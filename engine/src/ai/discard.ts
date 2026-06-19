/**
 * Module 4.3 -- AI Action Selection: Discard
 *
 * Given a HandPlan, score every concealed tile by how much it helps the plan
 * and discard the least useful one. This single mechanism delivers most of the
 * agreed rules: off-suit tiles score low and go early; pairs and runs in the
 * target suit score high and stay; dragons and the AI's own seat wind are kept
 * (both double on a pung); other winds are shed early once the hand is clean.
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
const KEEP = {
  dragon:        8,
  dragonPair:    11,  // a dragon pair: very close to a scoring pung
  ownWind:       8,
  ownWindPair:   11,
  otherWind:     1,   // shed early
  otherWindPair: 4,   // hold briefly in case of a pung
  honourTriplet: 12,
  offSuit:       2,   // suited, wrong suit (clean mode)
  offSuitPair:   3,
  inTriplet:     12,
  inPair:        8,
  inRun:         6,   // part of a chow shape
  inIsolated:    4,
  inTerminal:    3,   // isolated terminal: fewer chow options
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
    const own = tile.wind === plan.seatWind;
    if (c >= 3) return KEEP.honourTriplet;
    if (c === 2) return own ? KEEP.ownWindPair : KEEP.otherWindPair;
    return own ? KEEP.ownWind : KEEP.otherWind;
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
