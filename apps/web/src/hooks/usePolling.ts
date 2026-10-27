import { useCallback, useEffect, useRef, useState } from 'react';

/** Carga `fn` y la repite cada `ms` mientras `shouldContinue(data)` sea verdadero. */
export function usePolling<T>(fn: () => Promise<T>, ms: number, shouldContinue: (d: T) => boolean, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      const d = await fn();
      setData(d);
      setError(null);
      if (shouldContinue(d)) timer.current = setTimeout(load, ms);
    } catch (e) {
      setError(e as Error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, [load]);

  return { data, error, reload: load };
}
