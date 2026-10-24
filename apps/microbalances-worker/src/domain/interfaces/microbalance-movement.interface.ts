/**
 * One wallet movement whose microbalances (wallet bags and references) must be applied.
 * Macro wallet balances were already written by the API or billing and are never touched here.
 */
export interface MicrobalanceMovement {
    transactionId: number;
    transactionType: number;
    amount: number;
    walletTransferId?: number;
    walletReceiverId?: number;
    /** A credit line replaces the receiver wallet; only its presence matters to the rules. */
    hasCreditLine: boolean;
    reverseParentTransactionId?: number;
    allowSenderDebt: boolean;
    createUserId: number;
    /** Movement whose microbalances must be settled first (billing tax and commission children). */
    dependsOnTransactionId?: number;
}
