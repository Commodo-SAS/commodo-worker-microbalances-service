import { EntityManager } from 'typeorm';
import { markProcessed } from '@commodo-sas/shared-libs/sqs';
import { MicrobalanceUnit } from '../../application/ports/microbalance-store.port';
import {
    BalanceReferencePort,
    BalanceReferenceRecord,
    CreateBalanceReferenceInput,
    CreateWalletBalanceInput,
    UpdateWalletBalanceInput,
    WalletBalancePort,
    WalletBalanceRecord,
} from '../../domain/ports/balance-unit';
import { TransactionBalanceReferenceRow } from './transaction-balance-reference.entity';
import { TransactionRow } from './transaction.entity';
import { WalletBalanceRow } from './wallet-balance.entity';
import { WalletRow } from './wallet.entity';

export const MICROBALANCES_CONSUMER = 'microbalances';

function toRecord(row: WalletBalanceRow): WalletBalanceRecord {
    return {
        id: row.id,
        walletId: row.walletId,
        transactionId: row.transactionId,
        originalAmount: row.originalAmount,
        availableAmount: row.availableAmount,
        balanceStatus: row.balanceStatus,
    };
}

class TypeOrmWalletBalances implements WalletBalancePort {
    constructor(private readonly manager: EntityManager) {}

    async create(input: CreateWalletBalanceInput): Promise<WalletBalanceRecord> {
        const entity = this.manager.create(WalletBalanceRow, input);
        return toRecord(await this.manager.save(WalletBalanceRow, entity));
    }

    async update(id: number, updates: UpdateWalletBalanceInput): Promise<void> {
        await this.manager.update(WalletBalanceRow, { id }, updates);
    }

    async findAllAvailableByWalletId(walletId: number): Promise<WalletBalanceRecord[]> {
        const rows = await this.manager
            .createQueryBuilder(WalletBalanceRow, 'walletBalance')
            .where('walletBalance.walletId = :walletId', { walletId })
            .andWhere('walletBalance.balanceStatus = :status', { status: 'AVAILABLE' })
            .andWhere('walletBalance.status = :active', { active: true })
            .orderBy('walletBalance.createdAt', 'ASC')
            .getMany();
        return rows.map(toRecord);
    }

    async findAllByTransactionIdAndWalletId(transactionId: number, walletId: number): Promise<WalletBalanceRecord[]> {
        const rows = await this.manager
            .createQueryBuilder(WalletBalanceRow, 'walletBalance')
            .where('walletBalance.transactionId = :transactionId', { transactionId })
            .andWhere('walletBalance.walletId = :walletId', { walletId })
            .orderBy('walletBalance.createdAt', 'ASC')
            .getMany();
        return rows.map(toRecord);
    }

    async findAllNegativeByWalletId(walletId: number): Promise<WalletBalanceRecord[]> {
        const rows = await this.manager
            .createQueryBuilder(WalletBalanceRow, 'walletBalance')
            .where('walletBalance.walletId = :walletId', { walletId })
            .andWhere('walletBalance.availableAmount < 0')
            .andWhere('walletBalance.balanceStatus IN (:...statuses)', { statuses: ['AVAILABLE'] })
            .andWhere('walletBalance.status = :active', { active: true })
            .orderBy('walletBalance.createdAt', 'ASC')
            .getMany();
        return rows.map(toRecord);
    }
}

class TypeOrmBalanceReferences implements BalanceReferencePort {
    constructor(private readonly manager: EntityManager) {}

    async create(input: CreateBalanceReferenceInput): Promise<void> {
        const reference = this.manager.create(TransactionBalanceReferenceRow, input);
        await this.manager.save(TransactionBalanceReferenceRow, reference);
    }

    async findAllByTransactionId(transactionId: number): Promise<BalanceReferenceRecord[]> {
        const rows = await this.manager.find(TransactionBalanceReferenceRow, { where: { transactionId } });
        return rows.map((row) => ({
            id: row.id,
            transactionId: row.transactionId,
            walletBalanceId: row.walletBalanceId,
            amountUsed: row.amountUsed,
        }));
    }
}

export class TypeOrmMicrobalanceUnit implements MicrobalanceUnit {
    readonly walletBalances: WalletBalancePort;
    readonly references: BalanceReferencePort;

    constructor(private readonly manager: EntityManager) {
        this.walletBalances = new TypeOrmWalletBalances(manager);
        this.references = new TypeOrmBalanceReferences(manager);
    }

    claimEvent(eventId: string, eventType: string): Promise<boolean> {
        return markProcessed(this.manager, { consumer: MICROBALANCES_CONSUMER, eventId, eventType });
    }

    async lockWallets(walletIds: number[]): Promise<number[]> {
        if (walletIds.length === 0) return [];
        const wallets = await this.manager
            .createQueryBuilder(WalletRow, 'wallet')
            .setLock('pessimistic_write')
            .where('wallet.id IN (:...walletIds)', { walletIds })
            .orderBy('wallet.id', 'ASC')
            .getMany();
        return wallets.map((wallet) => wallet.id);
    }

    async isMovementApplied(transactionId: number, walletReceiverId?: number): Promise<boolean> {
        if (await this.manager.exists(TransactionBalanceReferenceRow, { where: { transactionId } })) return true;
        if (!walletReceiverId) return false;
        return this.manager.exists(WalletBalanceRow, { where: { transactionId, walletId: walletReceiverId } });
    }

    async isAntecedentSettled(transactionId: number): Promise<boolean> {
        if (await this.manager.exists(TransactionBalanceReferenceRow, { where: { transactionId } })) return true;
        if (await this.manager.exists(WalletBalanceRow, { where: { transactionId } })) return true;
        const transaction = await this.manager.findOne(TransactionRow, { where: { id: transactionId } });
        return !!transaction && (!!transaction.unregisteredUserId || Number(transaction.amount) === 0);
    }
}
