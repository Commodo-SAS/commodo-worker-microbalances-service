import { WalletBalanceStatus } from '../../enums/transaction-type.enum';

/** A wallet bag (microbalance) as the balance rules see it. */
export interface WalletBalanceRecord {
    id: number;
    walletId: number;
    transactionId: number;
    originalAmount: number;
    availableAmount: number;
    balanceStatus: WalletBalanceStatus;
}

/** Data needed to create a bag; the status defaults to AVAILABLE. */
export interface CreateWalletBalanceInput {
    transactionId: number;
    walletId: number;
    originalAmount: number;
    availableAmount: number;
    balanceStatus?: WalletBalanceStatus;
    expirationDate: Date;
    createdBy: number;
}

/** Fields a rule may change on an existing bag; an omitted status keeps its previous value. */
export interface UpdateWalletBalanceInput {
    availableAmount: number;
    updatedBy: number;
    balanceStatus?: WalletBalanceStatus;
}

/** Persistence of wallet bags inside the active database transaction. */
export interface WalletBalancePort {
    /**
     * Persists a new bag.
     * @returns The stored bag with its generated id.
     */
    create(input: CreateWalletBalanceInput): Promise<WalletBalanceRecord>;
    /** Updates the available amount and, optionally, the status of a bag. */
    update(id: number, updates: UpdateWalletBalanceInput): Promise<void>;
    /** AVAILABLE and active bags of the wallet, oldest first (FIFO consumption order). */
    findAllAvailableByWalletId(walletId: number): Promise<WalletBalanceRecord[]>;
    /**
     * One page of the spendable bags of the wallet (AVAILABLE, active and with a positive amount), oldest first.
     * Reading by pages keeps memory bounded for wallets with many bags; callers ask again after consuming a page.
     * @param walletId - Wallet whose bags are read.
     * @param limit - Page size.
     * @param excludeTransactionId - Bags created by this movement are never spent by it (self transfers).
     */
    findSpendableByWalletId(walletId: number, limit: number, excludeTransactionId: number): Promise<WalletBalanceRecord[]>;
    /** All bags that a transaction created in a wallet, whatever their status. */
    findAllByTransactionIdAndWalletId(transactionId: number, walletId: number): Promise<WalletBalanceRecord[]>;
    /** AVAILABLE and active debt bags (negative available amount), oldest first. */
    findAllNegativeByWalletId(walletId: number): Promise<WalletBalanceRecord[]>;
}
