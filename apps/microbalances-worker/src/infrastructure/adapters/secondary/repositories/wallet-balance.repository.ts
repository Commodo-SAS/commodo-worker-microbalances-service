import { EntityManager } from 'typeorm';
import {
    CreateWalletBalanceInput,
    UpdateWalletBalanceInput,
    WalletBalancePort,
    WalletBalanceRecord,
} from '../../../../domain/ports/secondary/wallet-balance.port';
import { WalletBalanceRow } from './entities/wallet-balance.entity';

/** Maps the entity to the record the balance rules work with. */
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

/** Wallet bags persisted through the entity manager of the active transaction, with the same queries as the legacy repository. */
export class WalletBalanceRepository implements WalletBalancePort {
    constructor(private readonly manager: EntityManager) {}

    /** Persists a bag; the generated id and defaults come back with the saved entity. */
    async create(input: CreateWalletBalanceInput): Promise<WalletBalanceRecord> {
        const entity = this.manager.create(WalletBalanceRow, input);
        return toRecord(await this.manager.save(WalletBalanceRow, entity));
    }

    /** Updates only the provided fields of a bag. */
    async update(id: number, updates: UpdateWalletBalanceInput): Promise<void> {
        await this.manager.update(WalletBalanceRow, { id }, updates);
    }

    /** Active AVAILABLE bags of a wallet, oldest first, which is the FIFO consumption order. */
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

    /** Every bag a transaction created in a wallet, whatever its status. */
    async findAllByTransactionIdAndWalletId(transactionId: number, walletId: number): Promise<WalletBalanceRecord[]> {
        const rows = await this.manager
            .createQueryBuilder(WalletBalanceRow, 'walletBalance')
            .where('walletBalance.transactionId = :transactionId', { transactionId })
            .andWhere('walletBalance.walletId = :walletId', { walletId })
            .orderBy('walletBalance.createdAt', 'ASC')
            .getMany();
        return rows.map(toRecord);
    }

    /** Active AVAILABLE debt bags of a wallet (negative available amount), oldest first. */
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
