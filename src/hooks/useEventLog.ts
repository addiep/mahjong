import { useState } from 'react';

/**
 * The rolling sidebar event log, shared by both game modes.
 *
 * Capped at 6 entries. logEvent must be called OUTSIDE setState updaters
 * because React StrictMode double-invokes updaters, which would duplicate
 * entries. (Extracted from App.tsx in the Todo G refactor, 2026-07-02.)
 */
export function useEventLog() {
  const [events, setEvents] = useState<string[]>([]);
  const logEvent = (msg: string) => setEvents(prev => [...prev, msg].slice(-6));
  const clearEvents = () => setEvents([]);
  return { events, logEvent, clearEvents };
}
