/**
 * GameSetup -- pre-game configuration screen.
 *
 * Collects:
 *  - Player count (3 or 4)
 *  - Number of AI opponents (0 .. playerCount - 1); the rest are human
 *    (pass-and-play). The human is always seat 0 (East); AI take the last seats.
 *  - Knitting / crocheting allowed (on by default -- Adam's preference,
 *    2026-07-09; the engine's DEFAULT_CONFIG stays conservative)
 *  - Dead wall (off by default)
 *  - Discard visibility (default: face-up; optional hard mode: face-down pool).
 *    Re-added 2026-07-02 -- `GameConfig.discardsVisible` already existed on the
 *    engine and in MJrules.md ("Discard Visibility") but this screen was
 *    hard-coding `discardsVisible: true` and never exposed a control for it.
 *  - Paying system: pool (current behaviour) or traditional (Todo F --
 *    losers pay the winner, then settle differences among themselves; East
 *    pays and receives double).
 */

import { useState } from 'react';
import type { GameConfig, PayingSystem } from '@mahjong/engine';
import styles from './GameSetup.module.css';

const SEAT_WINDS = ['East', 'South', 'West', 'North'];

interface Props {
  readonly defaultConfig: GameConfig;
  readonly defaultAiSeats?: number;
  /**
   * Todo E: whether the event log is read aloud. Not part of GameConfig --
   * it is a client-side display preference, not a rule/engine concern, so
   * it is threaded through separately from the config object.
   */
  readonly defaultSpeakEvents?: boolean;
  readonly onStart: (config: GameConfig, aiSeats: number, speakEvents: boolean) => void;
}

export function GameSetup({ defaultConfig, defaultAiSeats, defaultSpeakEvents, onStart }: Props) {
  const [playerCount, setPlayerCount] = useState<3 | 4>(
    (defaultConfig.playerCount as 3 | 4) ?? 4,
  );
  const [aiSeats, setAiSeats] = useState<number>(
    defaultAiSeats ?? ((defaultConfig.playerCount as number) - 1),
  );
  const [knitting, setKnitting] = useState(defaultConfig.knittingEnabled ?? false);
  const [deadWall, setDeadWall] = useState(defaultConfig.deadWall ?? false);
  const [discardsVisible, setDiscardsVisible] = useState(defaultConfig.discardsVisible ?? true);
  const [payingSystem, setPayingSystem] = useState<PayingSystem>(
    defaultConfig.payingSystem ?? 'pool',
  );
  const [speakEvents, setSpeakEvents] = useState(defaultSpeakEvents ?? false);

  // AI count cannot exceed playerCount - 1 (at least one human seat).
  const maxAi = playerCount - 1;
  const clampedAi = Math.min(aiSeats, maxAi);

  const choosePlayers = (n: 3 | 4) => {
    setPlayerCount(n);
    if (aiSeats > n - 1) setAiSeats(n - 1);
  };

  const handleStart = () => {
    onStart(
      {
        playerCount,
        discardsVisible,
        knittingEnabled: knitting,
        deadWall,
        payingSystem,
      },
      clampedAi,
      speakEvents,
    );
  };

  const aiOptions = Array.from({ length: playerCount }, (_, i) => i); // 0 .. playerCount-1

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Mah Jong</h1>
        <p className={styles.sub}>Hong Kong / Cantonese rules</p>

        <div className={styles.section}>
          <label className={styles.label}>Players</label>
          <div className={styles.toggle}>
            <button
              type="button"
              className={playerCount === 4 ? styles.activeBtn : styles.inactiveBtn}
              onClick={() => choosePlayers(4)}
            >
              4
            </button>
            <button
              type="button"
              className={playerCount === 3 ? styles.activeBtn : styles.inactiveBtn}
              onClick={() => choosePlayers(3)}
            >
              3
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>AI opponents</label>
          <div className={styles.toggle}>
            {aiOptions.map(n => (
              <button
                key={n}
                type="button"
                className={clampedAi === n ? styles.activeBtn : styles.inactiveBtn}
                onClick={() => setAiSeats(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <span className={styles.hint}>
            {clampedAi === 0
              ? 'Pass-and-play: you control every seat.'
              : `You play ${SEAT_WINDS.slice(0, playerCount - clampedAi).join(', ')}; `
                + `${SEAT_WINDS.slice(playerCount - clampedAi, playerCount).join(', ')} `
                + `${clampedAi > 1 ? 'are' : 'is'} AI.`}
          </span>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Paying system</label>
          <div className={styles.toggle}>
            <button
              type="button"
              className={payingSystem === 'pool' ? styles.activeBtn : styles.inactiveBtn}
              onClick={() => setPayingSystem('pool')}
            >
              Pool
            </button>
            <button
              type="button"
              className={payingSystem === 'traditional' ? styles.activeBtn : styles.inactiveBtn}
              onClick={() => setPayingSystem('traditional')}
            >
              Traditional
            </button>
          </div>
          <span className={styles.hint}>
            {payingSystem === 'pool'
              ? 'Each player simply banks their own hand score.'
              : 'Losers pay the winner, then settle the differences between '
                + 'themselves. East pays and receives double.'}
          </span>
        </div>

        <div className={styles.section}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={knitting}
              onChange={e => setKnitting(e.target.checked)}
            />
            <span>
              <strong>Knitting &amp; crocheting</strong>
              <span className={styles.hint}>
                &nbsp;-- allow the knitting and crocheting special hands
              </span>
            </span>
          </label>
        </div>

        <div className={styles.section}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={deadWall}
              onChange={e => setDeadWall(e.target.checked)}
            />
            <span>
              <strong>Dead wall</strong>
              <span className={styles.hint}>
                &nbsp;-- reserve 14 tiles for kong / bonus replacements
              </span>
            </span>
          </label>
        </div>

        <div className={styles.section}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={!discardsVisible}
              onChange={e => setDiscardsVisible(!e.target.checked)}
            />
            <span>
              <strong>Hard mode</strong>
              <span className={styles.hint}>
                &nbsp;-- hide the discard pool history (only the tile just played
                is visible, during the claim window)
              </span>
            </span>
          </label>
        </div>

        <div className={styles.section}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={speakEvents}
              onChange={e => setSpeakEvents(e.target.checked)}
            />
            <span>
              <strong>Speak events</strong>
              <span className={styles.hint}>
                &nbsp;-- read each new event aloud (discards, claims, Mah Jong)
              </span>
            </span>
          </label>
        </div>

        <button type="button" className={styles.startBtn} onClick={handleStart}>
          Deal
        </button>
      </div>
    </div>
  );
}
