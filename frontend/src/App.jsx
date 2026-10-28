import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import SettingsModal from './components/SettingsModal';
import { api } from './api';
import { setCouncilColors } from './utils/labels';
import './App.css';

const THEME_KEY = 'council-theme';
const SIDEBAR_KEY = 'council-sidebar-collapsed';
const NARROW_QUERY = '(max-width: 860px)';

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
}

function newAssistantMessage(plannedDebate) {
  return {
    role: 'assistant',
    stage1: null,
    debate: null,
    stage2: null,
    stage3: null,
    metadata: null,
    plannedDebate,
    startedAt: Date.now(),
    loading: { stage1: false, debate: false, stage2: false, stage3: false },
  };
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [loadingConversationId, setLoadingConversationId] = useState(null);
  const [council, setCouncil] = useState(null);
  const [theme, setTheme] = useState(readTheme);
  // Narrow screens: off-canvas sidebar (sidebarOpen). Wide screens: it can be collapsed.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
  const [notice, setNotice] = useState(null);
  const [settingsTab, setSettingsTab] = useState(null); // open settings tab, or null
  // Bumped after a failed council run so the connection badge re-checks
  const [statusSignal, setStatusSignal] = useState(0);
  const noticeTimer = useRef(null);

  // Latest values, readable from async stream callbacks
  const currentIdRef = useRef(null);
  const conversationRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    conversationRef.current = currentConversation;
  }, [currentConversation]);

  // Theme: "system" follows the OS setting
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage may be unavailable (private mode); the theme still applies
    }
  }, [theme]);

  const showNotice = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  // Browser tab shows the open conversation
  useEffect(() => {
    const title = currentConversation?.title;
    document.title =
      title && title !== 'New Conversation' ? `${title} · Kurtlar Konseyi` : 'Kurtlar Konseyi';
  }, [currentConversation?.title]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Storage may be unavailable; the state still applies for this visit
    }
  }, [sidebarCollapsed]);

  const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

  const openSidebar = useCallback(() => {
    if (isNarrow()) setSidebarOpen(true);
    else setSidebarCollapsed(false);
  }, []);

  const closeSidebar = () => {
    if (isNarrow()) setSidebarOpen(false);
    else setSidebarCollapsed(true);
  };

  // Ctrl/Cmd+K: search conversations, Ctrl/Cmd+B: toggle the sidebar, Escape: close the mobile sidebar
  useEffect(() => {
    const onKey = (e) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        openSidebar();
        // Wait a frame so a just-reopened sidebar is visible before focusing
        requestAnimationFrame(() => document.getElementById('conversation-search')?.focus());
      } else if ((e.ctrlKey || e.metaKey) && key === 'b') {
        e.preventDefault();
        if (isNarrow()) setSidebarOpen((o) => !o);
        else setSidebarCollapsed((c) => !c);
      } else if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSidebar]);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }, []);

  const loadConversation = useCallback(async (id) => {
    try {
      const conv = await api.getConversation(id);
      // Ignore if the user moved on while this was loading
      if (currentIdRef.current === id) setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }, []);

  const loadCouncil = useCallback(async () => {
    try {
      const data = await api.getCouncil();
      setCouncilColors(data.members);
      setCouncil(data);
    } catch (error) {
      console.error('Failed to load council:', error);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    loadCouncil();
  }, [loadConversations, loadCouncil]);

  const selectConversation = (id) => {
    currentIdRef.current = id;
    setCurrentConversationId(id);
    setSidebarOpen(false);
    if (id) loadConversation(id);
    else setCurrentConversation(null);
  };

  const handleNewConversation = () => {
    // The conversation itself is created with the first question
    selectConversation(null);
  };

  const handleRenameConversation = async (id, title) => {
    const clean = title.trim();
    if (!clean) return;
    try {
      await api.renameConversation(id, clean);
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: clean } : c)));
      setCurrentConversation((prev) => (prev && prev.id === id ? { ...prev, title: clean } : prev));
    } catch (error) {
      showNotice(`Yeniden adlandırılamadı: ${error.message}`);
    }
  };

  const handleDeleteConversation = async (id) => {
    if (loadingConversationId === id) abortRef.current?.abort();
    try {
      await api.deleteConversation(id);
      setConversations((list) => list.filter((c) => c.id !== id));
      if (currentIdRef.current === id) selectConversation(null);
    } catch (error) {
      showNotice(`Silinemedi: ${error.message}`);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSendMessage = async (content, { retry = false } = {}) => {
    if (loadingConversationId) return;

    let conversationId = currentIdRef.current;

    // Start a conversation on the first question
    if (!conversationId) {
      try {
        const newConv = await api.createConversation();
        conversationId = newConv.id;
        setConversations((list) => [
          { id: newConv.id, created_at: newConv.created_at, title: newConv.title, message_count: 0 },
          ...list,
        ]);
        currentIdRef.current = conversationId;
        setCurrentConversationId(conversationId);
        setCurrentConversation(newConv);
      } catch (error) {
        showNotice(`Sohbet oluşturulamadı: ${error.message}`);
        return;
      }
    }

    // Updates only this conversation, and only its in-progress assistant message
    const updateAssistant = (patch) => {
      setCurrentConversation((prev) => {
        if (!prev || prev.id !== conversationId || prev.messages.length === 0) return prev;
        const messages = [...prev.messages];
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant' || !lastMsg.loading) return prev;
        messages[messages.length - 1] = {
          ...lastMsg,
          ...patch,
          loading: { ...lastMsg.loading, ...(patch.loading || {}) },
        };
        return { ...prev, messages };
      });
    };

    const finishAssistant = (patch) => {
      updateAssistant({
        ...patch,
        finishedAt: Date.now(),
        loading: { stage1: false, debate: false, stage2: false, stage3: false },
      });
    };

    setCurrentConversation((prev) => {
      if (!prev || prev.id !== conversationId) return prev;
      let messages = prev.messages;
      if (retry) {
        // Drop the failed turn locally too; the backend does the same
        const lastUser = messages.map((m) => m.role).lastIndexOf('user');
        if (lastUser !== -1 && messages[lastUser].content === content) messages = messages.slice(0, lastUser);
      }
      return {
        ...prev,
        messages: [...messages, { role: 'user', content }, newAssistantMessage(council?.debate_rounds || 0)],
      };
    });

    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingConversationId(conversationId);
    let finished = false;

    try {
      await api.sendMessageStream(
        conversationId,
        content,
        (eventType, event) => {
          switch (eventType) {
            case 'stage1_start':
              updateAssistant({ loading: { stage1: true } });
              break;
            case 'stage1_complete':
              updateAssistant({ stage1: event.data, failedMembers: event.failed || [], loading: { stage1: false } });
              break;
            case 'debate_start':
              updateAssistant({ debate: [], plannedDebate: event.rounds, loading: { debate: true } });
              break;
            case 'debate_round':
              setCurrentConversation((prev) => {
                if (!prev || prev.id !== conversationId) return prev;
                const messages = [...prev.messages];
                const last = messages[messages.length - 1];
                if (last?.role !== 'assistant' || !last.loading) return prev;
                messages[messages.length - 1] = { ...last, debate: [...(last.debate || []), event.data] };
                return { ...prev, messages };
              });
              break;
            case 'debate_complete':
              updateAssistant({ debate: event.data, debateDone: true, loading: { debate: false } });
              break;
            case 'stage2_start':
              updateAssistant({ loading: { stage2: true } });
              break;
            case 'stage2_complete':
              updateAssistant({ stage2: event.data, metadata: event.metadata, loading: { stage2: false } });
              break;
            case 'stage3_start':
              updateAssistant({ loading: { stage3: true } });
              break;
            case 'stage3_complete':
              updateAssistant({ stage3: event.data, loading: { stage3: false } });
              break;
            case 'title_complete':
              setConversations((list) =>
                list.map((c) => (c.id === conversationId ? { ...c, title: event.data.title } : c))
              );
              setCurrentConversation((prev) =>
                prev && prev.id === conversationId ? { ...prev, title: event.data.title } : prev
              );
              break;
            case 'complete':
              finished = true;
              finishAssistant(event.metadata ? { metadata: event.metadata } : {});
              loadConversations();
              break;
            case 'error':
              finished = true;
              setStatusSignal((n) => n + 1);
              console.error('Stream error:', event.message);
              finishAssistant({ error: event.message });
              loadConversations();
              break;
            default:
              console.log('Unknown event type:', eventType);
          }
        },
        controller.signal,
        retry
      );
      if (!finished) {
        // The server closed the stream without a final event (crash or lost connection)
        finishAssistant({ error: 'Sunucuyla bağlantı beklenmedik şekilde kesildi.' });
        loadConversations();
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        finishAssistant({ stopped: true });
      } else {
        console.error('Failed to send message:', error);
        finishAssistant({ error: error.message });
      }
    } finally {
      abortRef.current = null;
      setLoadingConversationId(null);
      // If the user left and came back mid-answer, the view holds the server copy
      // without the answer; reload it to show the saved result
      const shown = conversationRef.current;
      const last = shown?.messages?.[shown.messages.length - 1];
      if (shown?.id === conversationId && currentIdRef.current === conversationId && last?.role === 'user') {
        loadConversation(conversationId);
      }
    }
  };

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        loadingConversationId={loadingConversationId}
        onSelectConversation={selectConversation}
        onNewConversation={handleNewConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => setSettingsTab('general')}
        statusSignal={statusSignal}
        onClose={closeSidebar}
      />
      <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      <ChatInterface
        conversation={currentConversation}
        council={council}
        isLoading={loadingConversationId !== null && loadingConversationId === currentConversationId}
        isBusyElsewhere={loadingConversationId !== null && loadingConversationId !== currentConversationId}
        onSendMessage={handleSendMessage}
        onRetry={(question) => handleSendMessage(question, { retry: true })}
        onStop={handleStop}
        onRename={(title) => currentConversation && handleRenameConversation(currentConversation.id, title)}
        onDelete={() => currentConversation && handleDeleteConversation(currentConversation.id)}
        onOpenSidebar={openSidebar}
        onOpenSettings={() => setSettingsTab('members')}
      />
      {settingsTab && (
        <SettingsModal
          initialTab={settingsTab}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettingsTab(null)}
          onSaved={() => {
            loadCouncil();
            showNotice('Konsey ayarları kaydedildi. Yeni sorular bu ayarlarla cevaplanacak.');
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

export default App;
