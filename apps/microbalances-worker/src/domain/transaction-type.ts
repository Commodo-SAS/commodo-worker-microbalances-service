export enum TransactionType {
    REDEMPTION = 1,
    CASHBACK = 2,
    TRANSFER = 3,
    SERVICES_PURCHASES = 4,
    PURCHASE_RETURNS = 5,
    SURCHARGE = 6,
    COMMODOS_PURCHASE = 7,
    COMMODO_COMMISSION = 8,
    REFUND = 9,
    TAX = 10,
    CREDIT = 11,
    REVERSE = 12,
    SERVICE_PAYMENT = 13,
    REDEMPTION_COUPON = 14,
    BONUS = 15,
    STAMP_EXCHANGE = 17,
}

export enum WalletBalanceStatus {
    AVAILABLE = 'AVAILABLE',
    USED = 'USED',
    EXPIRED = 'EXPIRED',
    REVERSED = 'REVERSED',
}
