/**
 * App shell — wired to the live turn engine (Module 2.2).
 *
 * Holds a live GameState and auto-advances all phases that need no human
 * input: DRAWING (BEGIN_TURN), CHECK_BONUS (DRAW_REPLACEMENT), CLAIM_WINDOW
 * and ROBBING_KONG (auto-pass until Module 2.4 adds real claim buttons).
 *
 * The DISCARDING phase is interactive: the current player taps a tile to
 * select it (lifted, green border), then taps again to confirm the discard.
 */

import { useEffect, useState } from 'react';
import { Board } from './components/Board';
import {
  buildWall,
  createGameState,
  DEFAULT_CONFIG,
  dispatch as engineDispatch,
  type GameState,
  type GameConfig,
  type SeatIndex,
  type TileId,
} from '@mahjong/engine';
import styles from './App.module.css';

function makeInitialState(playerCount: 3 | 4): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount };
  const deal = buildWall(playerCount, config.deadWall ?? false);
  const names =
    playerCount === 4
      ? ['Alice', 'Bob', 'Carol', 'Dan']
      : ['Alice', 'Bob', 'Carol'];
  return createGameState(config, deal, names);
}

export function App() {
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [revealAll, setRevealAll] = useState(true);
  const [state, setState] = useState<GameState>(() => makeInitialState(4));

  /**
   * Auto-advance all non-interactive phases. Using a functional setState so
   * the dispatch always sees the latest state — safe under React 18 Strict
   * Mode double-invocation because each branch guards on the current phase.
   */
  useEffect(() => {
    setState(s => {
      try {
        switch (s.phase) {
          case 'DRAWING':
            return engineDispatch(s, { type: 'BEGIN_TURN' });
          case 'CHECK_BONUS':
            return engineDispatch(s, { type: 'DRAW_REPLACEMENT' });
          case 'CLAIM_WINDOW': {
            const pending = s.claimWindow?.responses.findIndex(r => r === null) ?? -1;
            if (pending < 0) return s;
            return engineDispatch(s, {
              type: 'CLAIM_RESPONSE',
              seat: pending as SeatIndex,
              decision: { type: 'pass' },
            });
          }
          case 'ROBBING_KONG': {
            const pending = s.robbingKong?.responses.findIndex(r => r === null) ?? -1;
            if (pending < 0) return s;
            return engineDispatch(s, {
              type: 'CLAIM_RESPONSE',
              seat: pending as SeatIndex,
              decision: { type: 'pass' },
            });
          }
          default:
            return s; // DISCARDING or HAND_OVER — no auto-advance
        }
      } catch (err) {
        console.error('Engine error during auto-advance:', err);
        return s;
      }
    });
  }, [state]);

  const handleDiscard = (tileId: TileId) => {
    setState(s => engineDispatch(s, { type: 'DISCARD', tileId }));
  };

  const startNewHand = (count: 3 | 4 = playerCount) => {
    setState(makeInitialState(count));
  };

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Mah Jong</span>
        <div className={styles.controls}>
          <label>
            Players
            <select
              value={playerCount}
              onChange={e => {
                const n = Number(e.target.value) as 3 | 4;
                setPlayerCount(n);
                startNewHand(n);
              }}
            >
              <option value={4}>4</option>
              <option value={3}>3</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={revealAll}
              onChange={e => setRevealAll(e.target.checked)}
            />
            Reveal all hands
          </label>
          <button type="button" className={styles.newHandBtn} onClick={() => startNewHand()}>
            New hand
          </button>
        </div>
      </div>

      <div className={styles.tableArea}>
        <Board
          state={state}
          revealAll={revealAll}
          onDiscard={state.phase === 'DISCARDING' ? handleDiscard : undefined}
        />
      </div>

      {state.phase === 'HAND_OVER' && (
        <div className={styles.handOverBanner}>
          <span>
            {state.handResult?.reason === 'win'
              ? `${state.players[state.handResult.winnerSeat ?? 0]?.name ?? '?'} wins!`
              : 'Draw — wall exhausted.'}
          </span>
          <button type="button" className={styles.newHandBtn} onClick={() => startNewHand()}>
            New hand
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
