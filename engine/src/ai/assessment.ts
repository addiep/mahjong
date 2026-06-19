/**
 * Module 4.2 -- AI Hand Assessment (the plan)
 *
 * Pure functions that look at a seat's own hand (plus public table signals) and
 * produce a HandPlan: which suit to collect, whether to play clean or dirty, and
 * (later, Module 4.6) whether to chase a special hand.
 *
 * This is the layer where the AI's cleverness lives. The action layer
 * (discard.ts / claims.ts) just reads the plan. The plan is re-assessed every
 * turn rather than fixed at the deal, so it can switch mid-hand. The clean->dirty
 * switch is sticky: once dirty, a hand stays dirty.
 *
 * Reads only the seat's own hand and public information (exposed melds, discards
 * via the inference engine). Never inspects opponents' concealed tiles.
 *
 * Dependencies: tiles.ts, game-state.ts, inference.ts. No UI, no side effects.
 */

import {
  Suit, Wind, Tile, SuitedTile,
  isSuited, isWind, isDragon, tileKey, SUITS,
} from '../tiles.js';
import { GameState, SeatIndex } from '../game-state.js';
import { TableInference } from '../inference.js';

export type AiMode = 'clean' | 'dirty';

/** The per-turn plan that drives an AI seat's discards and claims. */
export interface HandPlan {
  readonly seat:       SeatIndex;
  readonly mode:       AiMode;
  /** The suit the AI is collecting; null in dirty mode (build in any suit). */
  readonly targetSuit: Suit | null;
  /** The AI's own seat wind (kept like a dragon, since its pung doubles). */
  readonly seatWind:   Wind;
  /** Special-hand targeting is disabled in the baseline (Module 4.6). */
  readonly special:    false;
  /** Per-suit usefulness scores, for tests and the hint panel. */
  readonly suitScores: Readonly<Record<Suit, number>>;
}

/**
 * After this many of the AI's own discard turns, if the hand is still hard to
 * clean, switch to a dirty hand and build melds fastest. Hard-coded for the
 * baseline; tunable (DESIGN Module 4.2 / Decisions Log 2026-06-19).
 */
export const DIRTY_SWITCH_TURN = 5;

// --- Weights (tunable) -----
const W = {
  tile:      1,   // each concealed tile in a suit
  pair:      2,   // a pair (two of a kind)
  triplet:   4,   // a concealed triplet (would-be pung)
  adjacency: 1,   // two tiles that could become a chow
  meldTile:  2,   // each tile of an exposed meld in the suit (3 tiles = +6)
  unpopular: 2,   // a suit no opponent appears to be collecting
} as const;

interface SuitStats {
  count:     number;  // concealed suited tiles in this suit
  pairs:     number;
  triplets:  number;
  adjacency: number;
  meldTiles: number;  // tiles of exposed melds in this suit
}

function emptyStats(): SuitStats {
  return { count: 0, pairs: 0, triplets: 0, adjacency: 0, meldTiles: 0 };
}

/** Count concealed tiles by their kind key. */
function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t) as string;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Per-suit statistics over a seat's concealed tiles and exposed melds. */
function suitStatsFor(state: GameState, seat: SeatIndex): Record<Suit, SuitStats> {
  const stats: Record<Suit, SuitStats> = {
    bamboo:     emptyStats(),
    characters: emptyStats(),
    circles:    emptyStats(),
  };
  const player = state.players[seat]!;

  // Per-suit value presence for pairs / triplets / adjacency.
  for (const suit of SUITS) {
    const valueCounts = new Map<number, number>();
    for (const t of player.concealed) {
      if (isSuited(t) && (t as SuitedTile).suit === suit) {
        const v = (t as SuitedTile).value;
        valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
        stats[suit].count += 1;
      }
    }
    for (const [, c] of valueCounts) {
      if (c >= 3) stats[suit].triplets += 1;
      else if (c === 2) stats[suit].pairs += 1;
    }
    for (let v = 1; v <= 9; v++) {
      if (!valueCounts.has(v)) continue;
      if (valueCounts.has(v + 1)) stats[suit].adjacency += 1;       // run partner
      else if (valueCounts.has(v + 2)) stats[suit].adjacency += 1;  // gap partner
    }
  }

  // Exposed melds (chows / pungs / kongs) in a suit strongly confirm it.
  for (const meld of player.melds) {
    const first = meld.tiles[0];
    if (first && isSuited(first)) {
      stats[(first as SuitedTile).suit].meldTiles += meld.tiles.length;
    }
  }

  return stats;
}

function scoreSuit(s: SuitStats): number {
  return (
    s.count     * W.tile +
    s.pairs     * W.pair +
    s.triplets  * W.triplet +
    s.adjacency * W.adjacency +
    s.meldTiles * W.meldTile
  );
}

/** Suits that at least one opponent appears to be collecting (clean suited target). */
function popularSuits(inference: TableInference | undefined, seat: SeatIndex): Set<Suit> {
  const popular = new Set<Suit>();
  if (!inference) return popular;
  for (const p of inference.players) {
    if (p.seat === seat) continue;
    for (const g of p.topGuesses) {
      if (g.kind === 'bamboo' || g.kind === 'characters' || g.kind === 'circles') {
        popular.add(g.kind);
      }
    }
  }
  return popular;
}

/**
 * Assess a seat's hand and produce its plan.
 *
 * @param prevMode    the seat's mode last turn (sticky: 'dirty' stays 'dirty').
 * @param turnsTaken  how many discard turns this seat has had this hand.
 * @param inference   optional table inference, used only to lean toward a suit
 *                    opponents are not collecting (easier tiles to claim).
 */
export function assessHand(
  state:      GameState,
  seat:       SeatIndex,
  prevMode:   AiMode,
  turnsTaken: number,
  inference?: TableInference,
): HandPlan {
  const player = state.players[seat]!;
  const stats  = suitStatsFor(state, seat);
  const unpopularBonus = (suit: Suit) =>
    popularSuits(inference, seat).has(suit) ? 0 : W.unpopular;

  const suitScores: Record<Suit, number> = {
    bamboo:     scoreSuit(stats.bamboo)     + (stats.bamboo.count     > 0 ? unpopularBonus('bamboo')     : 0),
    characters: scoreSuit(stats.characters) + (stats.characters.count > 0 ? unpopularBonus('characters') : 0),
    circles:    scoreSuit(stats.circles)    + (stats.circles.count    > 0 ? unpopularBonus('circles')    : 0),
  };

  // Target suit = highest score among suits we actually hold/meld.
  let targetSuit: Suit | null = null;
  let best = -1;
  for (const suit of SUITS) {
    const present = stats[suit].count > 0 || stats[suit].meldTiles > 0;
    if (present && suitScores[suit] > best) {
      best = suitScores[suit];
      targetSuit = suit;
    }
  }

  // Mode: sticky dirty; otherwise clean until the turn-5 hard-to-clean switch.
  let mode: AiMode = 'clean';
  if (prevMode === 'dirty') {
    mode = 'dirty';
  } else if (turnsTaken >= DIRTY_SWITCH_TURN && targetSuit !== null) {
    const onTarget  = stats[targetSuit].count;
    const offTarget = SUITS.reduce((sum, s) => sum + (s === targetSuit ? 0 : stats[s].count), 0);
    if (offTarget > onTarget) mode = 'dirty';  // still more off-suit than target -> hard to clean
  }

  return {
    seat,
    mode,
    targetSuit: mode === 'dirty' ? null : targetSuit,
    seatWind:   player.seatWind,
    special:    false,
    suitScores,
  };
}

/** True if a tile would belong in / advance the given plan (used by the action layer). */
export function tileFitsPlan(tile: Tile, plan: HandPlan): boolean {
  if (isDragon(tile)) return true;
  if (isWind(tile))   return tile.wind === plan.seatWind;  // own wind only
  if (isSuited(tile)) {
    if (plan.mode === 'dirty') return true;
    return (tile as SuitedTile).suit === plan.targetSuit;
  }
  return false;
}

/** Count concealed copies of a tile's kind. Exported for the action layer/tests. */
export function concealedCountOf(concealed: readonly Tile[], tile: Tile): number {
  return countByKey(concealed).get(tileKey(tile) as string) ?? 0;
}
