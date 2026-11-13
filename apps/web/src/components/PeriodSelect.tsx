export function PeriodSelect({ periods, value, onChange }: { periods: string[]; value: string; onChange: (p: string) => void }) {
  return (
    <label>Período
      <select aria-label="Período" value={value} onChange={(e) => onChange(e.target.value)}>
        {periods.length === 0 && <option value="">—</option>}
        {periods.map((p) => <option key={p}>{p}</option>)}
      </select>
    </label>
  );
}
