/**
 * App shell for the local pass-and-play board. For Module 2.0 it simply feeds
 * the sample GameState into the Board and exposes a couple of layout toggles
 * (table size, reveal). The live turn engine is wired in later modules.
 */

import { useMemo, useState } from 'react';
import { Board } from './components/Board';
import { makeSampleState } from './fixtures/sampleState';
import styles from './App.module.css';

export function App() {
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [revealAll, setRevealAll] = useState(true);

  const state = useMemo(() => makeSampleState(playerCount), [playerCount]);

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Mah Jong</span>
        <div className={styles.controls}>
          <label>
            Players
            <select
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value) as 3 | 4)}
            >
              <option value={4}>4</option>
              <option value={3}>3</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={revealAll}
              onChange={(e) => setRevealAll(e.target.checked)}
            />
            Reveal all hands
          </label>
        </div>
      </div>
      <div className={styles.tableArea}>
        <Board state={state} revealAll={revealAll} />
      </div>
    </div>
  );
}

export default App;
