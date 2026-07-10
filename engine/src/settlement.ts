/**
 * Todo F -- Traditional paying system (settlement between players).
 *
 * Pure arithmetic: given each seat's hand score for a completed hand, work out
 * who pays whom. No UI, no engine state, no side effects.
 *
 * The rules, as settled with Adam (2026-07-09):
 *
 *  1. Each of the three losers pays the WINNER the winner's hand score.
 *     (Not the difference -- the winner's full score, from each of them.)
 *  2. The losers then settle among THEMSELVES: for every pair of losers, the
 *     lower-scoring one pays the higher-scoring one the difference between
 *     their two hand scores.
 *  3. EAST pays and receives DOUBLE on every payment it is a party to --
 *     including the loser-to-loser leg, and including when East is the winner.
 *  4. The player who discarded the winning tile carries NO extra liability.
 *     There is no `pao` / "discarder pays for all" rule here; they are an
 *     ordinary loser. (This is why `settleScores` never needs to know who the
 *     discarder was.)
 *  5. A self-drawn win settles exactly like a claimed win -- no multiplier and
 *     no flat bonus. (Likewise: `settleScores` never needs to know.)
 *  6. The table limit caps the HAND SCORE only (that cap is applied upstream,
 *     in scoring.ts). It does not cap an individual payment, so East's
 *     doubling may legitimately carry one payment above the limit.
 *
 * Because every payment is recorded as a single from/to transfer of one
 * amount, the per-seat deltas necessarily sum to zero -- the doubling is
 * applied to the transfer, not to one side of it. `settleScores` asserts this
 * invariant before returning, so a future change that breaks it fails loudly
 * rather than quietly minting or destroying points.
 *
 * The `'pool'` paying system never calls this: there, each player simply banks
 * their own hand score. See `GameConfig.payingSystem`.
 */

import type { SeatIndex } from './game-state.js';

/**
 * Traditional mode's starting running total for every seat (Adam, 2026-07-10).
 *
 * Pool mode still starts every seat at 0 -- each hand banks its own score
 * directly, so there is nothing to go negative against. Traditional mode
 * moves points *between* players every hand, so starting at 0 meant a player
 * who lost hand 1 was immediately negative, which reads oddly for a running
 * score. 1,000 is an arbitrary but generous stake -- large enough that normal
 * hands don't exhaust it in a short session, and easy to re-tune later if
 * Adam wants a different figure after more live play.
 */
export const TRADITIONAL_STARTING_STAKE = 1000;

/** Which rule produced a payment; used to group the score-panel display. */
export type PaymentReason = 'to-winner' | 'between-losers';

/** A single transfer of points from one seat to another. */
export interface Payment {
  readonly from:    SeatIndex;
  readonly to:      SeatIndex;
  /** The payment before East's doubling. */
  readonly base:    number;
  /** What actually changes hands: `base`, doubled if East is a party. */
  readonly amount:  number;
  /** True when East is the payer or the payee (and so `amount === base * 2`). */
  readonly doubled: boolean;
  readonly reason:  PaymentReason;
}

export interface SettlementInput {
  /**
   * Each seat's hand score for this hand, indexed by seat.
   *
   * The winner's entry is their winning-hand total (plus bonus tiles, unless
   * it was a limit hand); every other seat's is their exposed-meld + concealed
   * + bonus total. Both call sites (the local HAND_OVER effect and the
   * server's computeHandScore) already compute exactly these numbers for the
   * running totals, so they are passed straight through.
   */
  readonly handScores:  readonly number[];
  readonly winnerSeat:  SeatIndex;
  readonly playerCount: number;
  /**
   * The seat holding the East wind this hand. Defaults to 0, which is always
   * East by construction (`createGameState` assigns seat 0 the east wind, and
   * Todo A's rotation rotates which *player* sits there, not which seat index
   * is East).
   */
  readonly eastSeat?:   SeatIndex;
}

export interface SettlementResult {
  /** Every transfer, in display order: to-winner first, then between-losers. */
  readonly payments: readonly Payment[];
  /** Net change per seat. Sums to exactly zero. */
  readonly deltas:   readonly number[];
}

/**
 * Work out the traditional settlement for a completed, won hand.
 *
 * Throws if `winnerSeat` is out of range for `playerCount`. A hand that ended
 * in a draw has no winner and must not be passed here -- callers skip
 * settlement entirely, exactly as they already skip scoring.
 */
export function settleScores(input: SettlementInput): SettlementResult {
  const { handScores, winnerSeat, playerCount } = input;
  const eastSeat = input.eastSeat ?? (0 as SeatIndex);

  if (winnerSeat < 0 || winnerSeat >= playerCount) {
    throw new Error(
      `settleScores: winnerSeat ${winnerSeat} out of range for ${playerCount} players`,
    );
  }

  const deltas: number[] = Array(playerCount).fill(0);
  const payments: Payment[] = [];

  const scoreOf = (seat: number): number => handScores[seat] ?? 0;

  /**
   * Record one transfer. `base` is the pre-doubling amount; East's presence on
   * either side doubles the whole transfer, so both deltas move by the same
   * figure and the sum stays zero.
   *
   * Non-positive payments are dropped: a zero difference between two equally
   * scoring losers is not a payment, and a negative one would mean the caller
   * got the direction backwards.
   */
  const pay = (from: SeatIndex, to: SeatIndex, base: number, reason: PaymentReason): void => {
    if (base <= 0) return;
    const doubled = from === eastSeat || to === eastSeat;
    const amount  = doubled ? base * 2 : base;
    payments.push({ from, to, base, amount, doubled, reason });
    deltas[from] = (deltas[from] ?? 0) - amount;
    deltas[to]   = (deltas[to]   ?? 0) + amount;
  };

  const losers: SeatIndex[] = [];
  for (let s = 0; s < playerCount; s++) {
    if (s !== winnerSeat) losers.push(s as SeatIndex);
  }

  // (1) Every loser pays the winner the winner's hand score.
  const winnerScore = scoreOf(winnerSeat);
  for (const loser of losers) {
    pay(loser, winnerSeat, winnerScore, 'to-winner');
  }

  // (2) The losers settle the differences between their own hand scores.
  //     Each unordered pair settles once; the lower score pays the higher.
  for (let i = 0; i < losers.length; i++) {
    for (let j = i + 1; j < losers.length; j++) {
      const a = losers[i]!;
      const b = losers[j]!;
      const diff = scoreOf(a) - scoreOf(b);
      if (diff > 0)      pay(b, a,  diff, 'between-losers');
      else if (diff < 0) pay(a, b, -diff, 'between-losers');
    }
  }

  // (3) Zero-sum invariant. Points are only ever transferred, never created.
  const sum = deltas.reduce((acc, d) => acc + d, 0);
  if (sum !== 0) {
    throw new Error(`settleScores: deltas do not sum to zero (got ${sum})`);
  }

  return { payments, deltas };
}
