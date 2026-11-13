import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { App } from '../App';
import { SessionProvider } from '../session';
import { AvailabilityPage } from './AvailabilityPage';
import { OfferPage } from './OfferPage';
import { PublishedPage } from './PublishedPage';
import { UsersPage } from './UsersPage';
import { mockApi, renderAt } from '../test-utils';

const as = (roles: string[], actor = 'u@unbosque.edu.co') => localStorage.setItem('scheduler.session', JSON.stringify({ actor, roles, token: null }));
const periods = [{ id: 'p', code: '2027-1', starts_on: '2027-01-25', ends_on: '2027-06-05' }];
const slot = (id: string, day: number, index: number, starts_at: string) => ({ id, day, index, starts_at, ends_at: '00:00', edge: false });

describe('Menú por actor', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['ADMINISTRADOR', ['Horarios', 'Oferta', 'Ajustes', 'Datos maestros', 'Usuarios', 'Horario publicado']],
    ['COMITE_TACTICO', ['Horarios', 'Reglas', 'Horario publicado']],
    ['DIRECTOR', ['Horarios', 'Oferta', 'Ajustes', 'Horario publicado']],
    ['DOCENTE', ['Mi disponibilidad', 'Mi horario']],
    ['ESTUDIANTE', ['Horario publicado']],
  ])('%s ve solo sus secciones', (role, expected) => {
    as([role]);
    mockApi({});
    render(<SessionProvider><MemoryRouter><App /></MemoryRouter></SessionProvider>);
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(expected);
    expect(screen.getAllByAltText('Universidad El Bosque').length).toBeGreaterThan(0);
  });

  it('una ruta de otro actor muestra un aviso en lugar de la pantalla', () => {
    as(['ESTUDIANTE']);
    mockApi({});
    render(<SessionProvider><MemoryRouter initialEntries={['/users']}><App /></MemoryRouter></SessionProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('no está disponible para su actor');
  });
});

describe('Docente: disponibilidad', () => {
  beforeEach(() => localStorage.clear());

  it('rota el estado de una franja y guarda solo la disponibilidad del período', async () => {
    as(['DOCENTE'], 't004@unbosque.edu.co');
    const view = (locked = false) => ({ period: '2027-1', teacher: 'T004', locked, updated_at: null,
      slots: [{ ...slot('MON-0', 1, 0, '07:00'), availability: 'AVAILABLE' }, { ...slot('TUE-0', 2, 0, '07:00'), availability: 'NOT_PREFERRED' }] });
    const { calls } = mockApi({ 'GET /v1/academic-periods': periods, 'GET /v1/me/availability': view(), 'PUT /v1/me/availability': view() });
    renderAt('/a', [{ path: '/a', element: <AvailabilityPage /> }]);
    const mon = await screen.findByRole('button', { name: 'Lunes 07:00: Disponible' });
    await userEvent.click(mon);
    await userEvent.click(screen.getByRole('button', { name: 'Lunes 07:00: Prefiero no' }));
    expect(screen.getByRole('button', { name: 'Lunes 07:00: No disponible' })).toHaveClass('UNAVAILABLE');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar (1 cambios)' }));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/v1/me/availability?period=2027-1');
    expect(put.body).toEqual({ slots: [{ slot: 'MON-0', availability: 'UNAVAILABLE' }, { slot: 'TUE-0', availability: 'NOT_PREFERRED' }] });
  });

  it('cerrada tras la publicación', async () => {
    as(['DOCENTE']);
    mockApi({ 'GET /v1/academic-periods': periods, 'GET /v1/me/availability': { period: '2027-1', teacher: 'T004', locked: true, updated_at: null,
      slots: [{ ...slot('MON-0', 1, 0, '07:00'), availability: 'AVAILABLE' }] } });
    renderAt('/a', [{ path: '/a', element: <AvailabilityPage /> }]);
    expect(await screen.findByText(/ya fue publicado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lunes 07:00: Disponible' })).toBeDisabled();
  });
});

describe('Administrador: usuarios', () => {
  beforeEach(() => localStorage.clear());

  it('pide el alcance según el actor y guarda en el directorio', async () => {
    const { calls } = mockApi({
      'GET /v1/users': [], 'GET /v1/programs': [{ id: '1', code: 'SIS' }], 'GET /v1/teachers': [{ code: 'T004', full_name: 'Ana Gómez' }],
      'PUT /v1/users/:email': { email: 'ana@unbosque.edu.co' },
    });
    renderAt('/u', [{ path: '/u', element: <UsersPage /> }]);
    await userEvent.type(await screen.findByLabelText('Correo institucional'), 'ana@unbosque.edu.co');
    expect(screen.queryByLabelText('Docente vinculado')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Docente'));
    await userEvent.selectOptions(await screen.findByLabelText('Docente vinculado'), 'T004');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeDefined());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('/v1/users/ana%40unbosque.edu.co');
    expect(put.body).toEqual({ roles: ['DOCENTE'], active: true, program: null, teacher: 'T004', cohort: null });
  });
});

describe('Director: oferta', () => {
  beforeEach(() => localStorage.clear());

  it('consolida la oferta de su programa', async () => {
    as(['DIRECTOR'], 'direccion.sis@unbosque.edu.co');
    const offers = (state: string) => ({ period: '2027-1', programs: [{ program: 'SIS', groups: 1, state, consolidation: null }],
      groups: [{ code: 'C101-A', course: 'C101', course_name: 'Cálculo', teacher: 'T004', teacher_name: 'Ana', cohort: 'SIS-1A', size: 20, sessions_per_week: 2, required_features: [] }] });
    let state = 'SIN_CONSOLIDAR';
    const { calls } = mockApi({
      'GET /v1/academic-periods': periods,
      'GET /v1/me': { email: 'direccion.sis@unbosque.edu.co', roles: ['DIRECTOR'], program: 'SIS', teacher: null, cohort: null, display_name: null },
      'GET /v1/offers': () => offers(state),
      'POST /v1/offers/consolidate': () => { state = 'CONSOLIDADA'; return {}; },
    });
    renderAt('/o', [{ path: '/o', element: <OfferPage /> }]);
    expect(await screen.findByRole('table', { name: 'Grupos ofertados' })).toHaveTextContent('Cálculo');
    await userEvent.type(screen.getByLabelText('Notas para el administrador'), 'Cupos confirmados');
    await userEvent.click(screen.getByRole('button', { name: 'Consolidar oferta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('el administrador ya puede generar');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ period: '2027-1', notes: 'Cupos confirmados' });
    expect(await screen.findByText('Consolidada')).toBeInTheDocument();
  });
});

describe('Estudiante: horario publicado', () => {
  beforeEach(() => localStorage.clear());

  it('muestra la semana publicada con asignatura, aula y docente', async () => {
    as(['ESTUDIANTE']);
    mockApi({
      'GET /v1/academic-periods': periods,
      'GET /v1/published-schedules': {
        period: '2027-1', cohorts: ['SIS-1A'],
        publication: { id: 'pub', published_at: '2026-11-12T10:00:00Z', revision_no: 3 },
        slots: [slot('MON-0', 1, 0, '07:00'), slot('TUE-0', 2, 0, '07:00')],
        sessions: [{ group: 'C101-A', session: 0, course: 'C101', course_name: 'Cálculo I', program: 'SIS', teacher: 'T004', teacher_name: 'Ana Gómez',
          cohort: 'SIS-1A', room: 'A101', building: 'Bloque A', slot: 'TUE-0', day: 2, starts_at: '07:00', ends_at: '00:00' }],
      },
    });
    renderAt('/p', [{ path: '/p', element: <PublishedPage /> }]);
    const week = await screen.findByRole('table', { name: 'Horario publicado' });
    expect(week).toHaveTextContent('Cálculo I');
    expect(week).toHaveTextContent('A101 (Bloque A)');
    expect(week).toHaveTextContent('Ana Gómez');
    expect(screen.getByText(/revisión 3/)).toBeInTheDocument();
  });
});
