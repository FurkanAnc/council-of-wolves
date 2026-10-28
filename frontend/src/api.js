/**
 * API client for the Claude Council backend.
 */

// Same host the page was opened from (localhost -> 127.0.0.1, where the backend listens)
const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
import { getLanguage, t } from './i18n';

const API_BASE = import.meta.env.VITE_API_BASE || `http://${host}:8001`;

async function errorMessage(response, fallback) {
  try {
    const body = await response.json();
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}

/** fetch with the UI language, so the backend localizes default member names. */
function request(url, options = {}) {
  return fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-Council-Lang': getLanguage() } });
}

export const api = {
  /**
   * Get the council composition (members + chairman).
   */
  async getCouncil() {
    const response = await request(`${API_BASE}/api/council`);
    if (!response.ok) {
      throw new Error('Failed to load council');
    }
    return response.json();
  },

  /**
   * Saved connection (provider, model, limits, key hint; never the key).
   */
  async getSetup() {
    const response = await request(`${API_BASE}/api/setup`);
    if (!response.ok) {
      throw new Error('Failed to load setup');
    }
    return response.json();
  },

  /**
   * Test a connection and save it if it works. The key only travels to the local backend.
   */
  async saveSetup(setup) {
    const response = await request(`${API_BASE}/api/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(setup),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, t('connection.saveFailed')));
    }
    return response.json();
  },

  async forgetSetup() {
    const response = await request(`${API_BASE}/api/setup`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(await errorMessage(response, t('connection.forgetFailed')));
    }
    return response.json();
  },

  /**
   * API connection status (cached by the backend unless refresh is true).
   */
  async getStatus(refresh = false) {
    const response = await request(`${API_BASE}/api/status${refresh ? '?refresh=true' : ''}`);
    if (!response.ok) {
      throw new Error('Failed to load status');
    }
    return response.json();
  },

  /**
   * Editable council settings (members, roles, chairman, discussion).
   */
  async getSettings() {
    const response = await request(`${API_BASE}/api/settings`);
    if (!response.ok) {
      throw new Error(await errorMessage(response, 'Failed to load settings'));
    }
    return response.json();
  },

  async saveSettings(settings) {
    const response = await request(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, 'Failed to save settings'));
    }
    return response.json();
  },

  async resetSettings() {
    const response = await request(`${API_BASE}/api/settings`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(await errorMessage(response, 'Failed to reset settings'));
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await request(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await request(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await request(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Rename a conversation.
   */
  async renameConversation(conversationId, title) {
    const response = await request(`${API_BASE}/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, 'Failed to rename conversation'));
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await request(`${API_BASE}/api/conversations/${conversationId}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(await errorMessage(response, 'Failed to delete conversation'));
    }
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await request(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error(await errorMessage(response, 'Failed to send message'));
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {AbortSignal} [signal] - Aborts the request (stop button)
   * @param {boolean} [retry] - Re-ask the last question, replacing its failed turn
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent, signal, retry = false) {
    const response = await request(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, retry }),
      }
    );

    if (!response.ok) {
      throw new Error(await errorMessage(response, 'Failed to send message'));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Events can be split across network chunks; keep the incomplete tail
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },
};
