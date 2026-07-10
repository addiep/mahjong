/**
 * Todo F -- settleScores (traditional paying system).
 *
 * The oracle for every case is the zero-sum invariant plus a hand-worked
 * example. Seat 0 is East throughout unless a test says otherwise.
 */

import { describe, it, expect } from 'vitest';
import { settleScores, TRADITIONAL_STARTING_STAKE, type SeatIndex } from '../index.js';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('TRADITIONAL_STARTING_STAKE', () => {
  it('is 1000, per Adam (2026-07-10)', () => {
    // Guards against a silent rename/retune -- both call sites
    // (server/src/game-session.ts, src/hooks/useLocalGame.ts) import this
    // rather than hardcoding the figure.
    expect(TRADITIONAL_STARTING_STAKE).toBe(1000);
  });
});

describe('settleScores -- basic settlement', () => {
  it('every loser pays the winner the winner\'s hand score', () => {
    // Winner is seat 1 (South, not East). All losers score 0, so there is no
    // between-losers leg. Seat 0 is East, so its payment doubles.
    const { payments, deltas } = settleScores({
      handScores:  [0, 100, 0, 0],
      winnerSeat:  1 as SeatIndex,
      playerCount: 4,
    });

    const toWinner = payments.filter(p => p.reason === 'to-winner');
    expect(toWinner).toHaveLength(3);
    expect(payments.filter(p => p.reason === 'between-losers')).toHaveLength(0);

    // East (seat 0) pays double; West and North pay the plain 100.
    expect(toWinner.find(p => p.from === 0)?.amount).toBe(200);
    expect(toWinner.find(p => p.from === 2)?.amount).toBe(100);
    expect(toWinner.find(p => p.from === 3)?.amount).toBe(100);

    expect(deltas).toEqual([-200, 400, -100, -100]);
    expect(sum(deltas)).toBe(0);
  });

  it('losers settle the differences between their own hand scores', () => {
    // Winner seat 3 (North). Losers: East 0 pts, South 30, West 10.
    // to-winner:  each loser pays 50; East's doubles -> 100.
    // between-losers pairs (0,1), (0,2), (1,2):
    //   0 vs 1: South higher by 30 -> East pays South 30, doubled = 60
    //   0 vs 2: West  higher by 10 -> East pays West  10, doubled = 20
    //   1 vs 2: South higher by 20 -> West pays South 20 (no East, plain)
    const { deltas } = settleScores({
      handScores:  [0, 30, 10, 50],
      winnerSeat:  3 as SeatIndex,
      playerCount: 4,
    });

    // East: -100 (to winner) - 60 - 20 = -180
    // South: -50 (to winner) + 60 + 20 = +30
    // West: -50 (to winner) + 20 - 20 = -50
    // North (winner): +100 + 50 + 50 = +200
    expect(deltas).toEqual([-180, 30, -50, 200]);
    expect(sum(deltas)).toBe(0);
  });

  it('equal loser scores produce no between-losers payment', () => {
    const { payments } = settleScores({
      handScores:  [20, 20, 20, 60],
      winnerSeat:  3 as SeatIndex,
      playerCount: 4,
    });
    expect(payments.filter(p => p.reason === 'between-losers')).toHaveLength(0);
  });

  it('the lower-scoring loser always pays the higher-scoring one', () => {
    const { payments } = settleScores({
      handScores:  [0, 40, 10, 0],
      winnerSeat:  0 as SeatIndex,
      playerCount: 4,
    });
    const between = payments.filter(p => p.reason === 'between-losers');
    // Losers are 1 (40), 2 (10), 3 (0). Higher always receives.
    for (const p of between) {
      expect(p.to).not.toBe(p.from);
    }
    expect(between.find(p => p.from === 2 && p.to === 1)?.base).toBe(30);
    expect(between.find(p => p.from === 3 && p.to === 1)?.base).toBe(40);
    expect(between.find(p => p.from === 3 && p.to === 2)?.base).toBe(10);
  });
});

describe('settleScores -- East doubles', () => {
  it('East receives double from every loser when East wins', () => {
    const { payments, deltas } = settleScores({
      handScores:  [80, 0, 0, 0],
      winnerSeat:  0 as SeatIndex,
      playerCount: 4,
    });
    for (const p of payments) {
      expect(p.doubled).toBe(true);
      expect(p.amount).toBe(160);
    }
    expect(deltas[0]).toBe(480);
    expect(sum(deltas)).toBe(0);
  });

  it('East pays double when East loses', () => {
    const { payments } = settleScores({
      handScores:  [0, 70, 0, 0],
      winnerSeat:  1 as SeatIndex,
      playerCount: 4,
    });
    const eastPayment = payments.find(p => p.from === 0);
    expect(eastPayment?.doubled).toBe(true);
    expect(eastPayment?.base).toBe(70);
    expect(eastPayment?.amount).toBe(140);
  });

  it('East doubles the loser-to-loser leg too, not just payments to the winner', () => {
    // Winner seat 2. Losers East (0 pts), South (25), North (0).
    // East pays South the 25 difference -- doubled to 50 because East is a party.
    const { payments } = settleScores({
      handScores:  [0, 25, 90, 0],
      winnerSeat:  2 as SeatIndex,
      playerCount: 4,
    });
    const eastToSouth = payments.find(
      p => p.reason === 'between-losers' && p.from === 0 && p.to === 1,
    );
    expect(eastToSouth?.doubled).toBe(true);
    expect(eastToSouth?.base).toBe(25);
    expect(eastToSouth?.amount).toBe(50);
  });

  it('payments not involving East are never doubled', () => {
    const { payments } = settleScores({
      handScores:  [0, 30, 10, 90],
      winnerSeat:  3 as SeatIndex,
      playerCount: 4,
    });
    const southToWest = payments.find(p => p.from === 2 && p.to === 1);
    expect(southToWest?.doubled).toBe(false);
    expect(southToWest?.amount).toBe(southToWest?.base);
  });

  it('honours a non-default eastSeat', () => {
    const { payments } = settleScores({
      handScores:  [0, 0, 50, 0],
      winnerSeat:  2 as SeatIndex,
      playerCount: 4,
      eastSeat:    1 as SeatIndex,
    });
    expect(payments.find(p => p.from === 1)?.amount).toBe(100);
    expect(payments.find(p => p.from === 0)?.amount).toBe(50);
  });
});

describe('settleScores -- three players', () => {
  it('settles two losers with a single between-losers payment', () => {
    // Winner seat 0 (East). Losers: South 20, West 5.
    // to-winner: each pays 60, doubled (East receives) -> 120 each.
    // between: South higher by 15 -> West pays South 15 (no East involved).
    const { payments, deltas } = settleScores({
      handScores:  [60, 20, 5],
      winnerSeat:  0 as SeatIndex,
      playerCount: 3,
    });
    expect(payments.filter(p => p.reason === 'between-losers')).toHaveLength(1);
    expect(deltas).toEqual([240, -105, -135]);
    expect(sum(deltas)).toBe(0);
  });
});

describe('settleScores -- invariants', () => {
  it('deltas always sum to zero across many random hands', () => {
    // Deterministic LCG so a failure is reproducible.
    let seed = 20260709;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    for (let trial = 0; trial < 500; trial++) {
      const playerCount = 3 + rnd(2); // 3 or 4
      const handScores = Array.from({ length: playerCount }, () => rnd(400));
      const winnerSeat = rnd(playerCount) as SeatIndex;
      const eastSeat = rnd(playerCount) as SeatIndex;

      const { deltas, payments } = settleScores({
        handScores, winnerSeat, playerCount, eastSeat,
      });

      expect(sum(deltas)).toBe(0);
      expect(deltas).toHaveLength(playerCount);

      // Every payment doubles exactly when East is a party to it.
      for (const p of payments) {
        const involvesEast = p.from === eastSeat || p.to === eastSeat;
        expect(p.doubled).toBe(involvesEast);
        expect(p.amount).toBe(involvesEast ? p.base * 2 : p.base);
        expect(p.base).toBeGreaterThan(0);
      }
    }
  });

  it('the winner never pays anyone', () => {
    const { payments } = settleScores({
      handScores:  [10, 200, 30, 40],
      winnerSeat:  1 as SeatIndex,
      playerCount: 4,
    });
    expect(payments.every(p => p.from !== 1)).toBe(true);
  });

  it('a zero-scoring winner collects nothing but losers still settle', () => {
    const { payments, deltas } = settleScores({
      handScores:  [0, 0, 30, 10],
      winnerSeat:  1 as SeatIndex,
      playerCount: 4,
    });
    expect(payments.filter(p => p.reason === 'to-winner')).toHaveLength(0);
    expect(deltas[1]).toBe(0);
    expect(sum(deltas)).toBe(0);
  });

  it('throws when winnerSeat is out of range', () => {
    expect(() =>
      settleScores({ handScores: [1, 2, 3], winnerSeat: 3 as SeatIndex, playerCount: 3 }),
    ).toThrow(/out of range/);
  });
});
