/**
 * Tests for Module 1.9 — Flower / Season Scoring
 */
import { describe, it, expect } from 'vitest';
import { scoreBonusTiles } from '../flower-scoring.js';
import { DEFAULT_SCORING_CONFIG, ScoringConfig } from '../scoring-config.js';
import { Tile } from '../tiles.js';

let _id = 0;
const mk = (o: object): Tile => ({ id: `f${_id++}`, ...o } as unknown as Tile);
const FL = (f: string) => mk({ category: 'flower', flower: f });
const SE = (s: string) => mk({ category: 'season', season: s });
const B = (v: number) => mk({ category: 'suited', suit: 'bamboo', value: v });
const D = (d: string) => mk({ category: 'dragon', dragon: d });

describe('scoreBonusTiles', () => {
  it('scores nothing for an empty list', () => {
    const r = scoreBonusTiles([]);
    expect(r).toEqual({ points: 0, flowerCount: 0, seasonCount: 0, count: 0 });
  });

  it('scores a flat 4 points per flower or season', () => {
    const r = scoreBonusTiles([FL('plum'), FL('orchid'), SE('spring')]);
    expect(r.flowerCount).toBe(2);
    expect(r.seasonCount).toBe(1);
    expect(r.count).toBe(3);
    expect(r.points).toBe(12); // 3 × 4
  });

  it('treats flowers and seasons identically (no own-flower distinction)', () => {
    const flowers = scoreBonusTiles([FL('plum'), FL('orchid'), FL('chrysanthemum'), FL('bamboo')]);
    const seasons = scoreBonusTiles([SE('spring'), SE('summer'), SE('autumn'), SE('winter')]);
    expect(flowers.points).toBe(16);
    expect(seasons.points).toBe(16);
  });

  it('ignores non-bonus tiles so a full hand can be passed in', () => {
    const r = scoreBonusTiles([B(1), B(2), D('red'), FL('plum'), SE('winter')]);
    expect(r.count).toBe(2);
    expect(r.points).toBe(8);
  });

  it('respects a custom per-tile value from the config', () => {
    const cfg: ScoringConfig = { ...DEFAULT_SCORING_CONFIG, flowerOrSeason: 10 };
    const r = scoreBonusTiles([FL('plum'), SE('spring')], cfg);
    expect(r.points).toBe(20);
  });
});
