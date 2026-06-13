/**
 * Module 1.2 — Wall Builder
 *
 * Builds the full 144-tile set, shuffles it, deals initial hands, and
 * partitions the dead wall for kong and bonus-tile replacement draws.
 *
 * Responsibilities of this module:
 *   - Shuffle the tile set (Fisher-Yates).
 *   - Deal the correct number of tiles to each player (14 to the dealer,
 *     13 to everyone else).
 *   - Reserve the last 14 tiles as the dead wall.
 *   - Provide pure functions for drawing from the live wall and dead wall.
 *
 * This module does NOT handle the bonus-tile replacement loop (that belongs
 * in the turn engine, module 1.4) and does NOT pre-filter bonus tiles from
 * initial hands — players reveal and replace them at the start of each hand.
 *
 * All functions are pure and immutable: no input is ever mutated.
 */

import { buildTileSet, Tile } from './tiles.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Tiles reserved at the back of the wall for kong/bonus replacements. */
const DEAD_WALL_SIZE = 14;

/** Tiles dealt to the dealer (East). */
const DEALER_HAND_SIZE = 14;

/** Tiles dealt to each non-dealer. */
const NON_DEALER_HAND_SIZE = 13;

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Number of players at the table. */
export type PlayerCount = 3 | 4;

/**
 * The two portions of the wall that remain after dealing.
 *
 * live — tiles drawn turn by turn, front to back (index 0 = next draw).
 * dead — tiles used only for kong and bonus-tile replacements
 *        (index 0 = next replacement).
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

// ─── Shuffle ───────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle.
 * Mutates the supplied array in place and returns it.
 * Uses Math.random() — entirely sufficient for a game application.
 */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Wall builder ──────────────────────────────────────────────────────────────

/**
 * Builds and shuffles the full 144-tile set, then deals initial hands.
 *
 * Tile allocation:
 *
 *   144 total
 *   − 14  dead wall   (last 14 of the shuffled set)
 *   = 130 live pool
 *     − 14  dealer hand   (seat 0)
 *     − 13  × (playerCount − 1)  non-dealer hands
 *   = remainder → live wall
 *
 * 4-player breakdown:  53 dealt + 14 dead + 77 live  = 144
 * 3-player breakdown:  40 dealt + 14 dead + 90 live  = 144
 */
export function buildWall(playerCount: PlayerCount): Deal {
  const tiles = shuffle(buildTileSet());

  // Reserve the last DEAD_WALL_SIZE tiles as the dead wall.
  const deadStart = tiles.length - DEAD_WALL_SIZE;
  const pool      = tiles.slice(0, deadStart);  // live pool before dealing
  const dead      = tiles.slice(deadStart);      // 14 replacement tiles

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

// ─── Draw functions ────────────────────────────────────────────────────────────

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
  const [tile, ...live] = wall.live as Tile[];
  return { tile, wall: { ...wall, live } };
}

/**
 * Draws the next replacement tile from the dead wall.
 *
 * Used after a kong declaration or a bonus tile draw.
 * In normal play the dead wall should never be fully exhausted, but null
 * is returned defensively if it is.
 */
export function drawReplacement(wall: Wall): { tile: Tile | null; wall: Wall } {
  if (wall.dead.length === 0) {
    return { tile: null, wall };
  }
  const [tile, ...dead] = wall.dead as Tile[];
  return { tile, wall: { ...wall, dead } };
}
