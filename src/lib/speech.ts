/**
 * Todo E -- Text-to-Speech Event Announcements.
 *
 * Thin wrapper over the browser Web Speech API (window.speechSynthesis).
 * No external dependency; the API is widely supported in modern browsers,
 * so no fallback is provided for the family-game target.
 *
 * Cancel-before-speak: any utterance still queued or in progress is
 * cancelled before the new one is enqueued, so a burst of rapid events
 * (e.g. a claim immediately followed by the next discard) never queues up
 * and gets read out late -- only the most recent event is ever heard.
 */
export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
}
