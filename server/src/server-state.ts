/**
 * Server-side state machine for the online game lobby.
 *
 * Phases:
 *   idle        -- No game running. The server accepts exactly one creator.
 *   waiting     -- Creator has configured a game; waiting for human players.
 *                  Joiners connect without a password.
 *   in-progress -- Game is running. New connections are held briefly to allow
 *                  reconnect_attempt; otherwise they are disconnected.
 */

export type ServerPhase = 'idle' | 'waiting' | 'in-progress';

export interface ConnectedSeat {
  socketId: string;
  name: string;
  /** 0 = East (creator), 1 = South, 2 = West, 3 = North */
  seat: number;
}

export interface ServerState {
  phase: ServerPhase;
  /** Total human seats expected (0 until creator_config is received). */
  humanCount: number;
  /** Human seats that have a player connected. Creator is always seat 0. */
  seats: ConnectedSeat[];
  /** Socket id of the creator; only they may send creator_config / creator_deal. */
  creatorSocketId: string | null;
  /**
   * Set by startGameSession (Module 3.4) while a hand is running.
   * Called by lobby.ts when a socket sends reconnect_attempt during in-progress.
   * Returns true if the reconnect was accepted (seat matched, name matched);
   * the game-session handler will have already emitted game_start + game_state
   * to the reconnecting socket.
   */
  reconnectHandler: ((socketId: string, seat: number, name: string) => boolean) | null;
}

export function createServerState(): ServerState {
  return {
    phase: 'idle',
    humanCount: 0,
    seats: [],
    creatorSocketId: null,
    reconnectHandler: null,
  };
}

/** Reset to idle (after a game ends or the creator aborts during setup). */
export function resetServerState(state: ServerState): void {
  state.phase           = 'idle';
  state.humanCount      = 0;
  state.seats           = [];
  state.creatorSocketId = null;
  state.reconnectHandler = null;
}

/**
 * Return the lowest seat index (0-based) not yet occupied by a human.
 * Returns null when all humanCount seats are filled.
 */
export function nextAvailableSeat(state: ServerState): number | null {
  const occupied = new Set(state.seats.map(s => s.seat));
  for (let i = 0; i < state.humanCount; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

/** True when all expected human seats have connected and the creator can deal. */
export function isReadyToDeal(state: ServerState): boolean {
  return state.phase === 'waiting' && state.seats.length === state.humanCount;
}
