/**
 * Client <-> server wire protocol -- the single source of truth.
 *
 * These are the typed Socket.io event and payload definitions for online play.
 * They live in the engine package (type-only, no runtime, no socket.io import)
 * so that BOTH the Node server (server/src/events.ts) and the React client
 * (src/components/OnlineLobby.tsx) import exactly the same definitions, instead
 * of each keeping a hand-maintained copy. Drift between two copies has caused
 * real runtime bugs before (an action missing from the client copy froze the
 * game; a mislabelled meld field), which TypeScript could not catch across the
 * package boundary. One definition removes that whole class of bug.
 *
 * The engine already owns GameState and the action/decision types these events
 * carry, so the wire protocol for those types belongs alongside them. The
 * concrete socket wrappers stay on each side (socket.io Server on the server,
 * socket.io-client Socket in the browser); only the event maps are shared.
 */

import type { GameState, ClaimDecision } from './game-state.js';

/** A human player occupying a seat in the waiting room. */
export interface LobbySeat {
  name: string;
  /** 0 = East (creator), 1 = South, 2 = West, 3 = North */
  seat: number;
}

/**
 * A game action sent from a human client during an active hand.
 * Maps to the engine's interactive action types.
 */
export type GameActionPayload =
  | { type: 'DISCARD';             tileId: string }
  | { type: 'DECLARE_WIN' }
  | { type: 'DECLARE_ADDED_KONG';  tileId: string }
  | { type: 'CLAIM_RESPONSE';      decision: ClaimDecision };

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  /**
   * Sent immediately on connection. The client adapts its UI:
   *   'idle'        -> show creator screen (name + password)
   *   'waiting'     -> show joiner screen (name only)
   *   'in-progress' -> socket gets a brief window to send reconnect_attempt
   */
  server_state: (data: { phase: 'idle' | 'waiting' | 'in-progress' }) => void;

  // --- creator flow ---
  /** Password accepted. Client shows the human-count config screen. */
  auth_ok: () => void;
  /** Wrong password (or server not idle). Socket is disconnected after this. */
  auth_fail: () => void;
  /** Creator has configured the game. Client enters the waiting room as East (seat 0). */
  config_ok: (data: { seat: 0 }) => void;

  // --- joiner flow ---
  /** Joiner accepted. Client enters the waiting room at the given seat. */
  join_ok: (data: { seat: number }) => void;
  /** Joiner rejected (no game open, or game full). */
  join_fail: (data: { reason: string }) => void;

  // --- waiting room (broadcast to all connected clients) ---
  /** Sent whenever a seat is added, removed, or the human count changes. */
  lobby_update: (data: { seats: LobbySeat[]; humanCount: number }) => void;

  // --- game start / reconnect ---
  /** Broadcast when the creator hits Deal. Carries the client's own seat number. */
  /** Also sent on successful reconnect so the client can re-enter the game view. */
  game_start: (data: { seat: number }) => void;

  // --- in-game (Module 3.3) ---
  /**
   * Sent after every engine dispatch. The payload is filtered for the receiving
   * seat: opponent concealed tiles are replaced with wind-east placeholders
   * (preserving the count), the private discardLog is stripped, and at
   * HAND_OVER the winner's tiles are revealed for scoring.
   */
  game_state: (state: GameState) => void;

  /**
   * A single human-readable line describing a move that just happened (a
   * discard, a pung/kong/chow claim, an added kong, or the end of the hand),
   * for the client's event sidebar. Derived authoritatively on the server in
   * broadcastState, which observes every engine dispatch, so it is reliable
   * regardless of how the client batches incoming game_state events.
   */
  game_event: (message: string) => void;
}

/** Events the client sends to the server. */
export interface ClientToServerEvents {
  /** Creator authentication. Only valid when server is idle. */
  creator_auth: (data: { name: string; password: string }) => void;
  /** Creator sets the number of human players (1-4). Sent after auth_ok. */
  creator_config: (data: { humanCount: number }) => void;
  /** Joiner enters their name. Only valid when server is waiting. */
  joiner_join: (data: { name: string }) => void;
  /** Creator starts the game. Only valid when all human seats are filled. */
  creator_deal: () => void;

  // --- in-game (Module 3.3) ---
  /** Human player's action during DISCARDING, CLAIM_WINDOW, or ROBBING_KONG. */
  game_action: (payload: GameActionPayload) => void;
  /** Creator requests a new hand after HAND_OVER. Ignored from non-creator sockets. */
  new_hand: () => void;

  // --- reconnection (Module 3.4) ---
  /**
   * Sent immediately on connection when the client has stored session credentials
   * (seat number + name from a previous connection). Only processed while the
   * server is in-progress; ignored (and the socket disconnected) otherwise.
   */
  reconnect_attempt: (data: { seat: number; name: string }) => void;
}
