/**
 * GameSetup — pre-game configuration screen.
 *
 * Collects:
 *  - Player count (3 or 4)
 *  - Dirty wins allowed (off by default)
 *  - Dead wall (off by default)
 */

import { useState } from 'react';
import type { GameConfig } from '@mahjong/engine';
import styles from './GameSetup.module.css';

interface Props {
  readonly defaultConfig: GameConfig;
  readonly onStart: (config: GameConfig) => void;
}

export function GameSetup({ defaultConfig, onStart }: Props) {
  const [playerCount, setPlayerCount] = useState<3 | 4>(
    (defaultConfig.playerCount as 3 | 4) ?? 4,
  );
  const [dirtyWin, setDirtyWin] = useState(defaultConfig.dirtyWinAllowed ?? false);
  const [deadWall, setDeadWall] = useState(defaultConfig.deadWall ?? false);

  const handleStart = () => {
    onStart({
      playerCount,
      discardsVisible: true,
      knittingEnabled: false,
      dirtyWinAllowed: dirtyWin,
      deadWall,
    });
  };

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
              onClick={() => setPlayerCount(4)}
            >
              4
            </button>
            <button
              type="button"
              className={playerCount === 3 ? styles.activeBtn : styles.inactiveBtn}
              onClick={() => setPlayerCount(3)}
            >
              3
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={dirtyWin}
              onChange={e => setDirtyWin(e.target.checked)}
            />
            <span>
              <strong>Dirty wins allowed</strong>
              <span className={styles.hint}>
                &nbsp;— winner may have an unpaired bonus tile
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
                &nbsp;— reserve 14 tiles for kong / bonus replacements
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
