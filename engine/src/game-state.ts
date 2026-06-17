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
 * Dependencies: tiles.ts (Tile, TileId, Wind), wall.ts (Wall, Deal, PlayerCount)
 * No UI dependencies. No side effects.
 */

import { Tile, TileId, Wind } from './tiles.js';
import { Wall, Deal, PlayerCount } from './wall.js';

// ─── Seat ──────────────────────────────────────────

/**
 * A player's seat position for a hand.
 * 0 = East (dealer), 1 = South, 2 = West, 3 = North.
 * In a 3-player game only seats 0, 1, and 2 are occupied.
 */
export type SeatIndex = 0 | 1 | 2 | 3;

/** The seat winds in canonical seat order. */
const SEAT_WINDS: readonly Wind[] = ['east', 'south', 'west', 'north'];

// ─── Game configuration ────────────────────────────────────

/**
 * Configuration set before the hand begins and immutable during play.
 * All flags default to the most common / conservative setting.
 */
export interface GameConfig {
  readonly playerCount:     PlayerCount;
  readonly discardsVisible: boolean;
  readonly knittingEnabled: boolean;
  readonly dirtyWinAllowed: boolean;
  /**
   * Whether to reserve a 14-tile dead wall for kong / flower replacements.
   * When false (the family rule, and the default), there is no reserve:
   * replacement (loose) tiles come from the far end of the live wall and play
   * continues until the wall is exhausted. Optional for backward compatibility;
   * absent is treated as false. The game setup passes this to `buildWall`.
   */
  readonly deadWall?:       boolean;
}

/**
 * Sensible defaults: 4-player, face-up discards, no knitting, clean wins only,
 * and no dead-wall reserve (the family rule — use up the whole wall).
 */
export const DEFAULT_CONFIG: GameConfig = {
  playerCount:     4,
  discardsVisible: true,
  knittingEnabled: false,
  dirtyWinAllowed: false,
  deadWall:        false,
};

// ─── Declared melds ─────────────────────────────────────

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

// ─── Player state ──────────────────────────────────

export interface PlayerState {
  /** The player's display name. */
  readonly name:       string;
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

// ─── Game phase ─────────────────────────────────

/**
 * The phase the game is currently in. The turn engine (Module 1.4) drives
 * transitions between these phases.
 *
 * DRAWING      — the current player needs to draw from the live wall, or has
 *                just claimed a discard and holds it before discarding.
 * CHECK_BONUS  — a bonus tile (or kong) requires a replacement draw from the
 *                dead wall before play continues.
 * DISCARDING   — the current player has their full hand and must discard one tile.
 * CLAIM_WINDOW — a tile has just been discarded; other players may claim it.
 * ROBBING_KONG — a player has promoted an exposed pung to a kong; other players
 *                may rob that exact tile for a win before the replacement draw.
 * HAND_OVER    — the hand has ended (win or exhausted wall); handResult is set.
 */
export type GamePhase =
  | 'DRAWING'
  | 'CHECK_BONUS'
  | 'DISCARDING'
  | 'CLAIM_WINDOW'
  | 'ROBBING_KONG'
  | 'HAND_OVER';

// ─── Hand result ──────────────────────────────────

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
   * false = won by claiming a discard (including robbing a kong).
   * null  = not applicable (draw game).
   */
  readonly selfDraw:   boolean | null;
}

// ─── Claim window ───────────────────────────────

/**
 * The type of claim a player may make on a discarded tile.
 * 'pass' means the player declines to claim.
 */
export type ClaimType = 'win' | 'pung' | 'kong' | 'chow' | 'pass';

/**
 * A single player's decision during the CLAIM_WINDOW (or ROBBING_KONG) phase.
 *
 * chowTiles is only set when type === 'chow'. It contains the IDs of the two
 * tiles from the claimer's concealed hand that, together with the discard,
 * form the chow sequence.
 */
export interface ClaimDecision {
  readonly type:       ClaimType;
  readonly chowTiles?: readonly [TileId, TileId];
}

/**
 * Tracks every player's response during a CLAIM_WINDOW phase.
 *
 * responses is indexed by SeatIndex. null means that seat has not yet
 * responded. The discarder's own slot is pre-filled with { type: 'pass' }
 * by the turn engine (they cannot claim their own tile).
 */
export interface ClaimWindowState {
  readonly responses: ReadonlyArray<ClaimDecision | null>;
}

/**
 * Tracks the Robbing the Kong window, opened when a player promotes an exposed
 * pung to a kong by adding a drawn tile. Only that exact tile may be claimed,
 * and only as a winning tile ('win' or 'pass'); concealed kongs are never robbable.
 *
 * responses is indexed by SeatIndex, like ClaimWindowState. The melder's own
 * slot is pre-filled with { type: 'pass' } — they cannot rob their own kong.
 */
export interface RobbingKongState {
  /** The tile just added to the kong; the only tile that may be robbed. */
  readonly tile:       Tile;
  /** The seat that declared the added kong. */
  readonly melderSeat: SeatIndex;
  /** Each seat's response; null = not yet responded. Only 'win'/'pass' are legal. */
  readonly responses:  ReadonlyArray<ClaimDecision | null>;
}

// ─── Game state ─────────────────────────────────

/**
 * The complete, immutable snapshot of the game at a single point in time.
 *
 * The turn engine produces a new GameState for every action — old snapshots
 * are never modified.
 */
export interface GameState {
  /** Immutable configuration for this game. */
  readonly config:         GameConfig;
  /** One PlayerState per seat, indexed 0 to (playerCount - 1). */
  readonly players:        readonly PlayerState[];
  /** The live wall and dead wall. */
  readonly wall:           Wall;
  /** The communal discard pool in chronological order (last = most recent). */
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
  /** Set only during CLAIM_WINDOW phase; null otherwise. */
  readonly claimWindow:    ClaimWindowState | null;
  /** Set only during ROBBING_KONG phase; null otherwise. */
  readonly robbingKong:    RobbingKongState | null;
}

// ─── Factory ───────────────────────────────────

/**
 * Creates the initial GameState for a new hand from a config, a completed deal,
 * and the players' names.
 *
 * Names are matched to seats in order: names[0] is East (dealer), names[1] is
 * South, and so on. The array length must equal config.playerCount.
 */
export function createGameState(
  config: GameConfig,
  deal:   Deal,
  names:  string[],
): GameState {
  if (names.length !== config.playerCount) {
    throw new Error(
      `createGameState: expected ${config.playerCount} names, got ${names.length}`,
    );
  }

  const players: PlayerState[] = deal.hands.map((hand, i) => ({
    name:       names[i]!,
    seat:       i as SeatIndex,
    seatWind:   SEAT_WINDS[i]!,
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
    claimWindow:    null,
    robbingKong:    null,
  };
}
