/**
 * Module 1.9 — Flower / Season Scoring
 *
 * Bonus-tile scoring at the end of a hand: a flat number of points (4 by
 * default) for every flower or season a player has set aside. This applies to
 * *every* player, not just the winner — anyone holding bonus tiles banks the
 * points when the hand ends.
 *
 * Per OQ-2 (resolved) there is no own-flower distinction and no own-flower
 * doubling: each flower and each season is worth the same flat amount, and the
 * player's seat is irrelevant. The complete-set-of-flowers / complete-set-of-
 * seasons *doublings* are not handled here — those belong to the hand's
 * doublings tally and are applied by Module 1.8 (`scoreWinningHand`). This
 * module owns only the flat per-tile points.
 *
 * Pure function of its inputs. No UI dependencies, no side effects. The flat
 * value lives in scoring-config.ts (`flowerOrSeason`).
 *
 * Dependencies: tiles.ts, scoring-config.ts.
 */

import { Tile, isFlower, isSeason } from './tiles.js';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from './scoring-config.js';

export interface BonusScoreResult {
  /** Flat total: (flowers + seasons) × the per-tile value. */
  readonly points:      number;
  /** Number of flower bonus tiles. */
  readonly flowerCount: number;
  /** Number of season bonus tiles. */
  readonly seasonCount: number;
  /** Total bonus tiles scored (flowers + seasons). */
  readonly count:       number;
}

/**
 * Scores a player's bonus tiles. Non-bonus tiles are ignored defensively, so
 * callers may pass a whole hand or just the set-aside `bonusTiles` list.
 *
 * `scoringConfig` defaults to the family table; pass a custom one to retune the
 * per-tile value.
 */
export function scoreBonusTiles(
  bonusTiles: readonly Tile[],
  scoringConfig: ScoringConfig = DEFAULT_SCORING_CONFIG,
): BonusScoreResult {
  let flowerCount = 0;
  let seasonCount = 0;
  for (const t of bonusTiles) {
    if (isFlower(t)) flowerCount++;
    else if (isSeason(t)) seasonCount++;
  }
  const count = flowerCount + seasonCount;
  return {
    points: count * scoringConfig.flowerOrSeason,
    flowerCount,
    seasonCount,
    count,
  };
}
