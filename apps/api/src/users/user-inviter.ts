import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

export const USER_INVITER = Symbol('USER_INVITER');

/**
 * Resultado de invitar a una persona del directorio:
 * - SENT: se creó la cuenta en Cognito y se envió el correo con la contraseña temporal.
 * - RESENT: la cuenta existía sin estrenar (FORCE_CHANGE_PASSWORD); se reenvió el correo con una contraseña nueva.
 * - ALREADY_ACTIVE: la persona ya cambió su contraseña; no hay nada que enviar.
 * - NOT_CONFIGURED: entorno sin Cognito (desarrollo local, pruebas).
 * - FAILED: Cognito rechazó la operación; el directorio queda guardado igualmente.
 */
export type InvitationStatus = 'SENT' | 'RESENT' | 'ALREADY_ACTIVE' | 'NOT_CONFIGURED' | 'FAILED';

/** Abstracción del alta de cuentas para poder probar sin AWS. */
export interface UserInviter {
  invite(email: string, displayName?: string | null): Promise<InvitationStatus>;
}

export class NoopUserInviter implements UserInviter {
  async invite(): Promise<InvitationStatus> {
    return 'NOT_CONFIGURED';
  }
}

/**
 * Crea la cuenta en Cognito con AdminCreateUser: Cognito genera la contraseña temporal y envía el correo
 * de invitación con la plantilla del user pool (terraform/modules/auth/invite-email.html).
 */
export class CognitoUserInviter implements UserInviter {
  private readonly client: CognitoIdentityProviderClient;

  constructor(private readonly userPoolId: string, region: string, endpoint?: string) {
    this.client = new CognitoIdentityProviderClient({ region, endpoint });
  }

  async invite(email: string, displayName?: string | null): Promise<InvitationStatus> {
    const attributes = [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      ...(displayName ? [{ Name: 'name', Value: displayName }] : []),
    ];
    try {
      await this.client.send(new AdminCreateUserCommand({
        UserPoolId: this.userPoolId, Username: email, UserAttributes: attributes, DesiredDeliveryMediums: ['EMAIL'],
      }));
      return 'SENT';
    } catch (err) {
      if (!(err instanceof UsernameExistsException)) throw err;
    }
    const existing = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: email }));
    if (existing.UserStatus !== 'FORCE_CHANGE_PASSWORD') return 'ALREADY_ACTIVE';
    await this.client.send(new AdminCreateUserCommand({
      UserPoolId: this.userPoolId, Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'],
    }));
    return 'RESENT';
  }
}
