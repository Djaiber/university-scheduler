import { useEffect, useState } from 'react';
import { useSession } from '../session';

/** Períodos académicos disponibles y el seleccionado (por defecto, el más reciente). */
export function usePeriods() {
  const { api } = useSession();
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod] = useState('');
  useEffect(() => {
    api.listPeriods()
      .then((ps) => {
        setPeriods(ps.map((p) => p.code));
        setPeriod((cur) => cur || ps[0]?.code || '');
      })
      .catch(() => setPeriods([]));
  }, [api]);
  return { periods, period, setPeriod };
}
