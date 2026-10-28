import { Injectable } from '@nestjs/common';
import { CommodoLoggerService } from '@commodo-sas/shared-libs/observability';
import { TransactionBalanceManagerService } from '../../services/transaction-balance-manager.service';
import {
    MicrobalanceDeadlineExceededError,
    MicrobalanceDependencyPendingError,
    MicrobalanceRuleError,
} from '../../../domain/errors/microbalance.errors';
import { MicrobalanceEnvelope, movementsFromEnvelope } from '../../../domain/models/microbalance-event';
import { MicrobalanceMovement } from '../../../domain/interfaces/microbalance-movement.interface';
import { TransactionType } from '../../../domain/enums/transaction-type.enum';
import { MicrobalanceStore, MicrobalanceUnit } from '../../../domain/ports/secondary/microbalance-store.port';

/** Validated event plus the context needed to process it. */
export interface ApplyMicrobalancesInput {
    envelope: MicrobalanceEnvelope;
    expectedEnvironment: string;
    /** Absolute epoch milliseconds after which transaction retries must stop. */
    deadlineAt: number;
}

/** Result of one delivery; every variant allows the message to be acknowledged. */
export type ApplyMicrobalancesOutcome =
    | { status: 'applied'; applied: number; skipped: number }
    | { status: 'duplicate' }
    | { status: 'ignored'; reason: 'environment_mismatch' | 'no_registered_user' };

/**
 * Applies the microbalances of one event in a single database transaction: claims the event, locks the wallets,
 * skips movements that already have microbalances and applies the rest. Any failure rolls the whole event back,
 * including the claim, so the delivery can be retried. Macro wallet balances are never written here.
 */
@Injectable()
export class ApplyMicrobalancesService {
    private readonly balances = new TransactionBalanceManagerService();

    /**
     * @param store - Port that runs the movements in one transaction.
     * @param logger - Structured logger for the processing outcomes.
     */
    constructor(
        private readonly store: MicrobalanceStore,
        private readonly logger: CommodoLoggerService,
    ) {}

    /**
     * Processes one validated event in a single transaction and reports how it ended.
     * @throws MicrobalanceDependencyPendingError when a billing child movement must wait for its antecedent.
     * @throws MicrobalanceRuleError when a wallet is missing or a balance rule rejects the movement.
     */
    async execute({ envelope, expectedEnvironment, deadlineAt }: ApplyMicrobalancesInput): Promise<ApplyMicrobalancesOutcome> {
        // Events published for another environment are acknowledged without being processed.
        if (envelope.environment.toUpperCase() !== expectedEnvironment.toUpperCase()) {
            return { status: 'ignored', reason: 'environment_mismatch' };
        }

        // Validate the payload and derive the movements before opening a database transaction.
        const movements = movementsFromEnvelope(envelope);

        return this.store.transaction(
            async (unit) => {
                // Step 1: claim the event inside the transaction; a conflict means a duplicate delivery.
                if (!(await unit.claimEvent(envelope.eventId, envelope.eventType))) return { status: 'duplicate' } as const;
                // Events without a registered user create no microbalances, as in the legacy consumer.
                if (movements.length === 0) return { status: 'ignored', reason: 'no_registered_user' } as const;

                // Step 2: lock the wallets in a stable order so concurrent events serialize.
                await this.lockAndValidateWallets(unit, movements);

                // Step 3: apply each movement; one failure rolls back the claim and every movement.
                let applied = 0;
                let skipped = 0;
                for (const movement of movements) {
                    // The consumer stops waiting for this event when the budget ends but cannot cancel the transaction,
                    // so the work stops itself: throwing rolls back and releases the wallet locks held for other events.
                    if (Date.now() >= deadlineAt) throw new MicrobalanceDeadlineExceededError();
                    if (await this.applyMovement(unit, movement)) applied++;
                    else skipped++;
                }
                return { status: 'applied', applied, skipped } as const;
            },
            { deadlineAt },
        );
    }

    /**
     * Locks every wallet of the event once and verifies that they all exist.
     * @throws MicrobalanceRuleError when the sender or receiver wallet does not exist.
     */
    private async lockAndValidateWallets(unit: MicrobalanceUnit, movements: MicrobalanceMovement[]): Promise<void> {
        // Each wallet is locked once, even when several movements share it.
        const requested = [...new Set(movements.flatMap((m) => [m.walletTransferId, m.walletReceiverId]).filter((id): id is number => !!id))];
        // The lock returns the wallets that exist; a missing one aborts the whole event.
        const found = new Set(await unit.lockWallets(requested));
        for (const movement of movements) {
            if (movement.walletTransferId && !found.has(movement.walletTransferId)) {
                throw new MicrobalanceRuleError('sender_wallet_not_found', `No se encontró la billetera emisora con ID ${movement.walletTransferId}`);
            }
            if (movement.walletReceiverId && !found.has(movement.walletReceiverId)) {
                throw new MicrobalanceRuleError(
                    'receiver_wallet_not_found',
                    `No se encontró la billetera receptora con ID ${movement.walletReceiverId}`,
                );
            }
        }
    }

    /**
     * Applies one movement unless it is a legacy no-op, was already applied or still waits for its antecedent.
     * @returns True when bags were written; false when the movement was skipped.
     * @throws MicrobalanceDependencyPendingError when the antecedent has no microbalances yet.
     */
    private async applyMovement(unit: MicrobalanceUnit, movement: MicrobalanceMovement): Promise<boolean> {
        // A reversal that only touches a credit line has no bags to reverse (legacy rule).
        if (movement.transactionType === TransactionType.REVERSE && !movement.walletTransferId && !movement.walletReceiverId) {
            this.logSkip('reverse_without_wallets', movement);
            return false;
        }

        // Idempotency across events: the same movement may arrive through different events.
        if (await unit.isMovementApplied(movement.transactionId, movement.walletReceiverId)) {
            this.logSkip('already_applied', movement);
            return false;
        }

        // Billing children wait for their antecedent; the delivery is retried while it is pending.
        if (movement.dependsOnTransactionId && !(await unit.isAntecedentSettled(movement.dependsOnTransactionId))) {
            throw new MicrobalanceDependencyPendingError('antecedent_pending', 'The antecedent movement has no microbalances yet');
        }

        // Apply the balance rule of the movement transaction type.
        await this.balances.apply(movement, unit);
        return true;
    }

    /** Logs why a movement was skipped, with identifiers only and never amounts or users. */
    private logSkip(reason: string, movement: MicrobalanceMovement): void {
        this.logger.business({
            level: 'info',
            event: 'microbalances.movement.skipped',
            message: 'Microbalance movement skipped',
            outcome: 'success',
            business: { reason, transactionId: movement.transactionId, transactionTypeId: movement.transactionType },
        });
    }
}
