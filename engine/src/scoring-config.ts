/**
 * Module 1.8 — Scoring Configuration
 *
 * The points table for the scoring engine, kept in a single config object so
 * the family can adjust values without touching scoring logic (DESIGN.md §5,
 * "Scoring config in a JSON/TS file, not hardcoded").
 *
 * Every value here is sourced from DESIGN.md §1 "Scoring System". Doublings are
 * expressed as a *count* of doublings (each doubling multiplies the running
 * total by two), so a "×3" rule in the design contributes 3 doublings (×8).
 *
 * No UI dependencies. No side effects.
 */

/** Flat base points for a single pung or kong, split by tile rank. */
export interface MeldPoints {
  /** Simples (suited 2–8). */
  readonly minor: number;
  /** Terminals (1 or 9) or honours (Winds / Dragons). */
  readonly major: number;
}

export interface ScoringConfig {
  // ── Base points per meld (DESIGN.md §1) ──
  readonly exposedPung:    MeldPoints;   // 2 / 4
  readonly concealedPung:  MeldPoints;   // 4 / 8
  readonly exposedKong:    MeldPoints;   // 8 / 16
  readonly concealedKong:  MeldPoints;   // 16 / 32
  /** Pair of a Dragon or the player's seat Wind. */
  readonly scoringPair:    number;       // 2
  /** Flat points per flower or season bonus tile (Module 1.9). */
  readonly flowerOrSeason: number;       // 4

  // ── Going Mah-Jong bonuses (winner only, flat, added before doublings) ──
  readonly goingMahjong:     number;     // 20
  readonly winFromLiveWall:  number;     // +2  (winning tile self-drawn from the live wall)
  readonly noChows:          number;     // +10 (hand contains no chows)

  // ── Limit (agreed maximum payout) and special-hand fixed scores ──
  /** The agreed maximum payout; also the cap on any single hand. */
  readonly limit:                  number; // 1000
  /** Double-limit hands (currently only Unique Wonder). */
  readonly doubleLimit:            number; // 2000
  /** Half-limit hands (Clean Pairs, Crocheting). */
  readonly halfLimit:              number; // 500
  readonly buriedTreasure:         number; // 1000
  readonly buriedTreasureFishing:  number; // 400
  readonly allPairsHonours:        number; // 500
  readonly allPairsHonoursFishing: number; // 200
}

/**
 * Default scoring table from DESIGN.md §1, with the family limit set to 1,000
 * (half-limit 500). The limit doubles as the table-wide cap on any single hand.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  exposedPung:    { minor: 2,  major: 4  },
  concealedPung:  { minor: 4,  major: 8  },
  exposedKong:    { minor: 8,  major: 16 },
  concealedKong:  { minor: 16, major: 32 },
  scoringPair:    2,
  flowerOrSeason: 4,

  goingMahjong:     20,
  winFromLiveWall:  2,
  noChows:          10,

  limit:                  1000,
  doubleLimit:            2000,
  halfLimit:              500,
  buriedTreasure:         1000,
  buriedTreasureFishing:  400,
  allPairsHonours:        500,
  allPairsHonoursFishing: 200,
};
