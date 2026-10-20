import { WalletBalanceStatus } from '../transaction-type';

export interface WalletBalanceRecord {
    id: number;
    walletId: number;
    transactionId: number;
    originalAmount: number;
    availableAmount: number;
    balanceStatus: WalletBalanceStatus;
}

export interface CreateWalletBalanceInput {
    transactionId: number;
    walletId: number;
    originalAmount: number;
    availableAmount: number;
    balanceStatus?: WalletBalanceStatus;
    expirationDate: Date;
    createdBy: number;
}

export interface UpdateWalletBalanceInput {
    availableAmount: number;
    updatedBy: number;
    balanceStatus?: WalletBalanceStatus;
}

export interface WalletBalancePort {
    create(input: CreateWalletBalanceInput): Promise<WalletBalanceRecord>;
    update(id: number, updates: UpdateWalletBalanceInput): Promise<void>;
    findAllAvailableByWalletId(walletId: number): Promise<WalletBalanceRecord[]>;
    findAllByTransactionIdAndWalletId(transactionId: number, walletId: number): Promise<WalletBalanceRecord[]>;
    findAllNegativeByWalletId(walletId: number): Promise<WalletBalanceRecord[]>;
}

export interface BalanceReferenceRecord {
    id: number;
    transactionId: number;
    walletBalanceId: number;
    amountUsed: number;
}

export interface CreateBalanceReferenceInput {
    transactionId: number;
    walletBalanceId: number;
    amountUsed: number;
    createdBy: number;
}

export interface BalanceReferencePort {
    create(input: CreateBalanceReferenceInput): Promise<void>;
    findAllByTransactionId(transactionId: number): Promise<BalanceReferenceRecord[]>;
}

export interface BalanceUnit {
    walletBalances: WalletBalancePort;
    references: BalanceReferencePort;
}
