/**
 * Module 3.3 -- Authoritative Game Session
 *
 * Wires the engine's GameRunner to Socket.io:
 *
 *   filterStateForSeat  -- strips opponent concealed tiles before broadcasting;
 *                          at HAND_OVER also reveals the winner's hand.
 *   HumanSocketController -- bridges `game_action` socket events to the
 *                            PlayerController interface the GameRunner expects.
 *   startGameSession    -- runs back-to-back hands until the creator leaves.
 *
 * Security note: the GAME_PASSWORD is checked in lobby.ts before any session
 * starts; this module never sees the password.
 */

import type { Server, Socket } from 'socket.io';
import {
  type GameState,
  type SeatIndex,
  type DiscardAction,
  type ClaimDecision,
  type Tile,
  type TileId,
  type PlayerController,
  GameRunner,
  HeuristicController,
  buildWall,
  createGameState,
  DEFAULT_CONFIG,
} from '@mahjong/engine';
import type { ServerToClientEvents, ClientToServerEvents, GameActionPayload } from './events.js';
import type { ServerState } from './server-state.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Per-seat state filtering
// ---------------------------------------------------------------------------

/**
 * A face-down placeholder tile. The Board renders it face-down regardless of
 * tile identity, so the kind/wind values are arbitrary -- only the count and
 * the fake unique ID matter.
 */
function placeholder(idx: number): Tile {
  return {
    kind: 'wind',
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
// Human seat controller
// ---------------------------------------------------------------------------

/**
 * Implements PlayerController by parking a pending Promise for each decision
 * point and resolving it when the human client emits `game_action`.
 *
 * One instance per connected human socket; it persists across hands (the
 * `game_action` listener stays active throughout the session).
 */
class HumanSocketController implements PlayerController {
  private pendingDiscard: ((a: DiscardAction) => void) | null = null;
  private pendingClaim:   ((d: ClaimDecision) => void) | null = null;

  constructor(private readonly socket: TypedSocket) {
    socket.on('game_action', (payload: GameActionPayload) => {
      if (payload.type === 'DISCARD' || payload.type === 'DECLARE_WIN') {
        if (this.pendingDiscard) {
          const resolve       = this.pendingDiscard;
          this.pendingDiscard = null;
          resolve(payload as DiscardAction);
        }
      } else if (payload.type === 'CLAIM_RESPONSE') {
        if (this.pendingClaim) {
          const resolve     = this.pendingClaim;
          this.pendingClaim = null;
          resolve(payload.decision);
        }
      }
    });
  }

  getDiscardAction(_state: GameState, _seat: SeatIndex): Promise<DiscardAction> {
    return new Promise(resolve => { this.pendingDiscard = resolve; });
  }

  getClaimDecision(_state: GameState, _seat: SeatIndex): Promise<ClaimDecision> {
    return new Promise(resolve => { this.pendingClaim = resolve; });
  }

  /** Removes the `game_action` listener and cancels any in-flight promise. */
  cleanup(): void {
    this.socket.removeAllListeners('game_action');
    this.pendingDiscard = null;
    this.pendingClaim   = null;
  }
}

// ---------------------------------------------------------------------------
// Game session
// ---------------------------------------------------------------------------

const HAND_CONFIG = { ...DEFAULT_CONFIG, deadWall: false };

/**
 * Runs back-to-back hands for the current session.
 *
 * Resolves when the creator disconnects or the server state leaves
 * 'in-progress' (lobby.ts resets state on normal exit and on errors).
 */
export async function startGameSession(
  io: TypedServer,
  serverState: ServerState,
): Promise<void> {
  const { seats } = serverState;

  // Build one PlayerController per seat.
  const humanControllers = new Map<number, HumanSocketController>();
  const humanSockets     = new Map<number, TypedSocket>();
  const controllers: PlayerController[] = [];

  for (let seat = 0; seat < 4; seat++) {
    const humanSeat = seats.find(s => s.seat === seat);
    if (humanSeat) {
      const raw = io.sockets.sockets.get(humanSeat.socketId);
      if (raw) {
        const socket = raw as unknown as TypedSocket;
        const ctrl   = new HumanSocketController(socket);
        humanControllers.set(seat, ctrl);
        humanSockets.set(seat, socket);
        controllers.push(ctrl);
        continue;
      }
    }
    // AI fallback: seat has no connected human (or socket was lost).
    controllers.push(new HeuristicController(seat as SeatIndex));
  }

  const names = Array.from({ length: 4 }, (_, i) =>
    seats.find(s => s.seat === i)?.name ??
    `AI ${(['East', 'South', 'West', 'North'] as const)[i]!}`,
  );

  /** Emit a filtered snapshot to every connected human socket. */
  function broadcastState(state: GameState): void {
    for (const [seat, socket] of humanSockets) {
      socket.emit('game_state', filterStateForSeat(state, seat));
    }
  }

  // Run hands in a loop until the session ends.
  while (serverState.phase === 'in-progress') {
    const deal         = buildWall(4, false);
    const initialState = createGameState(HAND_CONFIG, deal, names);

    // Broadcast the initial dealt state before the game loop runs.
    broadcastState(initialState);

    const runner     = new GameRunner(initialState, controllers, broadcastState);
    const finalState = await runner.run();

    // Broadcast the HAND_OVER state (winner's tiles revealed for scoring).
    broadcastState(finalState);

    // Wait for the creator to request another hand (or disconnect).
    const creatorSocket = serverState.creatorSocketId
      ? (io.sockets.sockets.get(serverState.creatorSocketId) as unknown as TypedSocket | undefined)
      : undefined;

    if (!creatorSocket) break;

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

  // Remove game_action listeners from all human sockets.
  for (const ctrl of humanControllers.values()) ctrl.cleanup();
}
