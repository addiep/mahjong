/**
 * Tests for Module 1.7 — Hand Evaluator
 */
import { describe, it, expect } from 'vitest';
import {
  isWinningHand, decomposeStandard, detectCircumstance,
} from '../hand-evaluator.js';
import { DEFAULT_CONFIG, GameConfig, DeclaredMeld, MeldType } from '../game-state.js';
import { Tile } from '../tiles.js';

// ─── Fabricators ────────────────────────────────────────────────────────────────
let _id = 0;
const mk = (o: object): Tile => ({ id: `x${_id++}`, ...o } as unknown as Tile);
const B = (v: number) => mk({ category: 'suited', suit: 'bamboo', value: v });
const C = (v: number) => mk({ category: 'suited', suit: 'characters', value: v });
const O = (v: number) => mk({ category: 'suited', suit: 'circles', value: v });
const W = (w: string) => mk({ category: 'wind', wind: w });
const D = (d: string) => mk({ category: 'dragon', dragon: d });
const FL = () => mk({ category: 'flower', flower: 'plum' });

const x3 = (f: (v: number) => Tile, v: number) => [f(v), f(v), f(v)];
const pr = (f: (v: number) => Tile, v: number) => [f(v), f(v)];
const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ ...DEFAULT_CONFIG, ...over });
const dm = (type: MeldType, tiles: Tile[]): DeclaredMeld => ({ type, tiles });

// ─── Standard wins ──────────────────────────────────────────────────────────────
describe('isWinningHand — standard', () => {
  it('accepts a clean single-suit win', () => {
    const hand = [...pr(B, 1), B(1), B(2), B(3), B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9)];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });

  it('rejects a random non-winning hand', () => {
    const hand = [B(1), B(4), B(7), C(2), C(5), C(8), O(3), O(6), O(9), W('east'), W('south'), D('red'), D('green'), D('white')];
    expect(isWinningHand(hand, [], cfg())).toBe(false);
  });

  it('accepts a multi-suit chow hand', () => {
    const hand = [B(1), B(2), B(3), C(4), C(5), C(6), O(7), O(8), O(9), W('east'), W('east'), W('east'), D('red'), D('red')];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });

  it('accepts a multi-suit all-pungs hand', () => {
    const hand = [...x3(B, 1), ...x3(C, 2), ...x3(O, 3), W('east'), W('east'), W('east'), D('red'), D('red')];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });
});

// ─── Declared melds ─────────────────────────────────────────────────────────────
describe('isWinningHand — with declared melds', () => {
  it('accepts a win using two exposed melds (clean)', () => {
    const declared = [dm('pung', x3(B, 1)), dm('chow', [B(4), B(5), B(6)])];
    const concealed = [B(7), B(8), B(9), ...x3(B, 2), ...pr(B, 3)];
    expect(isWinningHand(concealed, declared, cfg())).toBe(true);
  });

  it('accepts a multi-suit hand with a declared chow', () => {
    const declared = [dm('chow', [C(1), C(2), C(3)])];
    const concealed = [B(1), B(2), B(3), B(4), B(5), B(6), O(7), O(8), O(9), ...pr(B, 9)];
    expect(isWinningHand(concealed, declared, cfg())).toBe(true);
  });

  it('accepts four declared pungs + concealed pair (meldsNeeded 0, All Pungs bypass)', () => {
    const declared = [dm('pung', x3(B, 1)), dm('pung', x3(C, 2)), dm('pung', x3(O, 3)), dm('pung', [D('red'), D('red'), D('red')])];
    expect(isWinningHand([D('green'), D('green')], declared, cfg())).toBe(true);
  });
});

// ─── decomposeStandard ──────────────────────────────────────────────────────────
describe('decomposeStandard', () => {
  it('returns both readings of 222333444 (three pungs vs three chows)', () => {
    const hand = [...pr(B, 9), ...x3(B, 2), ...x3(B, 3), ...x3(B, 4), B(5), B(6), B(7)];
    expect(decomposeStandard(hand, 4)).toHaveLength(2);
  });

  it('returns [] when a bonus tile is present', () => {
    const hand = [...pr(B, 1), B(1), B(2), B(3), B(1), B(2), B(3), B(4), B(5), B(6), B(7), FL()];
    expect(decomposeStandard(hand, 4)).toHaveLength(0);
  });

  it('returns [] when the tile count does not match meldsNeeded', () => {
    expect(decomposeStandard([B(1), B(1)], 4)).toHaveLength(0);
  });
});

// ─── Seven pairs family ─────────────────────────────────────────────────────────
describe('isWinningHand — seven pairs family', () => {
  it('accepts Heavenly Twins (one suit, seven pairs)', () => {
    const hand = [...pr(B, 1), ...pr(B, 2), ...pr(B, 3), ...pr(B, 4), ...pr(B, 5), ...pr(B, 6), ...pr(B, 7)];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });

  it('accepts All Pairs Honours (terminals + honours)', () => {
    const hand = [...pr(B, 1), ...pr(B, 9), ...pr(C, 1), ...pr(C, 9), ...pr(O, 1), W('east'), W('east'), D('red'), D('red')];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });

  it('rejects mixed-suit seven pairs that are not all terminal/honour', () => {
    const hand = [...pr(B, 1), ...pr(B, 2), ...pr(B, 3), ...pr(C, 4), ...pr(C, 5), ...pr(O, 6), ...pr(O, 7)];
    expect(isWinningHand(hand, [], cfg())).toBe(false);
  });
});

// ─── Bespoke special hands ──────────────────────────────────────────────────────
describe('isWinningHand — bespoke special hands', () => {
  it('accepts Wriggling Snake (1-9 one suit, one doubled, four winds)', () => {
    const hand = [B(1), B(2), B(3), B(4), B(5), B(5), B(6), B(7), B(8), B(9), W('east'), W('south'), W('west'), W('north')];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });

  it('rejects Wriggling Snake missing a wind', () => {
    const hand = [B(1), B(2), B(3), B(4), B(5), B(5), B(6), B(7), B(8), B(9), W('east'), W('south'), W('west'), W('east')];
    expect(isWinningHand(hand, [], cfg())).toBe(false);
  });

  it('accepts 13 Unique Wonders', () => {
    const hand = [B(1), B(9), C(1), C(9), O(1), O(9), W('east'), W('south'), W('west'), W('north'), D('red'), D('green'), D('white'), B(1)];
    expect(isWinningHand(hand, [], cfg())).toBe(true);
  });

  it('rejects 13 Unique Wonders with a simple tile', () => {
    const hand = [B(1), B(9), C(1), C(9), O(1), O(5), W('east'), W('south'), W('west'), W('north'), D('red'), D('green'), D('white'), B(1)];
    expect(isWinningHand(hand, [], cfg())).toBe(false);
  });
});

// ─── Knitting / crocheting gating ───────────────────────────────────────────────
describe('isWinningHand — knitting gated by config', () => {
  const knit = [B(1), B(2), B(3), B(4), B(5), B(6), B(7), C(1), C(2), C(3), C(4), C(5), C(6), C(7)];
  const crochet = [B(1), C(1), O(1), B(2), C(2), O(2), B(3), C(3), O(3), B(4), C(4), O(4), B(5), B(5)];

  it('rejects knitting when knittingEnabled is false', () => {
    expect(isWinningHand(knit, [], cfg({ knittingEnabled: false }))).toBe(false);
  });
  it('accepts knitting (cross-suit number pairs) when knittingEnabled is true', () => {
    expect(isWinningHand(knit, [], cfg({ knittingEnabled: true }))).toBe(true);
  });
  it('rejects two-suit identical pairs that are not cross-suit matched, even when enabled', () => {
    // Same-suit identical pairs (not B(n)+C(n) cross-suit pairs). Values are
    // non-consecutive so the hand is not an ordinary chow win either, and the
    // two suits keep it out of the one-suit seven-pairs family.
    const hand = [...pr(B, 1), ...pr(B, 4), ...pr(B, 7), ...pr(C, 1), ...pr(C, 4), ...pr(C, 7), ...pr(C, 9)];
    expect(isWinningHand(hand, [], cfg({ knittingEnabled: true }))).toBe(false);
  });
  it('accepts crocheting only when knittingEnabled is true', () => {
    expect(isWinningHand(crochet, [], cfg({ knittingEnabled: false }))).toBe(false);
    expect(isWinningHand(crochet, [], cfg({ knittingEnabled: true }))).toBe(true);
  });
});

// ─── Circumstance hands ─────────────────────────────────────────────────────────
describe('detectCircumstance', () => {
  it('detects Plum Blossom (circ 5 from dead wall)', () => {
    expect(detectCircumstance(O(5), { source: 'dead-wall-replacement' })).toContain('plum_blossom');
  });
  it('detects Moon (circ 1, last wall tile, self-draw)', () => {
    expect(detectCircumstance(O(1), { source: 'self-draw-wall', isLastWallTile: true })).toContain('moon');
  });
  it('detects Twofold Fortune (kong replacement chain >= 2)', () => {
    expect(detectCircumstance(O(5), { source: 'dead-wall-replacement', kongReplacementChain: 2 }))
      .toEqual(expect.arrayContaining(['plum_blossom', 'twofold_fortune']));
  });
  it('does not detect Plum Blossom on an ordinary self-draw', () => {
    expect(detectCircumstance(O(5), { source: 'self-draw-wall' })).toHaveLength(0);
  });
});
