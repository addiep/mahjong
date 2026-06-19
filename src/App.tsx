/**
 * App shell -- wired to the live turn engine.
 *
 * Playtesting round 4 fixes (2026-06-18):
 *  #1  handleDeclareWin now validates the hand with isWinningHand before
 *      dispatching DECLARE_WIN. If the hand doesn't qualify, a message is shown
 *      in the event sidebar and the game state is not advanced.
 *
 * Playtesting round 3 fixes (2026-06-18):
 *  #1/#5  scores prop passed to Board so the sidebar and seat badges show real totals.
 *  #4     Winner's hand captured at HAND_OVER and passed to ScorePanel for display.
 *
 * Playtesting round 2 fixes (2026-06-17):
 *  #1  All players' exposed melds scored at HAND_OVER (scoreExposedMelds).
 *  #5  Red border on last discard stays visible until next discard.
 *  #6  Last-event text shown in the score sidebar.
 *  #7  Tiles auto-sorted every time the active seat rotates (testing aid).
 *
 * Phase 1 playtest fixes (2026-06-17):
 *  #1  Game setup screen before each hand (player count, dirty wins, dead wall).
 *  #2  Hand order persists per seat across board rotations (handOrdersRef).
 *  #3  Gold border on the newly drawn tile (drawnTileId tracked by phase transition).
 *  #4  Red border on last discard during claim window (in Board/DiscardArea).
 *  #5  Chow suppressed in auto-advance when a pung/kong is already claimed.
 *  #8  DECLARE_WIN wired: self-draw Mah Jong button shown when hand is complete.
 *  #9  Draw (wall exhausted) no longer updates running totals or shows scores.
 * #12  "Drawn clockwise" label removed (in Board).
 * #13  Bigger tiles (bottom 68px, others 50px, in Board).
 *
 * Rule changes batch (2026-06-18):
 *  - Winner's bonus tile points not added when hand is a limit hand.
 *  - scoreExposedMelds now receives the player's seatWind for own-wind doubling.
 */

import { useEffect, useRef, useState } from 'react';
import { Board } from './components/Board';
import { ScorePanel } from './components/ScorePanel';
import type { PlayerBonusInfo, WinnerHandInfo } from './components/ScorePanel';
import { GameSetup } from './components/GameSetup';
import {
  buildWall,
  createGameState,
  DEFAULT_CONFIG,
  dispatch as engineDispatch,
  isWinningHand,
  isSuited, isWind, isDragon,
  canPung, canKong, canChow,
  scoreWinningHand,
  scoreBonusTiles,
  scoreExposedMelds,
  inferTable,
  HeuristicController,
  adviseSeat,
  type GameState,
  type GameConfig,
  type SeatIndex,
  type TileId,
  type Tile,
  type Suit,
  type Wind,
  type Dragon,
  type ClaimDecision,
  type ScoreResult,
  type WinContext,
  type ExposedMeldScoreResult,
} from '@mahjong/engine';
import styles from './App.module.css';

// --- Tile sort helpers (mirrored from PlayerHand.tsx) -----

const SUIT_ORDER: Record<Suit, number> = { bamboo: 0, characters: 1, circles: 2 };
const WIND_ORDER: Record<Wind, number> = { east: 0, south: 1, west: 2, north: 3 };
const DRAGON_ORDER: Record<Dragon, number> = { red: 0, green: 1, white: 2 };

function sortTileKey(t: Tile): [number, number, number] {
  if (isSuited(t)) return [0, SUIT_ORDER[t.suit], t.value];
  if (isWind(t))   return [1, WIND_ORDER[t.wind], 0];
  if (isDragon(t)) return [2, DRAGON_ORDER[t.dragon], 0];
  return [3, 0, 0];
}

function compareTileKeys(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Human-readable tile name, e.g. '3 of bamboo', 'east wind', 'red dragon'. */
function tileName(tile: Tile): string {
  if (isSuited(tile)) return `${tile.value} of ${tile.suit}`;
  if (isWind(tile))   return `${tile.wind} wind`;
  if (isDragon(tile)) return `${tile.dragon} dragon`;
  return 'bonus tile';
}

// --- Game initialisation -----

function makeInitialState(config: GameConfig): GameState {
  const deal = buildWall(config.playerCount, config.deadWall ?? false);
  const names =
    config.playerCount === 4
      ? ['Alice', 'Bob', 'Carol', 'Dan']
      : ['Alice', 'Bob', 'Carol'];
  return createGameState(config, deal, names);
}

// --- Types -----

interface HandScoreInfo {
  winnerName: string | null;
  result: ScoreResult | null;
  playerBonuses: PlayerBonusInfo[];
  /** Winner's full hand for display; null on a draw. */
  winnerHand: WinnerHandInfo | null;
}

// --- App -----

export function App() {
  // 'setup' = show the setup screen; 'playing' = game in progress.
  const [appPhase, setAppPhase] = useState<'setup' | 'playing'>('setup');
  const [gameConfig, setGameConfig] = useState<GameConfig>({ ...DEFAULT_CONFIG });
  const [revealAll, setRevealAll] = useState(true);
  const [state, setState] = useState<GameState | null>(null);
  const [handScore, setHandScore] = useState<HandScoreInfo | null>(null);
  const [runningTotals, setRunningTotals] = useState<number[]>([0, 0, 0, 0]);

  // Number of AI opponents (the last N seats); the human is always seat 0.
  const [aiSeats, setAiSeats] = useState(0);
  // One HeuristicController per AI seat, rebuilt each hand so strategy state resets.
  const aiControllers = useRef<Map<number, HeuristicController>>(new Map());
  // Guard so the AI acts on each distinct state at most once.
  const aiActedRef = useRef<GameState | null>(null);

  // Tile just drawn from the wall -- shown with a gold border.
  const [drawnTileId, setDrawnTileId] = useState<TileId | null>(null);

  // Last notable game event for display in the score sidebar.
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  // Per-seat hand display orders: auto-sorted each time a new seat becomes active.
  const handOrdersRef = useRef<Map<number, string[]>>(new Map());
  // The saved order for whoever is currently the interactive (bottom) seat.
  const [currentSeatOrder, setCurrentSeatOrder] = useState<string[] | undefined>(undefined);

  // Guard against scoring the same HAND_OVER state twice (React StrictMode).
  const scoredStateRef = useRef<GameState | null>(null);

  // Track phase transitions to detect when a tile is newly drawn.
  const prevPhaseRef = useRef<string | null>(null);
  const prevSeatRef = useRef<number | null>(null);

  // -- Start / new hand -----

  const buildAiControllers = (playerCount: number, ai: number) => {
    const map = new Map<number, HeuristicController>();
    for (let seat = playerCount - ai; seat < playerCount; seat++) {
      map.set(seat, new HeuristicController(seat as SeatIndex));
    }
    aiControllers.current = map;
    aiActedRef.current = null;
  };

  const startGame = (config: GameConfig, ai: number) => {
    setGameConfig(config);
    setAiSeats(ai);
    buildAiControllers(config.playerCount, ai);
    setRunningTotals(Array(config.playerCount).fill(0));
    handOrdersRef.current.clear();
    setCurrentSeatOrder(undefined);
    setHandScore(null);
    setDrawnTileId(null);
    setLastEvent(null);
    setState(makeInitialState(config));
    setAppPhase('playing');
  };

  const startNewHand = () => {
    buildAiControllers(gameConfig.playerCount, aiSeats);
    handOrdersRef.current.clear();
    setCurrentSeatOrder(undefined);
    setHandScore(null);
    setDrawnTileId(null);
    setLastEvent(null);
    setState(makeInitialState(gameConfig));
  };

  // -- Auto-advance non-interactive phases -----

  useEffect(() => {
    if (!state) return;
    setState(s => {
      if (!s) return s;
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

            // If any seat already has a pung/kong/win claim in, suppress chow
            // for remaining seats (priority: win > pung/kong > chow).
            const higherClaimIn = s.claimWindow!.responses.some(
              r => r !== null && (r.type === 'pung' || r.type === 'kong' || r.type === 'win'),
            );

            const hasLegal =
              isWinningHand([...claimer.concealed, discard], claimer.melds, s.config) ||
              canPung(claimer.concealed, discard) ||
              canKong(claimer.concealed, discard) ||
              (!higherClaimIn && pending === leftSeat && canChow(claimer.concealed, discard));

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

  // -- Drive AI seats -----
  // When the seat to act (or the first pending claimer) is an AI seat, ask its
  // HeuristicController and dispatch the result after a short, watchable delay.
  // The synchronous auto-advance above leaves AI decision points untouched
  // (it only auto-passes seats with no legal action), so the two never clash.

  useEffect(() => {
    if (!state) return;
    if (aiSeats <= 0) return;
    if (aiActedRef.current === state) return;

    const pc = state.config.playerCount;
    const isAi = (seat: number) => seat >= pc - aiSeats;
    const captured = state;
    let act: (() => void) | null = null;

    if (state.phase === 'DISCARDING' && isAi(state.currentSeat)) {
      const seat = state.currentSeat;
      const ctrl = aiControllers.current.get(seat);
      if (ctrl) {
        act = () => {
          void ctrl.getDiscardAction(captured, seat as SeatIndex).then(action => {
            setState(s => {
              if (s !== captured) return s;
              const player = s.players[seat];
              if (action.type === 'DISCARD') {
                const tile = player?.concealed.find(t => t.id === action.tileId);
                if (player && tile) setLastEvent(`${player.name} discarded the ${tileName(tile)}`);
              } else if (action.type === 'DECLARE_WIN') {
                if (player) setLastEvent(`${player.name} declared Mah Jong!`);
              }
              setDrawnTileId(null);
              try { return engineDispatch(s, action); }
              catch (err) { console.error('AI discard error:', err); return s; }
            });
          });
        };
      }
    } else if (state.phase === 'CLAIM_WINDOW') {
      const discard = state.discardPool[state.discardPool.length - 1];
      const pending = state.claimWindow?.responses.findIndex(r => r === null) ?? -1;
      if (discard && pending >= 0 && isAi(pending)) {
        const claimer = state.players[pending];
        const leftSeat = (state.currentSeat + 1) % pc;
        const higherClaimIn = state.claimWindow!.responses.some(
          r => r !== null && (r.type === 'pung' || r.type === 'kong' || r.type === 'win'),
        );
        const hasLegal = !!claimer && (
          isWinningHand([...claimer.concealed, discard], claimer.melds, state.config) ||
          canPung(claimer.concealed, discard) ||
          canKong(claimer.concealed, discard) ||
          (!higherClaimIn && pending === leftSeat && canChow(claimer.concealed, discard))
        );
        const ctrl = aiControllers.current.get(pending);
        if (hasLegal && ctrl) {
          act = () => {
            void ctrl.getClaimDecision(captured, pending as SeatIndex).then(decision => {
              setState(s => {
                if (s !== captured) return s;
                if (decision.type !== 'pass') {
                  const pl = s.players[pending];
                  const tile = s.discardPool[s.discardPool.length - 1];
                  if (pl && tile) {
                    const verb = decision.type === 'win' ? 'won with'
                      : decision.type === 'pung' ? 'punged'
                      : decision.type === 'kong' ? 'konged' : 'chowed';
                    setLastEvent(`${pl.name} ${verb} the ${tileName(tile)}`);
                  }
                }
                try { return engineDispatch(s, { type: 'CLAIM_RESPONSE', seat: pending as SeatIndex, decision }); }
                catch (err) { console.error('AI claim error:', err); return s; }
              });
            });
          };
        }
      }
    } else if (state.phase === 'ROBBING_KONG') {
      const pending = state.robbingKong?.responses.findIndex(r => r === null) ?? -1;
      const tile = state.robbingKong?.tile;
      if (pending >= 0 && isAi(pending) && tile) {
        const claimer = state.players[pending];
        const canWin = !!claimer && isWinningHand([...claimer.concealed, tile], claimer.melds, state.config);
        const ctrl = aiControllers.current.get(pending);
        if (canWin && ctrl) {
          act = () => {
            void ctrl.getClaimDecision(captured, pending as SeatIndex).then(decision => {
              setState(s => s === captured
                ? engineDispatch(s, { type: 'CLAIM_RESPONSE', seat: pending as SeatIndex, decision })
                : s);
            });
          };
        }
      }
    }

    if (!act) return;
    aiActedRef.current = state;
    const handle = setTimeout(act, 500);
    return () => clearTimeout(handle);
  }, [state, aiSeats]);

  // -- Track drawn tile (gold border) -----

  useEffect(() => {
    if (!state) return;
    const prevPhase = prevPhaseRef.current;
    const prevSeat = prevSeatRef.current;
    prevPhaseRef.current = state.phase;
    prevSeatRef.current = state.currentSeat;

    if (
      state.phase === 'DISCARDING' &&
      (prevPhase === 'DRAWING' || prevPhase === 'CHECK_BONUS' || prevSeat !== state.currentSeat)
    ) {
      // The last tile in the current player's concealed hand is the one just drawn.
      const player = state.players[state.currentSeat];
      const drawn = player?.concealed[player.concealed.length - 1];
      setDrawnTileId(drawn?.id ?? null);
    } else if (state.phase !== 'DISCARDING') {
      setDrawnTileId(null);
    }
  }, [state]);

  // -- Auto-sort tiles when active seat changes -----
  // During testing: tiles are sorted each time a seat becomes active so that
  // a freshly rotated hand is always in a readable order.

  useEffect(() => {
    if (!state) return;
    const player = state.players[state.currentSeat];
    if (!player) return;
    const sortedIds = [...player.concealed]
      .sort((a, b) => compareTileKeys(sortTileKey(a), sortTileKey(b)))
      .map(t => t.id);
    handOrdersRef.current.set(state.currentSeat, sortedIds);
    setCurrentSeatOrder(sortedIds);
  }, [state?.currentSeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Score HAND_OVER -----

  useEffect(() => {
    if (!state) return;
    if (state.phase !== 'HAND_OVER') return;
    if (scoredStateRef.current === state) return;
    scoredStateRef.current = state;

    const hr = state.handResult;
    if (!hr) return;

    // Draw: no scoring, no running total update.
    if (hr.reason === 'draw') {
      setHandScore({ winnerName: null, result: null, playerBonuses: [], winnerHand: null });
      return;
    }

    // Win: compute hand score and per-player meld + bonus scores.
    let result: ScoreResult | null = null;

    if (hr.winnerSeat !== null && hr.winningTile) {
      const winner = state.players[hr.winnerSeat];
      if (winner) {
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

    // Build winner hand info for display in the score overlay.
    const winnerPlayer = hr.winnerSeat !== null ? state.players[hr.winnerSeat] : null;
    const winnerHand: WinnerHandInfo | null = (winnerPlayer && hr.winnerSeat !== null)
      ? {
          concealed: hr.selfDraw
            ? winnerPlayer.concealed
            : hr.winningTile
              ? [...winnerPlayer.concealed, hr.winningTile]
              : winnerPlayer.concealed,
          melds: winnerPlayer.melds,
          bonusTiles: winnerPlayer.bonusTiles,
          winningTileId: hr.winningTile?.id ?? null,
        }
      : null;

    // Build per-player bonus + meld info.
    // For non-winners: pass the player's own seatWind for correct own-wind doubling.
    const playerBonuses: PlayerBonusInfo[] = state.players.map(p => ({
      name: p.name,
      seat: p.seat,
      bonus: scoreBonusTiles(p.bonusTiles),
      meldScore: p.seat !== hr.winnerSeat
        ? scoreExposedMelds(p.melds, p.bonusTiles, undefined, p.seatWind)
        : null,
    }));

    setRunningTotals(prev =>
      prev.map((t, i) => {
        const player = state.players[i];
        if (!player) return t;
        const pb = playerBonuses[i];
        // Winner's bonus tile points are NOT added for limit hands (rule change).
        const isWinnerLimit = i === hr.winnerSeat && result?.isLimitHand;
        const bonusPts = isWinnerLimit ? 0 : (pb?.bonus.points ?? 0);
        const handPts  = i === hr.winnerSeat && result ? result.total : 0;
        const meldPts  = i !== hr.winnerSeat ? (pb?.meldScore?.total ?? 0) : 0;
        return t + bonusPts + handPts + meldPts;
      }),
    );

    setHandScore({
      winnerName: hr.winnerSeat !== null ? (state.players[hr.winnerSeat]?.name ?? null) : null,
      result,
      playerBonuses,
      winnerHand,
    });
  }, [state]);

  // -- Event handlers -----

  const handleDiscard = (tileId: TileId) => {
    if (state) {
      const player = state.players[state.currentSeat];
      const tile = player?.concealed.find(t => t.id === tileId);
      if (player && tile) setLastEvent(`${player.name} discarded the ${tileName(tile)}`);
    }
    setDrawnTileId(null);
    setState(s => s ? engineDispatch(s, { type: 'DISCARD', tileId }) : s);
  };

  const handleDeclareWin = () => {
    if (!state) return;
    const player = state.players[state.currentSeat];
    if (!player) return;

    // Validate before dispatching -- the button is always shown during DISCARDING
    // but the hand may not yet be a winning hand.
    if (!isWinningHand(player.concealed, player.melds, state.config)) {
      setLastEvent("That hand doesn't qualify for Mah Jong yet.");
      return;
    }

    setLastEvent(`${player.name} declared Mah Jong!`);
    setState(s => s ? engineDispatch(s, { type: 'DECLARE_WIN' }) : s);
  };

  const handleClaimResponse = (seat: SeatIndex, decision: ClaimDecision) => {
    if (decision.type !== 'pass' && state) {
      const player = state.players[seat];
      const tile = state.discardPool[state.discardPool.length - 1];
      if (player && tile) {
        const verb =
          decision.type === 'win'  ? 'won with' :
          decision.type === 'pung' ? 'punged' :
          decision.type === 'kong' ? 'konged' :
          'chowed';
        setLastEvent(`${player.name} ${verb} the ${tileName(tile)}`);
      }
    }
    setState(s => s ? engineDispatch(s, { type: 'CLAIM_RESPONSE', seat, decision }) : s);
  };

  const handleOrderChange = (ids: string[]) => {
    if (!state) return;
    handOrdersRef.current.set(state.currentSeat, ids);
  };

  const handleHint = () => {
    if (!state) return;
    if (state.phase !== 'DISCARDING') { setLastEvent('Hint: wait until it is your turn to discard.'); return; }
    const seat = state.currentSeat;
    const advice = adviseSeat(state, seat);
    if (advice.winNow) { setLastEvent('Hint: this hand is a winning hand -- declare Mah Jong!'); return; }
    const planText = advice.plan.mode === 'dirty'
      ? 'go for a dirty hand (build melds in any suit, fast)'
      : `collect ${advice.plan.targetSuit}`;
    let discardText = '';
    if (advice.discard) {
      const player = state.players[seat];
      const tile = player?.concealed.find(t => t.id === advice.discard);
      if (tile) discardText = `; the AI would discard the ${tileName(tile)}`;
    }
    setLastEvent(`Hint: ${planText}${discardText}.`);
  };

  // -- Render -----

  // Setup screen.
  if (appPhase === 'setup' || !state) {
    return (
      <div className={styles.app}>
        <GameSetup defaultConfig={gameConfig} defaultAiSeats={aiSeats} onStart={startGame} />
      </div>
    );
  }

  const aiStart = state.config.playerCount - aiSeats;
  const humanSeats = new Set<number>();
  for (let s2 = 0; s2 < state.config.playerCount; s2++) {
    if (aiSeats <= 0 || s2 < aiStart) humanSeats.add(s2);
  }

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Mah Jong</span>
        <div className={styles.controls}>
          <label>
            <input
              type="checkbox"
              checked={revealAll}
              onChange={e => setRevealAll(e.target.checked)}
            />
            Reveal all hands
          </label>
          <button type="button" className={styles.newHandBtn} onClick={handleHint}>
            Hint
          </button>
          <button type="button" className={styles.newHandBtn} onClick={() => setAppPhase('setup')}>
            Setup
          </button>
          <button type="button" className={styles.newHandBtn} onClick={startNewHand}>
            New hand
          </button>
        </div>
      </div>

      <div className={styles.tableArea}>
        <Board
          state={state}
          revealAll={revealAll}
          onDiscard={state.phase === 'DISCARDING' ? handleDiscard : undefined}
          onDeclareWin={state.phase === 'DISCARDING' ? handleDeclareWin : undefined}
          onClaimResponse={handleClaimResponse}
          humanSeats={humanSeats}
          drawnTileId={drawnTileId}
          savedOrder={currentSeatOrder}
          onOrderChange={handleOrderChange}
          lastEvent={lastEvent}
          scores={runningTotals}
          inference={inferTable(state)}
        />
      </div>

      {state.phase === 'HAND_OVER' && handScore && (
        <ScorePanel
          winnerName={handScore.winnerName}
          result={handScore.result}
          playerBonuses={handScore.playerBonuses}
          winnerHand={handScore.winnerHand}
          runningTotals={state.players.map((p, i) => ({
            name: p.name,
            total: runningTotals[i] ?? 0,
          }))}
          onNewHand={startNewHand}
        />
      )}
    </div>
  );
}

export default App;
