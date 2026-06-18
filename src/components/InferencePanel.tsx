/**
 * Module 5.3 -- Live Inference Panel (debug display)
 *
 * Renders the Module 5.2 opponent-modelling read-out beneath the scoreboard.
 * One line per player (every seat shown, per the debug-overlay decision):
 * the top two hypotheses about what they are collecting, plus a closeness note.
 * A footer lists tiles that look safe for the seat-to-move to discard now.
 *
 * Purely presentational: it is handed a TableInference and draws it. All
 * reasoning lives in the engine (inference.ts), so this never touches game state.
 */

import type { TableInference, Confidence } from '@mahjong/engine';
import styles from './InferencePanel.module.css';

export interface InferencePanelProps {
  readonly inference:   TableInference;
  readonly currentSeat: number;
}

const CONF_TITLE: Record<Confidence, string> = {
  high:   'high confidence',
  medium: 'medium confidence',
  low:    'low confidence',
};

export function InferencePanel({ inference, currentSeat }: InferencePanelProps) {
  const { players, safeToDiscard } = inference;

  return (
    <section className={styles.panel} aria-label="Opponent inference (debug)">
      <div className={styles.head}>
        <span>What they seem to be doing</span>
        <span className={styles.tag}>debug</span>
      </div>

      <ul className={styles.list}>
        {players.map((p) => {
          const conf = p.topGuesses[0]?.confidence ?? null;
          return (
            <li
              key={p.seat}
              className={p.seat === currentSeat ? styles.active : undefined}
            >
              <span
                className={styles.dot}
                data-conf={conf ?? 'none'}
                title={conf ? CONF_TITLE[conf] : 'no read yet'}
              />
              <span className={styles.read}>{p.summary}</span>
            </li>
          );
        })}
      </ul>

      <p className={styles.safe}>
        {safeToDiscard.length > 0 ? (
          <>
            <span className={styles.safeLabel}>Safe to discard now:</span>{' '}
            {safeToDiscard.map((s, i) => (
              <span key={s.key} className={s.certainty === 'likely' ? styles.likely : undefined}>
                {s.label}{s.certainty === 'likely' ? '?' : ''}{i < safeToDiscard.length - 1 ? ', ' : ''}
              </span>
            ))}
          </>
        ) : (
          <span className={styles.safeLabel}>No certain safe tiles yet</span>
        )}
      </p>
    </section>
  );
}

export default InferencePanel;
