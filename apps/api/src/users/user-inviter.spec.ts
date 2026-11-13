import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoUserInviter, NoopUserInviter } from './user-inviter';

const exists = () => new UsernameExistsException({ message: 'exists', $metadata: {} });

describe('CognitoUserInviter', () => {
  let send: jest.SpyInstance;
  beforeEach(() => { send = jest.spyOn(CognitoIdentityProviderClient.prototype, 'send'); });
  afterEach(() => send.mockRestore());

  it('crea la cuenta y deja que Cognito envíe el correo con la contraseña temporal', async () => {
    send.mockResolvedValueOnce({});
    await expect(new CognitoUserInviter('pool', 'us-east-1').invite('a@unbosque.edu.co', 'Ana')).resolves.toBe('SENT');
    const cmd = send.mock.calls[0][0] as AdminCreateUserCommand;
    expect(cmd.input).toMatchObject({ UserPoolId: 'pool', Username: 'a@unbosque.edu.co', DesiredDeliveryMediums: ['EMAIL'] });
    expect(cmd.input.MessageAction).toBeUndefined();
    expect(cmd.input.UserAttributes).toEqual(expect.arrayContaining([{ Name: 'name', Value: 'Ana' }, { Name: 'email_verified', Value: 'true' }]));
  });

  it('reenvía la invitación si la cuenta existe y aún no se estrenó', async () => {
    send.mockRejectedValueOnce(exists()).mockResolvedValueOnce({ UserStatus: 'FORCE_CHANGE_PASSWORD' }).mockResolvedValueOnce({});
    await expect(new CognitoUserInviter('pool', 'us-east-1').invite('a@unbosque.edu.co')).resolves.toBe('RESENT');
    expect(send.mock.calls[1][0]).toBeInstanceOf(AdminGetUserCommand);
    expect((send.mock.calls[2][0] as AdminCreateUserCommand).input.MessageAction).toBe('RESEND');
  });

  it('no reenvía nada a quien ya cambió su contraseña', async () => {
    send.mockRejectedValueOnce(exists()).mockResolvedValueOnce({ UserStatus: 'CONFIRMED' });
    await expect(new CognitoUserInviter('pool', 'us-east-1').invite('a@unbosque.edu.co')).resolves.toBe('ALREADY_ACTIVE');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('propaga otros errores de Cognito', async () => {
    send.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(new CognitoUserInviter('pool', 'us-east-1').invite('a@unbosque.edu.co')).rejects.toThrow('AccessDenied');
  });
});

it('sin Cognito configurado no envía nada', async () => {
  await expect(new NoopUserInviter().invite()).resolves.toBe('NOT_CONFIGURED');
});
