import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export const QUEUE_SENDER = Symbol('QUEUE_SENDER');

/** Abstracción del envío para poder probar sin AWS. */
export interface QueueSender {
  readonly enabled: boolean;
  send(body: string, attributes: Record<string, string>): Promise<{ messageId: string }>;
}

export class SqsQueueSender implements QueueSender {
  readonly enabled = true;
  private readonly client: SQSClient;

  constructor(private readonly queueUrl: string, region: string, endpoint?: string) {
    this.client = new SQSClient({ region, endpoint });
  }

  async send(body: string, attributes: Record<string, string>): Promise<{ messageId: string }> {
    const out = await this.client.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: body,
      MessageAttributes: Object.fromEntries(
        Object.entries(attributes).map(([k, v]) => [k, { DataType: 'String', StringValue: v }]),
      ),
    }));
    return { messageId: out.MessageId ?? '' };
  }
}

/** Sin SQS_QUEUE_URL (desarrollo sin cola): las ejecuciones quedan en el outbox. */
export class DisabledQueueSender implements QueueSender {
  readonly enabled = false;
  async send(): Promise<{ messageId: string }> {
    throw new Error('SQS_QUEUE_URL no configurado');
  }
}
