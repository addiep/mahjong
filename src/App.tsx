/**
 * App shell — wired to the live turn engine (Module 2.2).
 *
 * Holds a live GameState and auto-advances all phases that need no human
 * input: DRAWING (BEGIN_TURN), CHECK_BONUS (DRAW_REPLACEMENT).
 *
 * CLAIM_WINDOW and ROBBING_KONG use a smarter auto-pass (Module 2.4):
 * each pending seat is checked for legal actions. If none are available
 * the seat is auto-passed; otherwise the ActionBar handles the decision.
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
  isWinningHand,
  canPung, canKong, canChow,
  type GameState,
  type GameConfig,
  type SeatIndex,
  type TileId,
  type ClaimDecision,
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
   * Auto-advance non-interactive phases. CLAIM_WINDOW and ROBBING_KONG are
   * only auto-passed when the pending seat has no legal action — otherwise
   * the ActionBar shows and the player decides.
   *
   * Using a functional setState so each dispatch sees the latest state and
   * is safe under React 18 StrictMode double-invocation (phase guards ensure
   * the switch case won't fire again once the phase has already advanced).
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
            const discard = s.discardPool[s.discardPool.length - 1];
            if (!discard) return s;
            const pending = s.claimWindow?.responses.findIndex(r => r === null) ?? -1;
            if (pending < 0) return s;
            const claimer = s.players[pending];
            if (!claimer) return s;
            // Auto-pass only when this seat has no legal action available.
            const leftSeat = (s.currentSeat + 1) % s.config.playerCount;
            const hasLegal =
              isWinningHand([...claimer.concealed, discard], claimer.melds, s.config) ||
              canPung(claimer.concealed, discard) ||
              canKong(claimer.concealed, discard) ||
              (pending === leftSeat && canChow(claimer.concealed, discard));
            if (hasLegal) return s; // ActionBar handles it
            return engineDispatch(s, {
              type: 'CLAIM_RESPONSE',
              seat: pending as SeatIndex,
              decision: { type: 'pass' },
            });
          }

          case 'ROBBING_KONG': {
            const pending = s.robbingKong?.responses.findIndex(r => r === null) ?? -1;
            if (pending < 0) return s;
            const tile = s.robbingKong?.tile;
            const claimer = s.players[pending];
            if (!claimer || !tile) return s;
            // Auto-pass only when this seat cannot win on the robbed tile.
            const canWin = isWinningHand([...claimer.concealed, tile], claimer.melds, s.config);
            if (canWin) return s; // ActionBar handles it
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

  const handleClaimResponse = (seat: SeatIndex, decision: ClaimDecision) => {
    setState(s => engineDispatch(s, { type: 'CLAIM_RESPONSE', seat, decision }));
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
          onClaimResponse={handleClaimResponse}
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
