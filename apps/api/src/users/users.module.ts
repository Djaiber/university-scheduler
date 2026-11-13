import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { CognitoUserInviter, NoopUserInviter, USER_INVITER } from './user-inviter';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [
    {
      provide: USER_INVITER,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        c.cognitoUserPoolId ? new CognitoUserInviter(c.cognitoUserPoolId, c.awsRegion, c.awsEndpoint) : new NoopUserInviter(),
    },
  ],
})
export class UsersModule {}
