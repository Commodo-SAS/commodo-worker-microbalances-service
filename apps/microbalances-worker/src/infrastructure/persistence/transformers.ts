import { ValueTransformer } from 'typeorm';

export const bigintTransformer: ValueTransformer = {
    to: (value?: number | null) => value,
    from: (value?: string | number | null) => (value === null || value === undefined ? value : Number(value)),
};

export const balanceTransformer: ValueTransformer = {
    to: (value: number) => value,
    from: (value: string) => (value ? parseFloat(value) : null),
};
