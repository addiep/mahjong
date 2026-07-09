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

import type { GameState, ClaimDecision, DeclaredMeld, SeatIndex, PayingSystem } from './game-state.js';
import type { Tile, TileId } from './tiles.js';
import type { ScoreResult, ExposedMeldScoreResult } from './scoring.js';
import type { BonusScoreResult } from './flower-scoring.js';
import type { SettlementResult } from './settlement.js';

/** A human player occupying a seat in the waiting room. */
export interface LobbySeat {
  name: string;
  /** 0 = East (creator), 1 = South, 2 = West, 3 = North */
  seat: number;
}

/**
 * A game action sent from a human client during an active hand.
 * Maps to the engine's interactive action types.
 *
 * DECLARE_CONCEALED_KONG (external codebase review finding 1, 2026-07-09):
 * was missing from this union, so a human could never send it online even
 * though the engine and server-side isActionValid already handled it -- the
 * client TypeScript types simply made it impossible to construct. tileId is
 * also tightened from `string` to the branded `TileId` here (review
 * suggestion 9), matching every other typed field on the wire.
 */
export type GameActionPayload =
  | { type: 'DISCARD';                tileId: TileId }
  | { type: 'DECLARE_WIN' }
  | { type: 'DECLARE_ADDED_KONG';     tileId: TileId }
  | { type: 'DECLARE_CONCEALED_KONG'; tileId: TileId }
  | { type: 'CLAIM_RESPONSE';         decision: ClaimDecision };

/**
 * Server-authoritative hand-score payload (Finding 3 fix, 2026-07-02).
 *
 * Previously each client computed its own copy of the HAND_OVER score from
 * its own per-seat FILTERED GameState (see game-session.ts filterStateForSeat):
 * a client could see its own concealed tiles and the winner's revealed hand,
 * but every other opponent's concealed tiles were placeholders. Non-winners'
 * concealed pungs/pairs (scoreExposedMelds' concealedTiles param) therefore
 * scored differently depending on who was computing them, so `runningTotals`
 * could permanently diverge between clients watching the same table.
 *
 * The server always holds every player's real, unfiltered GameState, so it is
 * the only party that can score everyone's contribution consistently. It now
 * computes this once per hand (from the unfiltered final state, before
 * filterStateForSeat is applied) and broadcasts the identical payload to every
 * connected client -- mirroring what local pass-and-play already does on one
 * screen (App.tsx's local HAND_OVER effect scores every player from their real
 * concealed tiles, since local mode has them all in view). `runningTotals` is
 * accumulated server-side across the whole session and is now the single
 * source of truth; clients no longer maintain their own copy online.
 */
export interface WinnerHandPayload {
  /** All concealed tiles (includes the winning tile). */
  readonly concealed:    readonly Tile[];
  readonly melds:        readonly DeclaredMeld[];
  readonly bonusTiles:   readonly Tile[];
  readonly winningTileId: TileId | null;
}

export interface PlayerBonusPayload {
  readonly name:      string;
  readonly seat:      SeatIndex;
  readonly bonus:     BonusScoreResult;
  /** Full hand score for non-winners (melds + concealed pungs); null for the winner. */
  readonly meldScore: ExposedMeldScoreResult | null;
}

export interface HandScorePayload {
  readonly winnerName:     string | null;
  /** null on a draw, or if scoring threw (see game-session.ts computeHandScore). */
  readonly result:         ScoreResult | null;
  readonly playerBonuses:  readonly PlayerBonusPayload[];
  /** Winner's full hand for display; null on a draw. */
  readonly winnerHand:     WinnerHandPayload | null;
  /** Authoritative running totals, one per seat, accumulated for the whole session. */
  readonly runningTotals:  readonly number[];
  /**
   * Todo F: who paid whom this hand, and each seat's net delta.
   *
   * Non-null only when `GameConfig.payingSystem === 'traditional'` AND the
   * hand was won (a draw settles nothing). Under the default 'pool' system
   * this is null and each seat simply banked its own hand score, exactly as
   * before. The server computes it once from the unfiltered final state --
   * the same reason `result` and `runningTotals` are server-authoritative
   * (Finding 3): a per-seat filtered state cannot see the other losers' real
   * concealed tiles, so a client could not compute the loser-to-loser leg.
   */
  readonly settlement:     SettlementResult | null;
}

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

  // --- game start / reconnect / seat rotation ---
  /**
   * Carries the client's own seat number for the CURRENT hand, plus whether
   * this client is the creator (identity 0 -- fixed for the whole session,
   * even though which physical seat/wind they occupy now rotates hand to
   * hand, see Todo A). Sent in three situations:
   *   - Broadcast when the creator hits Deal (initial deal, hand 1).
   *   - Sent on successful reconnect so the client can re-enter the game view.
   *   - Re-sent to every connected human at the start of EVERY subsequent
   *     hand, since seat rotation (Todo A: "East stays East on a win") means
   *     a player's physical seat can change between hands -- see
   *     game-session.ts's rotation logic. `isCreator` lets the client show
   *     the "New hand" control to the right player even after they rotate
   *     away from seat 0.
   */
  game_start: (data: { seat: number; isCreator: boolean }) => void;

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

  /**
   * Sent once per hand immediately after the final HAND_OVER `game_state`,
   * with the server-computed, authoritative score for that hand (see
   * HandScorePayload above). Identical for every connected client -- this is
   * what fixes Finding 3 (online running totals diverging between clients).
   */
  hand_score: (payload: HandScorePayload) => void;
}

/** Events the client sends to the server. */
export interface ClientToServerEvents {
  /** Creator authentication. Only valid when server is idle. */
  creator_auth: (data: { name: string; password: string }) => void;
  /**
   * Creator sets the number of human players (1-4) plus the hand-config
   * options for the whole session. Sent after auth_ok.
   *
   * `deadWall`, `knittingEnabled`, `discardsVisible`, and `payingSystem`
   * mirror the options GameSetup.tsx already offers for local pass-and-play
   * (Modules 2.6 and Todo F). Before 2026-07-02 the online lobby only ever
   * asked for humanCount, and the server used hardcoded defaults for the rest
   * (game-session.ts's HAND_CONFIG) -- the creator had no way to turn on the
   * dead wall or knitting/crocheting online. See Module 3.2 / Decisions Log
   * 2026-07-02. `payingSystem` was added the same way on 2026-07-09 (Todo F).
   */
  creator_config: (data: {
    humanCount:      number;
    deadWall:        boolean;
    knittingEnabled: boolean;
    discardsVisible: boolean;
    payingSystem:    PayingSystem;
  }) => void;
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
