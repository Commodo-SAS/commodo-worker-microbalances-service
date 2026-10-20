import { Injectable } from '@nestjs/common';
import { CommodoLoggerService } from '@commodo-sas/shared-libs/observability';
import { BalanceManager } from '../domain/balance-handlers/balance-manager';
import { MicrobalanceDependencyPendingError, MicrobalanceRuleError } from '../domain/errors';
import { MicrobalanceEnvelope, movementsFromEnvelope } from '../domain/events';
import { MicrobalanceMovement } from '../domain/movement';
import { TransactionType } from '../domain/transaction-type';
import { MicrobalanceStore, MicrobalanceUnit } from './ports/microbalance-store.port';

export interface ApplyMicrobalancesInput {
    envelope: MicrobalanceEnvelope;
    expectedEnvironment: string;
    deadlineAt: number;
}

export type ApplyMicrobalancesOutcome =
    | { status: 'applied'; applied: number; skipped: number }
    | { status: 'duplicate' }
    | { status: 'ignored'; reason: 'environment_mismatch' | 'no_registered_user' };

@Injectable()
export class ApplyMicrobalances {
    private readonly balances = new BalanceManager();

    constructor(
        private readonly store: MicrobalanceStore,
        private readonly logger: CommodoLoggerService,
    ) {}

    async execute({ envelope, expectedEnvironment, deadlineAt }: ApplyMicrobalancesInput): Promise<ApplyMicrobalancesOutcome> {
        if (envelope.environment.toUpperCase() !== expectedEnvironment.toUpperCase()) {
            return { status: 'ignored', reason: 'environment_mismatch' };
        }

        const movements = movementsFromEnvelope(envelope);

        return this.store.transaction(
            async (unit) => {
                if (!(await unit.claimEvent(envelope.eventId, envelope.eventType))) return { status: 'duplicate' } as const;
                if (movements.length === 0) return { status: 'ignored', reason: 'no_registered_user' } as const;

                await this.lockAndValidateWallets(unit, movements);

                let applied = 0;
                let skipped = 0;
                for (const movement of movements) {
                    if (await this.applyMovement(unit, movement)) applied++;
                    else skipped++;
                }
                return { status: 'applied', applied, skipped } as const;
            },
            { deadlineAt },
        );
    }

    private async lockAndValidateWallets(unit: MicrobalanceUnit, movements: MicrobalanceMovement[]): Promise<void> {
        const requested = [...new Set(movements.flatMap((m) => [m.walletTransferId, m.walletReceiverId]).filter((id): id is number => !!id))];
        const found = new Set(await unit.lockWallets(requested));
        for (const movement of movements) {
            if (movement.walletTransferId && !found.has(movement.walletTransferId)) {
                throw new MicrobalanceRuleError('sender_wallet_not_found', `No se encontró la billetera emisora con ID ${movement.walletTransferId}`);
            }
            if (movement.walletReceiverId && !found.has(movement.walletReceiverId)) {
                throw new MicrobalanceRuleError('receiver_wallet_not_found', `No se encontró la billetera receptora con ID ${movement.walletReceiverId}`);
            }
        }
    }

    private async applyMovement(unit: MicrobalanceUnit, movement: MicrobalanceMovement): Promise<boolean> {
        if (movement.transactionType === TransactionType.REVERSE && !movement.walletTransferId && !movement.walletReceiverId) {
            this.logSkip('reverse_without_wallets', movement);
            return false;
        }

        if (await unit.isMovementApplied(movement.transactionId, movement.walletReceiverId)) {
            this.logSkip('already_applied', movement);
            return false;
        }

        if (movement.dependsOnTransactionId && !(await unit.isAntecedentSettled(movement.dependsOnTransactionId))) {
            throw new MicrobalanceDependencyPendingError('antecedent_pending', 'The antecedent movement has no microbalances yet');
        }

        await this.balances.apply(movement, unit);
        return true;
    }

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
