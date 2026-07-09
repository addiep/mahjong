/**
 * Local pass-and-play mode -- game state, Todo A seat/wind rotation, phase
 * auto-advance, the AI driver, HAND_OVER scoring, and all action handlers.
 *
 * Extracted verbatim from App.tsx in the Todo G refactor (2026-07-02); no
 * behaviour change. Key invariants preserved:
 *  - logEvent is called OUTSIDE setState updaters (StrictMode double-invokes
 *    updaters, which would duplicate entries).
 *  - The AI driver's aiActedRef guard is reset in the effect cleanup so a
 *    cancelled re-run (concurrent mode) cannot permanently block a move.
 *  - Seat rotation: East retains the dealer on a win OR a draw; otherwise
 *    the assignment rotates anticlockwise, and the round wind advances one
 *    step after a full circuit of dealer changes.
 */

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CONFIG,
  dispatch as engineDispatch,
  isWinningHand,
  canPung, canKong, canChow,
  scoreWinningHand,
  scoreBonusTiles,
  scoreExposedMelds,
  HeuristicController,
  type GameState,
  type GameConfig,
  type SeatIndex,
  type TileId,
  type Wind,
  type ClaimDecision,
  type ScoreResult,
  type WinContext,
} from '@mahjong/engine';
import type { PlayerBonusInfo, WinnerHandInfo } from '../components/ScorePanel';
import {
  ROSTER_NAMES,
  nextWind,
  makeInitialState,
  tileName,
  getAddKongOptions,
  sortedTileIds,
  buildHintText,
  type HandScoreInfo,
} from '../lib/game-helpers';

export function useLocalGame(
  logEvent: (msg: string) => void,
  clearEvents: () => void,
) {
  // 'setup' = show the setup screen; 'playing' = game in progress.
  const [appPhase, setAppPhase] = useState<'setup' | 'playing'>('setup');
  // Knitting & crocheting is ticked by default on the setup screen (Adam's
  // preference, 2026-07-09). The engine's own DEFAULT_CONFIG stays
  // conservative (off) -- this is an app-level default, not a rules default.
  const [gameConfig, setGameConfig] = useState<GameConfig>({
    ...DEFAULT_CONFIG,
    knittingEnabled: true,
  });
  const [state, setState] = useState<GameState | null>(null);
  const [handScore, setHandScore] = useState<HandScoreInfo | null>(null);
  const [runningTotals, setRunningTotals] = useState<number[]>([0, 0, 0, 0]);

  // Number of AI opponents. Fixed for the session (set once in GameSetup);
  // which *identity slots* are AI is fixed too (the last `aiSeats` slots),
  // but which *seat* (wind) each identity currently occupies rotates hand to
  // hand -- see seatAssignmentRef below (issue 3 / Todo A fix, 2026-07-02).
  const [aiSeats, setAiSeats] = useState(0);
  // seatAssignmentRef[seat] = identity slot currently holding that seat/wind.
  // Identity 0 is the default local seat; identities >= playerCount-aiSeats
  // are AI. Starts as the identity trivially (seat i = identity i) and is
  // rotated in startNewHand per the HK "East stays East on a win" rule.
  const seatAssignmentRef = useRef<number[]>([]);
  // Wind of the round (prevailing wind); persists across hands and advances
  // once every seat has been dealer (Todo A's "round wind" note).
  const roundWindRef = useRef<Wind>('east');
  const dealerChangeCountRef = useRef(0);
  // Cosmetic wall-ring rotation, re-rolled each hand (Todo B, 2026-07-02).
  const [wallStartOffset, setWallStartOffset] = useState(0);
  // One HeuristicController per AI seat, rebuilt each hand so strategy state resets.
  const aiControllers = useRef<Map<number, HeuristicController>>(new Map());
  // Guard so the AI acts on each distinct state at most once.
  // Reset to null in the effect cleanup so that if React re-runs the effect for
  // the same state (possible in concurrent mode), the guard does not block
  // rescheduling after the timer was cancelled.
  const aiActedRef = useRef<GameState | null>(null);
  // Step-through mode (test aid): when on, each AI move waits for the Step button.
  const [stepMode, setStepMode] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const pendingActRef = useRef<(() => void) | null>(null);

  // Tile just drawn from the wall -- shown with a gold border.
  const [drawnTileId, setDrawnTileId] = useState<TileId | null>(null);

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

  // Whether identity slot k is AI, for a given playerCount/aiSeats. Identities
  // are fixed for the whole session; only their seat/wind rotates.
  const identityIsAi = (identity: number, playerCount: number, ai: number) =>
    identity >= playerCount - ai;

  const namesForAssignment = (assignment: number[]) =>
    assignment.map(identity => ROSTER_NAMES[identity] ?? `Player ${identity + 1}`);

  const buildAiControllers = (playerCount: number, ai: number) => {
    const map = new Map<number, HeuristicController>();
    for (let seat = 0; seat < playerCount; seat++) {
      const identity = seatAssignmentRef.current[seat] ?? seat;
      if (identityIsAi(identity, playerCount, ai)) {
        map.set(seat, new HeuristicController(seat as SeatIndex));
      }
    }
    aiControllers.current = map;
    aiActedRef.current = null;
  };

  const startGame = (config: GameConfig, ai: number) => {
    setGameConfig(config);
    setAiSeats(ai);
    seatAssignmentRef.current = Array.from({ length: config.playerCount }, (_, i) => i);
    roundWindRef.current = 'east';
    dealerChangeCountRef.current = 0;
    setWallStartOffset(Math.floor(Math.random() * 1000));
    buildAiControllers(config.playerCount, ai);
    setRunningTotals(Array(config.playerCount).fill(0));
    handOrdersRef.current.clear();
    setCurrentSeatOrder(undefined);
    setHandScore(null);
    setDrawnTileId(null);
    clearEvents();
    setState(makeInitialState(config, namesForAssignment(seatAssignmentRef.current), roundWindRef.current));
    setAppPhase('playing');
  };

  const startNewHand = () => {
    // East Stays East on a Win (Todo A): rotate seats anticlockwise (the
    // player who was South becomes the new East, etc.) unless the just-
    // finished hand was won by the current East seat, or ended in a draw --
    // both retain the current dealer, per Adam's 2026-07-02 call.
    const justFinished = state?.handResult ?? null;
    const eastRetains =
      justFinished === null || // hand aborted early / no result -- don't rotate
      justFinished.reason === 'draw' ||
      (justFinished.reason === 'win' && justFinished.winnerSeat === 0);

    if (!eastRetains) {
      const prev = seatAssignmentRef.current;
      seatAssignmentRef.current = prev.map((_, i) => prev[(i + 1) % prev.length] ?? i);
      dealerChangeCountRef.current += 1;
      if (dealerChangeCountRef.current >= gameConfig.playerCount) {
        roundWindRef.current = nextWind(roundWindRef.current, gameConfig.playerCount);
        dealerChangeCountRef.current = 0;
      }
    }

    setWallStartOffset(Math.floor(Math.random() * 1000));
    buildAiControllers(gameConfig.playerCount, aiSeats);
    handOrdersRef.current.clear();
    setCurrentSeatOrder(undefined);
    setHandScore(null);
    setDrawnTileId(null);
    clearEvents();
    setState(makeInitialState(gameConfig, namesForAssignment(seatAssignmentRef.current), roundWindRef.current));
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
    const isAi = (seat: number) => identityIsAi(seatAssignmentRef.current[seat] ?? seat, pc, aiSeats);
    const captured = state;
    let act: (() => void) | null = null;

    if (state.phase === 'DISCARDING' && isAi(state.currentSeat)) {
      const seat = state.currentSeat;
      const ctrl = aiControllers.current.get(seat);
      if (ctrl) {
        act = () => {
          void ctrl.getDiscardAction(captured, seat as SeatIndex).then(action => {
            // Log before setState so it fires exactly once.
            const player = captured.players[seat];
            if (action.type === 'DISCARD') {
              const tile = player?.concealed.find(t => t.id === action.tileId);
              if (player && tile) logEvent(`${player.name} discarded the ${tileName(tile)}`);
            } else if (action.type === 'DECLARE_WIN') {
              if (player) logEvent(`${player.name} declared Mah Jong!`);
            } else if (action.type === 'DECLARE_ADDED_KONG') {
              const tile = player?.concealed.find(t => t.id === action.tileId);
              if (player && tile) logEvent(`${player.name} added a kong of ${tileName(tile)}s`);
            }
            setDrawnTileId(null);
            setState(s => {
              if (s !== captured) return s;
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
              // Log before setState so it fires exactly once.
              if (decision.type !== 'pass') {
                const pl = captured.players[pending];
                const tile = captured.discardPool[captured.discardPool.length - 1];
                if (pl && tile) {
                  const verb = decision.type === 'win'  ? 'won with'
                    : decision.type === 'pung' ? 'punged'
                    : decision.type === 'kong' ? 'konged' : 'chowed';
                  logEvent(`${pl.name} ${verb} the ${tileName(tile)}`);
                }
              }
              setState(s => {
                if (s !== captured) return s;
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
            void ctrl.getClaimDecision(captured, pending as SeatIndex)
              .then(decision => {
                setState(s => {
                  if (s !== captured) return s;
                  try {
                    return engineDispatch(s, { type: 'CLAIM_RESPONSE', seat: pending as SeatIndex, decision });
                  } catch (err) {
                    console.error('AI rob-kong error:', err);
                    return s;
                  }
                });
              })
              .catch(err => {
                console.error('AI rob-kong decision error:', err);
                // Fall back to passing so the game is never permanently frozen.
                setState(s => {
                  if (s !== captured) return s;
                  try {
                    return engineDispatch(s, { type: 'CLAIM_RESPONSE', seat: pending as SeatIndex, decision: { type: 'pass' } });
                  } catch (e) {
                    console.error('AI rob-kong fallback error:', e);
                    return s;
                  }
                });
              });
          };
        }
      }
    }

    if (!act) return;
    aiActedRef.current = state;
    if (stepMode) {
      // Hold the move; the Step button fires it.
      pendingActRef.current = act;
      setAiPending(true);
      return;
    }
    const handle = setTimeout(act, 500);
    // Reset the guard on cleanup so that if React cancels and re-runs this effect
    // for the same state (concurrent mode), the guard does not block rescheduling.
    return () => { clearTimeout(handle); aiActedRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, aiSeats, stepMode]);

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
    const sortedIds = sortedTileIds(player.concealed);
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
    // Non-winners: pass concealed tiles so pungs and scoring pairs are included.
    const playerBonuses: PlayerBonusInfo[] = state.players.map(p => ({
      name: p.name,
      seat: p.seat,
      bonus: scoreBonusTiles(p.bonusTiles),
      meldScore: p.seat !== hr.winnerSeat
        ? scoreExposedMelds(p.melds, p.bonusTiles, undefined, p.seatWind, p.concealed, state.prevailingWind)
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
      if (player && tile) logEvent(`${player.name} discarded the ${tileName(tile)}`);
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
      logEvent("That hand doesn't qualify for Mah Jong yet.");
      return;
    }

    logEvent(`${player.name} declared Mah Jong!`);
    setState(s => s ? engineDispatch(s, { type: 'DECLARE_WIN' }) : s);
  };

  const handleAddKong = (tileId: TileId) => {
    if (!state) return;
    const player = state.players[state.currentSeat];
    const tile = player?.concealed.find(t => t.id === tileId);
    if (player && tile) logEvent(`${player.name} added a kong of ${tileName(tile)}s`);
    setDrawnTileId(null);
    setState(s => s ? engineDispatch(s, { type: 'DECLARE_ADDED_KONG', tileId }) : s);
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
        logEvent(`${player.name} ${verb} the ${tileName(tile)}`);
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
    if (state.phase !== 'DISCARDING') { logEvent('Hint: wait until it is your turn to discard.'); return; }
    logEvent(buildHintText(state, state.currentSeat));
  };

  const stepAi = () => {
    const a = pendingActRef.current;
    if (!a) return;
    pendingActRef.current = null;
    setAiPending(false);
    a();
  };

  // Toggling step mode off releases any move that was waiting.
  const toggleStepMode = (on: boolean) => {
    setStepMode(on);
    if (!on && pendingActRef.current) {
      const a = pendingActRef.current;
      pendingActRef.current = null;
      setAiPending(false);
      a();
    }
  };

  // -- Derived view values -----
  // Human-controlled seats follow the current seat/identity assignment, not
  // a fixed index range -- which seats are AI stays with the AI *identity*
  // as it rotates hand to hand (issue 3 / Todo A fix, 2026-07-02).
  const humanSeats = new Set<number>();
  if (state) {
    for (let s2 = 0; s2 < state.config.playerCount; s2++) {
      if (aiSeats <= 0 || !identityIsAi(seatAssignmentRef.current[s2] ?? s2, state.config.playerCount, aiSeats)) {
        humanSeats.add(s2);
      }
    }
  }

  // Added kong options: only offered to the current seat when it is human.
  const isHumanDiscarding = !!state && state.phase === 'DISCARDING' && humanSeats.has(state.currentSeat);
  const localKongOptions = state && isHumanDiscarding ? getAddKongOptions(state) : [];

  return {
    appPhase,
    setAppPhase,
    gameConfig,
    state,
    handScore,
    runningTotals,
    aiSeats,
    wallStartOffset,
    drawnTileId,
    currentSeatOrder,
    stepMode,
    aiPending,
    humanSeats,
    localKongOptions,
    startGame,
    startNewHand,
    handleDiscard,
    handleDeclareWin,
    handleAddKong,
    handleClaimResponse,
    handleOrderChange,
    handleHint,
    stepAi,
    toggleStepMode,
  };
}
