import { useState } from 'react';
import Markdown from './Markdown';
import { TruncatedBadge } from './Stage1';
import { memberColor, memberInitial, memberName, shortModel } from '../utils/labels';
import './Debate.css';

const PREVIEW_CHARS = 320;

function preview(text) {
  if (text.length <= PREVIEW_CHARS) return text;
  // Cut at a word boundary
  const cut = text.slice(0, PREVIEW_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 200 ? cut.lastIndexOf(' ') : PREVIEW_CHARS)}…`;
}

function ChatMessage({ item, text, collapsible }) {
  const [open, setOpen] = useState(!collapsible);
  const long = collapsible && text.length > PREVIEW_CHARS;
  return (
    <div className="chat-msg">
      <span className="avatar" style={{ '--member-color': memberColor(item.member_id) }}>
        {memberInitial(item)}
      </span>
      <div className="chat-msg-body">
        <div className="chat-msg-head">
          <span className="chat-msg-name">{memberName(item)}</span>
          <span className="chat-msg-model" title={item.model}>{shortModel(item.model)}</span>
          {item.truncated && <TruncatedBadge />}
        </div>
        <div className="chat-bubble">
          <Markdown>{open || !long ? text : preview(text)}</Markdown>
          {long && (
            <button className="chat-more" onClick={() => setOpen((o) => !o)}>
              {open ? 'Kısalt' : 'Devamını göster'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Debate({ openings, rounds, plannedRounds, loading }) {
  const done = rounds?.length || 0;
  return (
    <div className="debate">
      {openings?.length > 0 && (
        <section className="debate-round">
          <div className="round-label">
            <span>Açılış konuşmaları</span>
          </div>
          {openings.map((o, i) => (
            <ChatMessage key={`open-${o.member_id || i}`} item={o} text={o.response} collapsible />
          ))}
        </section>
      )}

      {(rounds || []).map((round, r) => (
        <section className="debate-round" key={r}>
          <div className="round-label">
            <span>{r + 1}. tur</span>
          </div>
          {round.map((m, i) => (
            <ChatMessage key={`${r}-${m.member_id || i}`} item={m} text={m.message} />
          ))}
        </section>
      ))}

      {loading && (
        <div className="debate-typing">
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Üyeler birbirine cevap yazıyor
          {plannedRounds > 1 && ` (${Math.min(done + 1, plannedRounds)}/${plannedRounds}. tur)`}
        </div>
      )}
    </div>
  );
}
