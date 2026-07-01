/**
 * Tests for Module 4.6a — Special-Hand Targeting (easy + medium hands)
 *
 *   - oracle agreement: for every 4.6a spec, `away === 0` on a complete hand
 *     that the Module 1.8 completion detector recognises (the detector is the
 *     test oracle for the away == 0 case)
 *   - partial fingerprints: hand-computed `away` counts on in-progress hands
 *   - blocked: concealed-only targets with declared melds; kinds out of play
 *   - commit policy: chooseSpecialTarget adopts a near-complete limit hand and
 *     ignores hopeless ones; keep/seek override discards and claims
 */

import { describe, it, expect } from 'vitest';
import {
  buildTileSet, Tile, TileKey, SuitedTile, Suit, Wind, tileKey,
} from '../tiles.js';
import {
  GameState, PlayerState, SeatIndex, DeclaredMeld, DEFAULT_CONFIG,
} from '../game-state.js';
import { Wall } from '../wall.js';
import { WinContext } from '../hand-evaluator.js';
import { scoreWinningHand, ScoreInput } from '../scoring.js';
import { DEFAULT_SCORING_CONFIG } from '../scoring-config.js';
import {
  scanTargets, buildScanContext, targetSpecByName, TargetAssessment,
  ScanContext, HandView, IMPOSSIBLE,
} from '../ai/targets.js';
import { assessHand, chooseSpecialTarget, nudgeSpecialTarget } from '../ai/assessment.js';
import { adviseSeat } from '../ai/heuristic-controller.js';
import { keepValue, chooseDiscardTile } from '../ai/discard.js';
import { chooseClaimDecision } from '../ai/claims.js';

// --- fixtures (mirrors ai.test.ts) -----
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
const pr = (f: (v: number, c?: number) => Tile, v: number) => [f(v, 0), f(v, 1)];
const W3 = (d: string) => [wind(d, 0), wind(d, 1), wind(d, 2)];
const D3 = (c: string) => [dragon(c, 0), dragon(c, 1), dragon(c, 2)];

/** A permissive context: every kind fully obtainable. */
const openCtx: ScanContext = {
  copiesLeft: () => 4,
  knittingEnabled: false,
  cfg: DEFAULT_SCORING_CONFIG,
};

const view = (concealed: Tile[], melds: DeclaredMeld[] = []): HandView => ({ concealed, melds });

function assessment(name: string, v: HandView, ctx: ScanContext = openCtx): TargetAssessment {
  const hit = scanTargets(v, ctx).find(t => t.name === name);
  expect(hit, `spec "${name}" missing from scan`).toBeDefined();
  return hit!;
}

/** The Module 1.8 detector, used as the oracle for away === 0. */
function detectorName(concealed: Tile[], melds: DeclaredMeld[] = []): string | null {
  const input: ScoreInput = {
    concealed, declaredMelds: melds, bonusTiles: [],
    winningTile: concealed[concealed.length - 1]!,
    winContext: { source: 'self-draw-wall' } as WinContext,
    seatWind: 'south', prevailingWind: 'east', seat: 1 as SeatIndex,
    gameConfig: DEFAULT_CONFIG,
  };
  return scoreWinningHand(input).specialHand;
}

function player(seat: SeatIndex, concealed: Tile[], melds: DeclaredMeld[] = []): PlayerState {
  return { name: `P${seat}`, seat, seatWind: WINDS_ORDER[seat]!, concealed, melds, bonusTiles: [], score: 0 };
}

function makeState(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: DEFAULT_CONFIG,
    players,
    wall: { live: ALL.slice(0, 60), dead: [] } as Wall,
    discardPool: [],
    currentSeat: 0,
    phase: 'DISCARDING',
    prevailingWind: 'east',
    handNumber: 0,
    handResult: null,
    claimWindow: null,
    robbingKong: null,
    discardLog: [],
    ...over,
  };
}

// --- oracle agreement: away === 0 iff the completion detector fires -----

describe('away === 0 agrees with the completion detectors', () => {
  const complete: Array<{ name: string; tiles: Tile[]; melds?: DeclaredMeld[] }> = [
    {
      name: "Sparrow's Sanctuary",
      tiles: [bam(1), bam(1, 1), bam(1, 2), bam(1, 3),
        ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), ...pr(bam, 8)],
    },
    {
      name: 'Unique Wonder',
      tiles: [bam(1), bam(9), chr(1), chr(9), cir(1), cir(9),
        wind('east'), wind('south'), wind('west'), wind('north'),
        dragon('red'), dragon('green'), dragon('white'), dragon('red', 1)],
    },
    {
      name: 'Wriggly Snake',
      tiles: [bam(1), bam(2), bam(3), bam(4), bam(5), bam(6), bam(7), bam(8), bam(9),
        wind('east'), wind('south'), wind('west'), wind('north'), wind('north', 1)],
    },
    {
      name: 'Gates of Heaven (Nine Chances)',
      tiles: [...x3(chr, 1), chr(2), chr(3), chr(4), chr(5), chr(5, 1), chr(6), chr(7), chr(8), ...x3(chr, 9)],
    },
    {
      name: 'Heavenly Twins',
      tiles: [...pr(cir, 1), ...pr(cir, 2), ...pr(cir, 4), ...pr(cir, 5), ...pr(cir, 7), ...pr(cir, 8), ...pr(cir, 9)],
    },
    {
      name: 'Clean Pairs',
      tiles: [...pr(cir, 1), ...pr(cir, 2), ...pr(cir, 4), ...pr(cir, 5), ...pr(cir, 7), ...pr(cir, 8),
        dragon('red'), dragon('red', 1)],
    },
    {
      name: 'All Pairs Honours',
      tiles: [...pr(bam, 1), ...pr(bam, 9), ...pr(chr, 1), ...pr(cir, 9),
        wind('east'), wind('east', 1), dragon('red'), dragon('red', 1), dragon('white'), dragon('white', 1)],
    },
    {
      name: 'Heads and Tails',
      tiles: [...x3(bam, 1), ...x3(bam, 9), ...x3(chr, 1), ...x3(cir, 9), ...pr(cir, 1)],
    },
    {
      name: 'All Winds and Dragons',
      tiles: [...W3('east'), ...W3('south'), ...W3('west'), ...D3('red'), dragon('green'), dragon('green', 1)],
    },
    {
      name: 'Chinese Odds',
      tiles: [...x3(chr, 1), ...x3(chr, 3), ...x3(chr, 5), ...x3(chr, 7), ...pr(chr, 9)],
    },
    {
      name: 'Imperial Jade',
      tiles: [...x3(bam, 2), ...x3(bam, 3), ...x3(bam, 8), ...D3('green'), ...pr(bam, 6)],
    },
    {
      name: 'Four Blessings Hovering Over the Door',
      tiles: [...W3('east'), ...W3('south'), ...W3('west'), ...W3('north'), ...pr(bam, 5)],
    },
  ];

  for (const { name, tiles, melds } of complete) {
    it(`${name}: detector fires and away === 0`, () => {
      expect(detectorName(tiles, melds ?? [])).toBe(name);
      const a = assessment(name, view(tiles, melds ?? []));
      expect(a.away).toBe(0);
      expect(a.blocked).toBe(false);
      expect(a.inPlace).toBe(14);
    });
  }

  it('All Honours: complete hand earns the x3 doubling and away === 0', () => {
    // Mixed honours and terminals: the doubling case, not a fixed limit hand.
    // One meld exposed, otherwise the fully-concealed hand is Mixed Pungs (4.6b).
    const melds: DeclaredMeld[] = [{ type: 'pung', tiles: W3('east') }];
    const concealed = [...D3('red'), ...x3(bam, 1), ...x3(cir, 9), ...pr(chr, 9)];
    const input: ScoreInput = {
      concealed, declaredMelds: melds, bonusTiles: [],
      winningTile: concealed[10]!, winContext: { source: 'self-draw-wall' } as WinContext,
      seatWind: 'south', prevailingWind: 'east', seat: 1 as SeatIndex, gameConfig: DEFAULT_CONFIG,
    };
    const r = scoreWinningHand(input);
    expect(r.specialHand).toBeNull();
    expect(r.doublingLines.some(l => l.label === 'all honours')).toBe(true);
    expect(assessment('All Honours', view(concealed, melds)).away).toBe(0);
  });
});

// --- partial fingerprints -----

describe('partial hands: away counts', () => {
  it("Sparrow's Sanctuary: two swaps out", () => {
    // 3x 1-Bam (need 4) + pairs of 2,3,4,6 + single 8 + junk chr 5 => away 2.
    const tiles = [bam(1), bam(1, 1), bam(1, 2),
      ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), bam(8), chr(5)];
    const a = assessment("Sparrow's Sanctuary", view(tiles));
    expect(a.away).toBe(2);
    expect(a.seek).toContain(tileKey(bam(1)) as TileKey);
    expect(a.seek).toContain(tileKey(bam(8)) as TileKey);
  });

  it('Unique Wonder: a classic opening hand is far away', () => {
    // 6 of the 13 wonders + 8 junk simples.
    const tiles = [bam(1), bam(9), chr(1), wind('east'), dragon('red'), dragon('white'),
      bam(4), bam(5), chr(3), chr(6), cir(2), cir(4), cir(6), cir(8)];
    const a = assessment('Unique Wonder', view(tiles));
    expect(a.away).toBe(8); // 6 of 13 singles in place, dup missing => 14 - 6
  });

  it('Gates of Heaven: one 9 short', () => {
    const tiles = [...x3(bam, 1), bam(2), bam(3), bam(4), bam(5), bam(6), bam(7), bam(8),
      bam(9), bam(9, 1), chr(5)];
    const a = assessment('Gates of Heaven (Nine Chances)', view(tiles));
    expect(a.away).toBe(2); // third 9 + the doubled 2-8 tile
    expect(a.seek).toContain(tileKey(bam(9)) as TileKey);
  });

  it('Heavenly Twins: five pairs + two singles of the suit', () => {
    const tiles = [...pr(cir, 1), ...pr(cir, 2), ...pr(cir, 4), ...pr(cir, 5), ...pr(cir, 7),
      cir(8), cir(9), chr(3), chr(6)];
    const a = assessment('Heavenly Twins', view(tiles));
    // inPlace = 10 (pairs) + 2 (pairable singles) = 12
    expect(a.away).toBe(2);
  });

  it('Four Blessings: three wind pungs + a wind pair + a suited pair', () => {
    const tiles = [...W3('east'), ...W3('south'), ...W3('west'),
      wind('north'), wind('north', 1), ...pr(bam, 5), chr(2)];
    const a = assessment('Four Blessings Hovering Over the Door', view(tiles));
    // winds in place 3+3+3+2 = 11, pair 2 => 13; away 1 (the third North).
    expect(a.away).toBe(1);
    expect(a.seek).toEqual([tileKey(wind('north')) as TileKey]);
  });

  it('Heads and Tails: declared terminal pung counts toward the shape', () => {
    const melds: DeclaredMeld[] = [{ type: 'pung', tiles: x3(bam, 1) }];
    const tiles = [...x3(bam, 9), ...x3(chr, 1), ...pr(cir, 1), cir(5), cir(6), cir(7)];
    const a = assessment('Heads and Tails', view(tiles, melds));
    // 3 (meld) + 3 + 3 + 2 (pair) = 11... plus nothing else conforms => away 3.
    expect(a.away).toBe(3);
    expect(a.blocked).toBe(false);
  });
});

// --- blocked targets -----

describe('blocked targets', () => {
  it('concealed-only targets are killed by any declared meld', () => {
    const melds: DeclaredMeld[] = [{ type: 'pung', tiles: x3(bam, 2) }];
    const tiles = [...pr(cir, 1), ...pr(cir, 2), ...pr(cir, 4), ...pr(cir, 5), ...pr(cir, 7), cir(8)];
    for (const name of ['Heavenly Twins', 'Clean Pairs', 'All Pairs Honours',
      'Unique Wonder', "Sparrow's Sanctuary", 'Wriggly Snake', 'Gates of Heaven (Nine Chances)']) {
      const a = assessment(name, view(tiles, melds));
      expect(a.blocked, name).toBe(true);
      expect(a.away, name).toBe(IMPOSSIBLE);
    }
  });

  it('a declared chow blocks the pungs-and-pair shapes', () => {
    const melds: DeclaredMeld[] = [{ type: 'chow', tiles: [bam(1), bam(2), bam(3)] }];
    const a = assessment('Heads and Tails', view([...x3(bam, 9), ...x3(chr, 1)], melds));
    expect(a.blocked).toBe(true);
  });

  it('a needed kind with no copies left blocks the target', () => {
    // Sparrow's needs a 4th 1-Bam but every unseen copy is gone.
    const ctx: ScanContext = {
      ...openCtx,
      copiesLeft: (k: TileKey) => (k === (tileKey(bam(1)) as TileKey) ? 0 : 4),
    };
    const tiles = [bam(1), bam(1, 1), bam(1, 2),
      ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), ...pr(bam, 8), chr(5)];
    const a = assessment("Sparrow's Sanctuary", view(tiles), ctx);
    expect(a.blocked).toBe(true);
  });

  it('Imperial Jade is blocked by a non-green declared meld', () => {
    const melds: DeclaredMeld[] = [{ type: 'pung', tiles: x3(bam, 5) }];
    const a = assessment('Imperial Jade', view([...D3('green'), ...pr(bam, 6)], melds));
    expect(a.blocked).toBe(true);
  });
});

// --- scan ranking -----

describe('scanTargets ranking', () => {
  it('ranks unblocked targets by away, blocked last', () => {
    const tiles = [bam(1), bam(1, 1), bam(1, 2), bam(1, 3),
      ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), ...pr(bam, 8)];
    const ranked = scanTargets(view(tiles), openCtx);
    expect(ranked[0]!.name).toBe("Sparrow's Sanctuary");
    expect(ranked[0]!.away).toBe(0);
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1]!, b = ranked[i]!;
      expect(a.blocked && !b.blocked).toBe(false); // blocked never before unblocked
    }
  });
});

// --- commit policy -----

describe('chooseSpecialTarget / assessHand commit policy', () => {
  it('commits to a one-away limit hand', () => {
    // Sparrow's Sanctuary one tile away (3x 1-Bam): EV = 0.45 x 1000 >> threshold.
    const tiles = [bam(1), bam(1, 1), bam(1, 2),
      ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), ...pr(bam, 8), chr(5)];
    const st = makeState([player(0, tiles), player(1, []), player(2, []), player(3, [])]);
    const special = chooseSpecialTarget(st, 0);
    expect(special).not.toBeNull();
    expect(special!.name).toBe("Sparrow's Sanctuary");
    expect(special!.concealedOnly).toBe(true);
    expect(assessHand(st, 0, 'clean', 0).special?.name).toBe("Sparrow's Sanctuary");
  });

  it('does not commit on an ordinary hand', () => {
    const tiles = [bam(1), bam(2), bam(3), bam(5), bam(6), chr(2), chr(2, 1), chr(7),
      cir(3), cir(4), cir(8), wind('east'), dragon('red'), bam(9)];
    const st = makeState([player(0, tiles), player(1, []), player(2, []), player(3, [])]);
    expect(chooseSpecialTarget(st, 0)).toBeNull();
  });

  it('does not commit when the wall cannot cover the distance', () => {
    const tiles = [bam(1), bam(1, 1), bam(1, 2),
      ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), ...pr(bam, 8), chr(5)];
    const st = makeState(
      [player(0, tiles), player(1, []), player(2, []), player(3, [])],
      { wall: { live: ALL.slice(0, 2), dead: [] } as Wall }, // < 1 draw per seat
    );
    expect(chooseSpecialTarget(st, 0)).toBeNull();
  });

  it('buildScanContext counts table + own tiles against copiesLeft', () => {
    const tiles = [bam(1), bam(1, 1)];
    const st = makeState([
      player(0, tiles),
      player(1, [], [{ type: 'pung', tiles: [bam(5), bam(5, 1), bam(5, 2)] }]),
      player(2, []), player(3, []),
    ], { discardPool: [bam(1, 2)] });
    const ctx = buildScanContext(st, 0);
    expect(ctx.copiesLeft(tileKey(bam(1)) as TileKey)).toBe(1);  // 2 held + 1 discarded
    expect(ctx.copiesLeft(tileKey(bam(5)) as TileKey)).toBe(1);  // 3 melded
    expect(ctx.copiesLeft(tileKey(chr(7)) as TileKey)).toBe(4);
  });
});

// --- the hint nudge (Module 4.7): chattier than the commit test -----

describe('nudgeSpecialTarget / adviseSeat nudge', () => {
  // Clean Pairs three away: 4 circle pairs + 2 circle singles + a lone dragon.
  // EV = 0.08 x 500 = 40: meets the nudge bar (x1) but not the commit bar (x2).
  const threeAway = [...pr(cir, 1), ...pr(cir, 2), ...pr(cir, 4), ...pr(cir, 5),
    cir(7), cir(8), dragon('red')];

  it('nudges a target the AI would not yet commit to', () => {
    const st = makeState([player(0, threeAway), player(1, []), player(2, []), player(3, [])]);
    expect(chooseSpecialTarget(st, 0)).toBeNull();
    const nudge = nudgeSpecialTarget(st, 0);
    expect(nudge).not.toBeNull();
    expect(nudge!.name).toBe('Clean Pairs');
  });

  it('stays quiet on an ordinary hand', () => {
    const tiles = [bam(1), bam(2), bam(3), bam(5), bam(6), chr(2), chr(2, 1), chr(7),
      cir(3), cir(4), cir(8), wind('east'), dragon('red'), bam(9)];
    const st = makeState([player(0, tiles), player(1, []), player(2, []), player(3, [])]);
    expect(nudgeSpecialTarget(st, 0)).toBeNull();
  });

  it('adviseSeat surfaces the nudge for the hint panel', () => {
    const st = makeState([player(0, threeAway), player(1, []), player(2, []), player(3, [])]);
    const advice = adviseSeat(st, 0);
    expect(advice.nudge?.name).toBe('Clean Pairs');
    expect(advice.plan.special).toBeNull(); // the AI itself has not committed
  });
});

// --- keep/seek overrides in the action layer -----

describe('special plan drives discards and claims', () => {
  const sparrowTiles = [bam(1), bam(1, 1), bam(1, 2),
    ...pr(bam, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), ...pr(bam, 8), chr(5)];

  it('discards the offender, keeps every target tile', () => {
    const st = makeState([player(0, sparrowTiles), player(1, []), player(2, []), player(3, [])]);
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.special?.name).toBe("Sparrow's Sanctuary");
    expect(chooseDiscardTile(st, 0, plan)).toBe(chr(5).id);
    // Every needed tile outranks the offender.
    const offenderValue = keepValue(chr(5), plan, sparrowTiles);
    for (const t of sparrowTiles.filter(t => t.id !== chr(5).id)) {
      expect(keepValue(t, plan, sparrowTiles)).toBeGreaterThan(offenderValue);
    }
  });

  it('a spare copy of a needed kind is shed after junk but before target tiles', () => {
    // Third copy of 2-Bam: need only 2.
    const tiles = [bam(1), bam(1, 1), bam(1, 2), bam(1, 3),
      ...pr(bam, 2), bam(2, 2), ...pr(bam, 3), ...pr(bam, 4), ...pr(bam, 6), bam(8)];
    const st = makeState([player(0, tiles), player(1, []), player(2, []), player(3, [])]);
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.special?.name).toBe("Sparrow's Sanctuary");
    const spare = keepValue(bam(2, 2), plan, tiles);
    const needed = keepValue(bam(6), plan, tiles);
    expect(spare).toBeLessThan(needed);
    expect(chooseDiscardTile(st, 0, plan)).toBe(bam(2).id); // some copy of the spare kind
  });

  it('a concealed-only target never claims a discard', () => {
    const st = makeState(
      [player(0, sparrowTiles), player(1, []), player(2, []), player(3, [])],
      { phase: 'CLAIM_WINDOW', currentSeat: 3, discardPool: [bam(2, 2)] },
    );
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.special?.concealedOnly).toBe(true);
    // 0 holds a 2-Bam pair; normally this pung might tempt. Special forbids it.
    expect(chooseClaimDecision(st, 0, plan)).toEqual({ type: 'pass' });
  });

  it('a second-group target wins on the sought tile when it completes the hand', () => {
    // Four Blessings, one North short (13 tiles); the discarded North wins.
    const tiles = [...W3('east'), ...W3('south'), ...W3('west'),
      wind('north'), wind('north', 1), ...pr(bam, 5)];
    const st = makeState(
      [player(0, tiles), player(1, []), player(2, []), player(3, [])],
      { phase: 'CLAIM_WINDOW', currentSeat: 2, discardPool: [wind('north', 2)] },
    );
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.special?.name).toBe('Four Blessings Hovering Over the Door');
    expect(chooseClaimDecision(st, 0, plan)).toEqual({ type: 'win' });
  });

  it('a second-group target pungs a sought tile (not yet a win)', () => {
    // Two Norths + junk so a pung claim (not a win) is the right call.
    const tiles = [...W3('east'), ...W3('south'), ...W3('west'),
      wind('north'), wind('north', 1), bam(5), chr(2)];
    const st = makeState(
      [player(0, tiles), player(1, []), player(2, []), player(3, [])],
      { phase: 'CLAIM_WINDOW', currentSeat: 2, discardPool: [wind('north', 2)] },
    );
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.special?.name).toBe('Four Blessings Hovering Over the Door');
    expect(chooseClaimDecision(st, 0, plan)).toEqual({ type: 'pung' });
  });
});
