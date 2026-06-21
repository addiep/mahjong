/**
 * Typed Socket.io event definitions for the Mah Jong server.
 *
 * These interfaces define the full client-server protocol. The React client
 * (Module 3.2 frontend) will import these types to stay in sync.
 */

/** A human player occupying a seat in the waiting room. */
export interface LobbySeat {
  name: string;
  /** 0 = East (creator), 1 = South, 2 = West, 3 = North */
  seat: number;
}

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
  /**
   * Broadcast when the creator hits Deal. Carries the client's own seat number.
   * Module 3.3 will extend this with the initial filtered GameState.
   */
  game_start: (data: { seat: number }) => void;
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
}
