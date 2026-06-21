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
 *
 * Event log fix (2026-06-19):
 *  - logEvent calls moved out of setState functional updaters (StrictMode
 *    double-invokes updaters, causing each AI event to appear twice).
 *  - Rolling event list expanded from 3 to 6 entries.
 *
 * Scoring fixes (2026-06-19):
 *  - Score labels now use human-readable tile names ('circles', 'south wind').
 *  - Non-winners' concealed pungs and scoring pairs now scored at HAND_OVER
 *    (scoreExposedMelds extended with optional concealedTiles param).
 *
 * Online mode (Module 3.2, 2026-06-21):
 *  - VITE_ONLINE=true switches the app into online mode.
 *  - Shows OnlineLobby until game_start; then a placeholder pending Module 3.3.
 *
 * Online game rendering (Module 3.3, 2026-06-21):
 *  - game_state events from the server drive the online Board.
 *  - Opponent tiles are placeholders (hidden server-side); localSeat + revealAll=false
 *    ensure the Board renders them face-down.
 *  - HAND_OVER scoring: winner tiles are revealed; non-winner concealed tiles are
 *    either real (local player) or undefined (placeholders avoided in scoring).
 *  - Creator emits new_hand; non-creators' panels clear when the new state arrives.
 *
 * Online resilience (Module 3.4, 2026-06-21):
 *  - onlineConnected tracks socket state; red banner shown when reconnecting.
 *  - On socket reconnect, App.tsx emits reconnect_attempt with stored creds.
 *  - game_state receipt confirms the reconnect; banner clears.
 *
 * Online Hint + event sidebar (2026-06-21):
 *  - Hint button added to the online toolbar; handleOnlineHint mirrors handleHint.
 *  - lastEvents={events} passed to the online Board.
 *  - prevOnlineStateRef + useEffect diffs each game_state to detect discards,
 *    pung/kong/chow claims, wins, and draws, then calls logEvent so they appear
 *    in the sidebar (previously the array was always empty in online mode).
 *
 * Added kong (2026-06-21):
 *  - Human player: "Add Kong" button shown during DISCARDING when a concealed tile
 *    matches an existing exposed pung. Dispatches DECLARE_ADDED_KONG; optional
 *    (player may prefer to keep the tile for a chow or discard it instead).
 *  - AI: HeuristicController.getDiscardAction now declares DECLARE_ADDED_KONG
 *    whenever the condition is met (Module 4.4 refinement).
 *  - Online mode: handleOnlineAddKong emits the action to the server.
 *  - Online event detection: added-kong events detected by diffing pung→open_kong
 *    meld transitions and logged to the sidebar.
 *  - Fixed a bug in the online meld detection that used newMeld.kind (which does
 *    not exist on DeclaredMeld) instead of newMeld.type.
 */

import { useEffect, useRef, useState } from 'react';
import { Board } from './components/Board';
import { ScorePanel } from './components/ScorePanel';
import type { PlayerBonusInfo, WinnerHandInfo } from './components/ScorePanel';
import { GameSetup } from './components/GameSetup';
import { OnlineLobby, type OnlineSocket } from './components/OnlineLobby';
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
  tileKey,
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

// Whether the app is running in online multiplayer mode.
// Set VITE_ONLINE=true in the Dockerfile builder stage (or a local .env).
const ONLINE_MODE = import.meta.env.VITE_ONLINE === 'true';

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

/** True when a tile's ID is a server-side placeholder (hidden opponent tile). */
function isPlaceholder(id: string): boolean {
  return id.startsWith('__hid_');
}

/**
 * Returns options for declaring an added kong during DISCARDING: tiles in the
 * current player's concealed hand that match an existing exposed pung.
 * Each option carries the tileId to dispatch and a display label.
 */
function getAddKongOptions(state: GameState): { tileId: TileId; label: string }[] {
  const player = state.players[state.currentSeat];
  if (!player) return [];
  return player.melds
    .filter(m => m.type === 'pung')
    .flatMap(m => {
      const pungTile = m.tiles[0];
      if (!pungTile) return [];
      const key = tileKey(pungTile);
      const match = player.concealed.find(t => tileKey(t) === key);
      return match ? [{ tileId: match.id, label: `Add Kong: ${tileName(pungTile)}` }] : [];
    });
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

const SEAT_NAMES = ['East', 'South', 'West', 'North'] as const;

// --- App -----

export function App() {
  // 'setup' = show the setup screen; 'playing' = game in progress.
  const [appPhase, setAppPhase] = useState<'setup' | 'playing'>('setup');
  const [gameConfig, setGameConfig] = useState<GameConfig>({ ...DEFAULT_CONFIG });
  const [revealAll, setRevealAll] = useState(true);
  const [state, setState] = useState<GameState | null>(null);
  const [handScore, setHandScore] = useState<HandScoreInfo | null>(null);
  const [runningTotals, setRunningTotals] = useState<number[]>([0, 0, 0, 0]);

  // Online multiplayer: populated by OnlineLobby when game_start fires.
  const [onlineGameInfo, setOnlineGameInfo] = useState<{
    seat: number;
    socket: OnlineSocket;
  } | null>(null);

  // Online game state received from the server (filtered per seat).
  const [onlineState, setOnlineState] = useState<GameState | null>(null);
  const [onlineHandScore, setOnlineHandScore] = useState<HandScoreInfo | null>(null);
  const [onlineRunningTotals, setOnlineRunningTotals] = useState<number[]>([0, 0, 0, 0]);
  const [onlineCurrentOrder, setOnlineCurrentOrder] = useState<string[] | undefined>(undefined);
  const onlineHandOrderRef  = useRef<string[] | undefined>(undefined);
  // Guard: only score each HAND_OVER state once (React StrictMode double-invokes effects).
  const onlineScoredStateRef = useRef<GameState | null>(null);
  // Tracks the previous online state for client-side event detection.
  const prevOnlineStateRef = useRef<GameState | null>(null);
  // True while the socket is connected mid-game; false while reconnecting (Module 3.4).
  const [onlineConnected, setOnlineConnected] = useState(true);

  // Number of AI opponents (the last N seats); the human is always seat 0.
  const [aiSeats, setAiSeats] = useState(0);
  // One HeuristicController per AI seat, rebuilt each hand so strategy state resets.
  const aiControllers = useRef<Map<number, HeuristicController>>(new Map());
  // Guard so the AI acts on each distinct state at most once.
  const aiActedRef = useRef<GameState | null>(null);
  // Step-through mode (test aid): when on, each AI move waits for the Step button.
  const [stepMode, setStepMode] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const pendingActRef = useRef<(() => void) | null>(null);

  // Tile just drawn from the wall -- shown with a gold border.
  const [drawnTileId, setDrawnTileId] = useState<TileId | null>(null);

  // The last few notable game events (most recent last), shown in the sidebar
  // so the human can follow several AI seats between their own turns.
  // Capped at 6; logEvent must be called OUTSIDE setState updaters because
  // React StrictMode double-invokes updaters, which would duplicate entries.
  const [events, setEvents] = useState<string[]>([]);
  const logEvent = (msg: string) => setEvents(prev => [...prev, msg].slice(-6));

  // Per-seat hand display orders: auto-sorted each time a new seat becomes active.
  const handOrdersRef = useRef<Map<number, string[]>>(new Map());
  // The saved order for whoever is currently the interactive (bottom) seat.
  const [currentSeatOrder, setCurrentSeatOrder] = useState<string[] | undefined>(undefined);

  // Guard against scoring the same HAND_OVER state twice (React StrictMode).
  const scoredStateRef = useRef<GameState | null>(null);

  // Track phase transitions to detect when a tile is newly drawn.
  const prevPhaseRef = useRef<string | null>(null);
  const prevSeatRef = useRef<number | null>(null);

  // -- Online: listen for game_state, disconnect and reconnect events -----

  useEffect(() => {
    if (!onlineGameInfo) return;
    const { socket } = onlineGameInfo;

    socket.on('game_state', (newState: GameState) => {
      setOnlineConnected(true); // receiving state confirms the connection is live
      setOnlineState(newState);
      // Clear the score panel as soon as the new hand starts.
      if (newState.phase !== 'HAND_OVER') {
        setOnlineHandScore(null);
      }
    });

    // When the socket drops, show the reconnecting banner.
    socket.on('disconnect', () => setOnlineConnected(false));

    // When socket.io auto-reconnects, re-send stored credentials so the server
    // can re-attach the socket to the ongoing hand (Module 3.4).
    socket.on('connect', () => {
      const storedSeat = sessionStorage.getItem('mj_seat');
      const storedName = sessionStorage.getItem('mj_name');
      if (storedSeat !== null && storedName !== null) {
        socket.emit('reconnect_attempt', {
          seat: parseInt(storedSeat, 10),
          name: storedName,
        });
      }
    });

    return () => {
      socket.off('game_state');
      socket.off('disconnect');
      socket.off('connect');
    };
  }, [onlineGameInfo]);

  // -- Online: auto-sort tiles when the local seat becomes active -----

  useEffect(() => {
    if (!onlineState || !onlineGameInfo) return;
    if (onlineState.phase !== 'DISCARDING') return;
    if (onlineState.currentSeat !== onlineGameInfo.seat) return;
    const player = onlineState.players[onlineGameInfo.seat];
    if (!player) return;
    const sortedIds = [...player.concealed]
      .sort((a, b) => compareTileKeys(sortTileKey(a), sortTileKey(b)))
      .map(t => t.id);
    onlineHandOrderRef.current = sortedIds;
    setOnlineCurrentOrder(sortedIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineState?.currentSeat, onlineState?.phase]);

  // -- Online: detect game events for the event sidebar -----
  // Diffs each incoming game_state against the previous one to infer what just
  // happened (discard, claim, added kong, win/draw) and logs it for the sidebar.
  // Discard pool tiles and meld tiles are always real (never placeholders), so
  // tileName() is safe to call on them.

  useEffect(() => {
    if (!onlineState) return;
    const prev = prevOnlineStateRef.current;
    prevOnlineStateRef.current = onlineState;
    if (!prev) return;

    // Detect a new discard: pool grew by one tile.
    if (onlineState.discardPool.length > prev.discardPool.length) {
      const newTile = onlineState.discardPool[onlineState.discardPool.length - 1];
      const discarder = onlineState.players[prev.currentSeat];
      if (discarder && newTile) {
        logEvent(`${discarder.name} discarded the ${tileName(newTile)}`);
      }
    }

    // Detect a new meld via discard claim (pung, kong, chow): meld count grew.
    onlineState.players.forEach((player, i) => {
      const prevPlayer = prev.players[i];
      if (!prevPlayer || player.melds.length <= prevPlayer.melds.length) return;
      const newMeld = player.melds[player.melds.length - 1];
      if (!newMeld) return;
      const claimedTile = prev.discardPool[prev.discardPool.length - 1];
      const verb = (newMeld.type === 'open_kong' || newMeld.type === 'concealed_kong')
        ? 'konged'
        : newMeld.type === 'pung' ? 'punged'
        : 'chowed';
      if (claimedTile) {
        logEvent(`${player.name} ${verb} the ${tileName(claimedTile)}`);
      }
    });

    // Detect an added kong: a pung meld promoted to open_kong (meld count stays the same).
    onlineState.players.forEach((player, i) => {
      const prevPlayer = prev.players[i];
      if (!prevPlayer) return;
      player.melds.forEach((meld, mi) => {
        const prevMeld = prevPlayer.melds[mi];
        if (prevMeld?.type === 'pung' && meld.type === 'open_kong') {
          const addedTile = meld.tiles[meld.tiles.length - 1];
          if (addedTile) logEvent(`${player.name} added a kong of ${tileName(addedTile)}s`);
        }
      });
    });

    // Detect HAND_OVER transition.
    if (onlineState.phase === 'HAND_OVER' && prev.phase !== 'HAND_OVER') {
      const hr = onlineState.handResult;
      if (hr?.reason === 'draw') {
        logEvent('Wall exhausted — no winner this hand.');
      } else if (hr && hr.winnerSeat !== null) {
        const winner = onlineState.players[hr.winnerSeat];
        if (winner) logEvent(`${winner.name} declared Mah Jong!`);
      }
    }
  }, [onlineState]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Online: score HAND_OVER -----

  useEffect(() => {
    if (!onlineState || !onlineGameInfo) return;
    if (onlineState.phase !== 'HAND_OVER') return;
    if (onlineScoredStateRef.current === onlineState) return;
    onlineScoredStateRef.current = onlineState;

    const hr = onlineState.handResult;
    if (!hr) return;

    if (hr.reason === 'draw') {
      setOnlineHandScore({ winnerName: null, result: null, playerBonuses: [], winnerHand: null });
      return;
    }

    let result: ScoreResult | null = null;

    if (hr.winnerSeat !== null && hr.winningTile) {
      const winner = onlineState.players[hr.winnerSeat];
      if (winner) {
        // Winner's tiles are revealed by the server at HAND_OVER.
        const concealed = hr.selfDraw
          ? winner.concealed
          : [...winner.concealed, hr.winningTile];

        const winContext: WinContext = {
          source: hr.winSource ?? 'self-draw-wall',
          isLastWallTile: hr.isLastWallTile ?? false,
        };

        try {
          result = scoreWinningHand({
            concealed,
            declaredMelds:  winner.melds,
            bonusTiles:     winner.bonusTiles,
            winningTile:    hr.winningTile,
            winContext,
            seatWind:       winner.seatWind,
            prevailingWind: onlineState.prevailingWind,
            seat:           winner.seat,
            gameConfig:     onlineState.config,
            wonByDiscard:   !hr.selfDraw,
            robbingKong:    hr.robbedKong ?? false,
          });
        } catch (err) {
          console.error('Online scoring error:', err);
        }
      }
    }

    const winnerPlayer = hr.winnerSeat !== null ? onlineState.players[hr.winnerSeat] : null;
    const winnerHand: WinnerHandInfo | null = winnerPlayer
      ? {
          concealed: hr.selfDraw
            ? winnerPlayer.concealed
            : hr.winningTile
              ? [...winnerPlayer.concealed, hr.winningTile]
              : winnerPlayer.concealed,
          melds:        winnerPlayer.melds,
          bonusTiles:   winnerPlayer.bonusTiles,
          winningTileId: hr.winningTile?.id ?? null,
        }
      : null;

    // For non-winner concealed scoring: only pass actual tiles (not placeholders).
    // A placeholder tile starts with '__hid_'; passing those to scoreExposedMelds
    // would incorrectly score them as east wind pungs.
    const localSeatN = onlineGameInfo.seat;
    const playerBonuses: PlayerBonusInfo[] = onlineState.players.map(p => {
      const concealedForScoring =
        p.seat !== hr.winnerSeat && p.seat !== localSeatN
          ? undefined                                      // other opponents: placeholder tiles
          : p.concealed.some(t => isPlaceholder(t.id))
            ? undefined                                    // local seat somehow has placeholders
            : p.concealed;                                 // real tiles
      return {
        name: p.name,
        seat: p.seat,
        bonus: scoreBonusTiles(p.bonusTiles),
        meldScore: p.seat !== hr.winnerSeat
          ? scoreExposedMelds(p.melds, p.bonusTiles, undefined, p.seatWind, concealedForScoring)
          : null,
      };
    });

    setOnlineRunningTotals(prev =>
      prev.map((t, i) => {
        const player = onlineState.players[i];
        if (!player) return t;
        const pb = playerBonuses[i];
        const isWinnerLimit = i === hr.winnerSeat && result?.isLimitHand;
        const bonusPts = isWinnerLimit ? 0 : (pb?.bonus.points ?? 0);
        const handPts  = i === hr.winnerSeat && result ? result.total : 0;
        const meldPts  = i !== hr.winnerSeat ? (pb?.meldScore?.total ?? 0) : 0;
        return t + bonusPts + handPts + meldPts;
      }),
    );

    setOnlineHandScore({
      winnerName: hr.winnerSeat !== null ? (onlineState.players[hr.winnerSeat]?.name ?? null) : null,
      result,
      playerBonuses,
      winnerHand,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineState]);

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
    setEvents([]);
    setState(makeInitialState(config));
    setAppPhase('playing');
  };

  const startNewHand = () => {
    buildAiControllers(gameConfig.playerCount, aiSeats);
    handOrdersRef.current.clear();
    setCurrentSeatOrder(undefined);
    setHandScore(null);
    setDrawnTileId(null);
    setEvents([]);
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
  //
  // IMPORTANT: logEvent must be called BEFORE setState, not inside the updater.
  // React StrictMode double-invokes functional updaters, so any logEvent call
  // inside setState would fire twice and duplicate the event entry.

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
    if (stepMode) {
      // Hold the move; the Step button fires it.
      pendingActRef.current = act;
      setAiPending(true);
      return;
    }
    const handle = setTimeout(act, 500);
    return () => clearTimeout(handle);
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
    // Non-winners: pass concealed tiles so pungs and scoring pairs are included.
    const playerBonuses: PlayerBonusInfo[] = state.players.map(p => ({
      name: p.name,
      seat: p.seat,
      bonus: scoreBonusTiles(p.bonusTiles),
      meldScore: p.seat !== hr.winnerSeat
        ? scoreExposedMelds(p.melds, p.bonusTiles, undefined, p.seatWind, p.concealed)
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
    const seat = state.currentSeat;
    const advice = adviseSeat(state, seat);
    if (advice.winNow) { logEvent('Hint: this hand is a winning hand -- declare Mah Jong!'); return; }
    const planText = advice.plan.mode === 'dirty'
      ? 'go for a dirty hand (build melds in any suit, fast)'
      : `collect ${advice.plan.targetSuit}`;
    let discardText = '';
    if (advice.discard) {
      const player = state.players[seat];
      const tile = player?.concealed.find(t => t.id === advice.discard);
      if (tile) discardText = `; the AI would discard the ${tileName(tile)}`;
    }
    logEvent(`Hint: ${planText}${discardText}.`);
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

  // -- Render -----

  // Online mode: show the lobby until game_start, then drive the Board from
  // game_state events.
  if (ONLINE_MODE) {
    if (!onlineGameInfo) {
      return (
        <div className={styles.app}>
          <OnlineLobby
            onGameStart={(seat, socket) => setOnlineGameInfo({ seat, socket })}
          />
        </div>
      );
    }

    const { seat: localSeat, socket } = onlineGameInfo;

    // --- Online action handlers ---
    const handleOnlineDiscard = (tileId: TileId) => {
      socket.emit('game_action', { type: 'DISCARD', tileId });
    };

    const handleOnlineDeclareWin = () => {
      socket.emit('game_action', { type: 'DECLARE_WIN' });
    };

    const handleOnlineAddKong = (tileId: TileId) => {
      socket.emit('game_action', { type: 'DECLARE_ADDED_KONG', tileId });
    };

    const handleOnlineClaimResponse = (_claimSeat: SeatIndex, decision: ClaimDecision) => {
      // The server knows which seat we are from the socket identity.
      socket.emit('game_action', { type: 'CLAIM_RESPONSE', decision });
    };

    const handleOnlineOrderChange = (ids: string[]) => {
      onlineHandOrderRef.current = ids;
    };

    const handleOnlineHint = () => {
      if (!onlineState) return;
      if (onlineState.phase !== 'DISCARDING' || onlineState.currentSeat !== localSeat) {
        logEvent('Hint: wait until it is your turn to discard.');
        return;
      }
      const advice = adviseSeat(onlineState, localSeat as SeatIndex);
      if (advice.winNow) { logEvent('Hint: this hand is a winning hand -- declare Mah Jong!'); return; }
      const planText = advice.plan.mode === 'dirty'
        ? 'go for a dirty hand (build melds in any suit, fast)'
        : `collect ${advice.plan.targetSuit}`;
      let discardText = '';
      if (advice.discard) {
        const player = onlineState.players[localSeat];
        const tile = player?.concealed.find(t => t.id === advice.discard);
        if (tile) discardText = `; the AI would discard the ${tileName(tile)}`;
      }
      logEvent(`Hint: ${planText}${discardText}.`);
    };

    const handleOnlineNewHand = () => {
      // Clear local panel; server will broadcast the next dealt state.
      setOnlineHandScore(null);
      setOnlineCurrentOrder(undefined);
      onlineHandOrderRef.current = undefined;
      socket.emit('new_hand');
    };

    // Waiting for the first game_state from the server.
    if (!onlineState) {
      return (
        <div className={styles.app}>
          <div className={styles.toolbar}><span className={styles.title}>Mah Jong</span></div>
          <div className={styles.onlinePlaceholder}>
            <p>Connected as {SEAT_NAMES[localSeat] ?? `seat ${localSeat + 1}`}.</p>
            <p className={styles.onlineHint}>Waiting for the server to deal the tiles...</p>
          </div>
        </div>
      );
    }

    // The drawn-tile gold border: only shown for the local player's own turn.
    const onlineDrawnTileId =
      onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
        ? (onlineState.lastDrawnTileId ?? null)
        : null;

    // Added kong options: only offered when it's the local player's turn to discard.
    const onlineKongOptions =
      onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
        ? getAddKongOptions(onlineState)
        : [];

    // Creator is always East (seat 0); only they can trigger a new hand.
    const isCreator = localSeat === 0;

    return (
      <div className={styles.app}>
        {/* Reconnecting banner (Module 3.4) -- fixed overlay, clears when state arrives */}
        {!onlineConnected && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            background: '#b00', color: '#fff',
            textAlign: 'center', padding: '6px 0',
            fontSize: '13px', zIndex: 1000,
          }}>
            Connection lost — reconnecting...
          </div>
        )}

        <div className={styles.toolbar}>
          <span className={styles.title}>Mah Jong</span>
          <div className={styles.controls}>
            <button type="button" className={styles.newHandBtn} onClick={handleOnlineHint}>
              Hint
            </button>
            <span>{SEAT_NAMES[localSeat]} seat</span>
          </div>
        </div>

        <div className={styles.tableArea}>
          <Board
            state={onlineState}
            localSeat={localSeat as SeatIndex}
            revealAll={false}
            onDiscard={
              onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
                ? handleOnlineDiscard : undefined
            }
            onDeclareWin={
              onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
                ? handleOnlineDeclareWin : undefined
            }
            onAddKong={onlineKongOptions.length > 0 ? handleOnlineAddKong : undefined}
            addKongOptions={onlineKongOptions.length > 0 ? onlineKongOptions : undefined}
            onClaimResponse={handleOnlineClaimResponse}
            humanSeats={new Set([localSeat])}
            drawnTileId={onlineDrawnTileId}
            savedOrder={onlineCurrentOrder}
            onOrderChange={handleOnlineOrderChange}
            scores={onlineRunningTotals}
            inference={inferTable(onlineState)}
            lastEvents={events}
          />
        </div>

        {onlineState.phase === 'HAND_OVER' && onlineHandScore && (
          <ScorePanel
            winnerName={onlineHandScore.winnerName}
            result={onlineHandScore.result}
            playerBonuses={onlineHandScore.playerBonuses}
            winnerHand={onlineHandScore.winnerHand}
            runningTotals={onlineState.players.map((p, i) => ({
              name:  p.name,
              total: onlineRunningTotals[i] ?? 0,
            }))}
            onNewHand={isCreator ? handleOnlineNewHand : () => {}}
          />
        )}
      </div>
    );
  }

  // Local mode: setup screen.
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

  // Added kong options: only offered to the current seat when it is human.
  const isHumanDiscarding =
    state.phase === 'DISCARDING' && (aiSeats <= 0 || state.currentSeat < aiStart);
  const localKongOptions = isHumanDiscarding ? getAddKongOptions(state) : [];

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
          <label>
            <input
              type="checkbox"
              checked={stepMode}
              onChange={e => toggleStepMode(e.target.checked)}
            />
            Step through AI
          </label>
          {stepMode && (
            <button type="button" className={styles.newHandBtn} disabled={!aiPending} onClick={stepAi}>
              {aiPending ? 'Step ▶' : 'Step'}
            </button>
          )}
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
          onAddKong={localKongOptions.length > 0 ? handleAddKong : undefined}
          addKongOptions={localKongOptions.length > 0 ? localKongOptions : undefined}
          onClaimResponse={handleClaimResponse}
          humanSeats={humanSeats}
          drawnTileId={drawnTileId}
          savedOrder={currentSeatOrder}
          onOrderChange={handleOrderChange}
          lastEvents={events}
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
