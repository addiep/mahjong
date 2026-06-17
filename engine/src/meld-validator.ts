/**
 * Module 1.6 — Meld Validator
 *
 * Pure predicate functions that answer whether a given array of tiles forms a
 * legal complete meld. No game state, no side effects.
 *
 * Exported functions:
 *   isPair(tiles)      — two identical tiles (the "head" of a hand).
 *   isPung(tiles)      — three identical tiles.
 *   isKong(tiles)      — four identical tiles.
 *   isChow(tiles)      — three consecutive suited tiles of the same suit.
 *   identifyMeld(tiles)— returns the MeldKind, or null if none of the above.
 *
 * "Identical" means same tile kind (tileKey), not same physical copy.
 * Chows may be supplied in any order; honour tiles (winds, dragons, bonus)
 * can never form a chow.
 *
 * This module is used by:
 *   - Module 1.5 (Claim Window Logic) — to validate incoming claims.
 *   - Module 1.7 (Hand Evaluator)     — to decompose hands into melds.
 *
 * Dependencies: tiles.ts
 * No UI dependencies. No side effects.
 */

import { Tile, SuitedTile, isSuited, tileKey } from './tiles.js';

// ─── MeldKind ───────────────────────────────────────────────

/**
 * The shape of a complete meld (or pair).
 *
 * Distinct from the engine's MeldType (which distinguishes open_kong from
 * concealed_kong): that distinction is a gameplay concern. Here we care only
 * about tile structure.
 */
export type MeldKind = 'pair' | 'pung' | 'kong' | 'chow';

// ─── Predicates ────────────────────────────────────────────

/**
 * Returns true if the tiles form a valid pair: exactly two tiles of the same
 * kind. Used as the "head" in a standard hand.
 */
export function isPair(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 2) return false;
  return tileKey(tiles[0]!) === tileKey(tiles[1]!);
}

/**
 * Returns true if the tiles form a valid pung: exactly three tiles of the
 * same kind. Any tile category is allowed (suited, wind, dragon).
 */
export function isPung(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 3) return false;
  const key = tileKey(tiles[0]!);
  return tiles[1] !== undefined && tiles[2] !== undefined
    && tileKey(tiles[1]) === key
    && tileKey(tiles[2]) === key;
}

/**
 * Returns true if the tiles form a valid kong: exactly four tiles of the
 * same kind. Any tile category is allowed (suited, wind, dragon).
 */
export function isKong(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 4) return false;
  const key = tileKey(tiles[0]!);
  return tiles.every(t => tileKey(t) === key);
}

/**
 * Returns true if the tiles form a valid chow: exactly three suited tiles
 * of the same suit with consecutive values (e.g. Bam3–Bam4–Bam5).
 *
 * Tiles may be supplied in any order.
 * Honour tiles (winds, dragons) and bonus tiles can never form a chow.
 */
export function isChow(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 3) return false;
  if (!tiles.every(isSuited)) return false;

  const suited = tiles as readonly SuitedTile[];
  const suit   = suited[0]!.suit;
  if (!suited.every(t => t.suit === suit)) return false;

  const values = suited.map(t => t.value).sort((a, b) => a - b) as number[];
  return values[1]! === values[0]! + 1 && values[2]! === values[1]! + 1;
}

// ─── Convenience ────────────────────────────────────────────

/**
 * Returns the MeldKind of the given tiles, or null if they do not form any
 * recognised meld or pair.
 *
 * Precedence: pair → pung → kong → chow. In practice a pair of 4 identical
 * tiles will never be passed here, so the ordering only matters for the
 * pair-vs-pung edge (2 tiles is always a pair check, not a pung).
 */
export function identifyMeld(tiles: readonly Tile[]): MeldKind | null {
  if (isPair(tiles))  return 'pair';
  if (isPung(tiles))  return 'pung';
  if (isKong(tiles))  return 'kong';
  if (isChow(tiles))  return 'chow';
  return null;
}
