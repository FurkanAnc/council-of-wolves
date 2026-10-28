import { useState } from 'react';
import Markdown from './Markdown';
import CopyButton from './CopyButton';
import { memberColor, memberInitial, memberName } from '../utils/labels';
import './Stage1.css';

/** Shown when the token limit cut an answer short. */
export function TruncatedBadge() {
  return (
    <span className="truncated-badge" title="Token limitine ulaşıldı; cevap yarım kalmış olabilir.">
      Kesildi
    </span>
  );
}

/** Pill tabs, one per member, each with its identity avatar and name. */
export function MemberTabs({ items, active, onChange, label }) {
  return (
    <div className="member-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.member_id || index}
          role="tab"
          aria-selected={active === index}
          className={`member-tab ${active === index ? 'active' : ''}`}
          onClick={() => onChange(index)}
        >
          <span className="avatar small" style={{ '--member-color': memberColor(item.member_id) }}>
            {memberInitial(item)}
          </span>
          {memberName(item)}
        </button>
      ))}
    </div>
  );
}

export default function Stage1({ responses }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!responses || responses.length === 0) {
    return null;
  }

  const active = responses[Math.min(activeTab, responses.length - 1)];

  return (
    <div className="stage1">
      <MemberTabs items={responses} active={activeTab} onChange={setActiveTab} label="Üye cevapları" />

      <div className="member-panel" role="tabpanel">
        <div className="member-panel-header">
          <span className="member-panel-name">{memberName(active)}</span>
          <span className="member-panel-model">{active.model}</span>
          {active.truncated && <TruncatedBadge />}
          <CopyButton text={active.response} label="Bu cevabı kopyala" />
        </div>
        <Markdown>{active.response}</Markdown>
      </div>
    </div>
  );
}
