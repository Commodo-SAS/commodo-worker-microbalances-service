import { MicrobalanceStore, MicrobalanceUnit } from '../src/domain/ports/secondary/microbalance-store.port';
import {
    BalanceReferencePort,
    BalanceReferenceRecord,
    CreateBalanceReferenceInput,
} from '../src/domain/ports/secondary/transaction-balance-reference.port';
import {
    CreateWalletBalanceInput,
    UpdateWalletBalanceInput,
    WalletBalancePort,
    WalletBalanceRecord,
} from '../src/domain/ports/secondary/wallet-balance.port';
import { WalletBalanceStatus } from '../src/domain/enums/transaction-type.enum';

/** In-memory stand-in for the transaction-bound persistence, used by the rule and use case specs. */
export class InMemoryMicrobalanceUnit implements MicrobalanceUnit {
    bags: WalletBalanceRecord[] = [];
    referenceRows: BalanceReferenceRecord[] = [];
    claimed = new Set<string>();
    wallets = new Set<number>();
    transactions = new Map<number, { amount: number; unregisteredUserId?: number }>();
    lockedWallets: number[][] = [];
    private nextId = 1;

    readonly walletBalances: WalletBalancePort = {
        create: async (input: CreateWalletBalanceInput) => {
            const bag: WalletBalanceRecord = {
                id: this.nextId++,
                walletId: input.walletId,
                transactionId: input.transactionId,
                originalAmount: input.originalAmount,
                availableAmount: input.availableAmount,
                balanceStatus: input.balanceStatus ?? WalletBalanceStatus.AVAILABLE,
            };
            this.bags.push(bag);
            return { ...bag };
        },
        update: async (id: number, updates: UpdateWalletBalanceInput) => {
            const bag = this.bags.find((b) => b.id === id);
            bag.availableAmount = updates.availableAmount;
            if (updates.balanceStatus !== undefined) bag.balanceStatus = updates.balanceStatus;
        },
        findAllAvailableByWalletId: async (walletId: number) =>
            this.bags.filter((b) => b.walletId === walletId && b.balanceStatus === WalletBalanceStatus.AVAILABLE).map((b) => ({ ...b })),
        findAllByTransactionIdAndWalletId: async (transactionId: number, walletId: number) =>
            this.bags.filter((b) => b.transactionId === transactionId && b.walletId === walletId).map((b) => ({ ...b })),
        findAllNegativeByWalletId: async (walletId: number) =>
            this.bags
                .filter((b) => b.walletId === walletId && b.availableAmount < 0 && b.balanceStatus === WalletBalanceStatus.AVAILABLE)
                .map((b) => ({ ...b })),
    };

    readonly references: BalanceReferencePort = {
        create: async (input: CreateBalanceReferenceInput) => {
            this.referenceRows.push({ id: this.referenceRows.length + 1, ...input });
        },
        findAllByTransactionId: async (transactionId: number) => this.referenceRows.filter((r) => r.transactionId === transactionId),
    };

    async claimEvent(eventId: string, eventType: string): Promise<boolean> {
        const key = `${eventType}:${eventId}`;
        if (this.claimed.has(key)) return false;
        this.claimed.add(key);
        return true;
    }

    async lockWallets(walletIds: number[]): Promise<number[]> {
        this.lockedWallets.push(walletIds);
        return walletIds.filter((id) => this.wallets.has(id));
    }

    async isMovementApplied(transactionId: number, walletReceiverId?: number): Promise<boolean> {
        if (this.referenceRows.some((r) => r.transactionId === transactionId)) return true;
        return !!walletReceiverId && this.bags.some((b) => b.transactionId === transactionId && b.walletId === walletReceiverId);
    }

    async isAntecedentSettled(transactionId: number): Promise<boolean> {
        if (this.referenceRows.some((r) => r.transactionId === transactionId)) return true;
        if (this.bags.some((b) => b.transactionId === transactionId)) return true;
        const transaction = this.transactions.get(transactionId);
        return !!transaction && (!!transaction.unregisteredUserId || transaction.amount === 0);
    }

    seedBag(walletId: number, transactionId: number, availableAmount: number, balanceStatus = WalletBalanceStatus.AVAILABLE): WalletBalanceRecord {
        const bag: WalletBalanceRecord = {
            id: this.nextId++,
            walletId,
            transactionId,
            originalAmount: availableAmount,
            availableAmount,
            balanceStatus,
        };
        this.bags.push(bag);
        return bag;
    }

    bagsOf(walletId: number): WalletBalanceRecord[] {
        return this.bags.filter((b) => b.walletId === walletId);
    }
}

/** Store double that runs the work directly on an in-memory unit and counts the transactions it opened. */
export class InMemoryMicrobalanceStore implements MicrobalanceStore {
    transactions = 0;

    constructor(readonly unit: InMemoryMicrobalanceUnit) {}

    async transaction<T>(work: (unit: MicrobalanceUnit) => Promise<T>): Promise<T> {
        this.transactions++;
        return work(this.unit);
    }
}
