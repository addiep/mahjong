/**
 * Module 4.6b — Structural distance primitives
 *
 * The 4.6a specs were all fixed-tile-set hands: `coverDistance` (how many of
 * these 14 named tiles am I holding?) was the whole metric. The hard hands are
 * not like that. Buried Treasure is "any concealed one-suit hand, four melds
 * plus a pair, no kongs" — thousands of tile combinations qualify — so the only
 * way to know how far away it is is to actually try carving the tiles into
 * melds and part-melds and keep the best carving.
 *
 * That is what `standardUsable` does. It is the partial-hand sibling of
 * `hand-evaluator.ts`'s `decomposeStandard` (which only carves *complete*
 * hands). Where `decomposeStandard` asks "is there a valid reading?",
 * `standardUsable` asks "how many of my tiles can I keep, at best, on the way
 * to a valid reading?" — and the target's `away` is then `targetSize - usable`.
 *
 * `blockProgress` is the cheap summary the pungs-only hands need (Mixed Pungs,
 * All Kongs): completed and partial blocks by kind, no chow search.
 *
 * Dependencies: tiles.ts only. Pure, no side effects.
 */

import {
  Tile, TileKey, Suit, SUITS, WINDS, DRAGONS,
  tileKey, isSuited, isWind, isDragon,
} from '../tiles.js';

// ─── The 34-slot count vector ─────────────────────────────────────────────────

/**
 * Tiles are indexed 0..33: three suits of nine values (bamboo 0-8, characters
 * 9-17, circles 18-26), then the four winds (27-30) and three dragons (31-33).
 * A chow may only span indices inside one nine-slot suit block.
 */
export const TILE_INDEX_COUNT = 34;

const SUIT_BASE: Record<Suit, number> = { bamboo: 0, characters: 9, circles: 18 };

/** Index of a tile in the 34-slot count vector. Bonus tiles return -1. */
export function tileIndex(t: Tile): number {
  if (isSuited(t)) return SUIT_BASE[t.suit] + (t.value - 1);
  if (isWind(t))   return 27 + WINDS.indexOf(t.wind);
  if (isDragon(t)) return 31 + DRAGONS.indexOf(t.dragon);
  return -1;
}

/** The TileKey of a 34-slot index. Inverse of `tileIndex`. */
export function indexKey(i: number): TileKey {
  if (i < 27) {
    const suit = SUITS[Math.floor(i / 9)]!;
    return `suited:${suit}:${(i % 9) + 1}` as TileKey;
  }
  if (i < 31) return `wind:${WINDS[i - 27]}` as TileKey;
  return `dragon:${DRAGONS[i - 31]}` as TileKey;
}

/** True when index `i` is a suited tile (the only tiles that can form chows). */
export function isSuitedIndex(i: number): boolean { return i < 27; }

/** Position 0..8 of a suited index within its suit block. */
function suitOffset(i: number): number { return i % 9; }

/** Build the 34-slot count vector for a tile list. Bonus tiles are ignored. */
export function countVector(tiles: readonly Tile[]): number[] {
  const c = new Array<number>(TILE_INDEX_COUNT).fill(0);
  for (const t of tiles) {
    const i = tileIndex(t);
    if (i >= 0) c[i] = (c[i] ?? 0) + 1;
  }
  return c;
}

/** The nine indices belonging to one suit block. */
export function suitIndices(suit: Suit): number[] {
  const base = SUIT_BASE[suit];
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].map(v => base + v);
}

/** First index of a suit block. */
export function suitBase(suit: Suit): number { return SUIT_BASE[suit]; }

// ─── blockProgress: the cheap, chow-free summary ──────────────────────────────

export interface BlockProgress {
  /** Kinds held 3 or 4 times: a complete pung (or kong) already in hand. */
  readonly pungs:   readonly TileKey[];
  /** Kinds held exactly 4 times: a complete kong already in hand. */
  readonly kongs:   readonly TileKey[];
  /** Kinds held exactly twice: a pung one tile away, or the hand's pair. */
  readonly pairs:   readonly TileKey[];
  /** Kinds held exactly once. */
  readonly singles: readonly TileKey[];
}

/**
 * Completed and partial same-kind blocks in a tile list. No chow reasoning:
 * this is for the pungs-and-kongs hands (Mixed Pungs, All Kongs), where every
 * block is a set of identical tiles.
 */
export function blockProgress(tiles: readonly Tile[]): BlockProgress {
  const c = countVector(tiles);
  const pungs: TileKey[] = [], kongs: TileKey[] = [], pairs: TileKey[] = [], singles: TileKey[] = [];
  for (let i = 0; i < TILE_INDEX_COUNT; i++) {
    const n = c[i] ?? 0;
    if (n === 4) { kongs.push(indexKey(i)); pungs.push(indexKey(i)); }
    else if (n === 3) pungs.push(indexKey(i));
    else if (n === 2) pairs.push(indexKey(i));
    else if (n === 1) singles.push(indexKey(i));
  }
  return { pungs, kongs, pairs, singles };
}

// ─── standardUsable: the real structural distance ─────────────────────────────

export interface UsableOptions {
  /** How many melds the hand still needs (4 minus declared melds). */
  readonly setsNeeded: number;
  /** May a set be a chow? False for the pungs-only hands. */
  readonly allowChow: boolean;
  /** Does the hand still need its pair? */
  readonly needPair: boolean;
  /**
   * Restrict the search to these indices — tiles outside the mask contribute
   * nothing (they are the tiles the target would have you discard). Used to
   * confine a hand to a single suit, or to suit-plus-honours.
   */
  readonly allowed?: (i: number) => boolean;
}

/**
 * The maximum number of tiles that can contribute to the target shape.
 *
 * A completed set contributes 3, a two-tile part-set (a pair heading for a
 * pung, or two tiles inside a chow window) contributes 2, and a lone tile
 * earmarked for a set contributes 1. The hand's pair contributes 2 when
 * complete and 1 when it is still a single. Every part-set consumes one of the
 * `setsNeeded` slots, so the count can never exceed `3 * setsNeeded + 2`.
 *
 * Exact for the shape described — the true maximum over all carvings, not an
 * upper bound. `targetSize - standardUsable(...)` is therefore the true number
 * of tiles still to be drawn or claimed, i.e. `away`.
 */
export function standardUsable(counts: readonly number[], opts: UsableOptions): number {
  const allowed = opts.allowed ?? (() => true);
  const c = counts.slice();
  const memo = new Map<string, number>();
  const cap = 3 * opts.setsNeeded + (opts.needPair ? 2 : 0);

  function search(from: number, setsLeft: number, pairLeft: number): number {
    if (setsLeft === 0 && pairLeft === 0) return 0;

    // Advance to the next usable tile.
    let i = from;
    while (i < TILE_INDEX_COUNT && ((c[i] ?? 0) === 0 || !allowed(i))) i++;
    if (i >= TILE_INDEX_COUNT) return 0;

    const key = `${i}|${setsLeft}|${pairLeft}|${c.join('')}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let best = 0;
    const chowable = opts.allowChow && isSuitedIndex(i);
    const off = suitOffset(i);

    const take = (deltas: readonly (readonly [number, number])[], gain: number, dSets: number, dPair: number) => {
      for (const [idx, n] of deltas) c[idx] = (c[idx] ?? 0) - n;
      const v = gain + search(i, setsLeft - dSets, pairLeft - dPair);
      for (const [idx, n] of deltas) c[idx] = (c[idx] ?? 0) + n;
      if (v > best) best = v;
    };

    // Discard this tile: it contributes nothing.
    take([[i, 1]], 0, 0, 0);

    // Complete pung.
    if (setsLeft > 0 && (c[i] ?? 0) >= 3) take([[i, 3]], 3, 1, 0);

    // Complete chow.
    if (chowable && setsLeft > 0 && off <= 6 &&
        allowed(i + 1) && allowed(i + 2) && (c[i + 1] ?? 0) > 0 && (c[i + 2] ?? 0) > 0) {
      take([[i, 1], [i + 1, 1], [i + 2, 1]], 3, 1, 0);
    }

    // The hand's pair.
    if (pairLeft > 0 && (c[i] ?? 0) >= 2) take([[i, 2]], 2, 0, 1);

    // Part-set: two of a kind heading for a pung.
    if (setsLeft > 0 && (c[i] ?? 0) >= 2) take([[i, 2]], 2, 1, 0);

    // Part-set: two tiles inside a chow window (adjacent, or with a gap).
    if (chowable && setsLeft > 0 && off <= 7 && allowed(i + 1) && (c[i + 1] ?? 0) > 0) {
      take([[i, 1], [i + 1, 1]], 2, 1, 0);
    }
    if (chowable && setsLeft > 0 && off <= 6 && allowed(i + 2) && (c[i + 2] ?? 0) > 0) {
      take([[i, 1], [i + 2, 1]], 2, 1, 0);
    }

    // Part-set: a lone tile earmarked for a set.
    if (setsLeft > 0) take([[i, 1]], 1, 1, 0);

    // A lone tile earmarked for the pair.
    if (pairLeft > 0) take([[i, 1]], 1, 0, 1);

    memo.set(key, best);
    return best;
  }

  return Math.min(cap, search(0, opts.setsNeeded, opts.needPair ? 1 : 0));
}

/**
 * `standardUsable` restricted to one suit (optionally plus the honours).
 * Convenience wrapper: the one-suit hands all need this mask.
 */
export function usableInSuit(
  counts: readonly number[],
  suit: Suit,
  opts: Omit<UsableOptions, 'allowed'>,
  withHonours = false,
): number {
  const base = SUIT_BASE[suit];
  return standardUsable(counts, {
    ...opts,
    allowed: i => (i >= base && i < base + 9) || (withHonours && i >= 27),
  });
}

/** Tile kinds a tile list holds, once per copy. Handy for building `keep` lists. */
export function keysOf(tiles: readonly Tile[]): TileKey[] {
  return tiles.map(tileKey);
}
