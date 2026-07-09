/**
 * Todo E -- Text-to-Speech Event Announcements.
 *
 * Thin wrapper over the browser Web Speech API (window.speechSynthesis).
 * No external dependency; the API is widely supported in modern browsers,
 * so no fallback is provided for the family-game target.
 *
 * Queued, not cancelled (bug fix, 2026-07-09): speak() used to call
 * speechSynthesis.cancel() before every utterance. That silently swallowed
 * the FIRST of two events fired close together -- e.g. an AI claims a
 * discarded tile, then immediately discards again as its own turn -- because
 * the second speak() cancelled the first utterance before it could be heard.
 * Locally this was mostly masked by the 500ms per-AI-move delay in
 * useLocalGame.ts, but online the server drives AI turns back-to-back with no
 * artificial delay (game-session.ts), so the claim announcement was almost
 * always the one cancelled. speechSynthesis.speak() already queues an
 * utterance after whatever is currently speaking when called without a
 * preceding cancel(), so simply dropping the cancel() lets a short burst of
 * real events play out in full, in the order they happened.
 */
export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
