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
    expect(r.doublings).toBe(7);                    // clean 1 + bouquet flowers 3 + purity 3
    expect(r.doublingLines.some(l => l.label === 'bouquet (flowers)')).toBe(true);
    expect(r.total).toBe(1000);                     // 26 × 64 = 1664, capped at limit
  });

  it('scores a seat-wind pair', () => {
    // seat wind = South; pung B2, B3, B5 + chow B6B7B8 + pair of South.
    const concealed = [...x3(B, 2), ...x3(B, 3), ...x3(B, 5), B(6), B(7), B(8), ...Wp('south')];
    const r = score({ concealed, winningTile: concealed[0]! });
    // base: 4 + 4 + 4 + chow 0 + South pair 2 + going 20 + live wall 2 = 36
    expect(r.basePoints).toBe(36);
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

  it('seven honour pairs are now All Pairs Honours (half-limit), not a limit hand', () => {
    const concealed = [...Wp('east'), ...Wp('south'), ...Wp('west'), ...Wp('north'), ...Dp('red'), ...Dp('green'), ...Dp('white')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('All Pairs Honours');
    expect(r.total).toBe(500);
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

  it('Wriggly Snake (doubled suited tile) scores the limit', () => {
    const concealed = [B(1), B(2), B(3), B(4), B(5), B(5), B(6), B(7), B(8), B(9),
      W('east'), W('south'), W('west'), W('north')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Wriggly Snake');
    expect(r.total).toBe(1000);
  });

  it('Wriggly Snake with a doubled WIND scores the limit', () => {
    // exact 1-9 run + four winds with East doubled (14 tiles).
    const concealed = [B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9),
      W('east'), W('east'), W('south'), W('west'), W('north')];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Wriggly Snake');
    expect(r.total).toBe(1000);
  });

  it('Unique Wonder scores the double limit (2000)', () => {
    const concealed = [B(1), B(9), C(1), C(9), O(1), O(9), W('east'), W('south'), W('west'),
      W('north'), D('red'), D('green'), D('white'), B(1)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Unique Wonder');
    expect(r.total).toBe(2000);
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
    expect(r.total).toBe(500);
  });

  it('Imperial Jade (all green pungs + pair) is labelled Imperial Jade', () => {
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

// ─── New & changed special hands ─────────────────────────────────────────────
describe('rule-change special hands', () => {
  it('Mixed Pungs fires for a fully-concealed no-chow hand', () => {
    const concealed = [...x3(B, 2), ...x3(C, 3), ...x3(O, 4), ...x3(B, 6), ...pr(C, 7)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Mixed Pungs');
    expect(r.total).toBe(1000);
  });

  it('Mixed Pungs does NOT fire when a pung is claimed (not fully self-drawn)', () => {
    const declared = [dm('pung', x3(B, 2))];
    const concealed = [...x3(C, 3), ...x3(O, 4), ...x3(B, 6), ...pr(C, 7)];
    const r = score({
      declaredMelds: declared, concealed, winningTile: concealed[0]!,
      wonByDiscard: true, winContext: { source: 'discard' },
    });
    expect(r.specialHand).toBeNull();
  });

  it('Buried Treasure: fully-concealed clean single-suit hand WITH a chow', () => {
    // pung B2 + chow B4B5B6 + pung B7 + pung B8 + pair B9 = 14, one suit, no honours, no kong.
    const concealed = [...x3(B, 2), B(4), B(5), B(6), ...x3(B, 7), ...x3(B, 8), ...pr(B, 9)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Buried Treasure');
    expect(r.total).toBe(1000);
  });

  it('Buried Treasure NOT awarded when the hand has honours', () => {
    const tiles = [...x3(B, 2), B(4), B(5), B(6), ...x3(B, 7), ...D3('red'), ...Dp('green')];
    const r = score({ concealed: tiles, winningTile: tiles[0]! });
    expect(r.specialHand).not.toBe('Buried Treasure');
  });

  it('Buried Treasure NOT awarded when the hand has a kong', () => {
    const declared = [dm('concealed_kong', [B(2), B(2), B(2), B(2)])];
    const concealed = [B(4), B(5), B(6), ...x3(B, 7), ...x3(B, 8), ...pr(B, 9)];
    const r = score({ declaredMelds: declared, concealed, winningTile: concealed[0]! });
    expect(r.specialHand).not.toBe('Buried Treasure');
  });

  it('Imperial Jade allows a green chow + Green Dragon pung + green bamboo pair', () => {
    // chow B2B3B4 + chow B2B3B4 + pung B6 + Green Dragon pung + green bamboo pair B8.
    const concealed = [B(2), B(3), B(4), B(2), B(3), B(4), ...x3(B, 6), ...D3('green'), ...pr(B, 8)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Imperial Jade');
    expect(r.total).toBe(1000);
  });

  it('Three Great Scholars requires the 4th meld and pair to share a suit (negative)', () => {
    // dragons pungs + a bamboo chow + a CHARACTERS pair -> different suits -> not TGS.
    const concealed = [...D3('red'), ...D3('green'), ...D3('white'), B(1), B(2), B(3), ...pr(C, 5)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).not.toBe('Three Great Scholars');
  });

  it('Chinese Odds (one suit, all odd values, pungs + pair)', () => {
    const concealed = [...x3(B, 1), ...x3(B, 3), ...x3(B, 5), ...x3(B, 7), ...pr(B, 9)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Chinese Odds');
    expect(r.total).toBe(1000);
  });

  it('All Winds and Dragons (pure honours pungs + pair) is a limit hand', () => {
    const tiles = [...D3('red'), ...D3('green'), ...D3('white'), W('east'), W('east'), W('east'), ...Wp('south')];
    const r = score({ concealed: tiles, winningTile: tiles[0]! });
    expect(r.specialHand).toBe('All Winds and Dragons');
    expect(r.total).toBe(1000);
  });

  it('All Honours ×3 doubling for a mixed terminals+honours pung hand (not a special)', () => {
    // A claimed pung means the hand is NOT fully self-drawn, so Mixed Pungs cannot fire,
    // but the All Honours ×3 doubling (winner-only) still applies.
    const declared = [dm('pung', x3(B, 1))];
    const concealed = [...x3(B, 9), ...x3(C, 1), ...D3('red'), ...Wp('south')];
    const r = score({
      declaredMelds: declared, concealed, winningTile: concealed[0]!,
      wonByDiscard: true, winContext: { source: 'discard' },
    });
    expect(r.specialHand).toBeNull();
    expect(r.doublingLines.some(l => l.label === 'all honours')).toBe(true);
  });

  it('Run, Pung and Pair (single suit run + pung + pair)', () => {
    // 1..9 run + extra B5 (pung of 5) + pair B3.
    const concealed = [B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9), B(5), B(5), B(3), B(3), B(3)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe('Run, Pung and Pair');
    expect(r.total).toBe(1000);
  });

  it("Sparrow's Sanctuary is labelled Sparrow's, not Heavenly Twins", () => {
    const concealed = [B(1), B(1), B(1), B(1), ...pr(B, 2), ...pr(B, 3), ...pr(B, 4), ...pr(B, 6), ...pr(B, 8)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).toBe("Sparrow's Sanctuary");
    expect(r.total).toBe(1000);
  });

  it('Gates of Heaven rejects a 1/9 completing tile (extra 1 makes a kong shape)', () => {
    // 1111 234 5678 999  -> v[1]=4 -> not Nine Gates under the 2-8 completion rule.
    const concealed = [B(1), B(1), B(1), B(1), B(2), B(3), B(4), B(5), B(6), B(7), B(8), B(9), B(9), B(9)];
    const r = score({ concealed, winningTile: concealed[0]! });
    expect(r.specialHand).not.toBe('Gates of Heaven (Nine Chances)');
  });
});
