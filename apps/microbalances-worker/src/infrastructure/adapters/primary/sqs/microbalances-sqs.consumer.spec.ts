import { ChangeMessageVisibilityCommand, DeleteMessageCommand, Message, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { ProcessingStatus } from '@commodo-sas/shared-libs/sqs';
import { ApplyMicrobalancesOutcome } from '../../../../application/use-cases/apply-microbalances/apply-microbalances.service';
import { MicrobalanceContractError, MicrobalanceDependencyPendingError, MicrobalanceRuleError } from '../../../../domain/errors/microbalance.errors';
import { MAX_EVENT_BYTES } from '../../../../domain/models/microbalance-event';
import { MicrobalancesWorkerConfiguration } from '../../../environment/microbalances-environment.utils';
import { MicrobalancesSqsConsumer } from './microbalances-sqs.consumer';

const baseConfig: MicrobalancesWorkerConfiguration = {
    enabled: true,
    environment: 'LOCAL',
    region: 'us-east-1',
    queueUrl: 'http://localstack:4566/queue/us-east-1/000000000000/commodo-local-loyalty-microbalances',
    concurrency: 2,
    batchSize: 1,
    waitTimeSeconds: 0,
    visibilityTimeoutSeconds: 60,
    processingTimeoutMs: 200,
    pollErrorBackoffMs: 100,
    retryBaseDelaySeconds: 5,
    retryMaxDelaySeconds: 300,
    dependencyMaxReceives: 4,
    shutdownDeadlineMs: 500,
    dbAttempts: 3,
    dbStatementTimeoutMs: 100,
    dbLockTimeoutMs: 100,
};

function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        eventId: 'evt-1',
        eventType: 'cashback.created',
        version: 1,
        occurredAt: '2026-10-20T10:00:00.000Z',
        service: 'test',
        environment: 'LOCAL',
        correlationId: 'corr-1',
        transactionId: '100',
        requestId: 'req-1',
        payload: {},
        ...overrides,
    });
}

function message(receiveCount = 1, messageBody = body()): Message {
    return { MessageId: 'msg-1', ReceiptHandle: 'receipt-1', Body: messageBody, Attributes: { ApproximateReceiveCount: String(receiveCount) } };
}

describe('MicrobalancesSqsConsumer', () => {
    let calls: string[];
    let send: jest.Mock;
    let client: { send: jest.Mock; destroy: jest.Mock };
    let execute: jest.Mock;
    let logs: { update: jest.Mock; save: jest.Mock };
    let dataSource: {
        initialize: jest.Mock;
        destroy: jest.Mock;
        isInitialized: boolean;
        options: { extra: { max: number } };
        getRepository: jest.Mock;
    };
    let logger: { queue: jest.Mock; runtime: jest.Mock };
    let requestContext: { run: jest.Mock };

    function build(config: Partial<MicrobalancesWorkerConfiguration> = {}): MicrobalancesSqsConsumer {
        return new MicrobalancesSqsConsumer(
            { getMicrobalancesWorkerConfiguration: () => ({ ...baseConfig, ...config }) } as never,
            client as never,
            dataSource as never,
            { execute } as never,
            logger as never,
            requestContext as never,
        );
    }

    const handle = (consumer: MicrobalancesSqsConsumer, sqsMessage: Message) =>
        (consumer as unknown as { handle: (m: Message) => Promise<void> }).handle(sqsMessage);

    const sent = <T>(type: new (...args: never[]) => T): T[] =>
        send.mock.calls.map(([command]) => command).filter((command) => command instanceof type);
    const events = () => logger.queue.mock.calls.map(([input]) => input.event);

    beforeEach(() => {
        calls = [];
        send = jest.fn(async (command: unknown) => {
            calls.push(command.constructor.name);
            return {};
        });
        client = { send, destroy: jest.fn() };
        execute = jest.fn(async (): Promise<ApplyMicrobalancesOutcome> => {
            calls.push('execute');
            return { status: 'applied', applied: 1, skipped: 0 };
        });
        logs = { update: jest.fn().mockResolvedValue(undefined), save: jest.fn(async (row: object) => ({ ...row, id: 'log-1' })) };
        dataSource = {
            initialize: jest.fn().mockResolvedValue(undefined),
            destroy: jest.fn().mockResolvedValue(undefined),
            isInitialized: true,
            options: { extra: { max: 30 } },
            getRepository: jest.fn(() => ({ ...logs, create: (row: object) => row })),
        };
        logger = { queue: jest.fn(), runtime: jest.fn() };
        requestContext = { run: jest.fn((_context: unknown, callback: () => unknown) => callback()) };
    });

    describe('successful processing', () => {
        it('acknowledges the message only after the use case committed', async () => {
            await handle(build(), message());

            expect(calls).toEqual(['execute', 'DeleteMessageCommand']);
            expect(sent(DeleteMessageCommand)[0].input).toEqual({ QueueUrl: baseConfig.queueUrl, ReceiptHandle: 'receipt-1' });
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ status: ProcessingStatus.PROCESSED }));
            expect(events()).toContain('microbalances.message.processed');
        });

        it('passes the validated envelope, expected environment and a deadline to the use case', async () => {
            await handle(build(), message());

            const [input] = execute.mock.calls[0];
            expect(input.envelope).toMatchObject({ eventId: 'evt-1', eventType: 'cashback.created' });
            expect(input.expectedEnvironment).toBe('LOCAL');
            expect(input.deadlineAt).toBeGreaterThan(Date.now());
        });

        it('runs the use case inside the correlation context of the message', async () => {
            await handle(build(), message());

            expect(requestContext.run).toHaveBeenCalledWith(
                expect.objectContaining({ requestId: 'req-1', correlationId: 'corr-1', transactionId: '100' }),
                expect.any(Function),
            );
        });

        it('acknowledges duplicates and ignored events and records the duplicate', async () => {
            execute.mockResolvedValueOnce({ status: 'duplicate' });
            await handle(build(), message());
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ status: ProcessingStatus.SKIPPED_DUPLICATE }));

            execute.mockResolvedValueOnce({ status: 'ignored', reason: 'environment_mismatch' });
            await handle(build(), message());

            expect(sent(DeleteMessageCommand)).toHaveLength(2);
            expect(sent(ChangeMessageVisibilityCommand)).toHaveLength(0);
        });

        it('does not fail when the acknowledgement fails after the commit and warns instead', async () => {
            send.mockRejectedValueOnce(new Error('network'));

            await expect(handle(build(), message())).resolves.toBeUndefined();
            expect(events()).toContain('microbalances.message.delete_failed');
            expect(events()).not.toContain('microbalances.message.processed');
        });

        it('does not stop when the processing log cannot be written', async () => {
            logs.save.mockRejectedValue(new Error('log table unavailable'));
            logs.update.mockRejectedValue(new Error('log table unavailable'));

            await handle(build(), message());

            expect(sent(DeleteMessageCommand)).toHaveLength(1);
            expect(events()).toContain('microbalances.processing_log.failed');
        });
    });

    describe('failures', () => {
        it('keeps the message and delays it with exponential backoff on a transient failure', async () => {
            execute.mockRejectedValue(new Error('connection reset'));

            await handle(build(), message(1));
            await handle(build(), message(3));
            await handle(build(), message(20));

            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            expect(sent(ChangeMessageVisibilityCommand).map((c) => c.input.VisibilityTimeout)).toEqual([5, 20, 300]);
            expect(logs.update).toHaveBeenLastCalledWith(
                'log-1',
                expect.objectContaining({ status: ProcessingStatus.FAILED, errorMessage: 'transient:Error' }),
            );
        });

        it('records the database error code of a transient failure', async () => {
            execute.mockRejectedValue(Object.assign(new Error('deadlock'), { driverError: { code: '40P01' } }));

            await handle(build(), message());

            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'transient:40P01' }));
        });

        it('keeps a rule failure for retry and eventual DLQ', async () => {
            execute.mockRejectedValue(new MicrobalanceRuleError('insufficient_balance', 'insufficient'));

            await handle(build(), message(2));

            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            expect(sent(ChangeMessageVisibilityCommand)[0].input.VisibilityTimeout).toBe(10);
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'rule:insufficient_balance' }));
        });

        it('keeps a message that cannot be parsed without calling the use case', async () => {
            await handle(build(), message(1, 'not json'));

            expect(execute).not.toHaveBeenCalled();
            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            expect(sent(ChangeMessageVisibilityCommand)).toHaveLength(1);
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'contract:malformed_body' }));
        });

        it('keeps an envelope that fails the contract', async () => {
            await handle(build(), message(1, body({ eventType: 'raffle.created' })));

            expect(execute).not.toHaveBeenCalled();
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'contract:unsupported_event' }));
        });

        it('keeps a message above the size budget', async () => {
            await handle(build(), message(1, body({ padding: 'x'.repeat(MAX_EVENT_BYTES) })));

            expect(execute).not.toHaveBeenCalled();
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'contract:event_too_large' }));
        });

        it('treats a use case that exceeds its time budget as a transient failure', async () => {
            execute.mockImplementation(() => new Promise(() => undefined));

            await handle(build({ processingTimeoutMs: 30 }), message());

            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'transient:ProcessingTimeoutError' }));
        });

        it('still logs the failure when the retry delay cannot be applied', async () => {
            execute.mockRejectedValue(new Error('boom'));
            send.mockRejectedValueOnce(new Error('network'));

            await handle(build(), message());

            expect(events()).toContain('microbalances.message.backoff_failed');
            expect(events()).toContain('microbalances.message.not_processed');
        });

        it('logs failures without payloads, amounts or user identifiers', async () => {
            execute.mockRejectedValue(new Error('boom'));

            await handle(build(), message());

            const serialized = JSON.stringify(logger.queue.mock.calls);
            expect(serialized).not.toMatch(/payload|amount|userId|ReceiptHandle|receipt-1/);
        });
    });

    describe('movements waiting for an antecedent', () => {
        const pending = () => new MicrobalanceDependencyPendingError('antecedent_pending', 'waiting');

        it('retries with backoff while the attempts are below the limit', async () => {
            execute.mockRejectedValue(pending());

            await handle(build(), message(3));

            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            expect(sent(ChangeMessageVisibilityCommand)[0].input.VisibilityTimeout).toBe(20);
            expect(logs.update).toHaveBeenLastCalledWith('log-1', expect.objectContaining({ errorMessage: 'dependency:antecedent_pending' }));
            expect(events()).not.toContain('microbalances.dependency.abandoned');
        });

        it('logs and acknowledges the message after the maximum receives so it never reaches the DLQ', async () => {
            execute.mockRejectedValue(pending());

            await handle(build(), message(4));

            expect(sent(DeleteMessageCommand)).toHaveLength(1);
            expect(sent(ChangeMessageVisibilityCommand)).toHaveLength(0);
            expect(events()).toContain('microbalances.dependency.abandoned');
            expect(logs.update).toHaveBeenLastCalledWith(
                'log-1',
                expect.objectContaining({ status: ProcessingStatus.FAILED, errorMessage: 'dependency:antecedent_pending:abandoned' }),
            );
            const abandoned = logger.queue.mock.calls.map(([input]) => input).find((input) => input.event === 'microbalances.dependency.abandoned');
            expect(abandoned).toMatchObject({ level: 'error', outcome: 'failure', transactionId: '100', queue: { eventId: 'evt-1', attempt: 4 } });
        });

        it('only abandons dependency failures, not other failures at the same attempt', async () => {
            execute.mockRejectedValue(new MicrobalanceContractError('invalid_field', 'bad'));

            await handle(build(), message(4));

            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            expect(sent(ChangeMessageVisibilityCommand)).toHaveLength(1);
        });

        it('reports an abandoned movement even when its acknowledgement fails', async () => {
            execute.mockRejectedValue(pending());
            send.mockRejectedValueOnce(new Error('network'));

            await handle(build(), message(5));

            const abandoned = logger.queue.mock.calls.map(([input]) => input).find((input) => input.event === 'microbalances.dependency.abandoned');
            expect(abandoned.metadata).toMatchObject({ acknowledged: false });
        });
    });

    describe('lifecycle', () => {
        it('does not open the database or poll when disabled', async () => {
            const consumer = build({ enabled: false });

            await consumer.onModuleInit();
            await consumer.onModuleDestroy();

            expect(send).not.toHaveBeenCalled();
            expect(client.destroy).not.toHaveBeenCalled();
            expect(logger.runtime).toHaveBeenCalledWith(expect.objectContaining({ event: 'microbalances.consumer.disabled' }));
        });

        it('refuses to start when the shared pool cannot serve every polling loop', async () => {
            dataSource.options.extra.max = 4;
            const consumer = build({ concurrency: 3 });

            await expect(consumer.onModuleInit()).rejects.toThrow('MICROBALANCES_CONCURRENCY + 2');
            expect(send).not.toHaveBeenCalled();
        });

        it('starts one polling loop per configured worker with the configured receive options', async () => {
            let aborted: () => void;
            send.mockImplementation(
                (_command: unknown, options: { abortSignal: AbortSignal }) =>
                    new Promise((_resolve, reject) => {
                        aborted = () => reject(new Error('aborted'));
                        options?.abortSignal.addEventListener('abort', aborted);
                    }),
            );
            const consumer = build({ concurrency: 3, batchSize: 5, waitTimeSeconds: 7, visibilityTimeoutSeconds: 90, processingTimeoutMs: 1000 });

            await consumer.onModuleInit();

            const receives = sent(ReceiveMessageCommand);
            expect(receives).toHaveLength(3);
            expect(receives[0].input).toMatchObject({
                QueueUrl: baseConfig.queueUrl,
                MaxNumberOfMessages: 5,
                WaitTimeSeconds: 7,
                VisibilityTimeout: 90,
            });
            await consumer.onModuleDestroy();
        });

        it('stops polling, closes the client, leaves the pool to DBManagmentModule and keeps unprocessed messages on shutdown', async () => {
            send.mockImplementation(
                (_command: unknown, options: { abortSignal: AbortSignal }) =>
                    new Promise((_resolve, reject) => options?.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))),
            );
            const consumer = build();
            await consumer.onModuleInit();

            await consumer.onModuleDestroy();

            expect(client.destroy).toHaveBeenCalledTimes(1);
            expect(dataSource.destroy).not.toHaveBeenCalled();
            expect(events()).toContain('microbalances.consumer.stopped');
            expect(sent(DeleteMessageCommand)).toHaveLength(0);
            const stopped = logger.queue.mock.calls.map(([input]) => input).find((input) => input.event === 'microbalances.consumer.stopped');
            expect(stopped.outcome).toBe('success');
        });

        it('waits for the message in flight and reports a timeout when it exceeds the shutdown deadline', async () => {
            const stuck = new Promise<never>(() => undefined);
            send.mockImplementationOnce(async () => ({ Messages: [message()] }));
            send.mockImplementation(
                (_command: unknown, options: { abortSignal: AbortSignal }) =>
                    new Promise((_resolve, reject) => options?.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))),
            );
            execute.mockReturnValue(stuck);
            const consumer = build({ concurrency: 1, processingTimeoutMs: 300, shutdownDeadlineMs: 50 });
            await consumer.onModuleInit();
            await new Promise((resolve) => setTimeout(resolve, 20));

            await consumer.onModuleDestroy();

            const stopped = logger.queue.mock.calls.map(([input]) => input).find((input) => input.event === 'microbalances.consumer.stopped');
            expect(stopped).toMatchObject({ level: 'warn', outcome: 'timeout' });
            expect(sent(DeleteMessageCommand)).toHaveLength(0);
        });

        it('backs off and keeps polling after a receive error', async () => {
            send.mockRejectedValueOnce(new Error('network')).mockImplementation(
                (_command: unknown, options: { abortSignal: AbortSignal }) =>
                    new Promise((_resolve, reject) => options?.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))),
            );
            const consumer = build({ concurrency: 1, pollErrorBackoffMs: 20 });
            await consumer.onModuleInit();

            await new Promise((resolve) => setTimeout(resolve, 80));

            expect(events()).toContain('microbalances.poll.failed');
            expect(sent(ReceiveMessageCommand).length).toBeGreaterThanOrEqual(2);
            await consumer.onModuleDestroy();
        });
    });
});
