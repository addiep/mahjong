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
 * Defensive overlay (Todo D, 2026-07-02): `chooseDiscardTile` adds a danger
 * penalty on top of the plain `keepValue` score, using the inference engine
 * (Module 5.2) to read what opponents look like they are collecting. See
 * `defensivePenalty` below for the full design; `keepValue` itself stays a
 * pure hand-only function (unit-tested and used standalone elsewhere) and is
 * untouched by this overlay.
 *
 * Dependencies: tiles.ts, game-state.ts, assessment.ts, inference.ts. No UI,
 * no side effects.
 */

import {
  Tile, TileId, SuitedTile,
  isSuited, isWind, isDragon, isHonour, isTerminal, tileKey,
} from '../tiles.js';
import { GameState, SeatIndex } from '../game-state.js';
import { HandPlan } from './assessment.js';
import { inferTable, Confidence, Closeness, TableInference } from '../inference.js';

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

// --- Defensive overlay (Todo D) -----
//
// `defensivePenalty` reads the inference engine (Module 5.2) and returns a
// bonus added on top of `keepValue`, so a dangerous tile is held a little
// longer and a safer, similarly-useless tile is thrown first instead. It is
// deliberately modest relative to the KEEP scale (max ~5, vs a 1-15 spread
// across many tiers) so it reorders *among* comparably useless tiles rather
// than overriding real hand-building decisions (e.g. it will never outweigh
// keeping a dragon pair to protect a merely-plausible suit read).
//
// Design (2026-07-02, worked through with Adam):
//   1. Per-opponent risk for the tile's kind: how strongly does the inference
//      engine's top-guess for that opponent match this tile (suit-vs-suit, or
//      "honours" for winds/dragons), weighted by the guess's confidence. An
//      un-matched honour still carries a small baseline risk (anyone might be
//      sitting on a pair, not just a player read as "going for honours").
//   2. Seat-relative claim eligibility: a chow can only be claimed by the seat
//      immediately to the discarder's right, so suit-match risk from any other
//      seat is scaled down to roughly its pung/kong share only. Honour risk
//      (pung/kong/pair) applies from every seat equally.
//   3. Per-opponent "already discarded this kind" check: if a specific
//      opponent has themselves thrown this exact tile kind, they evidently do
//      not want it -- risk from that opponent for that tile drops to zero,
//      independent of their general closeness read. This is the direct,
//      tile-level version of "are they holding onto or chucking out winds and
//      dragons" (and works the same way for suits).
//   4. Closeness scaling: the per-opponent risk is scaled by how close that
//      opponent looks to a win (Module 5.2's `closeness.level`, plus a bump
//      for fishing tempo). A "none"/"building" read contributes ~nothing; a
//      "ready" read contributes the full weight.
//   5. Global lateness scaling: independent of any one opponent's exposed
//      melds (which only reflect the *claimed* portion of their hand -- a
//      fully concealed player can be one tile from winning with no melds at
//      all), the whole danger score is scaled by how deep into the wall the
//      hand is (`turnsLeft = wall.live.length / playerCount`, the same figure
//      Module 4.6's special-hand EV already uses). Early on, even a confident
//      read is worth little; late, it is worth its full weight. This is a
//      deliberate hedge against the meld-count blind spot in (4).
//   6. Zeroed entirely for anything already in the inference engine's
//      `safeToDiscard` ('safe' certainty) or `outOfPlay` lists.
//
// The final score is the WORST case across opponents (max, not sum), so a
// tile is not penalised just because several opponents carry weak, unrelated
// reads -- only the single most dangerous opponent matters.

const CONFIDENCE_WEIGHT: Record<Confidence, number> = { low: 0.3, medium: 0.6, high: 1 };
const CLOSENESS_WEIGHT: Record<Closeness['level'], number> = {
  none: 0, building: 0.15, near: 0.6, ready: 1,
};
const FISHING_BONUS = 0.25;

/** Baseline risk for a live, unmatched honour: anyone could be sitting on a pair. */
const BASE_HONOUR_RISK = 0.4;
/** A non-chow-eligible seat can still pung/kong; that is a fraction of full suit risk. */
const PUNG_ONLY_SHARE = 0.5;

/**
 * Turns-left figure below which the hand counts as "late" (mirrors Module 4.6's
 * EV gate). Exported: claims.ts (Todo I) reuses the same figure for its
 * kong-vs-pung-and-hold-back lateness split, rather than inventing a new one.
 */
export const EARLY_GAME_TURNS = 12;
/** Global scale never drops all the way to zero -- a fishing opponent is never fully ignored. */
const MIN_GLOBAL_SCALE = 0.2;

/** Comparable to one KEEP tier -- enough to reorder junk, not override real hand value. */
const DANGER_SCALE = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * How worried should `seat` be about discarding `tile`, worst case across
 * opponents?
 *
 * `table` is an optional pre-computed `inferTable(state)` result. Perf note
 * (external codebase review finding 13, 2026-07-09): `chooseDiscardTile`
 * below calls this once per candidate tile in the hand, and inference does
 * not change mid-decision, so it computes the table once and passes it
 * through here instead of every call re-running the full opponent-modelling
 * scan. Callers that don't have one handy (tests, other call sites) can omit
 * it and this falls back to computing its own, exactly as before.
 */
export function defensivePenalty(
  state: GameState, seat: SeatIndex, tile: Tile, table?: TableInference,
): number {
  if (!isSuited(tile) && !isHonour(tile)) return 0; // bonus tiles: never a claim risk

  const inferred = table ?? inferTable(state);
  const key      = tileKey(tile);
  if (inferred.safeToDiscard.some(s => s.key === key && s.certainty === 'safe')) return 0;
  if (inferred.outOfPlay.some(o => o.key === key)) return 0;

  const log = state.discardLog ?? [];
  const { playerCount } = state.config;
  const nextSeat = ((seat + 1) % playerCount) as SeatIndex;
  const turnsLeft = Math.floor(state.wall.live.length / playerCount);
  const globalScale = clamp(1 - turnsLeft / EARLY_GAME_TURNS, MIN_GLOBAL_SCALE, 1);

  let worst = 0;
  for (const opp of inferred.players) {
    if (opp.seat === seat) continue;

    // This opponent has already thrown this exact kind: they don't want it.
    const alreadyDiscarded = log.some(e => e.seat === opp.seat && tileKey(e.tile) === key);
    if (alreadyDiscarded) continue;

    let riskWeight: number;
    if (isHonour(tile)) {
      const honourGuess = opp.topGuesses.find(g => g.kind === 'honours');
      riskWeight = honourGuess
        ? Math.max(BASE_HONOUR_RISK, CONFIDENCE_WEIGHT[honourGuess.confidence])
        : BASE_HONOUR_RISK;
    } else {
      const suit = (tile as SuitedTile).suit;
      const guess = opp.topGuesses.find(g => g.kind === suit);
      const suitRisk = guess ? CONFIDENCE_WEIGHT[guess.confidence] : 0;
      const isNextSeat = opp.seat === nextSeat;
      riskWeight = isNextSeat ? suitRisk : suitRisk * PUNG_ONLY_SHARE;
    }
    if (riskWeight <= 0) continue;

    const closenessWeight =
      CLOSENESS_WEIGHT[opp.closeness.level] + (opp.closeness.fishing ? FISHING_BONUS : 0);
    const danger = riskWeight * closenessWeight;
    if (danger > worst) worst = danger;
  }

  return worst * globalScale * DANGER_SCALE;
}

/**
 * Choose the tile to discard: the least useful in hand, after the defensive
 * overlay. Deterministic tie-break: lowest combined value, then prefer the
 * just-drawn tile (mimics drawing a dud and throwing it), then a stable order
 * by tile id.
 */
export function chooseDiscardTile(state: GameState, seat: SeatIndex, plan: HandPlan): TileId {
  const player = state.players[seat]!;
  const hand   = player.concealed;
  if (hand.length === 0) throw new Error('chooseDiscardTile: empty concealed hand');

  const justDrawn = state.lastDrawnTileId;
  // Computed once per discard decision, not once per candidate tile -- see
  // defensivePenalty's docstring (review finding 13).
  const table = inferTable(state);
  let bestId  = hand[0]!.id;
  let bestVal = Number.POSITIVE_INFINITY;
  let bestDrawn = false;

  for (const t of hand) {
    const v = keepValue(t, plan, hand) + defensivePenalty(state, seat, t, table);
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
