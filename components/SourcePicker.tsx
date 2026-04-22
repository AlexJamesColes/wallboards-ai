'use client';

type Source = 'sql' | 'zendesk' | 'dataset';

interface Props {
  onPick:   (source: Source) => void;
  onCancel: () => void;
}

const PRIMARY    = '#6366f1';
const PRIMARY_LT = '#a5b4fc';

const OPTIONS: { key: Source; title: string; desc: string; icon: React.ReactNode }[] = [
  {
    key:   'sql',
    title: 'SQL Server',
    desc:  'Query the Gecko RDS database with read-only T-SQL.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
        <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
      </svg>
    ),
  },
  {
    key:   'zendesk',
    title: 'Zendesk',
    desc:  'Pick a metric, a time range, and optional ticket filters.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h18v12H5l-2 2V4z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </svg>
    ),
  },
  {
    key:   'dataset',
    title: 'Noetica Dataset',
    desc:  'Slice live data pushed by Noetica into a dataset.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21V10" />
        <path d="M10 21V4" />
        <path d="M16 21v-7" />
        <path d="M22 21H2" />
      </svg>
    ),
  },
];

export default function SourcePicker({ onPick, onCancel }: Props) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(4,6,14,0.78)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640,
          background: 'linear-gradient(180deg, rgba(26,33,54,0.98) 0%, rgba(14,20,39,0.98) 100%)',
          border: '1px solid rgba(99,102,241,0.22)',
          borderRadius: 16,
          padding: 28,
          boxShadow: '0 40px 90px rgba(0,0,0,0.75)',
          color: '#f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>New Widget</div>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>Where does the data come from?</div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                padding: '18px 16px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                color: '#f1f5f9',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background    = 'rgba(99,102,241,0.12)';
                e.currentTarget.style.borderColor   = 'rgba(99,102,241,0.45)';
                e.currentTarget.style.transform     = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background    = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.borderColor   = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.transform     = 'none';
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: 'rgba(99,102,241,0.15)',
                color: PRIMARY_LT,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{o.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{o.title}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{o.desc}</div>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#94a3b8',
              fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}
