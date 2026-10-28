import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComparisonItem } from '@us/api-client';
import { bestOrdinals, ComparePage, METRICS } from './ComparePage';
import { mockApi, renderAt } from '../test-utils';

const slack = (movable: number) => ({
  teacher_free_slots_min: 10, teacher_free_slots_avg: 12, free_rooms_per_slot_min: 2, free_rooms_per_slot_avg: 3,
  capacity_surplus_avg: 0.2, mobility: { movable_share: movable, avg_alternative_slots: 5, rigid_sessions: [], rigid_count: 0 },
});
const alt = (ordinal: number, penalty: number, movable: number, cohortSlot: string): ComparisonItem => ({
  id: `a${ordinal}`, ordinal, profile: ['balanced', 'compact'][ordinal - 1], solver_status: 'OPTIMAL',
  metrics: { rooms_used: 3, room_utilization: 0.4, slack: slack(movable) },
  revision: { id: `r${ordinal}`, revision_no: 0, hard_violations: 0, soft_penalty: penalty, soft_breakdown: { S2_EDGE_SLOT: penalty } },
  assignments: [
    { group: 'G1', session: 0, slot: cohortSlot, room: 'R1', course: 'CAL1', teacher: 'T1', cohort: 'SIS-1A' },
    { group: 'G2', session: 0, slot: 'TUE-0', room: 'R2', course: 'FIS1', teacher: 'T2', cohort: 'SIS-2A' },
  ],
});
const slots = [{ id: 'MON-0', day: 1, index: 0, edge: true }, { id: 'MON-1', day: 1, index: 1 }, { id: 'TUE-0', day: 2, index: 0 }];

describe('ComparePage', () => {
  it('marca la mejor alternativa por métrica según su dirección', () => {
    const items = [alt(1, 8, 0.9, 'MON-0'), alt(2, 4, 1, 'MON-1')];
    const penalty = METRICS.find((m) => m.label.startsWith('Penalización'))!;
    const mobility = METRICS.find((m) => m.label === 'Sesiones movibles')!;
    expect([...bestOrdinals(items, penalty)]).toEqual([2]);
    expect([...bestOrdinals(items, mobility)]).toEqual([2]);
  });

  it('muestra métricas, diversidad y la grilla por cohorte', async () => {
    mockApi({
      'GET /v1/schedule-requests/:id/comparison': { run_id: 'run', pairwise_diversity: [[0, 0.5], [0.5, 0]], alternatives: [alt(1, 8, 0.9, 'MON-0'), alt(2, 4, 1, 'MON-1')] },
      'GET /v1/alternatives/:id': { context: { slots, rooms: [] } },
    });
    renderAt('/requests/r1/compare', [{ path: '/requests/:id/compare', element: <ComparePage /> }]);
    const metrics = await screen.findByRole('table', { name: 'Métricas comparadas' });
    const row = within(metrics).getByText('Penalización (pesos base)').closest('tr')!;
    expect(within(row).getByText('4 ★')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Diversidad' })).getAllByText('50 %')).toHaveLength(2);
    const grids = await screen.findAllByRole('table', { name: 'Horario semanal' });
    expect(within(grids[0]).getByText('CAL1 · R1')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Cohorte'), 'SIS-2A');
    expect(within(grids[0]).queryByText('CAL1 · R1')).not.toBeInTheDocument();
    expect(within(grids[0]).getByText('FIS1 · R2')).toBeInTheDocument();
  });
});
