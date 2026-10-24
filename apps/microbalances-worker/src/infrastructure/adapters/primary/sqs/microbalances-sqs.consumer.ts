import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { CommodoLoggerService, RequestContextService } from '@commodo-sas/shared-libs/observability';
import { EventProcessingLogEntity, ProcessingStatus } from '@commodo-sas/shared-libs/sqs';
import {
    ApplyMicrobalancesService,
    ApplyMicrobalancesOutcome,
} from '../../../../application/use-cases/apply-microbalances/apply-microbalances.service';
import { MicrobalanceContractError, MicrobalanceError } from '../../../../domain/errors/microbalance.errors';
import { MAX_EVENT_BYTES, MicrobalanceEnvelope, parseEnvelope } from '../../../../domain/models/microbalance-event';
import { MICROBALANCES_CONFIG } from '../../../config/microbalances-worker.config';
import { MicrobalancesWorkerConfiguration } from '../../../environment/microbalances-environment.utils';
import { MICROBALANCES_SQS_CLIENT } from '../../secondary/sqs/microbalances-sqs.client';

/** The use case exceeded its time budget; treated as a transient failure so the message is retried. */
class ProcessingTimeoutError extends Error {
    constructor() {
        super('Message processing exceeded its time budget');
        this.name = 'ProcessingTimeoutError';
    }
}

/** Failure family and a stable code that is safe to log and to store in the processing log. */
interface Failure {
    kind: 'contract' | 'rule' | 'dependency' | 'transient';
    code: string;
}

/**
 * At-least-once SQS consumer. A message is acknowledged only after its database transaction committed; failures keep
 * it in the queue with an exponential visibility delay so the queue redrive policy decides when it reaches the DLQ.
 * A movement waiting for its antecedent is retried a bounded number of times and then logged and acknowledged, so it
 * never reaches the DLQ. On shutdown it stops polling, drains the messages in flight up to a deadline and closes the
 * client and the pool; anything not acknowledged is redelivered.
 */
@Injectable()
export class MicrobalancesSqsConsumer implements OnModuleInit, OnModuleDestroy {
    private running = false;
    private loops: Promise<void>[] = [];
    private readonly stop = new AbortController();
    private readonly queueName: string;

    /** Derives the queue name used in logs from the configured queue URL. */
    constructor(
        @Inject(MICROBALANCES_CONFIG) private readonly config: MicrobalancesWorkerConfiguration,
        @Inject(MICROBALANCES_SQS_CLIENT) private readonly client: SQSClient,
        private readonly dataSource: DataSource,
        private readonly applyMicrobalances: ApplyMicrobalancesService,
        private readonly logger: CommodoLoggerService,
        private readonly requestContext: RequestContextService,
    ) {
        this.queueName = this.config.queueUrl.split('/').pop() ?? 'microbalances';
    }

    /** Starts the polling loops when consumption is enabled; a disabled worker only logs that fact. */
    async onModuleInit(): Promise<void> {
        if (!this.config.enabled) {
            this.logger.runtime({
                level: 'info',
                event: 'microbalances.consumer.disabled',
                message: 'Microbalances consumer is disabled by configuration',
                outcome: 'success',
            });
            return;
        }
        // The connection is opened only when consumption is enabled, so a disabled worker never touches the database.
        await this.dataSource.initialize();
        this.running = true;
        // One independent polling loop per configured worker bounds the messages in flight.
        this.loops = Array.from({ length: this.config.concurrency }, () => this.poll());
        this.logQueue('info', 'microbalances.consumer.started', 'Microbalances consumer started', 'receive', 'success', {
            metadata: { concurrency: this.config.concurrency, batchSize: this.config.batchSize },
        });
    }

    /** Graceful shutdown: stop polling, drain the messages in flight up to the deadline and close the clients. */
    async onModuleDestroy(): Promise<void> {
        if (!this.running) return;
        // Stop polling first: abort the long poll and let the messages in flight finish within the deadline.
        this.running = false;
        this.stop.abort();
        const drained = await this.waitForLoops();
        // Close the clients only after the drain; unfinished messages are redelivered by SQS.
        this.client.destroy();
        if (this.dataSource.isInitialized) await this.dataSource.destroy();
        this.logQueue(
            drained ? 'info' : 'warn',
            'microbalances.consumer.stopped',
            drained ? 'Microbalances consumer stopped' : 'Microbalances consumer reached its shutdown deadline',
            'receive',
            drained ? 'success' : 'timeout',
        );
    }

    /** One polling loop: long poll, process the batch sequentially and back off when SQS fails. */
    private async poll(): Promise<void> {
        while (this.running) {
            try {
                // Long poll; the abort signal cancels it on shutdown.
                const { Messages } = await this.client.send(
                    new ReceiveMessageCommand({
                        QueueUrl: this.config.queueUrl,
                        MaxNumberOfMessages: this.config.batchSize,
                        WaitTimeSeconds: this.config.waitTimeSeconds,
                        VisibilityTimeout: this.config.visibilityTimeoutSeconds,
                        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
                        MessageAttributeNames: ['requestId', 'correlationId', 'transactionId'],
                    }),
                    { abortSignal: this.stop.signal },
                );
                // The messages of a batch are processed sequentially by this loop.
                for (const message of Messages ?? []) {
                    if (!this.running) break;
                    await this.handle(message);
                }
                // A polling error never stops the worker: back off and poll again unless it is shutting down.
            } catch {
                if (!this.running) break;
                this.logQueue('warn', 'microbalances.poll.failed', 'SQS polling failed; retrying with backoff', 'receive', 'failure');
                await this.sleep(this.config.pollErrorBackoffMs);
            }
        }
    }

    /** Parses, processes and settles one message; it never throws, so a bad message cannot stop the polling loop. */
    private async handle(message: Message): Promise<void> {
        const startedAt = Date.now();
        const receiveCount = Number.parseInt(message.Attributes?.ApproximateReceiveCount ?? '1', 10) || 1;
        // Step 1: leave a RECEIVED trace that survives a business rollback.
        const logId = await this.recordReceived(message, receiveCount);

        let envelope: MicrobalanceEnvelope;
        try {
            const body = message.Body ?? '';
            // Step 2: reject oversized or malformed messages before touching the database.
            if (Buffer.byteLength(body, 'utf8') > MAX_EVENT_BYTES) {
                throw new MicrobalanceContractError('event_too_large', 'Microbalance event exceeds its size budget');
            }
            envelope = parseEnvelope(this.parseJson(body));
        } catch (error) {
            // Contract failures are retried until the queue redrive policy sends them to the DLQ.
            await this.fail(message, receiveCount, logId, undefined, error, startedAt);
            return;
        }

        // Step 3: process inside the correlation context so every log of this message shares it.
        await this.requestContext.run(
            {
                requestId: envelope.requestId,
                correlationId: message.MessageAttributes?.correlationId?.StringValue ?? envelope.correlationId,
                traceId: envelope.traceId,
                transactionId: envelope.transactionId,
            },
            async () => {
                await this.updateLog(logId, { eventId: envelope.eventId, eventType: envelope.eventType, traceId: envelope.traceId ?? null });
                // The use case commits its transaction before returning; only then can the message be acknowledged.
                let outcome: ApplyMicrobalancesOutcome;
                try {
                    // The time budget stays below the visibility timeout so the message is not redelivered while processing.
                    outcome = await this.withTimeout(
                        this.applyMicrobalances.execute({
                            envelope,
                            expectedEnvironment: this.config.environment,
                            deadlineAt: startedAt + this.config.processingTimeoutMs,
                        }),
                    );
                } catch (error) {
                    await this.fail(message, receiveCount, logId, envelope, error, startedAt);
                    return;
                }
                await this.complete(message, receiveCount, logId, envelope, outcome, startedAt);
            },
        );
    }

    /** Records the successful outcome and acknowledges the message after the commit. */
    private async complete(
        message: Message,
        receiveCount: number,
        logId: string | undefined,
        envelope: MicrobalanceEnvelope,
        outcome: ApplyMicrobalancesOutcome,
        startedAt: number,
    ): Promise<void> {
        const durationMs = Date.now() - startedAt;
        await this.updateLog(logId, {
            status: outcome.status === 'duplicate' ? ProcessingStatus.SKIPPED_DUPLICATE : ProcessingStatus.PROCESSED,
            processingMs: durationMs,
            processedAt: new Date(),
        });
        try {
            // Acknowledge only after the commit. If this fails the message is redelivered and the idempotency claim turns it into a duplicate.
            await this.client.send(new DeleteMessageCommand({ QueueUrl: this.config.queueUrl, ReceiptHandle: message.ReceiptHandle }));
        } catch {
            this.logQueue('warn', 'microbalances.message.delete_failed', 'Message committed but its acknowledgement failed', 'delete', 'failure', {
                envelope,
                message,
                receiveCount,
                durationMs,
            });
            return;
        }
        this.logQueue('info', 'microbalances.message.processed', 'Microbalances message processed', 'process', 'success', {
            envelope,
            message,
            receiveCount,
            durationMs,
            metadata: { result: outcome.status, ...(outcome.status === 'applied' ? { applied: outcome.applied, skipped: outcome.skipped } : {}) },
        });
    }

    /** Keeps the message for retry with exponential backoff, or abandons it when a dependency never settles. */
    private async fail(
        message: Message,
        receiveCount: number,
        logId: string | undefined,
        envelope: MicrobalanceEnvelope | undefined,
        error: unknown,
        startedAt: number,
    ): Promise<void> {
        // Classify the failure: contract and rule errors do not heal by themselves, dependencies and transient errors may.
        const failure = this.classify(error);
        const durationMs = Date.now() - startedAt;
        // A movement waiting for an antecedent is not retried forever: after the limit it is logged and acknowledged so it never reaches the DLQ.
        if (failure.kind === 'dependency' && receiveCount >= this.config.dependencyMaxReceives) {
            await this.abandonDependency(message, receiveCount, logId, envelope, failure, durationMs);
            return;
        }
        await this.updateLog(logId, { status: ProcessingStatus.FAILED, processingMs: durationMs, errorMessage: `${failure.kind}:${failure.code}` });
        // Exponential backoff capped by configuration; SQS redelivers the message after this delay.
        const delay = Math.min(this.config.retryMaxDelaySeconds, this.config.retryBaseDelaySeconds * 2 ** Math.min(receiveCount - 1, 16));
        try {
            await this.client.send(
                new ChangeMessageVisibilityCommand({
                    QueueUrl: this.config.queueUrl,
                    ReceiptHandle: message.ReceiptHandle,
                    VisibilityTimeout: delay,
                }),
            );
        } catch {
            this.logQueue('warn', 'microbalances.message.backoff_failed', 'Message retry delay could not be applied', 'retry', 'failure', {
                envelope,
                message,
                receiveCount,
            });
        }
        // Waiting for a dependency is expected, so it is logged as a warning rather than an error.
        const pending = failure.kind === 'dependency';
        this.logQueue(
            pending ? 'warn' : 'error',
            'microbalances.message.not_processed',
            'Microbalances message not processed; it will be retried',
            'retry',
            pending ? 'partial' : 'failure',
            {
                envelope,
                message,
                receiveCount,
                durationMs,
                metadata: { kind: failure.kind, code: failure.code, retryDelaySeconds: delay },
            },
        );
    }

    /** Gives up on a movement whose antecedent never settled: logs an error and acknowledges the message so it never reaches the DLQ. */
    private async abandonDependency(
        message: Message,
        receiveCount: number,
        logId: string | undefined,
        envelope: MicrobalanceEnvelope | undefined,
        failure: Failure,
        durationMs: number,
    ): Promise<void> {
        await this.updateLog(logId, {
            status: ProcessingStatus.FAILED,
            processingMs: durationMs,
            errorMessage: `${failure.kind}:${failure.code}:abandoned`,
        });
        // Acknowledge the message so the movement stops being retried; the error log is the only trace left.
        let acknowledged = true;
        try {
            await this.client.send(new DeleteMessageCommand({ QueueUrl: this.config.queueUrl, ReceiptHandle: message.ReceiptHandle }));
        } catch {
            acknowledged = false;
        }
        this.logQueue(
            'error',
            'microbalances.dependency.abandoned',
            'Antecedent movement never settled; the movement was not applied',
            'process',
            'failure',
            {
                envelope,
                message,
                receiveCount,
                durationMs,
                metadata: { code: failure.code, acknowledged },
            },
        );
    }

    /**
     * Maps an error to its failure family and a loggable code.
     * @returns The kind and code; unknown errors are transient.
     */
    private classify(error: unknown): Failure {
        // Domain errors carry their own kind and a stable code.
        if (error instanceof MicrobalanceError) return { kind: error.kind, code: error.code };
        // Anything else is transient; the PostgreSQL error code, when present, is the safe thing to log.
        const driverCode = (error as { driverError?: { code?: string } })?.driverError?.code;
        return { kind: 'transient', code: driverCode ?? (error instanceof Error ? error.name : 'unknown') };
    }

    /**
     * Parses the message body.
     * @throws MicrobalanceContractError when the body is not valid JSON.
     */
    private parseJson(body: string): unknown {
        try {
            return JSON.parse(body);
        } catch {
            throw new MicrobalanceContractError('malformed_body', 'Malformed microbalance message body');
        }
    }

    /**
     * Races the work against the processing time budget.
     * @throws ProcessingTimeoutError when the budget is exceeded.
     */
    private async withTimeout<T>(work: Promise<T>): Promise<T> {
        // Race the work against the time budget; a timeout is treated as a transient failure.
        let timer: NodeJS.Timeout;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ProcessingTimeoutError()), this.config.processingTimeoutMs);
        });
        return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
    }

    /**
     * Writes the RECEIVED row of the processing log; the log is best effort and never blocks processing.
     * @returns The row id, or undefined when the log could not be written.
     */
    private async recordReceived(message: Message, receiveCount: number): Promise<string | undefined> {
        try {
            // The log row is written outside the business transaction, so it survives a rollback.
            const repository = this.dataSource.getRepository(EventProcessingLogEntity);
            const row = await repository.save(
                repository.create({
                    eventId: 'UNKNOWN',
                    eventType: 'UNKNOWN',
                    queueName: this.queueName,
                    sqsMessageId: message.MessageId ?? null,
                    receiveCount,
                    status: ProcessingStatus.RECEIVED,
                }),
            );
            return row.id;
        } catch {
            this.logQueue('warn', 'microbalances.processing_log.failed', 'Processing log could not be written', 'receive', 'degraded');
            return undefined;
        }
    }

    /** Updates the processing log row; best effort, a failure is logged and ignored. */
    private async updateLog(logId: string | undefined, changes: Partial<EventProcessingLogEntity>): Promise<void> {
        // Without a row there is nothing to update.
        if (!logId) return;
        try {
            await this.dataSource.getRepository(EventProcessingLogEntity).update(logId, changes);
        } catch {
            this.logQueue('warn', 'microbalances.processing_log.failed', 'Processing log could not be updated', 'process', 'degraded');
        }
    }

    /** Emits a structured queue log with correlation and identifiers only, never the payload or amounts. */
    private logQueue(
        level: 'info' | 'warn' | 'error',
        event: string,
        message: string,
        operation: 'receive' | 'process' | 'delete' | 'retry',
        outcome: 'success' | 'failure' | 'partial' | 'timeout' | 'degraded',
        extra: {
            envelope?: MicrobalanceEnvelope;
            message?: Message;
            receiveCount?: number;
            durationMs?: number;
            metadata?: Record<string, unknown>;
        } = {},
    ): void {
        this.logger.queue({
            level,
            event,
            message,
            outcome,
            context: MicrobalancesSqsConsumer.name,
            correlationId: extra.envelope?.correlationId,
            transactionId: extra.envelope?.transactionId,
            durationMs: extra.durationMs,
            metadata: extra.metadata,
            queue: {
                provider: 'sqs',
                queueName: this.queueName,
                operation,
                eventId: extra.envelope?.eventId,
                eventType: extra.envelope?.eventType,
                messageId: extra.message?.MessageId,
                attempt: extra.receiveCount,
            },
        });
    }

    /**
     * Waits for every polling loop to finish.
     * @returns False when the shutdown deadline is reached first.
     */
    private async waitForLoops(): Promise<boolean> {
        // Race the drain of the polling loops against the shutdown deadline.
        let timer: NodeJS.Timeout;
        const deadline = new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), this.config.shutdownDeadlineMs);
        });
        return Promise.race([Promise.all(this.loops).then(() => true as const), deadline]).finally(() => clearTimeout(timer));
    }

    /** Waits for the given time; shutdown aborts the wait so the loop can end immediately. */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            // The same handler resolves on timeout and on abort, and removes its own listener.
            const finish = () => {
                clearTimeout(timer);
                this.stop.signal.removeEventListener('abort', finish);
                resolve();
            };
            const timer = setTimeout(finish, ms);
            this.stop.signal.addEventListener('abort', finish, { once: true });
        });
    }
}
