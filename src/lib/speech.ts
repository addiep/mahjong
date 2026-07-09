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
 *
 * British voice preference (2026-07-09): left unset, speechSynthesis.speak()
 * falls back to whatever the browser/OS considers its default voice, which is
 * usually American English (e.g. Samantha/Alex on macOS Safari) regardless of
 * system locale. getPreferredVoice() searches the voices the browser actually
 * has installed and prefers a short list of known-good British ones (macOS's
 * own Daniel/Kate/Serena, then Chrome's "Google UK English" pair), falling
 * back to any other voice tagged en-GB, and finally to the browser default if
 * none is available. voiceschanged is listened for once at module load,
 * since most browsers populate the voice list asynchronously and
 * getVoices() can return an empty array on the very first call.
 */

let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) cachedVoices = voices;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

// Ordered by preference: named voices known to sound good, checked before
// falling back to "any voice tagged en-GB". macOS/Safari ship Daniel/Kate/
// Serena; Chrome offers its own "Google UK English" pair instead.
const PREFERRED_UK_VOICE_NAMES = [
  'Daniel',
  'Google UK English Male',
  'Kate',
  'Serena',
  'Google UK English Female',
];

function pickBritishVoice(): SpeechSynthesisVoice | undefined {
  if (cachedVoices.length === 0) refreshVoices();
  for (const name of PREFERRED_UK_VOICE_NAMES) {
    const match = cachedVoices.find(v => v.name === name);
    if (match) return match;
  }
  return cachedVoices.find(v => v.lang === 'en-GB')
    ?? cachedVoices.find(v => v.lang?.startsWith('en-GB'));
}

export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickBritishVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    // Best-effort hint even when no matching voice is installed -- some
    // browsers pick a closer-matching default voice based on lang alone.
    utterance.lang = 'en-GB';
  }
  window.speechSynthesis.speak(utterance);
}
