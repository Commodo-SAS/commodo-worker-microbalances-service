export interface MicrobalanceMovement {
    transactionId: number;
    transactionType: number;
    amount: number;
    walletTransferId?: number;
    walletReceiverId?: number;
    hasCreditLine: boolean;
    reverseParentTransactionId?: number;
    allowSenderDebt: boolean;
    createUserId: number;
    dependsOnTransactionId?: number;
}
