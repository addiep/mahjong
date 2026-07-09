/**
 * Tests for Module 4.6b — Special-Hand Targeting (the hard structural hands)
 *
 *   - oracle agreement: for every 4.6b spec, `away === 0` on a complete hand
 *     that the Module 1.8 completion detector recognises by name
 *   - standardUsable / blockProgress: the structural distance primitives
 *   - partial fingerprints and blocked cases
 *   - the scorer fix that Adam's "second group" ruling forces: Windy Dragons
 *     and Dragonfly are now detected with declared melds, not only concealed
 */

import { describe, it, expect } from 'vitest';
import { buildTileSet, Tile, SuitedTile, Suit, Wind, tileKey } from '../tiles.js';
import { GameState, PlayerState, SeatIndex, DeclaredMeld, DEFAULT_CONFIG } from '../game-state.js';
import { Wall } from '../wall.js';
import { WinContext } from '../hand-evaluator.js';
import { scoreWinningHand, ScoreInput } from '../scoring.js';
import { DEFAULT_SCORING_CONFIG } from '../scoring-config.js';
import {
  scanTargets, targetSpecByName, TargetAssessment, ScanContext, HandView, IMPOSSIBLE,
} from '../ai/targets.js';
import { countVector, standardUsable, usableInSuit, blockProgress, tileIndex, indexKey } from '../ai/shanten.js';
import { chooseSpecialTarget } from '../ai/assessment.js';

// --- fixtures (mirrors targets.test.ts) -----
const ALL = buildTileSet();
const WINDS_ORDER: Wind[] = ['east', 'south', 'west', 'north'];

const suited = (suit: Suit, v: number, copy = 0): Tile =>
  ALL.filter(t => t.category === 'suited' && (t as SuitedTile).suit === suit && (t as SuitedTile).value === v)[copy]!;
const bam = (v: number, c = 0) => suited('bamboo', v, c);
const chr = (v: number, c = 0) => suited('characters', v, c);
const cir = (v: number, c = 0) => suited('circles', v, c);
const dragon = (colour: string, copy = 0): Tile =>
  ALL.filter(t => t.category === 'dragon' && (t as any).dragon === colour)[copy]!;
const wind = (dir: string, copy = 0): Tile =>
  ALL.filter(t => t.category === 'wind' && (t as any).wind === dir)[copy]!;

const x3 = (f: (v: number, c?: number) => Tile, v: number) => [f(v, 0), f(v, 1), f(v, 2)];
const x4 = (f: (v: number, c?: number) => Tile, v: number) => [f(v, 0), f(v, 1), f(v, 2), f(v, 3)];
const pr = (f: (v: number, c?: number) => Tile, v: number) => [f(v, 0), f(v, 1)];
const W2 = (d: string) => [wind(d, 0), wind(d, 1)];
const W4 = (d: string) => [wind(d, 0), wind(d, 1), wind(d, 2), wind(d, 3)];
const D3 = (c: string) => [dragon(c, 0), dragon(c, 1), dragon(c, 2)];
const D4 = (c: string) => [dragon(c, 0), dragon(c, 1), dragon(c, 2), dragon(c, 3)];

const openCtx: ScanContext = { copiesLeft: () => 4, knittingEnabled: false, cfg: DEFAULT_SCORING_CONFIG };
const knitCtx: ScanContext = { ...openCtx, knittingEnabled: true };

const view = (concealed: Tile[], melds: DeclaredMeld[] = []): HandView => ({ concealed, melds });

function assessment(name: string, v: HandView, ctx: ScanContext = openCtx): TargetAssessment {
  const hit = scanTargets(v, ctx).find(t => t.name === name);
  expect(hit, `spec "${name}" missing from scan`).toBeDefined();
  return hit!;
}

/** The Module 1.8 detector, used as the oracle for away === 0. */
function detectorName(concealed: Tile[], melds: DeclaredMeld[] = [], knitting = false): string | null {
  const input: ScoreInput = {
    concealed, declaredMelds: melds, bonusTiles: [],
    winningTile: concealed[concealed.length - 1]!,
    winContext: { source: 'self-draw-wall' } as WinContext,
    seatWind: 'south', prevailingWind: 'east', seat: 1 as SeatIndex,
    gameConfig: { ...DEFAULT_CONFIG, knittingEnabled: knitting },
  };
  return scoreWinningHand(input).specialHand;
}

const pung = (tiles: Tile[]): DeclaredMeld => ({ type: 'pung', tiles });
const openKong = (tiles: Tile[]): DeclaredMeld => ({ type: 'open_kong', tiles });
const concealedKong = (tiles: Tile[]): DeclaredMeld => ({ type: 'concealed_kong', tiles });
const chow = (tiles: Tile[]): DeclaredMeld => ({ type: 'chow', tiles });

// ═══ the structural primitives ════════════════════════════════════════════════

describe('shanten.ts — standardUsable', () => {
  it('a complete one-suit standard hand uses all 14 tiles', () => {
    // 1,2,3,4,5,6,7,8,9,1,1,1,2,2 — three chows + a pung of 1s + a pair of 2s
    const tiles = [bam(1, 0), bam(2, 0), bam(3, 0), bam(4, 0), bam(5, 0), bam(6, 0), bam(7, 0), bam(8, 0), bam(9, 0),
      bam(1, 1), bam(1, 2), bam(1, 3), bam(2, 1), bam(2, 2)];
    expect(tiles.length).toBe(14);
    expect(usableInSuit(countVector(tiles), 'bamboo', { setsNeeded: 4, allowChow: true, needPair: true })).toBe(14);
  });

  it('a 13-tile waiting hand is one tile short', () => {
    const tiles = [bam(1, 0), bam(2, 0), bam(3, 0), bam(4, 0), bam(5, 0), bam(6, 0), bam(7, 0), bam(8, 0), bam(9, 0),
      bam(1, 1), bam(1, 2), bam(1, 3), bam(2, 1)];
    expect(usableInSuit(countVector(tiles), 'bamboo', { setsNeeded: 4, allowChow: true, needPair: true })).toBe(13);
  });

  it('honours never form chows, so a run of winds is worth one tile per set slot', () => {
    const tiles = [wind('east'), wind('south'), wind('west'), wind('north')];
    expect(standardUsable(countVector(tiles), { setsNeeded: 4, allowChow: true, needPair: false })).toBe(4);
  });

  it('the no-chow mode refuses to read a run as a set', () => {
    const tiles = [bam(1), bam(2), bam(3), bam(4), bam(5), bam(6), bam(7), bam(8), bam(9),
      bam(1, 1), bam(1, 2), bam(1, 3), bam(2, 1), bam(2, 2)];
    const withChows = standardUsable(countVector(tiles), { setsNeeded: 4, allowChow: true, needPair: true });
    const noChows = standardUsable(countVector(tiles), { setsNeeded: 4, allowChow: false, needPair: true });
    expect(withChows).toBe(14);
    expect(noChows).toBeLessThan(withChows);
  });

  it('the mask confines the count to one suit', () => {
    const tiles = [...x3(bam, 1), ...x3(chr, 2), ...x3(cir, 3), ...pr(bam, 5)];
    expect(usableInSuit(countVector(tiles), 'bamboo', { setsNeeded: 4, allowChow: true, needPair: true })).toBe(5);
  });

  it('never exceeds 3 x setsNeeded + 2', () => {
    const tiles = [...x4(bam, 1), ...x4(bam, 2), ...x4(bam, 3), ...x4(bam, 4)];
    expect(standardUsable(countVector(tiles), { setsNeeded: 2, allowChow: false, needPair: true })).toBe(8);
  });

  it('an empty hand is worth nothing', () => {
    expect(standardUsable([], { setsNeeded: 4, allowChow: true, needPair: true })).toBe(0);
  });
});

describe('shanten.ts — index round-trip and blockProgress', () => {
  it('tileIndex / indexKey round-trip every non-bonus tile', () => {
    for (const t of ALL) {
      const i = tileIndex(t);
      if (i < 0) continue;
      expect(indexKey(i)).toBe(tileKey(t));
    }
  });

  it('classifies complete and partial same-kind blocks', () => {
    const bp = blockProgress([...x4(bam, 1), ...x3(chr, 2), ...pr(cir, 3), dragon('red')]);
    expect(bp.kongs).toEqual([tileKey(bam(1))]);
    expect(bp.pungs).toContain(tileKey(bam(1)));
    expect(bp.pungs).toContain(tileKey(chr(2)));
    expect(bp.pairs).toEqual([tileKey(cir(3))]);
    expect(bp.singles).toEqual([tileKey(dragon('red'))]);
  });
});

// ═══ oracle agreement ═════════════════════════════════════════════════════════

describe('4.6b: away === 0 agrees with the completion detectors', () => {
  const cases: Array<{ name: string; tiles: Tile[]; melds?: DeclaredMeld[]; ctx?: ScanContext; knitting?: boolean }> = [
    {
      // four pungs across suits + a pair; no chows, fully concealed
      name: 'Mixed Pungs',
      tiles: [...x3(bam, 2), ...x3(chr, 5), ...x3(cir, 7), ...x3(bam, 8), ...pr(chr, 3)],
    },
    {
      // four kongs (one suit + honours) + a pair; kongs must be declared
      name: 'All Kongs (Fourfold Plenty)',
      tiles: pr(bam, 7),
      melds: [openKong(x4(bam, 2)), openKong(x4(bam, 5)), openKong(W4('east')), openKong(D4('red'))],
    },
    {
      // three dragon pungs + a bamboo chow + a bamboo pair
      name: 'Three Great Scholars',
      tiles: [...D3('red'), ...D3('green'), ...D3('white'), bam(3), bam(4), bam(5), ...pr(bam, 7)],
    },
    {
      name: 'Windy Dragons',
      tiles: [...D3('red'), ...D3('green'), ...W2('east'), ...W2('south'), ...W2('west'), ...W2('north')],
    },
    {
      name: 'Dragonfly',
      tiles: [dragon('red'), dragon('green'), dragon('white'),
        ...x3(bam, 2), ...x3(chr, 5), ...x3(cir, 7), ...pr(bam, 9)],
    },
    {
      // 1-9 run + a pung of 1s + a pair of 5s, all bamboo
      name: 'Run, Pung and Pair',
      tiles: [...x4(bam, 1), bam(2), bam(3), bam(4), ...x3(bam, 5), bam(6), bam(7), bam(8), bam(9)],
    },
    {
      // concealed, one suit, four melds + a pair, no kongs
      name: 'Buried Treasure',
      tiles: [chr(1), chr(2), chr(3), chr(4), chr(5), chr(6), chr(7), chr(8), chr(9),
        chr(2, 1), chr(3, 1), chr(4, 1), ...pr(chr, 5).slice(1), chr(5, 2)],
    },
    {
      name: 'Knitting',
      tiles: [bam(1), chr(1), bam(2), chr(2), bam(3), chr(3), bam(4), chr(4),
        bam(5), chr(5), bam(6), chr(6), bam(7), chr(7)],
      ctx: knitCtx, knitting: true,
    },
    {
      name: 'Crocheting (Triple Knitting)',
      tiles: [bam(1), chr(1), cir(1), bam(2), chr(2), cir(2), bam(3), chr(3), cir(3),
        bam(4), chr(4), cir(4), bam(5), chr(5)],
      ctx: knitCtx, knitting: true,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: the detector fires and away === 0`, () => {
      const melds = c.melds ?? [];
      const tileCount = c.tiles.length + melds.reduce((n, m) => n + m.tiles.length, 0);
      expect(tileCount, 'hand must be 14 tiles (+1 per kong)').toBe(14 + melds.filter(m => m.type !== 'pung' && m.type !== 'chow').length);

      expect(detectorName(c.tiles, melds, c.knitting ?? false)).toBe(c.name);
      expect(assessment(c.name, view(c.tiles, melds), c.ctx ?? openCtx).away).toBe(0);
    });
  }
});

// ═══ the scorer fix: second-group hands with declared melds ═══════════════════

describe('Windy Dragons and Dragonfly are detected with declared melds (MJrules second group)', () => {
  it('Windy Dragons: the two dragon pungs may be claimed', () => {
    const concealed = [...W2('east'), ...W2('south'), ...W2('west'), ...W2('north')];
    const melds = [pung(D3('red')), pung(D3('green'))];
    expect(detectorName(concealed, melds)).toBe('Windy Dragons');
    expect(assessment('Windy Dragons', view(concealed, melds)).away).toBe(0);
  });

  it('Windy Dragons: a dragon *kong* is not permitted', () => {
    const concealed = [...W2('east'), ...W2('south'), ...W2('west'), ...W2('north')];
    const melds = [openKong(D4('red')), pung(D3('green'))];
    expect(detectorName(concealed, melds)).not.toBe('Windy Dragons');
    expect(assessment('Windy Dragons', view(concealed, melds)).blocked).toBe(true);
  });

  it('Dragonfly: a suit pung may be claimed', () => {
    const concealed = [dragon('red'), dragon('green'), dragon('white'),
      ...x3(chr, 5), ...x3(cir, 7), ...pr(bam, 9)];
    const melds = [pung(x3(bam, 2))];
    expect(detectorName(concealed, melds)).toBe('Dragonfly');
    expect(assessment('Dragonfly', view(concealed, melds)).away).toBe(0);
  });

  it('Dragonfly: a claimed chow kills it', () => {
    const concealed = [dragon('red'), dragon('green'), dragon('white'),
      ...x3(chr, 5), ...x3(cir, 7), ...pr(bam, 9)];
    const melds = [chow([bam(2), bam(3), bam(4)])];
    expect(assessment('Dragonfly', view(concealed, melds)).blocked).toBe(true);
  });
});

// ═══ partial fingerprints ════════════════════════════════════════════════════

describe('4.6b partial fingerprints', () => {
  it('Mixed Pungs: three pungs + a pair + a lone tile is two away', () => {
    // 9 (pungs) + 2 (pair) + 1 (lone tile toward the 4th pung) = 12 in place
    const v = view([...x3(bam, 2), ...x3(chr, 5), ...x3(cir, 7), ...pr(chr, 3), bam(8)]);
    const a = assessment('Mixed Pungs', v);
    expect(a.inPlace).toBe(12);
    expect(a.away).toBe(2);
  });

  it('Mixed Pungs: a concealed kong is allowed, a claimed pung is not', () => {
    const conc = [...x3(chr, 5), ...x3(cir, 7), ...pr(chr, 3)];
    expect(assessment('Mixed Pungs', view(conc, [concealedKong(x4(bam, 2))])).blocked).toBe(false);
    expect(assessment('Mixed Pungs', view(conc, [pung(x3(bam, 2))])).blocked).toBe(true);
  });

  it('Buried Treasure: any declared meld kills it', () => {
    const conc = [chr(1), chr(2), chr(3), chr(4), chr(5), chr(6), chr(7), chr(8), chr(9), chr(5, 1)];
    expect(assessment('Buried Treasure', view(conc)).blocked).toBe(false);
    expect(assessment('Buried Treasure', view(conc, [chow([chr(1, 1), chr(2, 1), chr(3, 1)])])).blocked).toBe(true);
    expect(assessment('Buried Treasure', view(conc, [concealedKong(x4(chr, 5))])).blocked).toBe(true);
  });

  it('Buried Treasure: measures the best suit, ignoring the others', () => {
    const conc = [chr(1), chr(2), chr(3), chr(4), chr(5), chr(6), ...pr(chr, 9), bam(1), bam(5), dragon('red')];
    const a = assessment('Buried Treasure', view(conc));
    expect(a.inPlace).toBe(8);   // two chows + a pair; the bamboo and dragon count for nothing
    expect(a.away).toBe(6);
  });

  it('All Kongs is measured against eighteen tiles, so it starts absurdly far away', () => {
    const a = assessment('All Kongs (Fourfold Plenty)', view([...x4(bam, 2), ...x3(bam, 5), ...pr(bam, 7), bam(9)]));
    // The four best kong kinds take every tile: 4 + 3 + 2 + 1, leaving nothing for the pair.
    expect(a.inPlace).toBe(10);
    expect(a.away).toBe(8);
  });

  it('All Kongs: a second suit is not allowed alongside the first', () => {
    const a = assessment('All Kongs (Fourfold Plenty)', view([...x4(bam, 2), ...x4(chr, 5)]));
    // only one suit may count; the honours-plus-one-suit pool takes the better half
    expect(a.inPlace).toBe(4);
  });

  it('Three Great Scholars: two dragon pungs and a suit pair', () => {
    const a = assessment('Three Great Scholars', view([...D3('red'), ...D3('green'), ...pr(bam, 7)]));
    expect(a.inPlace).toBe(8);   // 6 dragons + 2 pair
    expect(a.away).toBe(6);      // a white pung (3) + a bamboo meld (3)
  });

  it('Three Great Scholars: a declared suited meld fixes the suit of the pair', () => {
    const melds = [pung(x3(bam, 2))];
    const withBam = assessment('Three Great Scholars', view([...D3('red'), ...D3('green'), ...D3('white'), ...pr(bam, 7)], melds));
    const withChr = assessment('Three Great Scholars', view([...D3('red'), ...D3('green'), ...D3('white'), ...pr(chr, 7)], melds));
    expect(withBam.away).toBe(0);
    expect(withChr.away).toBe(2);   // the characters pair cannot serve a bamboo fourth meld
  });

  it('Windy Dragons: three wind pairs and one dragon pung is five away', () => {
    const a = assessment('Windy Dragons', view([...D3('red'), ...W2('east'), ...W2('south'), ...W2('west')]));
    expect(a.inPlace).toBe(9);
    expect(a.away).toBe(5);   // a second dragon pung (3) + the north pair (2)
  });

  it('Run, Pung and Pair: a bare 1-9 run is five away', () => {
    const run = [bam(1), bam(2), bam(3), bam(4), bam(5), bam(6), bam(7), bam(8), bam(9)];
    const a = assessment('Run, Pung and Pair', view(run));
    expect(a.inPlace).toBe(9);
    expect(a.away).toBe(5);   // two more of a pung tile + one more of a pair tile... plus the pair's second
  });

  it('Knitting and Crocheting are blocked when the switch is off', () => {
    const conc = [bam(1), chr(1), bam(2), chr(2), bam(3), chr(3)];
    expect(assessment('Knitting', view(conc), openCtx).blocked).toBe(true);
    expect(assessment('Crocheting (Triple Knitting)', view(conc), openCtx).blocked).toBe(true);
    expect(assessment('Knitting', view(conc), knitCtx).blocked).toBe(false);
  });

  it('Knitting: matched cross-suit pairs count two, lone tiles count one', () => {
    const conc = [bam(1), chr(1), bam(2), chr(2), bam(3), chr(3), bam(4)];
    const a = assessment('Knitting', view(conc), knitCtx);
    expect(a.inPlace).toBe(7);   // three matched pairs (6) + the lone 4-bam (1)
    expect(a.away).toBe(7);
  });
});

// ═══ blocked by copies-left ═══════════════════════════════════════════════════

describe('4.6b blocked cases', () => {
  const noDragons: ScanContext = {
    ...openCtx,
    copiesLeft: (k) => (String(k).startsWith('dragon:') ? 0 : 4),
  };

  it('Three Great Scholars is impossible once a dragon is out of play', () => {
    const a = assessment('Three Great Scholars', view([...D3('red'), ...pr(bam, 7)]), noDragons);
    expect(a.blocked).toBe(true);
    expect(a.away).toBe(IMPOSSIBLE);
  });

  it('Windy Dragons is impossible once no dragons remain', () => {
    expect(assessment('Windy Dragons', view([...W2('east'), ...W2('south')]), noDragons).blocked).toBe(true);
  });

  it('Dragonfly needs one of each dragon', () => {
    const a = assessment('Dragonfly', view([...x3(bam, 2), ...x3(chr, 5)]), noDragons);
    expect(a.blocked).toBe(true);
  });
});

// ═══ the AI commit policy sees the new targets ═══════════════════════════════

describe('the commit policy reaches the 4.6b targets', () => {
  function player(seat: SeatIndex, concealed: Tile[], melds: DeclaredMeld[] = []): PlayerState {
    return { name: `P${seat}`, seat, seatWind: WINDS_ORDER[seat]!, concealed, melds, bonusTiles: [], score: 0 };
  }
  function makeState(players: PlayerState[], over: Partial<GameState> = {}): GameState {
    return {
      config: DEFAULT_CONFIG, players,
      wall: { live: ALL.slice(0, 60), dead: [] } as Wall,
      discardPool: [], currentSeat: 0, phase: 'DISCARDING',
      prevailingWind: 'east', handNumber: 0, handResult: null,
      claimWindow: null, robbingKong: null, discardLog: [],
      ...over,
    };
  }

  it('commits to Mixed Pungs one tile from home', () => {
    // 3 pungs + a pair + a pair heading for the fourth pung: away 1
    const hand = [...x3(bam, 2), ...x3(chr, 5), ...x3(cir, 7), ...pr(chr, 3), ...pr(bam, 8)];
    const state = makeState([player(0, hand), player(1, []), player(2, []), player(3, [])]);
    const plan = chooseSpecialTarget(state, 0 as SeatIndex);
    expect(plan?.name).toBe('Mixed Pungs');
    expect(plan?.concealedOnly).toBe(true);
    expect(plan?.away).toBe(1);
  });

  it('never commits to All Kongs from a normal hand — it is always too far away', () => {
    const hand = [...x4(bam, 2), ...x3(bam, 5), ...pr(bam, 7), bam(9), bam(1), chr(1), dragon('red')];
    const state = makeState([player(0, hand), player(1, []), player(2, []), player(3, [])]);
    const plan = chooseSpecialTarget(state, 0 as SeatIndex);
    expect(plan?.name).not.toBe('All Kongs (Fourfold Plenty)');
  });

  it('every spec is reachable by name', () => {
    for (const n of ['Mixed Pungs', 'All Kongs (Fourfold Plenty)', 'Three Great Scholars', 'Windy Dragons',
      'Dragonfly', 'Run, Pung and Pair', 'Buried Treasure', 'Knitting', 'Crocheting (Triple Knitting)']) {
      expect(targetSpecByName(n), n).toBeDefined();
    }
  });

  it('the first-group targets are flagged concealed-only; the second-group ones are not', () => {
    expect(targetSpecByName('Mixed Pungs')!.concealedOnly).toBe(true);
    expect(targetSpecByName('Buried Treasure')!.concealedOnly).toBe(true);
    expect(targetSpecByName('Run, Pung and Pair')!.concealedOnly).toBe(true);
    expect(targetSpecByName('Knitting')!.concealedOnly).toBe(true);
    // Adam's ruling 2026-07-09: MJrules.md's second group wins over the old design table.
    expect(targetSpecByName('Windy Dragons')!.concealedOnly).toBe(false);
    expect(targetSpecByName('Dragonfly')!.concealedOnly).toBe(false);
    expect(targetSpecByName('All Kongs (Fourfold Plenty)')!.concealedOnly).toBe(false);
    expect(targetSpecByName('Three Great Scholars')!.concealedOnly).toBe(false);
  });

  it('only Mixed Pungs and Buried Treasure require a self-drawn winning tile', () => {
    const flagged = ['Mixed Pungs', 'Buried Treasure'];
    for (const spec of ['Mixed Pungs', 'All Kongs (Fourfold Plenty)', 'Three Great Scholars', 'Windy Dragons',
      'Dragonfly', 'Run, Pung and Pair', 'Buried Treasure', 'Knitting', 'Crocheting (Triple Knitting)']) {
      expect(targetSpecByName(spec)!.lastTileMustBeSelfDrawn, spec).toBe(flagged.includes(spec));
    }
  });
});
