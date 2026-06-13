/**
 * Module 1.3 — Game State Model
 *
 * Defines the TypeScript types that describe the complete state of a game at
 * any point in time, plus a factory function for creating the initial state
 * after the deal.
 *
 * This is the single source of truth for the engine. All other modules either
 * read from a GameState or produce a new one — nothing is ever mutated in place.
 *
 * Dependencies: tiles.ts (Tile, Wind), wall.ts (Wall, Deal, PlayerCount)
 * No UI dependencies. No side effects.
 */

import { Tile, Wind } from './tiles.js';
import { Wall, Deal, PlayerCount } from './wall.js';

// ─── Seat ──────────────────────────────────────────────────────────────────────

/**
 * A player's seat position for a hand.
 * 0 = East (dealer), 1 = South, 2 = West, 3 = North.
 * In a 3-player game only seats 0, 1, and 2 are occupied.
 */
export type SeatIndex = 0 | 1 | 2 | 3;

/** The seat winds in canonical seat order. */
const SEAT_WINDS: readonly Wind[] = ['east', 'south', 'west', 'north'];

// ─── Game configuration ────────────────────────────────────────────────────────

/**
 * Configuration set before the hand begins and immutable during play.
 * All flags default to the most common / conservative setting.
 */
export interface GameConfig {
  readonly playerCount:     PlayerCount;
  /**
   * true (default): the communal discard pool is face-up; all players can see
   * every tile that has been discarded.
   * false: the pool is face-down; only the tile currently up for claiming is
   * visible (during the claim window).
   */
  readonly discardsVisible: boolean;
  /**
   * Whether the Knitting and Crocheting special hands are legal.
   * They are enabled or disabled together — there is no reason to allow one
   * without the other.
   */
  readonly knittingEnabled: boolean;
  /**
   * Whether a player may declare Mahjong with a dirty hand (melds spanning
   * more than one suit). Winds and Dragons are always permitted as honours
   * regardless of this flag. Special hands are unaffected.
   */
  readonly dirtyWinAllowed: boolean;
}

/** Sensible defaults: 4-player, face-up discards, no knitting, clean wins only. */
export const DEFAULT_CONFIG: GameConfig = {
  playerCount:     4,
  discardsVisible: true,
  knittingEnabled: false,
  dirtyWinAllowed: false,
};

// ─── Declared melds ────────────────────────────────────────────────────────────

/**
 * The type of a declared (face-up) meld.
 *
 * chow           — three consecutive suited tiles, claimed from a discard.
 * pung           — three identical tiles, claimed from a discard.
 * open_kong      — four identical tiles: either claimed from a discard, or
 *                  extended by adding a 4th tile to a melded pung.
 * concealed_kong — four identical tiles all drawn from the wall; declared
 *                  mid-turn. Scored as concealed despite being announced.
 */
export type MeldType =
  | 'chow'
  | 'pung'
  | 'open_kong'
  | 'concealed_kong';

/** A meld that has been declared and laid face-up (or, for concealed kongs, announced). */
export interface DeclaredMeld {
  readonly type:  MeldType;
  readonly tiles: readonly Tile[];
}

// ─── Player state ──────────────────────────────────────────────────────────────

export interface PlayerState {
  /** This player's seat position for this hand (0 = East/dealer). */
  readonly seat:       SeatIndex;
  /** This player's seat wind for this hand. */
  readonly seatWind:   Wind;
  /** Tiles in the concealed hand, not yet declared as part of a meld. */
  readonly concealed:  readonly Tile[];
  /** Melds declared during play, in declaration order. */
  readonly melds:      readonly DeclaredMeld[];
  /** Bonus tiles (flowers / seasons) set aside when drawn. */
  readonly bonusTiles: readonly Tile[];
  /** This player's cumulative score across all hands played so far. */
  readonly score:      number;
}

// ─── Game phase ────────────────────────────────────────────────────────────────

/**
 * The phase the game is currently in. The turn engine (Module 1.4) drives
 * transitions between these phases.
 *
 * DRAWING      — the current player needs to draw from the live wall (normal
 *                turn start), or has just successfully claimed a discard and
 *                now holds it in hand before discarding.
 * CHECK_BONUS  — the player just drew (or received as a replacement) a bonus
 *                tile; it is set aside and a replacement must be drawn from
 *                the dead wall before play continues.
 * DISCARDING   — the current player has their full hand and must discard one tile.
 * CLAIM_WINDOW — a tile has just been discarded; other players may claim it.
 *                The tile is the last entry in discardPool.
 * HAND_OVER    — the hand has ended (win or exhausted wall); handResult is set.
 */
export type GamePhase =
  | 'DRAWING'
  | 'CHECK_BONUS'
  | 'DISCARDING'
  | 'CLAIM_WINDOW'
  | 'HAND_OVER';

// ─── Hand result ───────────────────────────────────────────────────────────────

/** Why the hand ended. */
export type HandEndReason = 'win' | 'draw';

/**
 * Recorded when the hand ends. Null while the hand is in progress.
 */
export interface HandResult {
  readonly reason:     HandEndReason;
  /** Seat index of the winner. Null when the hand ended in a draw. */
  readonly winnerSeat: SeatIndex | null;
  /**
   * true  = won by self-draw (drew their own winning tile from the wall).
   * false = won by claiming a discard.
   * null  = not applicable (draw game).
   */
  readonly selfDraw:   boolean | null;
}

// ─── Game state ────────────────────────────────────────────────────────────────

/**
 * The complete, immutable snapshot of the game at a single point in time.
 *
 * The turn engine produces a new GameState for every action — old snapshots
 * are never modified. This makes the state easy to reason about, test, and
 * (eventually) replay or undo.
 */
export interface GameState {
  /** Immutable configuration for this game. */
  readonly config:         GameConfig;
  /**
   * One PlayerState per seat, indexed 0 to (playerCount - 1).
   * players[0] is always the current East (dealer) for this hand.
   */
  readonly players:        readonly PlayerState[];
  /** The live wall and dead wall. */
  readonly wall:           Wall;
  /**
   * The communal discard pool in chronological order.
   * The last element is the most recently discarded tile.
   * During CLAIM_WINDOW this is the tile currently available to claim.
   */
  readonly discardPool:    readonly Tile[];
  /** Seat index of the player whose turn it currently is. */
  readonly currentSeat:    SeatIndex;
  /** Current phase of the turn. */
  readonly phase:          GamePhase;
  /** The prevailing (round) wind for this hand. */
  readonly prevailingWind: Wind;
  /** Number of complete hands played before this one (0-indexed). */
  readonly handNumber:     number;
  /** Set when the hand ends; null while the hand is in progress. */
  readonly handResult:     HandResult | null;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates the initial GameState for a new hand from a config and a completed deal.
 *
 * The prevailing wind for hand 0 is East. Rotation of seat winds and
 * prevailing wind across hands is handled by the turn engine (Module 1.4).
 *
 * The initial phase is DRAWING: East holds 14 tiles and must check for bonus
 * tiles or declare a kong before discarding. (The turn engine handles that
 * check immediately on the first action.)
 */
export function createGameState(config: GameConfig, deal: Deal): GameState {
  const players: PlayerState[] = deal.hands.map((hand, i) => ({
    seat:       i as SeatIndex,
    seatWind:   SEAT_WINDS[i],
    concealed:  hand,
    melds:      [],
    bonusTiles: [],
    score:      0,
  }));

  return {
    config,
    players,
    wall:           deal.wall,
    discardPool:    [],
    currentSeat:    0,
    phase:          'DRAWING',
    prevailingWind: 'east',
    handNumber:     0,
    handResult:     null,
  };
}
