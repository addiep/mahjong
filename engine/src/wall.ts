/**
 * Module 1.2 — Wall Builder
 *
 * Builds the full 144-tile set, shuffles it, deals initial hands, and
 * (optionally) partitions a dead wall for kong and bonus-tile replacement draws.
 *
 * Two wall styles are supported (see `deadWall`):
 *   - Reserve (traditional): the last 14 tiles are set aside as a dead wall and
 *     replacement (kong / flower) draws come from it.
 *   - No reserve (the family rule, the game default): there is no dead wall;
 *     replacement draws come from the *far end* of the live wall, and play
 *     continues until the wall is exhausted.
 *
 * All functions are pure and immutable: no input is ever mutated.
 */

import { buildTileSet, Tile } from './tiles.js';

// ─── Constants ─────────────────────────────────────────────

/** Tiles reserved at the back of the wall for kong/bonus replacements (reserve style). */
const DEAD_WALL_SIZE = 14;

/** Tiles dealt to the dealer (East). */
const DEALER_HAND_SIZE = 14;

/** Tiles dealt to each non-dealer. */
const NON_DEALER_HAND_SIZE = 13;

// ─── Types ─────────────────────────────────────────────

/** Number of players at the table. */
export type PlayerCount = 3 | 4;

/**
 * The two portions of the wall that remain after dealing.
 *
 * live — tiles drawn turn by turn. Normal draws come from the front (index 0);
 *        in the no-reserve style, replacement draws come from the back.
 * dead — replacement tiles (reserve style only); empty in the no-reserve style.
 *        index 0 = next replacement.
 */
export interface Wall {
  readonly live: readonly Tile[];
  readonly dead: readonly Tile[];
}

/**
 * The result of dealing a new hand.
 *
 * hands — one entry per seat, indexed 0–(playerCount−1).
 *         Seat 0 is East (the dealer) and always receives 14 tiles.
 *         All other seats receive 13 tiles.
 * wall  — the remaining live wall and the dead wall.
 */
export interface Deal {
  readonly hands: readonly (readonly Tile[])[];
  readonly wall:  Wall;
}

// ─── Shuffle ─────────────────────────────────────────────

/**
 * Fisher-Yates shuffle.
 * Pure: returns a new shuffled array and never mutates the input (external
 * codebase review suggestion 8, 2026-07-09 -- the previous version mutated
 * `arr` in place, a minor impurity in an otherwise pure module).
 * Uses Math.random() — entirely sufficient for a game application.
 */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// ─── Wall builder ────────────────────────────────────────────

/**
 * Builds and shuffles the full 144-tile set, then deals initial hands.
 *
 * `deadWall` selects the wall style:
 *   - true  (the parameter default): reserve the last 14 tiles as a dead wall.
 *   - false (the family rule): no reserve — every undealt tile is in the live
 *     wall, and replacements come from its far end.
 *
 * Note the game-level default rule lives in `DEFAULT_CONFIG.deadWall` (false);
 * the game setup passes `config.deadWall` here explicitly. The parameter itself
 * defaults to the traditional reserve so existing low-level callers are unchanged.
 *
 * Reserve, 4-player:  53 dealt + 14 dead + 77 live  = 144
 * No reserve, 4-player: 53 dealt + 0 dead + 91 live = 144
 */
export function buildWall(playerCount: PlayerCount, deadWall: boolean = true): Deal {
  const tiles = shuffle(buildTileSet());

  // Reserve the last DEAD_WALL_SIZE tiles as the dead wall, or none.
  let pool: Tile[];
  let dead: Tile[];
  if (deadWall) {
    const deadStart = tiles.length - DEAD_WALL_SIZE;
    pool = tiles.slice(0, deadStart);  // live pool before dealing
    dead = tiles.slice(deadStart);      // 14 replacement tiles
  } else {
    pool = tiles;                        // every tile is in play
    dead = [];
  }

  // Deal hands from the front of the pool.
  const hands: (readonly Tile[])[] = [];
  let cursor = 0;

  for (let seat = 0; seat < playerCount; seat++) {
    const size = seat === 0 ? DEALER_HAND_SIZE : NON_DEALER_HAND_SIZE;
    hands.push(pool.slice(cursor, cursor + size));
    cursor += size;
  }

  // Everything left in the pool becomes the live wall.
  const live = pool.slice(cursor);

  return {
    hands,
    wall: { live, dead },
  };
}

// ─── Draw functions ───────────────────────────────────────────

/**
 * Draws the next tile from the live wall.
 *
 * Returns the drawn tile and an updated Wall with that tile removed.
 * If the wall is exhausted (draw game), tile is null and the wall is
 * returned unchanged — the caller (turn engine) handles this case.
 */
export function drawFromWall(wall: Wall): { tile: Tile | null; wall: Wall } {
  if (wall.live.length === 0) {
    return { tile: null, wall };
  }
  const tile = wall.live[0]!;
  const live = wall.live.slice(1);
  return { tile, wall: { ...wall, live } };
}

/**
 * Draws the next replacement (loose) tile.
 *
 * Reserve style: takes from the front of the dead wall.
 * No-reserve style (dead wall empty): takes from the *far end* of the live wall
 *   — the loose tiles simply come from the other end of the same wall.
 *
 * Returns null (and the same wall) only when there are no tiles left at all.
 */
export function drawReplacement(wall: Wall): { tile: Tile | null; wall: Wall } {
  if (wall.dead.length > 0) {
    const tile = wall.dead[0]!;
    const dead = wall.dead.slice(1);
    return { tile, wall: { ...wall, dead } };
  }
  if (wall.live.length > 0) {
    const live = wall.live.slice(0, -1);
    const tile = wall.live[wall.live.length - 1]!;
    return { tile, wall: { ...wall, live } };
  }
  return { tile: null, wall };
}
