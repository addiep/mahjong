/**
 * Tests for Module 1.8 — Scoring Engine
 */
import { describe, it, expect } from 'vitest';
import { scoreWinningHand, ScoreInput } from '../scoring.js';
import { DEFAULT_SCORING_CONFIG } from '../scoring-config.js';
import { DEFAULT_CONFIG, GameConfig, DeclaredMeld, MeldType, SeatIndex } from '../game-state.js';
import { WinContext } from '../hand-evaluator.js';
import { Tile, Wind } from '../tiles.js';

// ─── Fabricators ────────────────────────────────────────────────────────
let _id = 0;
const mk = (o: object): Tile => ({ id: `s${_id++}`, ...o } as unknown as Tile);
const B = (v: number) => mk({ category: 'suited', suit: 'bamboo', value: v });
const C = (v: number) => mk({ category: 'suited', suit: 'characters', value: v });
const O = (v: number) => mk({ category: 'suited', suit: 'circles', value: v });
const W = (w: string) => mk({ category: 'wind', wind: w });
const D = (d: string) => mk({ category: 'dragon', dragon: d });
const FL = (f: string) => mk({ category: 'flower', flower: f });

const x3 = (f: (v: number) => Tile, v: number) => [f(v), f(v), f(v)];
const pr = (f: (v: number) => Tile, v: number) => [f(v), f(v)];
const Wp = (w: string) => [W(w), W(w)];
const D3 = (d: string) => [D(d), D(d), D(d)];
const Dp = (d: string) => [D(d), D(d)];
const dm = (type: MeldType, tiles: Tile[]): DeclaredMeld => ({ type, tiles });

const ctx = (o: Partial<ScoreInput> & { concealed: readonly Tile[]; winningTile: Tile }): ScoreInput => ({
  declaredMelds: [],
  bonusTiles: [],
  winContext: { source: 'self-draw-wall' } as WinContext,
  seatWind: 'south' as Wind,
  prevailingWind: 'east' as Wind,
  seat: 1 as SeatIndex,
  gameConfig: DEFAULT_CONFIG as GameConfig,
  ...o,
});

const score = (o: Partial<ScoreInput> & { concealed: readonly Tile[]; winningTile: Tile }) =>
  scoreWinningHand(ctx(o));

// ─── Base-point arithmetic (under the limit) ──────────────────────────────────
describe('normal scoring — base points and doublings', () => {
  it('scores a clean self-drawn hand with one major pung + a chow', () => {
    // pungs Red-dragon, B2, B7 + chow B4B5B6 + pair B9, self-drawn.
    const concealed = [...D3('red'), ...x3(B, 2), ...x3(B, 7), B(4), B(5), B(6), ...pr(B, 9)];
    const r = score({ concealed, winningTile: concealed[10]! }); // a B5 (in the chow)
    // base: Dred pung 8 + B2 pung 4 + B7 pung 4 + chow 0 + pair 0 + going 20 + live wall 2 = 38
    expect(r.basePoints).toBe(38);
    // doublings: dragon meld (Dred) 1 + clean 1 + all concealed 1 = 3
    expect(r.doublings).toBe(3);
    expect(r.total).toBe(304);
    expect(r.specialHand).toBeNull();
  });

  it('treats the winning tile`s pung as exposed when claimed from a discard', () => {
    const declared = [dm('pung', x3(B, 5)), dm('pung', x3(B, 7))];
    const concealed = [...x3(B, 2), B(6), B(7), B(8), ...pr(B, 9)];
    // self-draw: pung B2 concealed (4)
    const self = score({ declaredMelds: declared, concealed, winningTile: concealed[0]! });
    // base: B5 exp 2 + B7 exp 2 + B2 concealed 4 + chow 0 + pair 0 + going 20 + live wall 2 = 30
    expect(self.basePoints).toBe(30);
    expect(self.doublings).toBe(4); // clean ×1 + purity ×3
    expect(self.total).toBe(480);

    // discard: pung B2 exposed (2) and no live-wall bonus
    const disc = score({
      declaredMelds: declared, concealed, winningTile: concealed[0]!,
      wonByDiscard: true, winContext: { source: 'discard' },
    });
    // base: 2 + 2 + 2 + 0 + going 20 = 26
    expect(disc.basePoints).toBe(26);
    expect(disc.total).toBe(416);
  });

  it('adds complete-set-of-flowers doubling but NOT flat per-flower points', () => {
    const declared = [dm('pung', x3(B, 5)), dm('pung', x3(B, 7))];
    const concealed = [...x3(B, 2), B(6), B(7), B(8), ...pr(B, 9)];
    const bonus = [FL('plum'), FL('orchid'), FL('chrysanthemum'), FL('bamboo')];
    const r = score({
      declaredMelds: declared, concealed, winningTile: concealed[0]!, bonusTiles: bonus,
      wonByDiscard: true, winContext: { source: 'discard' },
    });
    expect(r.basePoints).toBe(26);                 // flat flower points excluded (Module 1.9)
    expect(r.bonusTileCount).toBe(4);
    expect(r.doublings).toBe(6);                    // clean 1 + flowers 2 + purity 3
    expect(r.doublingLines.some(l => l.label === 'complete set of flowers')).toBe(true);
    expect(r.total).toBe(1000);                     // 26 × 64 = 1664, capped at limit
  });

  it('scores a seat-wind pair and the only-possible-tile bonus', () => {
    // seat wind = South; pung B2, B3, B5 + chow B6B7B8 + pair of South.
    const concealed = [...x3(B, 2), ...x3(B, 3), ...x3(B, 5), B(6), B(7), B(8), ...Wp('south')];
    const r = score({ concealed, winningTile: concealed[0]!, onlyPossibleTile: true });
    // base: 4 + 4 + 4 + chow 0 + South pair 2 + going 20 + live wall 2 + only tile 2 = 38
    expect(r.basePoints).toBe(38);
  });

  it('prevailing wind pair does NOT score (only dragon or own-wind pair scores)', () => {
    // seat wind = South (=own wind); prevailing = East.
    // pair of East (prevailing only, not own) should give 0 pair points.
    const concealed = [...x3(B, 2), ...x3(B, 3), ...x3(B, 5), B(6), B(7), B(8), W('east'), W('east')];
    const r = score({ concealed, winningTile: concealed[0]!, seatWind: 'south' });
    // base: 4 + 4 + 4 + chow 0 + East pair 0 + going 20 + live wall 2 = 34
    expect(r.basePoints).toBe(34);
  });
});

// ─── The limit caps every hand ────────────────────────────────────────────
describe('limit cap', () => {
  it('caps a huge concealed pung hand at the limit', () => {
    const concealed = [...x3(B, 2), ...x3(B, 3), ...x3(B, 4), ...x3(B, 5), ...pr(B, 6)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.total).toBe(DEFAULT_SCORING_CONFIG.limit);
  });
});

// ─── Special / limit hands ───────────────────────────────────────────────
describe('special & limit hands', () => {
  it('All Pairs Honours scores 500', () => {
    const concealed = [...pr(B, 1), ...pr(B, 9), ...pr(C, 1), ...pr(C, 9), ...pr(O, 1), ...Wp('east'), ...Dp('red')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('All Pairs Honours');
    expect(r.total).toBe(500);
    expect(r.isLimitHand).toBe(true);
  });

  it('Honour Pairs scores the limit', () => {
    const concealed = [...Wp('east'), ...Wp('south'), ...Wp('west'), ...Wp('north'), ...Dp('red'), ...Dp('green'), ...Dp('white')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Honour Pairs');
    expect(r.total).toBe(1000);
  });

  it('Heavenly Twins (seven pairs, one suit) scores the limit', () => {
    const concealed = [...pr(B, 1), ...pr(B, 2), ...pr(B, 3), ...pr(B, 4), ...pr(B, 5), ...pr(B, 6), ...pr(B, 7)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Heavenly Twins');
    expect(r.total).toBe(1000);
  });

  it('Clean Pairs (one suit + honour pairs) scores half the limit', () => {
    const concealed = [...pr(B, 2), ...pr(B, 3), ...pr(B, 4), ...pr(B, 5), ...pr(B, 6), ...Wp('east'), ...Dp('red')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Clean Pairs');
    expect(r.total).toBe(500);
  });

  it('Wriggling Snake scores the limit', () => {
    const concealed = [B(1), B(2), B(3), B(4), B(5), B(5), B(6), B(7), B(8), B(9),
      W('east'), W('south'), W('west'), W('north')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Wriggling Snake');
    expect(r.total).toBe(1000);
  });

  it('13 Unique Wonders scores the limit', () => {
    const concealed = [B(1), B(9), C(1), C(9), O(1), O(9), W('east'), W('south'), W('west'),
      W('north'), D('red'), D('green'), D('white'), B(1)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('13 Unique Wonders');
    expect(r.total).toBe(1000);
  });

  it('Gates of Heaven (Nine Chances) is reported and scores the limit', () => {
    const concealed = [B(1), B(1), B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9), B(9), B(9), B(5)];
    const r = score({ concealed, winningTile: concealed[13]! });
    expect(r.specialHand).toBe('Gates of Heaven (Nine Chances)');
    expect(r.total).toBe(1000);
  });

  it('Windy Dragons (two dragon pungs + four wind pairs)', () => {
    const concealed = [...D3('red'), ...D3('green'), ...Wp('east'), ...Wp('south'), ...Wp('west'), ...Wp('north')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Windy Dragons');
    expect(r.total).toBe(1000);
  });

  it('Dragonfly (one of each dragon + a pung in each suit + a pair)', () => {
    const concealed = [D('red'), D('green'), D('white'), ...x3(B, 2), ...x3(C, 5), ...x3(O, 8), ...pr(O, 3)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Dragonfly');
    expect(r.total).toBe(1000);
  });

  it('Imperial Jade (all green pungs + pair) outranks the generic All Pungs label', () => {
    const concealed = [...x3(B, 2), ...x3(B, 3), ...x3(B, 6), ...D3('green'), ...pr(B, 8)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Imperial Jade');
    expect(r.total).toBe(1000);
  });

  it('Knitting is gated by the config flag', () => {
    const knit = [B(1), B(2), B(3), B(4), B(5), B(6), B(7), C(1), C(2), C(3), C(4), C(5), C(6), C(7)];
    const off = score({ concealed: knit, winningTile: knit[0]! });
    expect(off.specialHand).toBeNull();
    const on = score({ concealed: knit, winningTile: knit[0]!, gameConfig: { ...DEFAULT_CONFIG, knittingEnabled: true } });
    expect(on.specialHand).toBe('Knitting');
    expect(on.total).toBe(1000);
  });

  it('Three Great Scholars fires even when the 4th meld is a chow', () => {
    // Three dragon pungs + one chow + pair
    const concealed = [...D3('red'), ...D3('green'), ...D3('white'), B(1), B(2), B(3), ...pr(B, 5)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Three Great Scholars');
    expect(r.total).toBe(1000);
  });
});

// ─── Circumstance hands ───────────────────────────────────────────────────────
describe('circumstance hands', () => {
  it('Heavenly Hand flag scores the limit', () => {
    const concealed = [...x3(B, 2), B(4), B(5), B(6), ...x3(C, 7), ...x3(O, 8), ...Dp('red')];
    const r = score({ concealed, winningTile: concealed[0]!, heavenlyHand: true });
    expect(r.specialHand).toBe('Heavenly Hand');
    expect(r.total).toBe(1000);
  });
});
