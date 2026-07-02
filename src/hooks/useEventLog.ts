import { useRef, useState } from 'react';
import { speak } from '../lib/speech';

/**
 * The rolling sidebar event log, shared by both game modes.
 *
 * Capped at 6 entries. logEvent must be called OUTSIDE setState updaters
 * because React StrictMode double-invokes updaters, which would duplicate
 * entries. (Extracted from App.tsx in the Todo G refactor, 2026-07-02.)
 *
 * Todo E (2026-07-02): when speakEnabled is true, every new event is also
 * read aloud via the Web Speech API (see lib/speech.ts). speakEnabled is
 * read from a ref that is refreshed every render, rather than closed over
 * directly by logEvent -- logEvent is called from effects elsewhere
 * (useLocalGame / useOnlineGame) that deliberately omit it from their
 * dependency arrays, so a plain closure could read a stale toggle value
 * until the next state-triggered re-run. The ref is a stable object across
 * renders, so every copy of logEvent -- however stale its own closure --
 * always reads the current toggle value at call time.
 */
export function useEventLog(speakEnabled: boolean = false) {
  const [events, setEvents] = useState<string[]>([]);
  const speakEnabledRef = useRef(speakEnabled);
  speakEnabledRef.current = speakEnabled;

  const logEvent = (msg: string) => {
    setEvents(prev => [...prev, msg].slice(-6));
    if (speakEnabledRef.current) speak(msg);
  };
  const clearEvents = () => setEvents([]);
  return { events, logEvent, clearEvents };
}
