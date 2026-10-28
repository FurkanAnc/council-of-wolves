import Icon from './Icon';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { parseDate } from '../utils/format';
import './ConnectionStatus.css';

// Each state has a label and an icon, so it never relies on color alone
const STATES = {
  checking: { label: 'Kontrol ediliyor…', tone: 'muted', icon: null },
  connected: { label: 'API bağlı', tone: 'good', icon: 'check' },
  no_key: { label: 'API anahtarı yok', tone: 'warning', icon: 'alert' },
  auth_error: { label: 'Anahtar geçersiz', tone: 'critical', icon: 'x' },
  unreachable: { label: 'API’ye ulaşılamıyor', tone: 'critical', icon: 'x' },
  error: { label: 'API hatası', tone: 'critical', icon: 'alert' },
  backend_down: { label: 'Sunucu kapalı', tone: 'critical', icon: 'x' },
};

function timeLabel(iso) {
  const date = parseDate(iso);
  return date ? date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
}

/**
 * Indicator for the sidebar footer (or, compact, for the icon rail); click to re-check.
 * The status comes from one shared useConnectionStatus in the sidebar.
 */
export function ConnectionBadge({ status, onCheck, compact = false }) {
  const check = onCheck;
  const state = STATES[status.status] || STATES.error;
  const details = [
    status.message,
    status.provider && `Sağlayıcı: ${status.provider}`,
    status.latency_ms != null && `Gecikme: ${status.latency_ms} ms`,
    status.checked_at && `Son kontrol: ${timeLabel(status.checked_at)}`,
    'Tekrar kontrol etmek için tıklayın.',
  ]
    .filter(Boolean)
    .join('\n');

  if (compact) {
    return (
      <button
        type="button"
        className={`rail-btn connection-rail tone-${state.tone}`}
        onClick={() => check(true)}
        title={`${state.label}\n${details}`}
        aria-label={state.label}
      >
        <span className="connection-dot" aria-hidden="true">
          {status.status === 'checking' ? (
            <span className="spinner tiny" />
          ) : (
            <Icon name={state.icon} size={10} strokeWidth={3.2} />
          )}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`connection-badge tone-${state.tone}`}
      onClick={() => check(true)}
      title={details}
      aria-live="polite"
    >
      <span className="connection-dot" aria-hidden="true">
        {status.status === 'checking' ? <span className="spinner tiny" /> : <Icon name={state.icon} size={10} strokeWidth={3.2} />}
      </span>
      <span className="connection-text">
        <span className="connection-label">{state.label}</span>
        {status.provider && <span className="connection-provider">{status.provider}</span>}
      </span>
      <Icon name="refresh" size={14} className="connection-refresh" />
    </button>
  );
}

/** Detailed card for the general settings tab. */
export function ConnectionCard({ onChange }) {
  const [status, check] = useConnectionStatus(0);
  const state = STATES[status.status] || STATES.error;
  return (
    <div className={`connection-card tone-${state.tone}`}>
      <div className="connection-card-head">
        <span className="connection-dot" aria-hidden="true">
          {status.status === 'checking' ? <span className="spinner tiny" /> : <Icon name={state.icon} size={10} strokeWidth={3.2} />}
        </span>
        <span className="connection-card-title">{state.label}</span>
        <button className="btn btn-ghost connection-test" onClick={() => check(true)} disabled={status.status === 'checking'}>
          <Icon name="refresh" size={14} /> Test et
        </button>
        {onChange && (
          <button className="btn btn-primary connection-test" onClick={onChange}>
            <Icon name="pencil" size={14} /> Bağlantıyı değiştir
          </button>
        )}
      </div>
      {status.message && status.status !== 'connected' && <p className="connection-message">{status.message}</p>}
      <dl className="connection-facts">
        {status.provider && (
          <>
            <dt>Sağlayıcı</dt>
            <dd>{status.provider}</dd>
          </>
        )}
        {status.model && (
          <>
            <dt>Test modeli</dt>
            <dd>{status.model}</dd>
          </>
        )}
        {status.latency_ms != null && (
          <>
            <dt>Gecikme</dt>
            <dd>{status.latency_ms} ms</dd>
          </>
        )}
        {status.checked_at && (
          <>
            <dt>Son kontrol</dt>
            <dd>{timeLabel(status.checked_at)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
