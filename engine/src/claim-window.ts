/**
 * Module 1.5 — Claim Window Logic
 *
 * Pure functions for validating and resolving claims during CLAIM_WINDOW phase.
 *
 * Exported functions:
 *   canPung(concealed, discard)       — player holds 2+ matching tiles.
 *   canKong(concealed, discard)       — player holds 3+ matching tiles.
 *   canChow(concealed, discard)       — player holds 2 tiles forming a valid chow.
 *   validateClaimDecision(...)        — returns an error string, or null if valid.
 *   selectWinClaimant(...)            — picks winner from simultaneous win claims.
 *
 * This module is used by:
 *   - Module 1.4 (Turn Engine) — to validate CLAIM_RESPONSE actions and
 *     resolve simultaneous win claims.
 *
 * Win validation (can a given hand actually win?) is deferred to Module 1.7
 * (Hand Evaluator). Win claims are accepted structurally here; the hand
 * evaluator performs the real check.
 *
 * Dependencies: tiles.ts, meld-validator.ts, game-state.ts
 * No UI dependencies. No side effects.
 */

import { Tile, SuitedTile, isSuited, tileKey } from './tiles.js';
import { isChow } from './meld-validator.js';
import { ClaimDecision, SeatIndex } from './game-state.js';

// ─── Capability helpers ────────────────────────────────────────────

/**
 * Returns true if the concealed hand contains at least two tiles matching the
 * discard (i.e. the player can form a pung with the discarded tile).
 */
export function canPung(concealed: readonly Tile[], discard: Tile): boolean {
  const key = tileKey(discard);
  return concealed.filter(t => tileKey(t) === key).length >= 2;
}

/**
 * Returns true if the concealed hand contains at least three tiles matching
 * the discard (i.e. the player can form a kong with the discarded tile).
 */
export function canKong(concealed: readonly Tile[], discard: Tile): boolean {
  const key = tileKey(discard);
  return concealed.filter(t => tileKey(t) === key).length >= 3;
}

/**
 * Returns true if the concealed hand contains at least two tiles that, together
 * with the discard, form a valid chow.
 *
 * Honours (winds, dragons, bonus tiles) can never form a chow, so this returns
 * false immediately for non-suited discards.
 *
 * Given a suited discard at value V in suit S, the three possible chow patterns
 * (expressed as the two partner values the hand must supply) are:
 *
 *   (V-2, V-1)  — discard is the high tile of the sequence
 *   (V-1, V+1)  — discard is the middle tile of the sequence
 *   (V+1, V+2)  — discard is the low tile of the sequence
 *
 * Patterns whose partner values fall outside 1–9 are skipped. For each
 * remaining pattern we check that the hand contains at least one tile of each
 * partner value in suit S. Because the two values are always different
 * (consecutive integers), separate per-value counts are sufficient — no risk
 * of the same physical tile being counted twice.
 */
export function canChow(concealed: readonly Tile[], discard: Tile): boolean {
  if (!isSuited(discard)) return false;
  const d = discard as SuitedTile;

  const patterns: [number, number][] = [
    [d.value - 2, d.value - 1],
    [d.value - 1, d.value + 1],
    [d.value + 1, d.value + 2],
  ];

  for (const [v1, v2] of patterns) {
    if (v1 < 1 || v2 > 9) continue;
    const suit = d.suit;
    const has1 = concealed.some(
      t => isSuited(t) && (t as SuitedTile).suit === suit && (t as SuitedTile).value === v1,
    );
    const has2 = concealed.some(
      t => isSuited(t) && (t as SuitedTile).suit === suit && (t as SuitedTile).value === v2,
    );
    if (has1 && has2) return true;
  }
  return false;
}

// ─── Claim validation ──────────────────────────────────────────

/**
 * Validates a player's ClaimDecision during CLAIM_WINDOW.
 *
 * @param decision      - the player's proposed claim.
 * @param concealed     - the claimer's concealed hand tiles.
 * @param discard       - the tile currently available to claim.
 * @param claimerSeat   - the seat making the claim.
 * @param discarderSeat - the seat that discarded.
 * @param playerCount   - total number of players.
 *
 * Returns null if the claim is structurally valid, or a descriptive error
 * string if it is not.
 *
 * Note: win validation is deferred to Module 1.7. A 'win' decision always
 * passes structural validation here.
 */
export function validateClaimDecision(
  decision:      ClaimDecision,
  concealed:     readonly Tile[],
  discard:       Tile,
  claimerSeat:   SeatIndex,
  discarderSeat: SeatIndex,
  playerCount:   number,
): string | null {
  switch (decision.type) {

    case 'pass':
      return null;

    case 'win':
      // Full hand validation deferred to Module 1.7 (Hand Evaluator).
      return null;

    case 'pung': {
      const count = concealed.filter(t => tileKey(t) === tileKey(discard)).length;
      if (count < 2) {
        return (
          `pung: need 2 matching tiles in hand for ${tileKey(discard)}, found ${count}`
        );
      }
      return null;
    }

    case 'kong': {
      const count = concealed.filter(t => tileKey(t) === tileKey(discard)).length;
      if (count < 3) {
        return (
          `kong: need 3 matching tiles in hand for ${tileKey(discard)}, found ${count}`
        );
      }
      return null;
    }

    case 'chow': {
      // Only the player immediately next in turn order may chow.
      const leftSeat = ((discarderSeat + 1) % playerCount) as SeatIndex;
      if (claimerSeat !== leftSeat) {
        return (
          `chow: only seat ${leftSeat} (left of discarder at seat ${discarderSeat}) may chow`
        );
      }
      if (!decision.chowTiles) {
        return 'chow: chowTiles must be provided';
      }
      const [id1, id2] = decision.chowTiles;
      if (id1 === id2) {
        return 'chow: chowTiles must reference two distinct tiles';
      }
      const t1 = concealed.find(t => t.id === id1);
      const t2 = concealed.find(t => t.id === id2);
      if (!t1) return `chow: tile "${id1}" not found in concealed hand`;
      if (!t2) return `chow: tile "${id2}" not found in concealed hand`;
      if (!isChow([t1, t2, discard])) {
        return (
          `chow: [${tileKey(t1)}, ${tileKey(t2)}, ${tileKey(discard)}] is not a valid chow`
        );
      }
      return null;
    }

    default: {
      const _exhaustive: never = decision.type;
      return `unknown claim type "${(decision as { type: string }).type}"`;
    }
  }
}

// ─── Simultaneous win resolution (OQ-3) ──────────────────────────────────

/**
 * Given multiple simultaneous win claims on the same discard, returns the seat
 * of the player whose turn comes soonest after the discarder.
 *
 * Play order runs through increasing seat indices (mod playerCount), so
 * "soonest" means the smallest positive offset from the discarder's seat index.
 *
 * Example (4 players, discarder = seat 2, claimants = seats 0 and 3):
 *   offset of seat 3: (3 - 2 + 4) % 4 = 1  <- wins
 *   offset of seat 0: (0 - 2 + 4) % 4 = 2
 *   -> seat 3 is awarded the win.
 *
 * Throws if the candidates array is empty.
 */
export function selectWinClaimant(
  winSeats:      SeatIndex[],
  discarderSeat: SeatIndex,
  playerCount:   number,
): SeatIndex {
  if (winSeats.length === 0) {
    throw new Error('selectWinClaimant: candidates array must not be empty');
  }
  return winSeats.reduce((best, s) => {
    const dS    = (s    - discarderSeat + playerCount) % playerCount;
    const dBest = (best - discarderSeat + playerCount) % playerCount;
    return dS < dBest ? s : best;
  });
}
