import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { JobPublisher } from './job-publisher.service';
import { DisabledQueueSender, QUEUE_SENDER, SqsQueueSender } from './queue-sender';

@Global()
@Module({
  providers: [
    {
      provide: QUEUE_SENDER,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => (c.queueUrl ? new SqsQueueSender(c.queueUrl, c.awsRegion, c.awsEndpoint) : new DisabledQueueSender()),
    },
    JobPublisher,
  ],
  exports: [JobPublisher, QUEUE_SENDER],
})
export class QueueModule {}
