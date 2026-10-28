import Icon from './Icon';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { parseDate } from '../utils/format';
import { t, locale } from '../i18n';
import './ConnectionStatus.css';

// Each state has a label and an icon, so it never relies on color alone (label = i18n key)
const STATES = {
  checking: { label: 'status.checking', tone: 'muted', icon: null },
  connected: { label: 'status.connected', tone: 'good', icon: 'check' },
  no_key: { label: 'status.noKey', tone: 'warning', icon: 'alert' },
  auth_error: { label: 'status.authError', tone: 'critical', icon: 'x' },
  unreachable: { label: 'status.unreachable', tone: 'critical', icon: 'x' },
  error: { label: 'status.error', tone: 'critical', icon: 'alert' },
  backend_down: { label: 'status.backendDown', tone: 'critical', icon: 'x' },
};

function timeLabel(iso) {
  const date = parseDate(iso);
  return date ? date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '';
}

/**
 * Indicator for the sidebar footer (or, compact, for the icon rail); click to re-check.
 * The status comes from one shared useConnectionStatus in the sidebar.
 */
export function ConnectionBadge({ status, onCheck, compact = false }) {
  const check = onCheck;
  const state = STATES[status.status] || STATES.error;
  const label = t(state.label);
  const details = [
    status.status === 'backend_down' ? t('status.backendDownMessage') : status.message,
    status.provider && `${t('status.provider')}: ${status.provider}`,
    status.latency_ms != null && `${t('status.latency')}: ${status.latency_ms} ms`,
    status.checked_at && `${t('status.lastCheck')}: ${timeLabel(status.checked_at)}`,
    t('status.clickToCheck'),
  ]
    .filter(Boolean)
    .join('\n');

  if (compact) {
    return (
      <button
        type="button"
        className={`rail-btn connection-rail tone-${state.tone}`}
        onClick={() => check(true)}
        title={`${label}\n${details}`}
        aria-label={label}
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
        <span className="connection-label">{label}</span>
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
        <span className="connection-card-title">{t(state.label)}</span>
        <button className="btn btn-ghost connection-test" onClick={() => check(true)} disabled={status.status === 'checking'}>
          <Icon name="refresh" size={14} /> {t('status.test')}
        </button>
        {onChange && (
          <button className="btn btn-primary connection-test" onClick={onChange}>
            <Icon name="pencil" size={14} /> {t('connection.change')}
          </button>
        )}
      </div>
      {status.message && status.status !== 'connected' && (
        <p className="connection-message">
          {status.status === 'backend_down' ? t('status.backendDownMessage') : status.message}
        </p>
      )}
      <dl className="connection-facts">
        {status.provider && (
          <>
            <dt>{t('status.provider')}</dt>
            <dd>{status.provider}</dd>
          </>
        )}
        {status.model && (
          <>
            <dt>{t('status.testModel')}</dt>
            <dd>{status.model}</dd>
          </>
        )}
        {status.latency_ms != null && (
          <>
            <dt>{t('status.latency')}</dt>
            <dd>{status.latency_ms} ms</dd>
          </>
        )}
        {status.checked_at && (
          <>
            <dt>{t('status.lastCheck')}</dt>
            <dd>{timeLabel(status.checked_at)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
