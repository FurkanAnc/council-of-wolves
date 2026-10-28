import { useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { ConnectionBadge } from './ConnectionStatus';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { dateGroup, shortDate, GROUP_ORDER } from '../utils/format';
import './Sidebar.css';


function displayTitle(conv) {
  return conv.title && conv.title !== 'New Conversation' ? conv.title : 'Yeni Sohbet';
}

function ConversationItem({ conv, active, busy, onSelect, onRename, onDelete }) {
  const [mode, setMode] = useState('view'); // view | rename | confirm
  const [draft, setDraft] = useState('');
  const cancelledRef = useRef(false);

  const startRename = (e) => {
    e.stopPropagation();
    setDraft(displayTitle(conv));
    cancelledRef.current = false;
    setMode('rename');
  };

  const commitRename = () => {
    if (cancelledRef.current) return;
    if (draft.trim() && draft.trim() !== displayTitle(conv)) onRename(conv.id, draft);
    setMode('view');
  };

  if (mode === 'rename') {
    return (
      <div className="conversation-item editing">
        <input
          className="rename-input"
          value={draft}
          autoFocus
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              cancelledRef.current = true;
              setMode('view');
            }
          }}
          aria-label="Sohbet adı"
        />
      </div>
    );
  }

  if (mode === 'confirm') {
    return (
      <div
        className="conversation-item confirming"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setMode('view');
          }
        }}
      >
        <span className="confirm-text">Silinsin mi?</span>
        <button className="btn btn-danger confirm-btn" autoFocus onClick={() => onDelete(conv.id)}>
          Sil
        </button>
        <button className="btn btn-ghost confirm-btn" onClick={() => setMode('view')}>
          İptal
        </button>
      </div>
    );
  }

  return (
    <div
      className={`conversation-item ${active ? 'active' : ''}`}
      onClick={() => onSelect(conv.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(conv.id);
      }}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
    >
      <div className="conversation-text">
        <div className="conversation-title">
          {busy && <span className="spinner tiny" aria-label="Cevap bekleniyor" />}
          <span>{displayTitle(conv)}</span>
        </div>
        <div className="conversation-meta">
          {shortDate(conv.created_at)}
          {conv.message_count > 0 && ` · ${Math.ceil(conv.message_count / 2)} soru`}
        </div>
      </div>
      <div className="conversation-actions">
        <button className="icon-btn small" onClick={startRename} title="Yeniden adlandır" aria-label="Yeniden adlandır">
          <Icon name="pencil" size={14} />
        </button>
        <button
          className="icon-btn small danger"
          onClick={(e) => {
            e.stopPropagation();
            setMode('confirm');
          }}
          title="Sil"
          aria-label="Sil"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({
  conversations,
  currentConversationId,
  loadingConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings,
  statusSignal,
  onClose,
  onExpand,
  onSearch,
}) {
  const [query, setQuery] = useState('');
  // One status check shared by the full sidebar and the icon rail
  const [status, checkStatus] = useConnectionStatus(statusSignal);

  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    const filtered = q
      ? conversations.filter((c) => displayTitle(c).toLocaleLowerCase('tr').includes(q))
      : conversations;
    const byGroup = new Map();
    for (const conv of filtered) {
      const group = dateGroup(conv.created_at);
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(conv);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)]);
  }, [conversations, query]);

  return (
    <>
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" aria-hidden="true" />
          <span className="brand-name">Kurtlar Konseyi</span>
          <button
            className="icon-btn sidebar-close"
            onClick={onClose}
            title="Paneli kapat (Ctrl+B)"
            aria-label="Paneli kapat"
          >
            <Icon name="panelLeft" size={18} />
          </button>
        </div>
        <button className="btn btn-primary new-conversation-btn" onClick={onNewConversation}>
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Yeni Sohbet
        </button>
        <label className="search">
          <Icon name="search" size={15} />
          <input
            id="conversation-search"
            type="search"
            placeholder="Sohbetlerde ara (Ctrl+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <nav className="conversation-list" aria-label="Sohbetler">
        {conversations.length === 0 ? (
          <div className="no-conversations">Henüz sohbet yok. İlk sorunuzu sorun.</div>
        ) : groups.length === 0 ? (
          <div className="no-conversations">“{query}” ile eşleşen sohbet yok</div>
        ) : (
          groups.map(([group, items]) => (
            <section key={group} className="conversation-group">
              <h2 className="group-title">{group}</h2>
              {items.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === currentConversationId}
                  busy={conv.id === loadingConversationId}
                  onSelect={onSelectConversation}
                  onRename={onRenameConversation}
                  onDelete={onDeleteConversation}
                />
              ))}
            </section>
          ))
        )}
      </nav>

      <div className="sidebar-footer">
        <button className="settings-btn" onClick={onOpenSettings}>
          <Icon name="sliders" size={16} />
          Ayarlar
        </button>
        <ConnectionBadge status={status} onCheck={checkStatus} />
      </div>
    </aside>

    {/* Collapsed sidebar on wide screens: a narrow rail with the main actions */}
    <nav className="sidebar-rail" aria-label="Kısayollar">
      <button className="rail-logo" onClick={onExpand} title="Paneli aç (Ctrl+B)" aria-label="Paneli aç">
        <img src="/logo.png" alt="" />
      </button>
      <button className="rail-btn" onClick={onExpand} title="Paneli aç (Ctrl+B)" aria-label="Paneli aç">
        <Icon name="panelRight" size={18} />
      </button>
      <button className="rail-btn rail-primary" onClick={onNewConversation} title="Yeni sohbet" aria-label="Yeni sohbet">
        <Icon name="plus" size={18} strokeWidth={2.2} />
      </button>
      <button className="rail-btn" onClick={onSearch} title="Sohbetlerde ara (Ctrl+K)" aria-label="Sohbetlerde ara">
        <Icon name="search" size={18} />
      </button>
      <div className="rail-spacer" />
      <button className="rail-btn" onClick={onOpenSettings} title="Ayarlar" aria-label="Ayarlar">
        <Icon name="sliders" size={18} />
      </button>
      <ConnectionBadge status={status} onCheck={checkStatus} compact />
    </nav>
    </>
  );
}
