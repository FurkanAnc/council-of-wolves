import { useEffect, useState } from 'react';
import Icon from './Icon';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import Debate from './Debate';
import { formatDuration, formatTokens } from '../utils/format';
import { memberColor, memberInitial, memberName } from '../utils/labels';
import './AssistantMessage.css';

function hasDebate(msg) {
  return Boolean(msg.plannedDebate > 0 || msg.debate?.length || msg.loading?.debate);
}

function steps(msg) {
  const list = [{ key: 'stage1', label: 'Üye cevapları' }];
  if (hasDebate(msg)) {
    const planned = msg.plannedDebate || msg.debate?.length || 0;
    const progress = msg.loading?.debate && planned > 1 ? ` ${Math.min((msg.debate?.length || 0) + 1, planned)}/${planned}` : '';
    list.push({ key: 'debate', label: `Tartışma${progress}` });
  }
  list.push({ key: 'stage2', label: 'Çapraz değerlendirme' }, { key: 'stage3', label: 'Son cevap' });
  return list;
}

function stepDone(msg, key) {
  if (key === 'debate') return Boolean(msg.debateDone || (msg.debate?.length && (msg.stage2 || msg.loading?.stage2)));
  return Boolean(msg[key]);
}

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Stepper({ msg }) {
  const running = !msg.finishedAt;
  const now = useNow(running);
  const elapsed = (msg.finishedAt || now) - msg.startedAt;

  let summary;
  if (msg.stopped) summary = 'Durduruldu';
  else if (msg.error) summary = 'Hata';
  else if (running) summary = 'Konsey çalışıyor';
  else summary = 'Tamamlandı';

  return (
    <div className={`stepper ${running ? 'running' : ''}`}>
      <ol className="steps">
        {steps(msg).map((step, i) => {
          const done = stepDone(msg, step.key);
          const active = Boolean(msg.loading?.[step.key]);
          const status = done ? 'done' : active ? 'active' : running ? 'pending' : 'skipped';
          return (
            <li key={step.key} className={`step ${status}`}>
              <span className="step-dot">
                {status === 'done' && <Icon name="check" size={12} strokeWidth={3} />}
                {status === 'active' && <span className="spinner step-spinner" />}
                {(status === 'pending' || status === 'skipped') && i + 1}
              </span>
              <span className="step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
      <span className="step-time">
        {summary} · {formatDuration(elapsed)}
      </span>
    </div>
  );
}

function Section({ title, summary, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="section-header">
        <Icon name="chevron" size={16} className="section-chevron" />
        <span className="section-title">{title}</span>
        {summary && <span className="section-summary">{summary}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function AvatarStack({ items }) {
  return (
    <span className="avatar-stack" aria-hidden="true">
      {items.map((item, i) => (
        <span
          key={item.member_id || i}
          className="avatar small"
          style={{ '--member-color': memberColor(item.member_id) }}
        >
          {memberInitial(item)}
        </span>
      ))}
    </span>
  );
}

function RetryButton({ onRetry }) {
  if (!onRetry) return null;
  return (
    <button className="btn btn-ghost retry-btn" onClick={onRetry}>
      <Icon name="refresh" size={15} />
      Tekrar dene
    </button>
  );
}

function AnswerMeta({ metadata, startedAt, finishedAt }) {
  const usage = metadata?.usage;
  const seconds = metadata?.duration_seconds ?? (startedAt && finishedAt ? (finishedAt - startedAt) / 1000 : null);
  if (!usage && seconds == null) return null;
  return (
    <div className="answer-meta">
      {seconds != null && <span>{formatDuration(seconds * 1000)}</span>}
      {usage && (
        <span
          title={`${usage.input_tokens.toLocaleString('tr-TR')} giriş, ${usage.output_tokens.toLocaleString('tr-TR')} çıkış tokeni (tüm çağrılar, başlık hariç)`}
        >
          {formatTokens(usage.input_tokens)} giriş · {formatTokens(usage.output_tokens)} çıkış token
        </span>
      )}
    </div>
  );
}

export default function AssistantMessage({ msg, onRetry }) {
  // Live messages start with the details open so members' answers can be read while waiting
  const live = Boolean(msg.startedAt);
  const top = msg.metadata?.aggregate_rankings?.[0];
  const failed = msg.metadata?.failed_members || msg.failedMembers || [];
  const finalFailed = Boolean(msg.stage3?.error);
  const total = (msg.stage1?.length || 0) + failed.length;

  // Stored failure without any stage data
  if (msg.error && !msg.stage1 && !live) {
    return (
      <div className="assistant-message">
        <div className="answer-error">
          <Icon name="alert" size={18} />
          <div>
            <strong>Konsey cevap veremedi.</strong>
            <div className="answer-error-detail">{msg.error}</div>
          </div>
        </div>
        <RetryButton onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="assistant-message">
      {live && <Stepper msg={msg} />}

      {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}

      {msg.stage3 && !finalFailed && (
        <AnswerMeta metadata={msg.metadata} startedAt={msg.startedAt} finishedAt={msg.finishedAt} />
      )}

      {live && msg.error && (
        <div className="answer-error">
          <Icon name="alert" size={18} />
          <div>
            <strong>Bir hata oluştu.</strong>
            <div className="answer-error-detail">{msg.error}</div>
          </div>
        </div>
      )}

      {msg.stopped && <div className="answer-note">Bu cevap durduruldu.</div>}

      {(msg.error || msg.stopped || finalFailed) && <RetryButton onRetry={onRetry} />}

      {msg.stage1 && msg.stage1.length > 0 && (
        <Section
          title="Üye cevapları"
          summary={
            <>
              <AvatarStack items={msg.stage1} />
              {failed.length > 0 ? `${msg.stage1.length}/${total} üye` : `${msg.stage1.length} üye`}
            </>
          }
          defaultOpen={live && !msg.stage3 && !(msg.plannedDebate > 0)}
        >
          {failed.length > 0 && (
            <div className="answer-note failed-note">
              <Icon name="alert" size={14} />
              {failed.join(', ')} cevap veremedi.
            </div>
          )}
          <Stage1 responses={msg.stage1} />
        </Section>
      )}

      {(msg.debate?.length > 0 || msg.loading?.debate) && (
        <Section
          title="Konsey tartışması"
          summary={
            msg.debate?.length
              ? `${msg.debate.length} tur · ${msg.debate.reduce((n, r) => n + r.length, 0)} mesaj`
              : 'Başlıyor…'
          }
          defaultOpen={live}
        >
          <Debate
            openings={msg.stage1}
            rounds={msg.debate}
            plannedRounds={msg.plannedDebate}
            loading={Boolean(msg.loading?.debate)}
          />
        </Section>
      )}

      {msg.stage2 && msg.stage2.length > 0 && (
        <Section
          title="Çapraz değerlendirme"
          summary={top ? `En iyi bulunan: ${memberName(top)}` : `${msg.stage2.length} değerlendirme`}
          defaultOpen={false}
        >
          <Stage2
            rankings={msg.stage2}
            labelToMember={msg.metadata?.label_to_member}
            labelToModel={msg.metadata?.label_to_model}
            aggregateRankings={msg.metadata?.aggregate_rankings}
          />
        </Section>
      )}
    </div>
  );
}
