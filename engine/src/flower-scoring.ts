/**
 * Module 1.9 — Flower / Season Scoring
 *
 * DISPLAY-ONLY since 2026-07-10 (Adam's call). Originally this module's flat
 * per-tile total was what actually credited a player for their bonus tiles --
 * added on top of Module 1.8's hand/meld total, AFTER doubling, via this
 * wholly separate mechanism. Adam asked for flowers/seasons to just be
 * ordinary points within the hand itself ("like a pung of dragons"), so
 * Module 1.8 (`scoreNormalReading` / `scoreExposedMelds`) now folds each
 * bonus tile's flat points into its own base, BEFORE doublings -- meaning a
 * `ScoreResult.total` / `ExposedMeldScoreResult.total` already includes
 * every bonus tile's contribution, correctly doubled alongside everything
 * else.
 *
 * `scoreBonusTiles` still exists purely to drive the score panel's
 * informational "Bonus tiles" breakdown (flowerCount / seasonCount / a flat,
 * undoubled points figure for that display only). Its `points` value must
 * NEVER be added into a hand score, running total, or Todo F settlement
 * input again -- that would double-count what Module 1.8 already folded in.
 * See DESIGN.md Module 1.8/1.9 and Todo F for the full history.
 *
 * The complete-set-of-flowers / complete-set-of-seasons *doublings* were
 * always Module 1.8's job (`scoreWinningHand` / `scoreExposedMelds`) and
 * still are -- unaffected by this change.
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
