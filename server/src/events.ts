/**
 * Typed Socket.io event definitions for the Mah Jong server.
 *
 * These interfaces define the full client-server protocol. The React client
 * mirrors these types in OnlineLobby.tsx -- keep them in sync.
 */

import type { GameState, ClaimDecision } from '@mahjong/engine';

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
  | { type: 'DISCARD';        tileId: string }
  | { type: 'DECLARE_WIN' }
  | { type: 'CLAIM_RESPONSE'; decision: ClaimDecision };

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  /**
   * Sent immediately on connection. The client adapts its UI:
   *   'idle'        -> show creator screen (name + password)
   *   'waiting'     -> show joiner screen (name only)
   *   'in-progress' -> socket is disconnected immediately after this
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

  // --- game start ---
  /** Broadcast when the creator hits Deal. Carries the client's own seat number. */
  game_start: (data: { seat: number }) => void;

  // --- in-game (Module 3.3) ---
  /**
   * Sent after every engine dispatch. The payload is filtered for the receiving
   * seat: opponent concealed tiles are replaced with wind-east placeholders
   * (preserving the count), the private discardLog is stripped, and at
   * HAND_OVER the winner's tiles are revealed for scoring.
   */
  game_state: (state: GameState) => void;
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
}
