import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { CommodoLoggerService, RequestContextService } from '@commodo-sas/shared-libs/observability';
import { EventProcessingLogEntity, ProcessingStatus } from '@commodo-sas/shared-libs/sqs';
import { ApplyMicrobalances, ApplyMicrobalancesOutcome } from '../../application/apply-microbalances.use-case';
import { MicrobalanceContractError, MicrobalanceError } from '../../domain/errors';
import { MAX_EVENT_BYTES, MicrobalanceEnvelope, parseEnvelope } from '../../domain/events';
import { MICROBALANCES_CONFIG } from '../config';
import { MicrobalancesWorkerConfiguration } from '../environment/microbalances-environment.utils';
import { MICROBALANCES_SQS_CLIENT } from './microbalances-sqs.client';

class ProcessingTimeoutError extends Error {
    constructor() {
        super('Message processing exceeded its time budget');
        this.name = 'ProcessingTimeoutError';
    }
}

interface Failure {
    kind: 'contract' | 'rule' | 'dependency' | 'transient';
    code: string;
}

@Injectable()
export class MicrobalancesSqsConsumer implements OnModuleInit, OnModuleDestroy {
    private running = false;
    private loops: Promise<void>[] = [];
    private readonly stop = new AbortController();
    private readonly queueName: string;

    constructor(
        @Inject(MICROBALANCES_CONFIG) private readonly config: MicrobalancesWorkerConfiguration,
        @Inject(MICROBALANCES_SQS_CLIENT) private readonly client: SQSClient,
        private readonly dataSource: DataSource,
        private readonly applyMicrobalances: ApplyMicrobalances,
        private readonly logger: CommodoLoggerService,
        private readonly requestContext: RequestContextService,
    ) {
        this.queueName = this.config.queueUrl.split('/').pop() ?? 'microbalances';
    }

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
        await this.dataSource.initialize();
        this.running = true;
        this.loops = Array.from({ length: this.config.concurrency }, () => this.poll());
        this.logQueue('info', 'microbalances.consumer.started', 'Microbalances consumer started', 'receive', 'success', {
            metadata: { concurrency: this.config.concurrency, batchSize: this.config.batchSize },
        });
    }

    async onModuleDestroy(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        this.stop.abort();
        const drained = await this.waitForLoops();
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

    private async poll(): Promise<void> {
        while (this.running) {
            try {
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
                for (const message of Messages ?? []) {
                    if (!this.running) break;
                    await this.handle(message);
                }
            } catch {
                if (!this.running) break;
                this.logQueue('warn', 'microbalances.poll.failed', 'SQS polling failed; retrying with backoff', 'receive', 'failure');
                await this.sleep(this.config.pollErrorBackoffMs);
            }
        }
    }

    private async handle(message: Message): Promise<void> {
        const startedAt = Date.now();
        const receiveCount = Number.parseInt(message.Attributes?.ApproximateReceiveCount ?? '1', 10) || 1;
        const logId = await this.recordReceived(message, receiveCount);

        let envelope: MicrobalanceEnvelope;
        try {
            const body = message.Body ?? '';
            if (Buffer.byteLength(body, 'utf8') > MAX_EVENT_BYTES) {
                throw new MicrobalanceContractError('event_too_large', 'Microbalance event exceeds its size budget');
            }
            envelope = parseEnvelope(this.parseJson(body));
        } catch (error) {
            await this.fail(message, receiveCount, logId, undefined, error, startedAt);
            return;
        }

        await this.requestContext.run(
            {
                requestId: envelope.requestId,
                correlationId: message.MessageAttributes?.correlationId?.StringValue ?? envelope.correlationId,
                traceId: envelope.traceId,
                transactionId: envelope.transactionId,
            },
            async () => {
                await this.updateLog(logId, { eventId: envelope.eventId, eventType: envelope.eventType, traceId: envelope.traceId ?? null });
                let outcome: ApplyMicrobalancesOutcome;
                try {
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

    private async fail(
        message: Message,
        receiveCount: number,
        logId: string | undefined,
        envelope: MicrobalanceEnvelope | undefined,
        error: unknown,
        startedAt: number,
    ): Promise<void> {
        const failure = this.classify(error);
        const durationMs = Date.now() - startedAt;
        if (failure.kind === 'dependency' && receiveCount >= this.config.dependencyMaxReceives) {
            await this.abandonDependency(message, receiveCount, logId, envelope, failure, durationMs);
            return;
        }
        await this.updateLog(logId, { status: ProcessingStatus.FAILED, processingMs: durationMs, errorMessage: `${failure.kind}:${failure.code}` });
        const delay = Math.min(this.config.retryMaxDelaySeconds, this.config.retryBaseDelaySeconds * 2 ** Math.min(receiveCount - 1, 16));
        try {
            await this.client.send(
                new ChangeMessageVisibilityCommand({ QueueUrl: this.config.queueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: delay }),
            );
        } catch {
            this.logQueue('warn', 'microbalances.message.backoff_failed', 'Message retry delay could not be applied', 'retry', 'failure', {
                envelope,
                message,
                receiveCount,
            });
        }
        const pending = failure.kind === 'dependency';
        this.logQueue(pending ? 'warn' : 'error', 'microbalances.message.not_processed', 'Microbalances message not processed; it will be retried', 'retry', pending ? 'partial' : 'failure', {
            envelope,
            message,
            receiveCount,
            durationMs,
            metadata: { kind: failure.kind, code: failure.code, retryDelaySeconds: delay },
        });
    }

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
        let acknowledged = true;
        try {
            await this.client.send(new DeleteMessageCommand({ QueueUrl: this.config.queueUrl, ReceiptHandle: message.ReceiptHandle }));
        } catch {
            acknowledged = false;
        }
        this.logQueue('error', 'microbalances.dependency.abandoned', 'Antecedent movement never settled; the movement was not applied', 'process', 'failure', {
            envelope,
            message,
            receiveCount,
            durationMs,
            metadata: { code: failure.code, acknowledged },
        });
    }

    private classify(error: unknown): Failure {
        if (error instanceof MicrobalanceError) return { kind: error.kind, code: error.code };
        const driverCode = (error as { driverError?: { code?: string } })?.driverError?.code;
        return { kind: 'transient', code: driverCode ?? (error instanceof Error ? error.name : 'unknown') };
    }

    private parseJson(body: string): unknown {
        try {
            return JSON.parse(body);
        } catch {
            throw new MicrobalanceContractError('malformed_body', 'Malformed microbalance message body');
        }
    }

    private async withTimeout<T>(work: Promise<T>): Promise<T> {
        let timer: NodeJS.Timeout;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ProcessingTimeoutError()), this.config.processingTimeoutMs);
        });
        return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
    }

    private async recordReceived(message: Message, receiveCount: number): Promise<string | undefined> {
        try {
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

    private async updateLog(logId: string | undefined, changes: Partial<EventProcessingLogEntity>): Promise<void> {
        if (!logId) return;
        try {
            await this.dataSource.getRepository(EventProcessingLogEntity).update(logId, changes);
        } catch {
            this.logQueue('warn', 'microbalances.processing_log.failed', 'Processing log could not be updated', 'process', 'degraded');
        }
    }

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

    private async waitForLoops(): Promise<boolean> {
        let timer: NodeJS.Timeout;
        const deadline = new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), this.config.shutdownDeadlineMs);
        });
        return Promise.race([Promise.all(this.loops).then(() => true as const), deadline]).finally(() => clearTimeout(timer));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
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
