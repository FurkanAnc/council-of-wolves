import Markdown from './Markdown';
import CopyButton from './CopyButton';
import { TruncatedBadge } from './Stage1';
import { memberColor, memberInitial, shortModel } from '../utils/labels';
import { t } from '../i18n';
import './Stage3.css';

export default function Stage3({ finalResponse }) {
  if (!finalResponse) {
    return null;
  }

  const name = finalResponse.member_name || t('stage3.chairman');
  const failed = Boolean(finalResponse.error);

  return (
    <article className={`final-answer ${failed ? 'failed' : ''}`}>
      <header className="final-header">
        <span className="avatar" style={{ '--member-color': memberColor(finalResponse.member_id || 'chairman') }}>
          {memberInitial({ member_name: name })}
        </span>
        <div className="final-heading">
          <span className="final-title">{t('stage3.title')}</span>
          <span className="final-sub">
            {name} · <span title={finalResponse.model}>{shortModel(finalResponse.model)}</span>
          </span>
        </div>
        {finalResponse.truncated && <TruncatedBadge />}
        <CopyButton text={finalResponse.response} label={t('copy.answer')} />
      </header>
      <Markdown className="final-text">{finalResponse.response}</Markdown>
    </article>
  );
}
