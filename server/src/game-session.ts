/**
 * Module 3.3/3.4 -- Authoritative Game Session + Resilience
 *
 * filterStateForSeat  -- strips opponent concealed tiles before broadcasting;
 *                        at HAND_OVER also reveals the winner's hand.
 * computeEvents       -- derives the human-readable event lines for the sidebar
 *                        by diffing consecutive states. Runs server-side in
 *                        broadcastState, which sees every engine dispatch, so it
 *                        is immune to the client-side React batching that used
 *                        to drop the discard a player makes right after a claim.
 * FallbackController  -- bridges game_action socket events to PlayerController;
 *                        falls back to the AI ONLY on disconnect (Module 3.4);
 *                        supports mid-hand socket reattach for reconnecting
 *                        players. A connected human seat waits indefinitely --
 *                        there is no turn timeout (removed 2026-06-21 at Adam's
 *                        request: the game must never move on for a player who
 *                        is present but simply has not acted yet).
 *                        Exception: during ROBBING_KONG, if the player cannot
 *                        win on the robbed tile the server auto-passes them
 *                        immediately (the client ActionBar shows nothing, so
 *                        no CLAIM_RESPONSE socket event would ever arrive).
 * startGameSession    -- runs back-to-back hands until the creator leaves.
 *
 * Security note: the GAME_PASSWORD is checked in lobby.ts before any session
 * starts; this module never sees the password.
 */

import type { Server, Socket } from 'socket.io';
import {
  type GameState,
  type GameConfig,
  type SeatIndex,
  type DiscardAction,
  type ClaimDecision,
  type Tile,
  type TileId,
  type Action,
  type PlayerController,
  type ScoreResult,
  type WinContext,
  GameRunner,
  HeuristicController,
  buildWall,
  createGameState,
  dispatch,
  DEFAULT_CONFIG,
  isSuited,
  isWind,
  isDragon,
  isWinningHand,
  scoreWinningHand,
  scoreBonusTiles,
  scoreExposedMelds,
} from '@mahjong/engine';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  GameActionPayload,
  HandScorePayload,
} from './events.js';
import type { ServerState } from './server-state.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// (Turn-timeout constant removed 2026-06-21: a connected human seat waits
// indefinitely; the AI only takes over on a genuine disconnect.)

// ---------------------------------------------------------------------------
// Event derivation (authoritative -- runs on every engine dispatch)
// ---------------------------------------------------------------------------

/** Human-readable tile name, e.g. '3 of bamboo', 'east wind', 'red dragon'. */
function tileName(tile: Tile): string {
  if (isSuited(tile)) return `${tile.value} of ${tile.suit}`;
  if (isWind(tile))   return `${tile.wind} wind`;
  if (isDragon(tile)) return `${tile.dragon} dragon`;
  return 'bonus tile';
}

/**
 * Diffs the previous state against the next one and returns the event lines to
 * show in the sidebar. Called from broadcastState after every dispatch, so
 * `prev` is always the immediately preceding state -- no intermediate state is
 * ever skipped (unlike the old client-side diff, which lost events whenever
 * React batched several game_state messages into one render).
 *
 * Detected events:
 *   - a discard (pool grew by one);
 *   - a claimed meld pung/kong/chow (a player's meld count grew);
 *   - an added kong (an existing pung promoted to an open kong in place);
 *   - the end of the hand (a win or a wall-exhaustion draw).
 */
function computeEvents(prev: GameState | null, next: GameState): string[] {
  if (!prev) return [];
  const out: string[] = [];

  // New discard: the pool grew by exactly one tile. After a DISCARD the phase
  // is CLAIM_WINDOW with currentSeat = the discarder (claiming a tile shrinks
  // the pool instead, so this never misfires on a claim).
  if (next.discardPool.length === prev.discardPool.length + 1) {
    const tile = next.discardPool[next.discardPool.length - 1];
    const seat = next.phase === 'CLAIM_WINDOW' ? next.currentSeat : prev.currentSeat;
    const player = next.players[seat];
    if (player && tile) out.push(`${player.name} discarded the ${tileName(tile)}`);
  }

  // New claimed meld (pung / kong / chow): a player's meld count grew. The
  // claimed tile is appended last by the engine's resolve helpers, so name it
  // from the meld itself.
  next.players.forEach((player, i) => {
    const prevPlayer = prev.players[i];
    if (!prevPlayer || player.melds.length <= prevPlayer.melds.length) return;
    const newMeld = player.melds[player.melds.length - 1];
    if (!newMeld) return;
    const tile = newMeld.tiles[newMeld.tiles.length - 1];
    if (!tile) return;
    const verb =
      newMeld.type === 'open_kong' || newMeld.type === 'concealed_kong' ? 'konged'
      : newMeld.type === 'pung' ? 'punged'
      : 'chowed';
    out.push(`${player.name} ${verb} the ${tileName(tile)}`);
  });

  // Added kong: an existing pung was promoted to an open kong in place, so the
  // meld count stays the same and the loop above does not catch it.
  next.players.forEach((player, i) => {
    const prevPlayer = prev.players[i];
    if (!prevPlayer) return;
    player.melds.forEach((meld, mi) => {
      const prevMeld = prevPlayer.melds[mi];
      if (prevMeld?.type === 'pung' && meld.type === 'open_kong') {
        const tile = meld.tiles[meld.tiles.length - 1];
        if (tile) out.push(`${player.name} added a kong of ${tileName(tile)}s`);
      }
    });
  });

  // Hand over: a win or a wall-exhaustion draw.
  if (next.phase === 'HAND_OVER' && prev.phase !== 'HAND_OVER') {
    const hr = next.handResult;
    if (hr?.reason === 'draw') {
      out.push('Wall exhausted -- no winner this hand.');
    } else if (hr && hr.winnerSeat !== null) {
      const winner = next.players[hr.winnerSeat];
      if (winner) out.push(`${winner.name} declared Mah Jong!`);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Per-seat state filtering
// ---------------------------------------------------------------------------

/**
 * A face-down placeholder tile. The Board renders it face-down regardless of
 * tile identity, so the wind value is arbitrary -- only the count and the fake
 * unique ID matter.
 */
function placeholder(idx: number): Tile {
  return {
    category: 'wind',
    wind: 'east',
    id:   `__hid_${idx}` as unknown as TileId,
  };
}

/**
 * Returns a copy of `state` safe to send to the client at `revealSeat`.
 *
 *  - `revealSeat`'s own concealed tiles are sent in full.
 *  - At HAND_OVER, the winner's tiles are also sent in full so the client can
 *    compute the hand score and display the winning hand.
 *  - Every other seat's concealed tiles are replaced with placeholder tiles of
 *    the same count (Board renders them face-down).
 *  - The private discardLog is stripped entirely.
 */
function filterStateForSeat(state: GameState, revealSeat: number): GameState {
  const isHandOver = state.phase === 'HAND_OVER';
  const winnerSeat = state.handResult?.winnerSeat ?? -1;

  return {
    ...state,
    discardLog: [],
    players: state.players.map((p, i) => {
      if (i === revealSeat)              return p;   // own seat: full tiles
      if (isHandOver && i === winnerSeat) return p;  // winner at HAND_OVER: revealed
      return { ...p, concealed: p.concealed.map((_, idx) => placeholder(idx)) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Authoritative hand scoring (Finding 3 fix, 2026-07-02)
// ---------------------------------------------------------------------------

/**
 * Computes the HAND_OVER score for `state` -- which MUST be the raw, unfiltered
 * final state (i.e. before filterStateForSeat is applied to it) -- and folds it
 * into `runningTotals` (mutated in place, one entry per seat).
 *
 * This mirrors the logic that used to live in App.tsx's online HAND_OVER
 * effect, with one crucial difference: because the server always holds every
 * player's real concealed tiles, every player's contribution (not just the
 * winner's and the caller's own) is scored from real data here. Every client
 * receives this exact payload, so `runningTotals` can never diverge between
 * clients again -- see HandScorePayload's docstring in protocol.ts.
 */
function computeHandScore(state: GameState, runningTotals: number[]): HandScorePayload {
  const hr = state.handResult;

  if (!hr || hr.reason === 'draw') {
    return {
      winnerName: null,
      result: null,
      playerBonuses: [],
      winnerHand: null,
      runningTotals: [...runningTotals],
    };
  }

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

      try {
        result = scoreWinningHand({
          concealed,
          declaredMelds:  winner.melds,
          bonusTiles:     winner.bonusTiles,
          winningTile:    hr.winningTile,
          winContext,
          seatWind:       winner.seatWind,
          prevailingWind: state.prevailingWind,
          seat:           winner.seat,
          gameConfig:     state.config,
          wonByDiscard:   !hr.selfDraw,
          robbingKong:    hr.robbedKong ?? false,
        });
      } catch (err) {
        console.error('Server-side scoring error:', err);
      }
    }
  }

  const winnerPlayer = hr.winnerSeat !== null ? state.players[hr.winnerSeat] : null;
  const winnerHand: HandScorePayload['winnerHand'] = winnerPlayer
    ? {
        concealed: hr.selfDraw
          ? winnerPlayer.concealed
          : hr.winningTile
            ? [...winnerPlayer.concealed, hr.winningTile]
            : winnerPlayer.concealed,
        melds:         winnerPlayer.melds,
        bonusTiles:    winnerPlayer.bonusTiles,
        winningTileId: hr.winningTile?.id ?? null,
      }
    : null;

  // Every player's real concealed tiles are available here (unfiltered state),
  // so -- unlike the old client-side calculation -- every non-winner's
  // concealed pungs/pairs are scored the same way for everyone.
  const playerBonuses: HandScorePayload['playerBonuses'] = state.players.map(p => ({
    name:  p.name,
    seat:  p.seat,
    bonus: scoreBonusTiles(p.bonusTiles),
    meldScore: p.seat !== hr.winnerSeat
      ? scoreExposedMelds(p.melds, p.bonusTiles, undefined, p.seatWind, p.concealed)
      : null,
  }));

  state.players.forEach((p, i) => {
    const pb = playerBonuses[i];
    const isWinnerLimit = i === hr.winnerSeat && (result?.isLimitHand ?? false);
    const bonusPts = isWinnerLimit ? 0 : (pb?.bonus.points ?? 0);
    const handPts  = i === hr.winnerSeat && result ? result.total : 0;
    const meldPts  = i !== hr.winnerSeat ? (pb?.meldScore?.total ?? 0) : 0;
    runningTotals[i] = (runningTotals[i] ?? 0) + bonusPts + handPts + meldPts;
  });

  return {
    winnerName: hr.winnerSeat !== null ? (state.players[hr.winnerSeat]?.name ?? null) : null,
    result,
    playerBonuses,
    winnerHand,
    runningTotals: [...runningTotals],
  };
}

// ---------------------------------------------------------------------------
// Untrusted-action validation (the server trust boundary)
// ---------------------------------------------------------------------------

/**
 * Returns true if `action` is a legal move for `seat` given `state`.
 *
 * This is the server's trust boundary. In local pass-and-play the UI only ever
 * constructs legal actions, so the engine deliberately defers full win
 * validation for ordinary claims (Module 1.7) and trusts the caller. Online,
 * the payload arrives over a socket and must not be trusted: a malformed or
 * illegal action would otherwise be dispatched, either ending the hand
 * illegally (an unchecked win) or throwing inside GameRunner and tearing down
 * the whole session for everyone.
 *
 * Two layers:
 *  1. Explicit win validation. The engine's dispatch accepts DECLARE_WIN and a
 *     CLAIM_WINDOW 'win' without checking the hand actually wins, so we run
 *     isWinningHand (Module 1.7) here. (ROBBING_KONG wins are already checked
 *     inside dispatch, but re-checking is harmless.)
 *  2. Structural validation by dry-run dispatch. dispatch is a pure function --
 *     it returns a new state and never mutates its input -- so calling it here
 *     and discarding the result is a safe trial that mirrors exactly what
 *     GameRunner will do. If it throws, the action is illegal (wrong phase,
 *     wrong seat, tile not held, already responded, bad chow, and so on).
 */
export function isActionValid(state: GameState, seat: SeatIndex, action: Action): boolean {
  const player = state.players[seat];
  if (!player) return false;

  // Ownership: a client may only act for its own seat, and only for the action
  // types a human ever sends. The engine's turn actions run on currentSeat and
  // do not carry a sender, so we bind them to the sender here; BEGIN_TURN and
  // DRAW_REPLACEMENT are engine-internal and must never arrive from a socket.
  switch (action.type) {
    case 'DISCARD':
    case 'DECLARE_CONCEALED_KONG':
    case 'DECLARE_ADDED_KONG':
    case 'DECLARE_WIN':
      if (state.phase !== 'DISCARDING' || state.currentSeat !== seat) return false;
      break;
    case 'CLAIM_RESPONSE':
      if (action.seat !== seat) return false;
      break;
    default:
      return false;
  }

  // Layer 1: wins the engine does not otherwise validate.
  if (action.type === 'DECLARE_WIN') {
    if (!isWinningHand(player.concealed, player.melds, state.config)) return false;
  }
  if (action.type === 'CLAIM_RESPONSE' && action.decision.type === 'win') {
    let winTile: Tile | undefined;
    if (state.phase === 'CLAIM_WINDOW') {
      winTile = state.discardPool[state.discardPool.length - 1];
    } else if (state.phase === 'ROBBING_KONG') {
      winTile = state.robbingKong?.tile;
    }
    if (!winTile) return false;
    if (!isWinningHand([...player.concealed, winTile], player.melds, state.config)) return false;
  }

  // Layer 2: everything else -- let the engine be the judge, without side effects.
  try {
    dispatch(state, action);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// FallbackController -- human seat with AI fallback on disconnect (Module 3.4)
// ---------------------------------------------------------------------------

/**
 * Implements PlayerController for a human seat with two resilience features:
 *
 *  1. Disconnect fallback: if the socket drops mid-turn, the AI resolves the
 *     pending decision immediately so the hand can continue; subsequent turns
 *     also fall back to AI until the player reconnects.
 *  2. Reconnect: attachSocket() wires (or rewires) a socket. After reconnect,
 *     future decision points wait for the human again.
 *
 * There is NO turn timeout: while the socket is connected, a decision promise
 * stays unresolved until the human actually sends the action, so the game never
 * advances on behalf of a present-but-idle player (Adam's rule, 2026-06-21).
 *
 * Exception -- ROBBING_KONG auto-pass: when the player cannot win by robbing
 * the kong tile, the server resolves with 'pass' immediately without waiting
 * for a socket event.  The client's ActionBar returns null in this case (it
 * only shows when canRob is true), so no CLAIM_RESPONSE would ever arrive and
 * the game would deadlock otherwise.
 *
 * One instance per human seat; it persists for the full session (across hands).
 */
class FallbackController implements PlayerController {
  private readonly ai: HeuristicController;
  private socket: TypedSocket | null = null;

  private pendingDiscard: {
    resolve: (a: DiscardAction) => void;
    state: GameState; seat: SeatIndex;
  } | null = null;

  private pendingClaim: {
    resolve: (d: ClaimDecision) => void;
    state: GameState; seat: SeatIndex;
  } | null = null;

  constructor(
    private readonly seatIdx: SeatIndex,
    /**
     * Called when a socket sends an illegal action, so the offending client can
     * be re-synced with a fresh authoritative snapshot instead of the action
     * being dispatched (which would end the hand illegally or crash the session).
     */
    private readonly resync: (socket: TypedSocket, state: GameState, seat: SeatIndex) => void = () => {},
  ) {
    this.ai = new HeuristicController(seatIdx);
  }

  /**
   * Wire up (or rewire) a socket. Safe to call mid-hand on reconnect:
   * the old socket's listeners are removed and the new socket takes over.
   * Any in-flight promise from a previous disconnect will have already been
   * resolved via AI, so there is no pending work to transfer.
   */
  attachSocket(socket: TypedSocket): void {
    // Remove listeners from the previous socket if any.
    this.socket?.removeAllListeners('game_action');
    this.socket = socket;

    socket.on('game_action', (payload: GameActionPayload) => {
      if (
        payload.type === 'DISCARD' ||
        payload.type === 'DECLARE_WIN' ||
        payload.type === 'DECLARE_ADDED_KONG'
      ) {
        if (!this.pendingDiscard) return;
        const { resolve, state, seat } = this.pendingDiscard;
        const action = payload as DiscardAction;
        if (!isActionValid(state, seat, action)) {
          // Illegal payload: re-sync this client and keep waiting for a legal
          // move. Never dispatch it -- that would crash or corrupt the hand.
          this.resync(socket, state, seat);
          return;
        }
        this.pendingDiscard = null;
        resolve(action);
      } else if (payload.type === 'CLAIM_RESPONSE') {
        if (!this.pendingClaim) return;
        const { resolve, state, seat } = this.pendingClaim;
        const action: Action = { type: 'CLAIM_RESPONSE', seat, decision: payload.decision };
        if (!isActionValid(state, seat, action)) {
          this.resync(socket, state, seat);
          return;
        }
        this.pendingClaim = null;
        resolve(payload.decision);
      }
    });

    socket.once('disconnect', () => {
      // Guard: if attachSocket was called again before this fires, ignore.
      if (this.socket !== socket) return;
      this.socket = null;
      socket.removeAllListeners('game_action');
      this.resolveViaAI();
    });
  }

  /** Resolve any in-flight promise via the AI controller (used on disconnect). */
  private resolveViaAI(): void {
    if (this.pendingDiscard) {
      const { resolve, state, seat } = this.pendingDiscard;
      this.pendingDiscard = null;
      void this.ai.getDiscardAction(state, seat).then(resolve);
    }
    if (this.pendingClaim) {
      const { resolve, state, seat } = this.pendingClaim;
      this.pendingClaim = null;
      void this.ai.getClaimDecision(state, seat).then(resolve);
    }
  }

  getDiscardAction(state: GameState, seat: SeatIndex): Promise<DiscardAction> {
    // No socket connected: resolve immediately via AI.
    if (!this.socket) {
      return this.ai.getDiscardAction(state, seat);
    }
    // Connected: wait for the human indefinitely. The promise resolves only
    // when the player sends a discard action (or, if they disconnect first,
    // via resolveViaAI). There is no timeout.
    return new Promise(resolve => {
      this.pendingDiscard = { resolve, state, seat };
    });
  }

  getClaimDecision(state: GameState, seat: SeatIndex): Promise<ClaimDecision> {
    // During ROBBING_KONG, if the player cannot win on the robbed tile, pass
    // immediately -- there is nothing to decide, and the client's ActionBar
    // returns null (no buttons shown) when canRob is false.  Without this
    // shortcut the server would wait forever for a CLAIM_RESPONSE socket event
    // that the client will never send, freezing the game.
    // If they CAN win, fall through to wait for the human's click.
    if (state.phase === 'ROBBING_KONG' && state.robbingKong) {
      const player = state.players[seat];
      const tile   = state.robbingKong.tile;
      if (
        player && tile &&
        !isWinningHand([...player.concealed, tile], player.melds, state.config)
      ) {
        return Promise.resolve({ type: 'pass' });
      }
    }

    // No socket connected: resolve immediately via AI.
    if (!this.socket) {
      return this.ai.getClaimDecision(state, seat);
    }
    // Connected: wait for the human indefinitely.
    return new Promise(resolve => {
      this.pendingClaim = { resolve, state, seat };
    });
  }

  /** Remove all listeners and drop any pending decisions. Call at session end. */
  cleanup(): void {
    this.socket?.removeAllListeners('game_action');
    this.pendingDiscard = null;
    this.pendingClaim   = null;
    this.socket         = null;
  }
}

// ---------------------------------------------------------------------------
// Game session
// ---------------------------------------------------------------------------

/**
 * Runs back-to-back hands for the current session.
 *
 * Resolves when the creator disconnects (between hands) or the server state
 * leaves 'in-progress'.
 */
export async function startGameSession(
  io: TypedServer,
  serverState: ServerState,
): Promise<void> {
  const { seats } = serverState;

  // Hand-config options for this whole session, taken from what the creator
  // submitted in creator_config (Module 3.2 fix, 2026-07-02). Previously this
  // was a module-level constant hardcoded to `{ ...DEFAULT_CONFIG, deadWall:
  // false }`, so the online lobby had no way to turn on the dead wall,
  // knitting/crocheting, or hard-mode discards -- the creator_config screen
  // never asked, and even if it had, the server ignored the answer. See
  // Decisions Log 2026-07-02.
  const handConfig: GameConfig = {
    ...DEFAULT_CONFIG,
    deadWall:        serverState.deadWall,
    knittingEnabled: serverState.knittingEnabled,
    discardsVisible: serverState.discardsVisible,
  };

  // Build one FallbackController per human seat, AI for the rest.
  const fallbackControllers = new Map<number, FallbackController>();
  const humanSockets        = new Map<number, TypedSocket>();
  const controllers: PlayerController[] = [];

  // Re-sync a client that sent an illegal action with a fresh snapshot, so it
  // corrects its local state instead of the bad action being dispatched.
  const resync = (socket: TypedSocket, state: GameState, seat: SeatIndex): void => {
    socket.emit('game_state', filterStateForSeat(state, seat));
  };

  for (let seat = 0; seat < 4; seat++) {
    const humanSeat = seats.find(s => s.seat === seat);
    if (humanSeat) {
      const raw = io.sockets.sockets.get(humanSeat.socketId);
      if (raw) {
        const socket  = raw as unknown as TypedSocket;
        const ctrl    = new FallbackController(seat as SeatIndex, resync);
        ctrl.attachSocket(socket);
        fallbackControllers.set(seat, ctrl);
        humanSockets.set(seat, socket);
        controllers.push(ctrl);
        continue;
      }
    }
    // Seat has no connected human -- use a pure AI controller.
    controllers.push(new HeuristicController(seat as SeatIndex));
  }

  const names = Array.from({ length: 4 }, (_, i) =>
    seats.find(s => s.seat === i)?.name ??
    `AI ${(['East', 'South', 'West', 'North'] as const)[i]!}`,
  );

  // Authoritative running totals, one per seat, accumulated across every hand
  // of this session (Finding 3 fix). Clients no longer maintain their own copy.
  const runningTotals: number[] = [0, 0, 0, 0];

  // Track the most recent state so reconnectors receive it immediately.
  let lastKnownState: GameState | null = null;
  // Track the most recent hand-score payload so a reconnector who dropped
  // between HAND_OVER and the next deal still sees the score panel.
  let lastScorePayload: HandScorePayload | null = null;
  // Previous state for authoritative event detection. Reset to null at the
  // start of each hand so event lines never bleed across the deal boundary.
  let prevEventState: GameState | null = null;

  /** Send a one-line event description to every connected human socket. */
  function emitEvent(message: string): void {
    for (const socket of humanSockets.values()) {
      socket.emit('game_event', message);
    }
  }

  /** Emit a filtered snapshot to every connected human socket. */
  function broadcastState(state: GameState): void {
    lastKnownState = state;
    // Derive and send event lines BEFORE the state snapshot. This runs after
    // every single engine dispatch, so prevEventState is always the immediately
    // preceding state and no move is ever missed.
    for (const message of computeEvents(prevEventState, state)) emitEvent(message);
    prevEventState = state;
    for (const [seat, socket] of humanSockets) {
      socket.emit('game_state', filterStateForSeat(state, seat));
    }
  }

  // Register the reconnect handler so lobby.ts can call it when a socket
  // sends reconnect_attempt during in-progress.
  serverState.reconnectHandler = (socketId: string, seatIdx: number, nameAttempt: string): boolean => {
    const ctrl     = fallbackControllers.get(seatIdx);
    const expected = seats.find(s => s.seat === seatIdx);
    if (!ctrl || !expected || expected.name !== nameAttempt) return false;

    const raw = io.sockets.sockets.get(socketId);
    if (!raw) return false;
    const socket = raw as unknown as TypedSocket;

    // Update socket map so future broadcasts reach the reconnected client.
    humanSockets.set(seatIdx, socket);
    ctrl.attachSocket(socket);

    // If this is the creator, update the tracked socket ID so the between-hand
    // new_hand listener finds the right socket.
    if (seatIdx === 0) {
      serverState.creatorSocketId = socketId;
    }

    // Re-send game_start so the client leaves the lobby view, then send state.
    socket.emit('game_start', { seat: seatIdx });
    if (lastKnownState) {
      socket.emit('game_state', filterStateForSeat(lastKnownState, seatIdx));
      // If they dropped between HAND_OVER and the next deal, the score panel
      // needs the last hand's payload too -- it is not re-derivable from
      // filterStateForSeat alone now that scoring lives only on the server.
      if (lastKnownState.phase === 'HAND_OVER' && lastScorePayload) {
        socket.emit('hand_score', lastScorePayload);
      }
    }
    return true;
  };

  try {
    // Run hands in a loop until the session ends.
    while (serverState.phase === 'in-progress') {
      const deal         = buildWall(4, handConfig.deadWall ?? false);
      const initialState = createGameState(handConfig, deal, names);

      // Fresh hand: do not carry event diffing across the deal boundary.
      prevEventState = null;
      broadcastState(initialState);

      const runner     = new GameRunner(initialState, controllers, broadcastState);
      const finalState = await runner.run();

      // Broadcast the HAND_OVER state (winner's tiles revealed for display).
      broadcastState(finalState);

      // Score the hand server-side from the raw, unfiltered finalState (every
      // player's real concealed tiles), and send the identical payload to
      // every connected client -- this is the Finding 3 fix. `runningTotals`
      // is mutated in place, so it stays correct across the whole session.
      const scorePayload = computeHandScore(finalState, runningTotals);
      lastScorePayload = scorePayload;
      for (const socket of humanSockets.values()) {
        socket.emit('hand_score', scorePayload);
      }

      // Wait for the creator to request another hand (or disconnect).
      // Re-read from humanSockets so we pick up a reconnected creator socket.
      const creatorSocket = humanSockets.get(0);
      // If the creator has no socket, or their socket already disconnected
      // mid-hand (in which case its 'disconnect' event has already fired and
      // will never fire again), end the session now. Waiting on a dead socket
      // would hang the loop between hands forever.
      if (!creatorSocket || !creatorSocket.connected) break;

      const shouldContinue = await new Promise<boolean>(resolve => {
        const cleanup = () => {
          creatorSocket.off('new_hand',   onNewHand);
          creatorSocket.off('disconnect', onDisconnect);
        };
        const onNewHand    = () => { cleanup(); resolve(true);  };
        const onDisconnect = () => { cleanup(); resolve(false); };
        creatorSocket.once('new_hand',   onNewHand);
        creatorSocket.once('disconnect', onDisconnect);
      });

      if (!shouldContinue) break;
    }
  } finally {
    // Always clear the reconnect handler and all per-seat listeners.
    serverState.reconnectHandler = null;
    for (const ctrl of fallbackControllers.values()) ctrl.cleanup();
  }
}
