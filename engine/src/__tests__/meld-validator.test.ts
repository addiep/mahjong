/**
 * Tests for Module 1.6 — Meld Validator
 */

import { describe, it, expect } from 'vitest';
import { isPair, isPung, isKong, isChow, identifyMeld } from '../meld-validator.js';
import { buildTileSet, Tile } from '../tiles.js';

// ─── Tile fixtures ─────────────────────────────────────────────────────────────────

const ALL = buildTileSet();

/** All copies of a tile kind by suit + value. */
const bam = (v: number) => ALL.filter(
  t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === v,
);
const chr = (v: number) => ALL.filter(
  t => t.category === 'suited' && (t as any).suit === 'characters' && (t as any).value === v,
);
const cir = (v: number) => ALL.filter(
  t => t.category === 'suited' && (t as any).suit === 'circles' && (t as any).value === v,
);
const winds  = (w: string) => ALL.filter(t => t.category === 'wind'   && (t as any).wind   === w);
const dragons = (d: string) => ALL.filter(t => t.category === 'dragon' && (t as any).dragon === d);
const flowers  = ALL.filter(t => t.category === 'flower');
const seasons  = ALL.filter(t => t.category === 'season');

// ─── isPair ─────────────────────────────────────────────────────────────────────────

describe('isPair', () => {
  it('accepts two suited tiles of the same kind', () => {
    expect(isPair(bam(5).slice(0, 2))).toBe(true);
  });

  it('accepts two wind tiles of the same kind', () => {
    expect(isPair(winds('east').slice(0, 2))).toBe(true);
  });

  it('accepts two dragon tiles of the same kind', () => {
    expect(isPair(dragons('red').slice(0, 2))).toBe(true);
  });

  it('rejects two tiles of different kinds', () => {
    expect(isPair([bam(5)[0], bam(6)[0]])).toBe(false);
  });

  it('rejects a single tile', () => {
    expect(isPair([bam(5)[0]])).toBe(false);
  });

  it('rejects three tiles even if all the same kind', () => {
    expect(isPair(bam(5).slice(0, 3))).toBe(false);
  });

  it('rejects an empty array', () => {
    expect(isPair([])).toBe(false);
  });
});

// ─── isPung ─────────────────────────────────────────────────────────────────────────

describe('isPung', () => {
  it('accepts three suited tiles of the same kind', () => {
    expect(isPung(bam(3).slice(0, 3))).toBe(true);
  });

  it('accepts three wind tiles of the same kind', () => {
    expect(isPung(winds('north').slice(0, 3))).toBe(true);
  });

  it('accepts three dragon tiles of the same kind', () => {
    expect(isPung(dragons('green').slice(0, 3))).toBe(true);
  });

  it('rejects three tiles where one differs', () => {
    expect(isPung([bam(3)[0], bam(3)[1], bam(4)[0]])).toBe(false);
  });

  it('rejects two tiles', () => {
    expect(isPung(bam(3).slice(0, 2))).toBe(false);
  });

  it('rejects four tiles', () => {
    expect(isPung(bam(3))).toBe(false); // bam(3) has exactly 4 copies
  });
});

// ─── isKong ─────────────────────────────────────────────────────────────────────────

describe('isKong', () => {
  it('accepts four suited tiles of the same kind', () => {
    expect(isKong(bam(7))).toBe(true); // bam(7) returns all 4 copies
  });

  it('accepts four wind tiles of the same kind', () => {
    expect(isKong(winds('west'))).toBe(true);
  });

  it('accepts four dragon tiles of the same kind', () => {
    expect(isKong(dragons('white'))).toBe(true);
  });

  it('rejects four tiles where one differs', () => {
    expect(isKong([bam(7)[0], bam(7)[1], bam(7)[2], bam(8)[0]])).toBe(false);
  });

  it('rejects three tiles', () => {
    expect(isKong(bam(7).slice(0, 3))).toBe(false);
  });

  it('rejects five tiles', () => {
    const five = [...bam(7), bam(7)[0]];
    expect(isKong(five)).toBe(false);
  });
});

// ─── isChow ─────────────────────────────────────────────────────────────────────────

describe('isChow', () => {
  it('accepts three consecutive suited tiles in sorted order', () => {
    expect(isChow([bam(3)[0], bam(4)[0], bam(5)[0]])).toBe(true);
  });

  it('accepts three consecutive suited tiles in any order', () => {
    expect(isChow([bam(5)[0], bam(3)[0], bam(4)[0]])).toBe(true);
    expect(isChow([bam(4)[0], bam(6)[0], bam(5)[0]])).toBe(true);
  });

  it('accepts a chow spanning 1–2–3 (low end)', () => {
    expect(isChow([cir(1)[0], cir(2)[0], cir(3)[0]])).toBe(true);
  });

  it('accepts a chow spanning 7–8–9 (high end)', () => {
    expect(isChow([chr(7)[0], chr(8)[0], chr(9)[0]])).toBe(true);
  });

  it('accepts copies of different copy-index for the same kind', () => {
    // bam(4)[1] and bam(4)[2] are different physical tiles, same kind
    expect(isChow([bam(4)[1], bam(5)[2], bam(6)[3]])).toBe(true);
  });

  it('rejects tiles from different suits', () => {
    expect(isChow([bam(3)[0], chr(4)[0], bam(5)[0]])).toBe(false);
  });

  it('rejects non-consecutive tiles in the same suit', () => {
    expect(isChow([bam(3)[0], bam(4)[0], bam(6)[0]])).toBe(false); // gap
    expect(isChow([bam(1)[0], bam(3)[0], bam(5)[0]])).toBe(false); // odd skip
  });

  it('rejects three identical suited tiles (pung, not chow)', () => {
    expect(isChow(bam(5).slice(0, 3))).toBe(false);
  });

  it('rejects wind tiles', () => {
    expect(isChow(winds('east').slice(0, 3))).toBe(false);
  });

  it('rejects dragon tiles', () => {
    expect(isChow(dragons('red').slice(0, 3))).toBe(false);
  });

  it('rejects flower / season bonus tiles', () => {
    expect(isChow(flowers.slice(0, 3))).toBe(false);
    expect(isChow(seasons.slice(0, 3))).toBe(false);
  });

  it('rejects two tiles', () => {
    expect(isChow([bam(3)[0], bam(4)[0]])).toBe(false);
  });

  it('rejects four tiles', () => {
    expect(isChow([bam(3)[0], bam(4)[0], bam(5)[0], bam(6)[0]])).toBe(false);
  });
});

// ─── identifyMeld ────────────────────────────────────────────────────────────────

describe('identifyMeld', () => {
  it('identifies a pair', () => {
    expect(identifyMeld(bam(5).slice(0, 2))).toBe('pair');
  });

  it('identifies a pung', () => {
    expect(identifyMeld(winds('south').slice(0, 3))).toBe('pung');
  });

  it('identifies a kong', () => {
    expect(identifyMeld(dragons('red'))).toBe('kong');
  });

  it('identifies a chow', () => {
    expect(identifyMeld([cir(6)[0], cir(7)[0], cir(8)[0]])).toBe('chow');
  });

  it('returns null for a random assortment', () => {
    expect(identifyMeld([bam(1)[0], chr(5)[0], winds('north')[0]])).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(identifyMeld([])).toBeNull();
  });
});
