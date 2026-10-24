import { Column, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from './transformers';

/** Audit columns every business table shares; only the columns this worker reads or writes are mapped. */
export abstract class RowBase {
    @PrimaryColumn('bigint', { unique: true, generated: true, primary: true, transformer: bigintTransformer })
    id?: number;

    @Column('int', { nullable: true, name: 'create_by' })
    createdBy?: number;

    @CreateDateColumn({ name: 'created_at' })
    createdAt?: Date;

    @Column('int', { nullable: true, select: false, name: 'update_by' })
    updatedBy?: number;

    @UpdateDateColumn({ type: 'timestamp', select: false, name: 'update_at', nullable: true })
    updatedAt?: Date;

    @Column('boolean', { default: true })
    status?: boolean;
}
