import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { SnapshotBuilder } from './snapshot.builder';

@Module({ controllers: [RequestsController], providers: [RequestsService, SnapshotBuilder], exports: [RequestsService] })
export class RequestsModule {}
