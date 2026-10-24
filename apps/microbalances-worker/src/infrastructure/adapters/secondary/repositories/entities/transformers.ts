import { ValueTransformer } from 'typeorm';

/** bigint ids come back as strings from PostgreSQL; the domain works with numbers. */
export const bigintTransformer: ValueTransformer = {
    to: (value?: number | null) => value,
    from: (value?: string | number | null) => (value === null || value === undefined ? value : Number(value)),
};

/** Decimal columns come back as strings; parsed with parseFloat to keep the legacy arithmetic. */
export const balanceTransformer: ValueTransformer = {
    to: (value: number) => value,
    from: (value: string) => (value ? parseFloat(value) : null),
};
