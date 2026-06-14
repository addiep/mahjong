/**
 * Tests for Module 1.5 — Claim Window Logic
 */

import { describe, it, expect } from 'vitest';
import {
  canPung,
  canKong,
  canChow,
  validateClaimDecision,
  selectWinClaimant,
} from '../claim-window.js';
import { buildTileSet, Tile, SuitedTile } from '../tiles.js';
import { SeatIndex } from '../game-state.js';

// ─── Tile fixtures ─────────────────────────────────────────────────────────────

const ALL = buildTileSet();

const bam = (v: number) =>
  ALL.filter(
    t => t.category === 'suited' && (t as SuitedTile).suit === 'bamboo' && (t as SuitedTile).value === v,
  );
const chr = (v: number) =>
  ALL.filter(
    t => t.category === 'suited' && (t as SuitedTile).suit === 'characters' && (t as SuitedTile).value === v,
  );
const cir = (v: number) =>
  ALL.filter(
    t => t.category === 'suited' && (t as SuitedTile).suit === 'circles' && (t as SuitedTile).value === v,
  );
const winds   = (w: string) => ALL.filter(t => t.category === 'wind'   && (t as any).wind   === w);
const dragons = (d: string) => ALL.filter(t => t.category === 'dragon' && (t as any).dragon === d);

// ─── canPung ──────────────────────────────────────────────────────────────────

describe('canPung', () => {
  it('returns true when the hand has exactly 2 matching tiles', () => {
    const discard    = bam(5)[0];
    const concealed  = [bam(5)[1], bam(5)[2]];
    expect(canPung(concealed, discard)).toBe(true);
  });

  it('returns true when the hand has 3 matching tiles (could also kong)', () => {
    const discard   = bam(5)[0];
    const concealed = [bam(5)[1], bam(5)[2], bam(5)[3]];
    expect(canPung(concealed, discard)).toBe(true);
  });

  it('returns false when the hand has only 1 matching tile', () => {
    const discard   = bam(5)[0];
    const concealed = [bam(5)[1], bam(6)[0], bam(7)[0]];
    expect(canPung(concealed, discard)).toBe(false);
  });

  it('returns false when the hand has no matching tiles', () => {
    const discard   = bam(5)[0];
    const concealed = [bam(6)[0], bam(7)[0], bam(8)[0]];
    expect(canPung(concealed, discard)).toBe(false);
  });

  it('works for wind tiles', () => {
    const discard   = winds('east')[0];
    const concealed = [winds('east')[1], winds('east')[2]];
    expect(canPung(concealed, discard)).toBe(true);
  });

  it('works for dragon tiles', () => {
    const discard   = dragons('red')[0];
    const concealed = [dragons('red')[1], dragons('red')[2]];
    expect(canPung(concealed, discard)).toBe(true);
  });
});

// ─── canKong ──────────────────────────────────────────────────────────────────

describe('canKong', () => {
  it('returns true when the hand has exactly 3 matching tiles', () => {
    const discard   = bam(3)[0];
    const concealed = [bam(3)[1], bam(3)[2], bam(3)[3]];
    expect(canKong(concealed, discard)).toBe(true);
  });

  it('returns false when the hand has only 2 matching tiles', () => {
    const discard   = bam(3)[0];
    const concealed = [bam(3)[1], bam(3)[2], bam(4)[0]];
    expect(canKong(concealed, discard)).toBe(false);
  });

  it('returns false when the hand has only 1 matching tile', () => {
    const discard   = bam(3)[0];
    const concealed = [bam(3)[1], bam(4)[0], bam(5)[0]];
    expect(canKong(concealed, discard)).toBe(false);
  });

  it('works for wind tiles', () => {
    const discard   = winds('north')[0];
    const concealed = [winds('north')[1], winds('north')[2], winds('north')[3]];
    expect(canKong(concealed, discard)).toBe(true);
  });
});

// ─── canChow ──────────────────────────────────────────────────────────────────

describe('canChow', () => {
  it('returns true when the discard is the high tile', () => {
    // Discard = Bam5; hand has Bam3, Bam4 → sequence 3-4-5
    const discard   = bam(5)[0];
    const concealed = [bam(3)[0], bam(4)[0]];
    expect(canChow(concealed, discard)).toBe(true);
  });

  it('returns true when the discard is the middle tile', () => {
    // Discard = Bam5; hand has Bam4, Bam6 → sequence 4-5-6
    const discard   = bam(5)[0];
    const concealed = [bam(4)[0], bam(6)[0]];
    expect(canChow(concealed, discard)).toBe(true);
  });

  it('returns true when the discard is the low tile', () => {
    // Discard = Bam5; hand has Bam6, Bam7 → sequence 5-6-7
    const discard   = bam(5)[0];
    const concealed = [bam(6)[0], bam(7)[0]];
    expect(canChow(concealed, discard)).toBe(true);
  });

  it('works at the low end of the suit (discard = 1)', () => {
    // Only valid pattern: 1-2-3
    const discard   = bam(1)[0];
    const concealed = [bam(2)[0], bam(3)[0]];
    expect(canChow(concealed, discard)).toBe(true);
  });

  it('returns false for discard = 1 when only the middle/high patterns would work', () => {
    // Discard = 1; hand has only 2 and 0 (impossible) — only 2+3 would work
    const discard   = bam(1)[0];
    const concealed = [bam(2)[0]]; // missing Bam3
    expect(canChow(concealed, discard)).toBe(false);
  });

  it('works at the high end of the suit (discard = 9)', () => {
    // Only valid pattern: 7-8-9
    const discard   = bam(9)[0];
    const concealed = [bam(7)[0], bam(8)[0]];
    expect(canChow(concealed, discard)).toBe(true);
  });

  it('returns false when a partner tile is missing', () => {
    const discard   = bam(5)[0];
    const concealed = [bam(3)[0]]; // would need Bam4 for 3-4-5; Bam6 for 4-5-6; Bam7 for 5-6-7
    expect(canChow(concealed, discard)).toBe(false);
  });

  it('returns false when partner tiles are from the wrong suit', () => {
    const discard   = bam(5)[0];
    const concealed = [chr(4)[0], chr(6)[0]]; // wrong suit
    expect(canChow(concealed, discard)).toBe(false);
  });

  it('returns false for a wind discard (cannot form a chow)', () => {
    const discard   = winds('east')[0];
    const concealed = [winds('south')[0], winds('west')[0]];
    expect(canChow(concealed, discard)).toBe(false);
  });

  it('returns false for a dragon discard', () => {
    const discard   = dragons('red')[0];
    const concealed = [dragons('green')[0], dragons('white')[0]];
    expect(canChow(concealed, discard)).toBe(false);
  });

  it('is satisfied by tiles from different copy indices', () => {
    // Physical tiles bam(4)[2] and bam(6)[3] are different copies of Bam4 and Bam6
    const discard   = bam(5)[1];
    const concealed = [bam(4)[2], bam(6)[3]];
    expect(canChow(concealed, discard)).toBe(true);
  });
});

// ─── validateClaimDecision ────────────────────────────────────────────────────

describe('validateClaimDecision', () => {
  // Seat 0 discards; seat 1 is left of discarder (the only one who may chow).
  const DISCARDER  = 0 as SeatIndex;
  const LEFT       = 1 as SeatIndex;
  const OTHER      = 2 as SeatIndex;
  const N          = 4;

  const discard    = bam(5)[0];

  describe('pass', () => {
    it('is always valid', () => {
      expect(validateClaimDecision({ type: 'pass' }, [], discard, LEFT, DISCARDER, N)).toBeNull();
    });
  });

  describe('win', () => {
    it('is always accepted (full validation deferred to Module 1.7)', () => {
      expect(validateClaimDecision({ type: 'win' }, [], discard, OTHER, DISCARDER, N)).toBeNull();
    });
  });

  describe('pung', () => {
    it('is valid when the hand has 2 matching tiles', () => {
      const concealed = [bam(5)[1], bam(5)[2]];
      expect(validateClaimDecision({ type: 'pung' }, concealed, discard, OTHER, DISCARDER, N)).toBeNull();
    });

    it('returns an error when the hand has fewer than 2 matching tiles', () => {
      const concealed = [bam(5)[1], bam(6)[0]];
      const result    = validateClaimDecision({ type: 'pung' }, concealed, discard, OTHER, DISCARDER, N);
      expect(result).toMatch(/pung/);
      expect(result).toMatch(/1/); // found 1
    });

    it('returns an error when there are no matching tiles', () => {
      const concealed = [bam(6)[0], bam(7)[0]];
      const result    = validateClaimDecision({ type: 'pung' }, concealed, discard, OTHER, DISCARDER, N);
      expect(result).toMatch(/pung/);
    });
  });

  describe('kong', () => {
    it('is valid when the hand has 3 matching tiles', () => {
      const concealed = [bam(5)[1], bam(5)[2], bam(5)[3]];
      expect(validateClaimDecision({ type: 'kong' }, concealed, discard, OTHER, DISCARDER, N)).toBeNull();
    });

    it('returns an error when the hand has only 2 matching tiles', () => {
      const concealed = [bam(5)[1], bam(5)[2]];
      const result    = validateClaimDecision({ type: 'kong' }, concealed, discard, OTHER, DISCARDER, N);
      expect(result).toMatch(/kong/);
      expect(result).toMatch(/2/); // found 2
    });
  });

  describe('chow', () => {
    it('is valid for the left player with a correct sequence', () => {
      // Sequence: Bam4-Bam5-Bam6 (discard = Bam5, hand supplies Bam4 and Bam6)
      const t1        = bam(4)[0];
      const t2        = bam(6)[0];
      const concealed = [t1, t2];
      const decision  = { type: 'chow' as const, chowTiles: [t1.id, t2.id] as [string, string] };
      expect(validateClaimDecision(decision, concealed, discard, LEFT, DISCARDER, N)).toBeNull();
    });

    it('returns an error when the claimer is not the left player', () => {
      const t1        = bam(4)[0];
      const t2        = bam(6)[0];
      const concealed = [t1, t2];
      const decision  = { type: 'chow' as const, chowTiles: [t1.id, t2.id] as [string, string] };
      const result    = validateClaimDecision(decision, concealed, discard, OTHER, DISCARDER, N);
      expect(result).toMatch(/chow/);
      expect(result).toMatch(/seat 1/); // only seat 1 may chow
    });

    it('returns an error when chowTiles is missing', () => {
      const concealed = [bam(4)[0], bam(6)[0]];
      const result    = validateClaimDecision({ type: 'chow' }, concealed, discard, LEFT, DISCARDER, N);
      expect(result).toMatch(/chowTiles/);
    });

    it('returns an error when chowTiles references the same tile twice', () => {
      const t1        = bam(4)[0];
      const concealed = [t1, bam(6)[0]];
      const decision  = { type: 'chow' as const, chowTiles: [t1.id, t1.id] as [string, string] };
      const result    = validateClaimDecision(decision, concealed, discard, LEFT, DISCARDER, N);
      expect(result).toMatch(/distinct/);
    });

    it('returns an error when a specified tile is not in the hand', () => {
      const t1        = bam(4)[0];
      const t2        = bam(6)[0];
      const concealed = [t1]; // t2 is not in hand
      const decision  = { type: 'chow' as const, chowTiles: [t1.id, t2.id] as [string, string] };
      const result    = validateClaimDecision(decision, concealed, discard, LEFT, DISCARDER, N);
      expect(result).toMatch(/not found/);
    });

    it('returns an error when the three tiles do not form a valid chow', () => {
      // Bam4 + Bam7 + Bam5 (discard) — not consecutive
      const t1        = bam(4)[0];
      const t2        = bam(7)[0];
      const concealed = [t1, t2];
      const decision  = { type: 'chow' as const, chowTiles: [t1.id, t2.id] as [string, string] };
      const result    = validateClaimDecision(decision, concealed, discard, LEFT, DISCARDER, N);
      expect(result).toMatch(/not a valid chow/);
    });

    it('handles wraparound: discarder = seat 3, left = seat 0', () => {
      const discarder3 = 3 as SeatIndex;
      const seat0      = 0 as SeatIndex;
      const t1         = bam(4)[0];
      const t2         = bam(6)[0];
      const concealed  = [t1, t2];
      const decision   = { type: 'chow' as const, chowTiles: [t1.id, t2.id] as [string, string] };
      expect(validateClaimDecision(decision, concealed, discard, seat0, discarder3, N)).toBeNull();
    });
  });
});

// ─── selectWinClaimant ────────────────────────────────────────────────────────

describe('selectWinClaimant', () => {
  it('returns the only candidate when there is just one', () => {
    expect(selectWinClaimant([2 as SeatIndex], 0 as SeatIndex, 4)).toBe(2);
  });

  it('returns the candidate with the smallest positive offset from the discarder', () => {
    // Discarder = 0; candidates = 1 and 3. Offset of 1 = 1, offset of 3 = 3. Seat 1 wins.
    const winner = selectWinClaimant(
      [3, 1] as SeatIndex[],
      0 as SeatIndex,
      4,
    );
    expect(winner).toBe(1);
  });

  it('handles discarder at seat 2 (candidates = 0 and 3)', () => {
    // Offset of 3: (3 - 2 + 4) % 4 = 1  <- closer
    // Offset of 0: (0 - 2 + 4) % 4 = 2
    const winner = selectWinClaimant(
      [0, 3] as SeatIndex[],
      2 as SeatIndex,
      4,
    );
    expect(winner).toBe(3);
  });

  it('handles wrap-around when discarder is seat 3', () => {
    // Discarder = 3; candidates = 0 and 2.
    // Offset of 0: (0 - 3 + 4) % 4 = 1  <- closer
    // Offset of 2: (2 - 3 + 4) % 4 = 3
    const winner = selectWinClaimant(
      [2, 0] as SeatIndex[],
      3 as SeatIndex,
      4,
    );
    expect(winner).toBe(0);
  });

  it('works with 3 players', () => {
    // Discarder = 1; candidates = 0 and 2.
    // Offset of 2: (2 - 1 + 3) % 3 = 1  <- closer
    // Offset of 0: (0 - 1 + 3) % 3 = 2
    const winner = selectWinClaimant(
      [0, 2] as SeatIndex[],
      1 as SeatIndex,
      3,
    );
    expect(winner).toBe(2);
  });

  it('throws when the candidates array is empty', () => {
    expect(() => selectWinClaimant([], 0 as SeatIndex, 4)).toThrow();
  });
});
