import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Icon from './Icon';
import Markdown from './Markdown';
import AssistantMessage from './AssistantMessage';
import { memberColor, memberInitial, shortModel } from '../utils/labels';
import { conversationToMarkdown, downloadText, fileNameFor } from '../utils/format';
import { t } from '../i18n';
import './ChatInterface.css';

function displayTitle(conversation) {
  const title = conversation?.title;
  return title && title !== 'New Conversation' ? title : t('chat.newChat');
}

function Welcome({ council, onPick, onOpenSettings }) {
  const members = council ? [...council.members, council.chairman] : [];
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <img className="welcome-logo" src="/logo.png" alt={t('app.logoAlt')} />
        <h2>{t('chat.welcomeTitle')}</h2>
        <p>
          {t(council?.debate_rounds > 0 ? 'chat.welcomeTextDebate' : 'chat.welcomeText', {
            n: council ? council.members.length : '',
            chairman: council?.chairman?.name || t('stage3.chairman'),
          })}
        </p>
      </div>

      {members.length > 0 && (
        <div className="council-head">
          <span>
            {t('answer.members', { n: council.members.length })}
            {' · '}
            {council.debate_rounds > 0
              ? t('chat.debateRounds', { n: council.debate_rounds })
              : t('chat.debateOff')}
            {' · '}
            {t('chat.callsPerQuestion', { n: council.calls_per_question })}
          </span>
          <button className="link-btn" onClick={onOpenSettings}>
            <Icon name="sliders" size={14} /> {t('chat.editCouncil')}
          </button>
        </div>
      )}

      {members.length > 0 && (
        <div className="council-grid">
          {members.map((m) => (
            <div key={m.id} className={`council-card ${m.id === 'chairman' ? 'chairman' : ''}`}>
              <span className="avatar" style={{ '--member-color': memberColor(m.id) }}>
                {memberInitial(m)}
              </span>
              <div className="council-card-text">
                <div className="council-card-name">
                  {m.name}
                  <span className="model-chip" title={m.model}>{shortModel(m.model)}</span>
                </div>
                <div className="council-card-desc">{m.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="examples">
        <div className="examples-title">{t('chat.examplesTitle')}</div>
        <div className="example-list">
          {t('chat.examples').map((q) => (
            <button key={q} className="example" onClick={() => onPick(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Composer({ value, onChange, onSubmit, onStop, isLoading, disabledReason, textareaRef }) {
  // Grow with the content up to a max height
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value, textareaRef]);

  const canSend = value.trim() && !isLoading && !disabledReason;

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <div className={`composer-box ${isLoading ? 'busy' : ''}`}>
        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder={isLoading ? t('composer.busy') : t('composer.placeholder')}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          aria-label={t('composer.label')}
        />
        {isLoading ? (
          <button type="button" className="composer-btn stop" onClick={onStop} title={t('composer.stop')} aria-label={t('composer.stop')}>
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button type="submit" className="composer-btn" disabled={!canSend} title={t('composer.send')} aria-label={t('composer.send')}>
            <Icon name="send" size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="composer-hint">
        {disabledReason || t('composer.hint')}
      </div>
    </form>
  );
}

export default function ChatInterface({
  conversation,
  council,
  isLoading,
  isBusyElsewhere,
  onSendMessage,
  onRetry,
  onStop,
  onRename,
  onDelete,
  onOpenSidebar,
  onOpenSettings,
}) {
  const [input, setInput] = useState('');
  // Id of the conversation whose title is being edited; switching conversations ends editing
  const [editingTitleFor, setEditingTitleFor] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const titleCancelledRef = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  // "Stick to bottom": follow new content until the reader scrolls up
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  const messageCount = conversation?.messages?.length || 0;

  // Jump to the bottom when a message is added or another conversation opens
  useEffect(() => {
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messageCount, conversation?.id]);

  // Follow stage updates while sticking; re-measure for the scroll-to-bottom button
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    if (stickRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    const frame = requestAnimationFrame(() => {
      setAtBottom(stickRef.current || el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    });
    return () => cancelAnimationFrame(frame);
  }, [conversation]);

  // Focus the composer on desktop only (on phones it would pop up the keyboard)
  useEffect(() => {
    if (window.matchMedia('(hover: hover)').matches) textareaRef.current?.focus();
  }, [conversation?.id]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    // Moving down (including our own smooth scroll) keeps sticking; scrolling up stops it
    stickRef.current = near || (stickRef.current && el.scrollTop >= lastTopRef.current);
    lastTopRef.current = el.scrollTop;
    setAtBottom(near || stickRef.current);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const editingTitle = Boolean(conversation) && editingTitleFor === conversation.id;
  const setEditingTitle = (on) => setEditingTitleFor(on ? conversation?.id ?? null : null);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    onSendMessage(text);
    setInput('');
  };

  const pickExample = (q) => {
    setInput(q);
    textareaRef.current?.focus();
  };

  const startTitleEdit = () => {
    if (!conversation) return;
    titleCancelledRef.current = false;
    setTitleDraft(displayTitle(conversation));
    setEditingTitle(true);
  };

  const commitTitle = () => {
    if (titleCancelledRef.current) return;
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== displayTitle(conversation)) onRename(titleDraft);
  };

  const handleExport = () => {
    downloadText(fileNameFor(displayTitle(conversation)), conversationToMarkdown(conversation));
  };

  const handleDelete = () => {
    if (window.confirm(t('chat.confirmDelete', { title: displayTitle(conversation) }))) {
      onDelete();
    }
  };

  const messages = conversation?.messages || [];
  const isEmpty = messages.length === 0;
  const lastMsg = messages[messages.length - 1];
  // Came back to a conversation whose answer is still being generated
  const waitingForServer = isLoading && lastMsg?.role === 'user';
  const canRetry = !isLoading && !isBusyElsewhere;

  return (
    <main className="chat">
      <header className="chat-header">
        <button className="icon-btn menu-btn" onClick={onOpenSidebar} aria-label={t('sidebar.openPanel')} title={t('sidebar.openPanelHint')}>
          <Icon name="menu" />
        </button>
        {conversation && editingTitle ? (
          <input
            className="title-input"
            value={titleDraft}
            autoFocus
            maxLength={100}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                titleCancelledRef.current = true;
                setEditingTitle(false);
              }
            }}
            aria-label={t('sidebar.chatName')}
          />
        ) : (
          <h1
            className="chat-title"
            onDoubleClick={startTitleEdit}
            title={conversation ? t('chat.doubleClickRename') : undefined}
          >
            {conversation ? displayTitle(conversation) : t('chat.newChat')}
          </h1>
        )}
        {conversation && (
          <div className="chat-actions">
            <button
              className="icon-btn"
              onClick={startTitleEdit}
              title={t('common.rename')}
              aria-label={t('common.rename')}
            >
              <Icon name="pencil" size={17} />
            </button>
            <button
              className="icon-btn"
              onClick={handleExport}
              disabled={isEmpty}
              title={t('chat.export')}
              aria-label={t('chat.export')}
            >
              <Icon name="download" size={17} />
            </button>
            <button className="icon-btn danger" onClick={handleDelete} title={t('chat.delete')} aria-label={t('chat.delete')}>
              <Icon name="trash" size={17} />
            </button>
          </div>
        )}
      </header>

      <div className="messages" ref={scrollRef} onScroll={handleScroll}>
        <div className="messages-inner">
          {isEmpty ? (
            <Welcome council={council} onPick={pickExample} onOpenSettings={onOpenSettings} />
          ) : (
            messages.map((msg, index) => {
              if (msg.role === 'user') {
                const next = messages[index + 1];
                const unanswered = !next || next.role !== 'assistant';
                const pending = isLoading && index === messages.length - 1;
                return (
                  <div key={index} className="turn user-turn">
                    <div className="user-bubble">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                    {unanswered && !pending && (
                      <div className="unanswered">
                        {t('chat.unanswered')}
                        {index === messages.length - 1 && canRetry && (
                          <button className="retry-link" onClick={() => onRetry(msg.content)}>
                            <Icon name="refresh" size={13} /> {t('chat.askAgain')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              const question = messages[index - 1]?.role === 'user' ? messages[index - 1].content : null;
              const isLast = index === messages.length - 1;
              return (
                <div key={index} className="turn assistant-turn">
                  <AssistantMessage
                    msg={msg}
                    onRetry={isLast && question && canRetry ? () => onRetry(question) : null}
                  />
                </div>
              );
            })
          )}

          {waitingForServer && (
            <div className="turn assistant-turn">
              <div className="waiting-card">
                <span className="spinner" />
                {t('chat.waiting')}
              </div>
            </div>
          )}
        </div>
      </div>

      {!atBottom && !isEmpty && (
        <button className="scroll-bottom" onClick={scrollToBottom} aria-label={t('chat.scrollDown')} title={t('chat.scrollDown')}>
          <Icon name="arrowDown" size={18} />
        </button>
      )}

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onStop={onStop}
        isLoading={isLoading}
        disabledReason={isBusyElsewhere ? t('composer.busyElsewhere') : null}
        textareaRef={textareaRef}
      />
    </main>
  );
}
