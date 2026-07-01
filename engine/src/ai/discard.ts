/**
 * Module 4.3 -- AI Action Selection: Discard
 *
 * Given a HandPlan, score every concealed tile by how much it helps the plan
 * and discard the least useful one.
 *
 * Ordering rule (Adam, 2026-06-19): clean the hand FIRST. In clean mode the
 * off-suit suited tiles are shed before guest (non-seat) winds -- you commit to
 * your suit, then ditch the winds. Among off-suit tiles, tiles forming pairs or
 * genuine run shapes are held longer than isolated tiles; within each shape tier
 * the weakest suit by count goes first (a 2-tile suit before a 4-tile one).
 * Committed triplets (3+ of the same tile) are excluded from run-partner
 * detection so a tile adjacent only to a pung/kong is not falsely ranked as
 * part of a chow shape. Guest winds are shed after all off-suit suited tiles in
 * clean mode. In DIRTY mode there is no off-suit to clean, so guest winds are
 * the first to go. Dragons and the AI's own seat wind are always kept (both
 * double on a pung).
 *
 * A later pass will overlay the inference safe-tile reads for defensive play
 * (DESIGN Module 4.3). The baseline plays to its own hand only.
 *
 * Dependencies: tiles.ts, game-state.ts, assessment.ts. No UI, no side effects.
 */

import {
  Tile, TileId, SuitedTile,
  isSuited, isWind, isDragon, isTerminal, tileKey,
} from '../tiles.js';
import { GameState, SeatIndex } from '../game-state.js';
import { HandPlan } from './assessment.js';

// --- Keep-values (higher = more useful = keep; lowest is discarded) -----
//
// Off-suit suited tiles (clean mode only -- in dirty mode all suited tiles are
// in-plan so these values are never reached for suited tiles):
//   offSuitLone    -- 1 tile of this suit held: scraps, shed immediately
//   offSuitWeak    -- 2 tiles, no pair, no run: a thin holding
//   offSuitStrong  -- 3+ tiles, no pair, no run: a developed suit, but not shaped
//   offSuitRun     -- tile with a genuine adjacent/gap-2 run partner in its suit
//   offSuitPair    -- tile held in pairs (c >= 2): worth keeping for a declared meld
//
// Guest winds come after ALL off-suit suited tiles in clean mode.
// In-plan tiles come last (highest keep values).
const KEEP = {
  offSuitLone:        1,
  offSuitWeak:        2,
  offSuitStrong:      3,
  offSuitRun:         4,   // off-suit tile with a genuine run partner
  offSuitPair:        5,   // off-suit tile forming a pair or better
  guestWindClean:     6,   // non-seat wind, clean mode -- shed after all off-suit junk
  guestWindCleanPair: 7,
  guestWindDirty:     1,   // dirty mode -- no suit to clean; winds go first
  guestWindDirtyPair: 4,
  inTerminal:         8,   // isolated in-plan terminal (1 or 9: fewer chow options)
  inIsolated:         9,   // isolated in-plan simple tile
  inRun:             10,   // part of a genuine chow shape
  dragon:            11,   // lone dragon: worth holding for a pair/pung
  ownWind:           11,   // lone own seat wind: its pung doubles
  inPair:            12,
  dragonPair:        14,
  ownWindPair:       14,
  honourTriplet:     15,
  inTriplet:         15,
} as const;

// --- Special-hand keep-value override (Module 4.6) -----
//
// When the plan carries a committed special target, its keep set (one entry
// per copy needed) overrides the normal keep-values entirely: needed copies
// rank far above everything (SPECIAL_KEEP), spare copies of a needed kind
// rank above the ordinary junk ordering (SPECIAL_SPARE) so genuine offenders
// are shed first, and tiles the target does not use fall through to the
// normal ordering (all of which sits below SPECIAL_SPARE).
const SPECIAL_KEEP  = 100;
const SPECIAL_SPARE = 50;

function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t) as string;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * Per-suit value-presence set for detecting run (chow) shapes.
 * Excludes values where count >= 3 so that a tile adjacent only to a committed
 * triplet (pung / kong) is not treated as having a genuine chow partner.
 */
function runValueSet(
  tiles: readonly Tile[],
  suit: string,
  counts: Map<string, number>,
): Set<number> {
  const s = new Set<number>();
  for (const t of tiles) {
    if (isSuited(t) && (t as SuitedTile).suit === suit) {
      if ((counts.get(tileKey(t) as string) ?? 0) < 3) {
        s.add((t as SuitedTile).value);
      }
    }
  }
  return s;
}

/** How useful is this tile to the plan? Higher = keep. */
export function keepValue(tile: Tile, plan: HandPlan, concealed: readonly Tile[]): number {
  const counts = countByKey(concealed);
  const c = counts.get(tileKey(tile) as string) ?? 0;

  if (plan.special) {
    const key = tileKey(tile);
    let needed = 0;
    for (const k of plan.special.keep) if (k === key) needed += 1;
    if (needed > 0) return c <= needed ? SPECIAL_KEEP : SPECIAL_SPARE;
    // Not part of the target: fall through to the normal ordering (junk first).
  }

  if (isDragon(tile)) return c >= 3 ? KEEP.honourTriplet : c >= 2 ? KEEP.dragonPair : KEEP.dragon;

  if (isWind(tile)) {
    if (c >= 3) return KEEP.honourTriplet;
    if (tile.wind === plan.seatWind) return c >= 2 ? KEEP.ownWindPair : KEEP.ownWind;
    // Guest (non-seat) wind: ordering depends on whether we are cleaning a suit.
    if (plan.mode === 'dirty') return c >= 2 ? KEEP.guestWindDirtyPair : KEEP.guestWindDirty;
    return c >= 2 ? KEEP.guestWindCleanPair : KEEP.guestWindClean;
  }

  if (isSuited(tile)) {
    const st = tile as SuitedTile;
    const inPlan = plan.mode === 'dirty' || st.suit === plan.targetSuit;

    if (!inPlan) {
      // Off-suit in clean mode.
      // 1. A pair (or better) is worth holding -- it can become a declared pung.
      if (c >= 2) return KEEP.offSuitPair;
      // 2. A genuine run shape is worth holding -- exclude triplet values so a
      //    tile adjacent only to a committed pung is not falsely counted.
      const vs = runValueSet(concealed, st.suit, counts);
      const hasOffRun =
        vs.has(st.value - 1) || vs.has(st.value + 1) ||
        vs.has(st.value - 2) || vs.has(st.value + 2);
      if (hasOffRun) return KEEP.offSuitRun;
      // 3. Fallback: rank by how many tiles of this suit we hold.
      //    Shed the weakest (fewest tiles) suit first.
      const suitCount = concealed.filter(
        t => isSuited(t) && (t as SuitedTile).suit === st.suit,
      ).length;
      if (suitCount <= 1) return KEEP.offSuitLone;
      if (suitCount === 2) return KEEP.offSuitWeak;
      return KEEP.offSuitStrong;
    }

    if (c >= 3) return KEEP.inTriplet;
    if (c === 2) return KEEP.inPair;
    // Exclude committed triplets from run detection (bug 3 fix).
    const vs = runValueSet(concealed, st.suit, counts);
    const hasRun =
      vs.has(st.value - 1) || vs.has(st.value + 1) ||
      vs.has(st.value - 2) || vs.has(st.value + 2);
    if (hasRun) return KEEP.inRun;
    return isTerminal(tile) ? KEEP.inTerminal : KEEP.inIsolated;
  }

  return KEEP.inIsolated; // bonus tiles never sit in `concealed`; defensive default
}

/**
 * Choose the tile to discard: the least useful in hand. Deterministic tie-break:
 * lowest keep-value, then prefer the just-drawn tile (mimics drawing a dud and
 * throwing it), then a stable order by tile id.
 */
export function chooseDiscardTile(state: GameState, seat: SeatIndex, plan: HandPlan): TileId {
  const player = state.players[seat]!;
  const hand   = player.concealed;
  if (hand.length === 0) throw new Error('chooseDiscardTile: empty concealed hand');

  const justDrawn = state.lastDrawnTileId;
  let bestId  = hand[0]!.id;
  let bestVal = Number.POSITIVE_INFINITY;
  let bestDrawn = false;

  for (const t of hand) {
    const v = keepValue(t, plan, hand);
    const isDrawn = justDrawn !== undefined && t.id === justDrawn;
    if (
      v < bestVal ||
      (v === bestVal && isDrawn && !bestDrawn) ||
      (v === bestVal && isDrawn === bestDrawn && (t.id as string) < (bestId as string))
    ) {
      bestVal = v;
      bestId = t.id;
      bestDrawn = isDrawn;
    }
  }
  return bestId;
}
