/**
 * Module 4.3 -- AI Action Selection: Discard
 *
 * Given a HandPlan, score every concealed tile by how much it helps the plan
 * and discard the least useful one.
 *
 * Ordering rule (Adam, 2026-06-19): clean the hand FIRST. In clean mode the
 * off-suit suited tiles are shed before guest (non-seat) winds -- you commit to
 * your suit, then ditch the winds. Guest winds are still shed reasonably early
 * (right after the off-suit junk, before any in-target tile), which keeps the
 * "throw winds early so nobody pungs them" benefit without throwing them before
 * the hand is clean. In DIRTY mode there is no off-suit to clean, so guest winds
 * are the first to go. Dragons and the AI's own seat wind are always kept (both
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
// Tuned so that, in clean mode, the discard order from first to last is:
//   off-suit single -> off-suit pair -> guest wind -> guest wind pair ->
//   in-target terminal -> in-target simple -> in-target run -> dragon/own wind
//   -> in-target pair -> dragon/own-wind pair -> any triplet.
const KEEP = {
  offSuit:            1,   // suited, wrong suit (clean mode): shed first to clean up
  offSuitPair:        2,
  guestWindClean:     3,   // a non-seat wind, clean mode: shed after the off-suit junk
  guestWindCleanPair: 4,
  guestWindDirty:     1,   // dirty mode: no suit to clean, so winds go first
  guestWindDirtyPair: 4,
  inTerminal:         5,   // isolated in-target terminal (fewer chow options)
  inIsolated:         6,   // isolated in-target simple
  inRun:              7,   // part of a chow shape
  dragon:             8,   // lone dragon: worth holding for a pair/pung
  ownWind:            8,   // lone own seat wind: same, its pung doubles
  inPair:             9,
  dragonPair:         11,
  ownWindPair:        11,
  honourTriplet:      12,
  inTriplet:          12,
} as const;

function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t) as string;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Per-suit value-presence set, for detecting chow (run) shapes. */
function valueSet(tiles: readonly Tile[], suit: string): Set<number> {
  const s = new Set<number>();
  for (const t of tiles) {
    if (isSuited(t) && (t as SuitedTile).suit === suit) s.add((t as SuitedTile).value);
  }
  return s;
}

/** How useful is this tile to the plan? Higher = keep. */
export function keepValue(tile: Tile, plan: HandPlan, concealed: readonly Tile[]): number {
  const counts = countByKey(concealed);
  const c = counts.get(tileKey(tile) as string) ?? 0;

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
    if (!inPlan) return c >= 2 ? KEEP.offSuitPair : KEEP.offSuit;
    if (c >= 3) return KEEP.inTriplet;
    if (c === 2) return KEEP.inPair;
    const vs = valueSet(concealed, st.suit);
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
