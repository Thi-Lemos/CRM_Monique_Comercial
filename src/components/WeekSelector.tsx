import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { WeekInfo, getWeekInfo, fmtDateBR } from '../utils/weekUtils';

interface WeekSelectorProps {
  value: WeekInfo;
  onChange: (week: WeekInfo) => void;
  /** Se true, não permite avançar além da semana corrente (padrão: true) */
  maxCurrentWeek?: boolean;
  /** Label acima do seletor */
  label?: string;
}

export default function WeekSelector({
  value,
  onChange,
  maxCurrentWeek = true,
  label = 'Semana de referência'
}: WeekSelectorProps) {
  const currentWeek = getWeekInfo();

  const goBack = () => {
    // O domingo anterior = inicio - 7 dias
    const prevSunday = new Date(value.inicio + 'T12:00:00Z');
    prevSunday.setUTCDate(prevSunday.getUTCDate() - 7);
    onChange(getWeekInfo(prevSunday));
  };

  const goForward = () => {
    if (maxCurrentWeek && value.inicio >= currentWeek.inicio) return;
    const nextSunday = new Date(value.inicio + 'T12:00:00Z');
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
    onChange(getWeekInfo(nextSunday));
  };

  const isAtCurrentWeek = value.inicio >= currentWeek.inicio;
  const canGoForward = !maxCurrentWeek || !isAtCurrentWeek;

  return (
    <div style={{
      padding: '0.85rem 1rem',
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'rgba(15, 23, 42, 0.3)',
      border: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem'
    }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
        {label}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={goBack}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(255,255,255,0.05)',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            padding: '0.3rem'
          }}
          title="Semana anterior"
        >
          <ChevronLeft size={16} />
        </button>

        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
            {value.label}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
            {fmtDateBR(value.inicio)} (Dom) → {fmtDateBR(value.fim)} (Sáb)
          </div>
        </div>

        <button
          type="button"
          onClick={goForward}
          disabled={!canGoForward}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            background: canGoForward ? 'rgba(255,255,255,0.05)' : 'transparent',
            cursor: canGoForward ? 'pointer' : 'not-allowed',
            color: canGoForward ? 'var(--text-muted)' : 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            padding: '0.3rem'
          }}
          title={canGoForward ? 'Próxima semana' : 'Não é possível avançar além da semana corrente'}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
