import { MicrobalancesWorkerConfiguration } from '../../../environment/microbalances-environment.utils';
import { MicrobalanceStoreRepository } from './microbalance-store.repository';

const config = { dbAttempts: 3, dbStatementTimeoutMs: 1000, dbLockTimeoutMs: 500 } as MicrobalancesWorkerConfiguration;

function driverError(code: string): Error {
    return Object.assign(new Error('driver'), { driverError: { code } });
}

describe('MicrobalanceStoreRepository', () => {
    let manager: { query: jest.Mock };
    let dataSource: { transaction: jest.Mock };
    let store: MicrobalanceStoreRepository;
    const farDeadline = () => ({ deadlineAt: Date.now() + 60000 });

    beforeEach(() => {
        manager = { query: jest.fn().mockResolvedValue([]) };
        dataSource = { transaction: jest.fn(async (_isolation: string, callback: (m: unknown) => unknown) => callback(manager)) };
        store = new MicrobalanceStoreRepository(config, dataSource as never);
    });

    it('runs the work in a READ COMMITTED transaction with bounded statement and lock timeouts', async () => {
        const result = await store.transaction(async () => 'done', farDeadline());

        expect(result).toBe('done');
        expect(dataSource.transaction).toHaveBeenCalledWith('READ COMMITTED', expect.any(Function));
        expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('set_config'), ['1000', '500']);
    });

    it.each(['40001', '40P01', '55P03'])('retries when PostgreSQL reports %s', async (code) => {
        const work = jest.fn().mockRejectedValueOnce(driverError(code)).mockResolvedValueOnce('ok');

        await expect(store.transaction(work, farDeadline())).resolves.toBe('ok');
        expect(work).toHaveBeenCalledTimes(2);
        expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it('does not retry other database errors or rule failures', async () => {
        const work = jest.fn().mockRejectedValue(driverError('23505'));

        await expect(store.transaction(work, farDeadline())).rejects.toThrow('driver');
        expect(work).toHaveBeenCalledTimes(1);
    });

    it('stops retrying after the configured number of attempts', async () => {
        const work = jest.fn().mockRejectedValue(driverError('40P01'));

        await expect(store.transaction(work, farDeadline())).rejects.toThrow('driver');
        expect(work).toHaveBeenCalledTimes(3);
    });

    it('does not retry when the remaining time cannot fit another attempt', async () => {
        const work = jest.fn().mockRejectedValue(driverError('40001'));

        await expect(store.transaction(work, { deadlineAt: Date.now() + 500 })).rejects.toThrow('driver');
        expect(work).toHaveBeenCalledTimes(1);
    });

    it('propagates a failing work callback so the transaction rolls back', async () => {
        const failure = new Error('rule failed');

        await expect(store.transaction(async () => Promise.reject(failure), farDeadline())).rejects.toBe(failure);
    });
});
