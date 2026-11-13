import { invitationMessage } from './UsersPage';

describe('invitationMessage', () => {
  it('confirma el envío de la contraseña temporal al guardar', () => {
    expect(invitationMessage('a@unbosque.edu.co', 'SENT', 'Usuario a@unbosque.edu.co guardado.')).toEqual({
      kind: 'ok', text: 'Usuario a@unbosque.edu.co guardado. Se envió a a@unbosque.edu.co un correo con su contraseña temporal.',
    });
  });
  it('marca como error un envío fallido para que se reintente', () => {
    expect(invitationMessage('a@unbosque.edu.co', 'FAILED').kind).toBe('error');
  });
  it('sin invitación (edición) deja solo el mensaje de guardado', () => {
    expect(invitationMessage('a@unbosque.edu.co', undefined, 'Usuario guardado.').text).toBe('Usuario guardado.');
  });
});
