import Markdown from './Markdown';
import CopyButton from './CopyButton';
import { TruncatedBadge } from './Stage1';
import { memberColor, memberInitial, shortModel } from '../utils/labels';
import './Stage3.css';

export default function Stage3({ finalResponse }) {
  if (!finalResponse) {
    return null;
  }

  const name = finalResponse.member_name || 'Başkan';
  const failed = Boolean(finalResponse.error);

  return (
    <article className={`final-answer ${failed ? 'failed' : ''}`}>
      <header className="final-header">
        <span className="avatar" style={{ '--member-color': memberColor(finalResponse.member_id || 'chairman') }}>
          {memberInitial({ member_name: name })}
        </span>
        <div className="final-heading">
          <span className="final-title">Konseyin son cevabı</span>
          <span className="final-sub">
            {name} · <span title={finalResponse.model}>{shortModel(finalResponse.model)}</span>
          </span>
        </div>
        {finalResponse.truncated && <TruncatedBadge />}
        <CopyButton text={finalResponse.response} label="Cevabı kopyala" />
      </header>
      <Markdown className="final-text">{finalResponse.response}</Markdown>
    </article>
  );
}
