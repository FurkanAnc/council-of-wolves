import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const POLL_MS = 60000;

/**
 * API connection status, polled every minute; `refreshSignal` changes force a fresh check.
 * Returns [status, check(refresh)].
 */
export function useConnectionStatus(refreshSignal) {
  const [status, setStatus] = useState({ status: 'checking' });

  const check = useCallback(async (refresh = false) => {
    setStatus((s) => (refresh ? { ...s, status: 'checking' } : s));
    try {
      setStatus(await api.getStatus(refresh));
    } catch {
      setStatus({
        status: 'backend_down',
        message: 'Uygulamanın sunucusuna (backend) bağlanılamadı. start.ps1 penceresi açık mı?',
      });
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => check(false), 0);
    const timer = setInterval(() => check(false), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [check]);

  // A failed council run asks for a fresh check
  useEffect(() => {
    if (!refreshSignal) return undefined;
    const t = setTimeout(() => check(true), 0);
    return () => clearTimeout(t);
  }, [refreshSignal, check]);

  return [status, check];
}
