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
 *
 * Module 2.5: when HAND_OVER is reached, scores are computed and shown in
 * the ScorePanel overlay.
 */

import { useEffect, useRef, useState } from 'react';
import { Board } from './components/Board';
import { ScorePanel } from './components/ScorePanel';
import type { PlayerBonusInfo } from './components/ScorePanel';
import {
  buildWall,
  createGameState,
  DEFAULT_CONFIG,
  dispatch as engineDispatch,
  isWinningHand,
  canPung, canKong, canChow,
  scoreWinningHand,
  scoreBonusTiles,
  type GameState,
  type GameConfig,
  type SeatIndex,
  type TileId,
  type ClaimDecision,
  type ScoreResult,
  type WinContext,
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

interface HandScoreInfo {
  winnerName: string | null;
  result: ScoreResult | null;
  playerBonuses: PlayerBonusInfo[];
}

export function App() {
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [revealAll, setRevealAll] = useState(true);
  const [state, setState] = useState<GameState>(() => makeInitialState(4));
  const [handScore, setHandScore] = useState<HandScoreInfo | null>(null);
  const [runningTotals, setRunningTotals] = useState<number[]>([0, 0, 0, 0]);

  // Guard against computing the score twice for the same HAND_OVER state
  // (React StrictMode double-invokes effects; the ref persists through cleanup).
  const scoredStateRef = useRef<GameState | null>(null);

  /**
   * Auto-advance non-interactive phases.
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
            const leftSeat = (s.currentSeat + 1) % s.config.playerCount;
            const hasLegal =
              isWinningHand([...claimer.concealed, discard], claimer.melds, s.config) ||
              canPung(claimer.concealed, discard) ||
              canKong(claimer.concealed, discard) ||
              (pending === leftSeat && canChow(claimer.concealed, discard));
            if (hasLegal) return s;
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
            const canWin = isWinningHand([...claimer.concealed, tile], claimer.melds, s.config);
            if (canWin) return s;
            return engineDispatch(s, {
              type: 'CLAIM_RESPONSE',
              seat: pending as SeatIndex,
              decision: { type: 'pass' },
            });
          }

          default:
            return s;
        }
      } catch (err) {
        console.error('Engine error during auto-advance:', err);
        return s;
      }
    });
  }, [state]);

  /**
   * Compute and store the hand score when HAND_OVER is reached.
   * The scoredStateRef guard ensures this runs exactly once per hand end,
   * even under React 18 StrictMode double-invocation.
   */
  useEffect(() => {
    if (state.phase !== 'HAND_OVER') return;
    if (scoredStateRef.current === state) return;
    scoredStateRef.current = state;

    const hr = state.handResult;
    if (!hr) return;

    let result: ScoreResult | null = null;

    if (hr.reason === 'win' && hr.winnerSeat !== null && hr.winningTile) {
      const winner = state.players[hr.winnerSeat];
      if (winner) {
        // For discard/robbing-kong wins, the winning tile is in the discard pool,
        // not yet in the winner's concealed hand — add it for scoring.
        const concealed = hr.selfDraw
          ? winner.concealed
          : [...winner.concealed, hr.winningTile];

        const winContext: WinContext = {
          source: hr.winSource ?? 'self-draw-wall',
          isLastWallTile: hr.isLastWallTile ?? false,
        };

        const scoreInput: Parameters<typeof scoreWinningHand>[0] = {
          concealed,
          declaredMelds: winner.melds,
          bonusTiles: winner.bonusTiles,
          winningTile: hr.winningTile,
          winContext,
          seatWind: winner.seatWind,
          prevailingWind: state.prevailingWind,
          seat: winner.seat,
          gameConfig: state.config,
          wonByDiscard: !hr.selfDraw,
          robbingKong: hr.robbedKong ?? false,
        };

        try {
          result = scoreWinningHand(scoreInput);
        } catch (err) {
          console.error('Scoring error:', err);
        }
      }
    }

    // Bonus tiles for all players (applies whether win or draw).
    const playerBonuses: PlayerBonusInfo[] = state.players.map(p => ({
      name: p.name,
      seat: p.seat,
      bonus: scoreBonusTiles(p.bonusTiles),
    }));

    // Update running totals.
    setRunningTotals(prev =>
      prev.map((t, i) => {
        const player = state.players[i];
        if (!player) return t;
        const bonusPts = playerBonuses[i]?.bonus.points ?? 0;
        const handPts = i === hr.winnerSeat && result ? result.total : 0;
        return t + bonusPts + handPts;
      }),
    );

    setHandScore({
      winnerName: hr.winnerSeat !== null ? (state.players[hr.winnerSeat]?.name ?? null) : null,
      result,
      playerBonuses,
    });
  }, [state]);

  const handleDiscard = (tileId: TileId) => {
    setState(s => engineDispatch(s, { type: 'DISCARD', tileId }));
  };

  const handleClaimResponse = (seat: SeatIndex, decision: ClaimDecision) => {
    setState(s => engineDispatch(s, { type: 'CLAIM_RESPONSE', seat, decision }));
  };

  const startNewHand = (count: 3 | 4 = playerCount) => {
    if (count !== playerCount) {
      setRunningTotals([0, 0, 0, 0]);
    }
    setHandScore(null);
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

      {state.phase === 'HAND_OVER' && handScore && (
        <ScorePanel
          winnerName={handScore.winnerName}
          result={handScore.result}
          playerBonuses={handScore.playerBonuses}
          runningTotals={state.players.map((p, i) => ({
            name: p.name,
            total: runningTotals[i] ?? 0,
          }))}
          onNewHand={() => startNewHand()}
        />
      )}
    </div>
  );
}

export default App;
