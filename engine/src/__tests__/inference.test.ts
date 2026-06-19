/**
 * Tests for Module 5.2 -- the inference engine (opponent modelling).
 *
 * The engine reads only public-style information: exposed melds, the discard
 * log (provenance), the pool, and the config. It never reads concealed hands.
 */
import { describe, it, expect } from 'vitest';
import { inferPlayers, inferTable } from '../inference.js';
import {
  GameState, PlayerState, SeatIndex, DeclaredMeld, DiscardLogEntry, DEFAULT_CONFIG,
} from '../game-state.js';
import { dispatch } from '../turn-engine.js';
import { Tile, buildTileSet, Wind } from '../tiles.js';
import { Wall } from '../wall.js';

const ALL    = buildTileSet();
const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

function ofSuit(suit: string, value: number): Tile[] {
  return ALL.filter(t => t.category === 'suited' && (t as any).suit === suit && (t as any).value === value);
}
function bam(v: number, copy = 0): Tile { return ofSuit('bamboo', v)[copy]!; }
function cha(v: number, copy = 0): Tile { return ofSuit('characters', v)[copy]!; }
function cir(v: number, copy = 0): Tile { return ofSuit('circles', v)[copy]!; }
function dragon(colour: string, copy = 0): Tile {
  return ALL.filter(t => t.category === 'dragon' && (t as any).dragon === colour)[copy]!;
}
function wind(dir: string, copy = 0): Tile {
  return ALL.filter(t => t.category === 'wind' && (t as any).wind === dir)[copy]!;
}

function pung(tiles: Tile[]): DeclaredMeld { return { type: 'pung', tiles }; }
function chow(tiles: Tile[]): DeclaredMeld { return { type: 'chow', tiles }; }

function player(seat: SeatIndex, melds: DeclaredMeld[] = []): PlayerState {
  return { name: `P${seat}`, seat, seatWind: WINDS[seat]!, concealed: [], melds, bonusTiles: [], score: 0 };
}

function entry(seat: SeatIndex, tile: Tile, moveIndex: number, justDrawn = false): DiscardLogEntry {
  return { seat, tile, moveIndex, claimedBy: null, justDrawn };
}

function makeState(
  players: PlayerState[],
  discardLog: DiscardLogEntry[],
  over: Partial<GameState> = {},
): GameState {
  return {
    config: DEFAULT_CONFIG,
    players,
    wall: { live: [], dead: [] } as Wall,
    discardPool: discardLog.filter(e => e.claimedBy === null).map(e => e.tile),
    currentSeat: 0,
    phase: 'DISCARDING',
    prevailingWind: 'east',
    handNumber: 0,
    handResult: null,
    claimWindow: null,
    robbingKong: null,
    discardLog,
    ...over,
  };
}

describe('inference -- suit collection from exposed melds', () => {
  it('reads a bamboo pung as collecting bamboo, with high confidence', () => {
    const p0 = player(0, [pung([bam(3), bam(3, 1), bam(3, 2)])]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    const top = inf[0]!.topGuesses[0]!;
    expect(top.kind).toBe('bamboo');
    expect(top.confidence).toBe('high');
  });

  it('flags two suited melds in different suits as a mixed hand, not a clean suit', () => {
    const p0 = player(0, [pung([bam(3), bam(3, 1), bam(3, 2)]), pung([cir(7), cir(7, 1), cir(7, 2)])]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    expect(inf[0]!.topGuesses[0]!.kind).toBe('mixed');
  });

  it('does not suggest all pungs for a mixed hand built from chows', () => {
    // Two exposed chows in different suits: a mixed hand, but plainly not all pungs.
    const p0 = player(0, [chow([bam(1), bam(2), bam(3)]), chow([cir(4), cir(5), cir(6)])]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    const top = inf[0]!.topGuesses[0]!;
    expect(top.kind).toBe('mixed');
    expect(top.label).not.toContain('pung');
  });
});

describe('inference -- suit collection from discards', () => {
  it('leans toward the suits a player never discards', () => {
    // P1 sheds circles repeatedly, keeps bamboo and characters.
    const log = [
      entry(1, cir(2), 0), entry(1, cir(5), 1), entry(1, cir(8), 2), entry(1, cir(9), 3),
    ];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log));
    const kinds = inf[1]!.topGuesses.map(g => g.kind);
    expect(kinds).toContain('bamboo');
    expect(kinds).toContain('characters');
    expect(kinds).not.toContain('circles');
  });
});

describe('inference -- honours', () => {
  it('does not read a single dragon pung as an all-honours hand', () => {
    // One dragon pung is normal in an ordinary suit hand; it is not "winds & dragons".
    const p0 = player(0, [pung([dragon('red'), dragon('red', 1), dragon('red', 2)])]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    expect(inf[0]!.topGuesses.map(g => g.kind)).not.toContain('honours');
  });

  it('reads two exposed honour pungs as an all-honours special hand', () => {
    const p0 = player(0, [
      pung([dragon('red'), dragon('red', 1), dragon('red', 2)]),
      pung([wind('east'), wind('east', 1), wind('east', 2)]),
    ]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    expect(inf[0]!.topGuesses[0]!.kind).toBe('honours');
    expect(inf[0]!.topGuesses[0]!.label).toContain('all-honours');
  });

  it('treats an early dragon discard as a strong negative for honours', () => {
    const log = [entry(2, dragon('green'), 0)];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log));
    const honours = inf[2]!.topGuesses.find(g => g.kind === 'honours');
    expect(honours).toBeUndefined();
  });
});

describe('inference -- knitting fingerprint', () => {
  it('guesses knitting when a player sheds one suit plus honours and keeps two', () => {
    const cfg = { ...DEFAULT_CONFIG, knittingEnabled: true };
    // P3 throws only circles + honours; keeps bamboo and characters.
    const log = [
      entry(3, cir(2), 0), entry(3, wind('north'), 1), entry(3, cir(6), 2), entry(3, dragon('white'), 3),
    ];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log, { config: cfg }));
    const kinds = inf[3]!.topGuesses.map(g => g.kind);
    expect(kinds).toContain('knitting');
  });

  it('does not guess knitting when the config disables it', () => {
    const log = [
      entry(3, cir(2), 0), entry(3, wind('north'), 1), entry(3, cir(6), 2), entry(3, dragon('white'), 3),
    ];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log));
    expect(inf[3]!.topGuesses.map(g => g.kind)).not.toContain('knitting');
  });
});

describe('inference -- closeness', () => {
  it('flags a player with three melds as near a win', () => {
    const p0 = player(0, [
      pung([bam(1), bam(1, 1), bam(1, 2)]),
      chow([bam(4), bam(5), bam(6)]),
      pung([bam(9), bam(9, 1), bam(9, 2)]),
    ]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    expect(inf[0]!.closeness.level).toBe('near');
    expect(inf[0]!.closeness.note).toMatch(/one or two tiles/);
  });

  it('does not call it fishing while still building with only two melds', () => {
    // Two melds + freshly-drawn discards early on is normal play, not fishing.
    const p1 = player(1, [pung([cha(2), cha(2, 1), cha(2, 2)]), pung([cha(5), cha(5, 1), cha(5, 2)])]);
    const log = [entry(1, cir(1), 0, true), entry(1, cir(9), 1, true)];
    const inf = inferPlayers(makeState([player(0), p1, player(2), player(3)], log));
    expect(inf[1]!.closeness.note ?? '').not.toContain('fishing');
  });

  it('reads a fishing tempo once the player has three melds down', () => {
    const p1 = player(1, [
      pung([cha(2), cha(2, 1), cha(2, 2)]),
      pung([cha(5), cha(5, 1), cha(5, 2)]),
      chow([bam(1), bam(2), bam(3)]),
    ]);
    const log = [entry(1, cir(1), 0, true), entry(1, cir(9), 1, true)];
    const inf = inferPlayers(makeState([player(0), p1, player(2), player(3)], log));
    expect(inf[1]!.closeness.note ?? '').toContain('fishing');
  });
});

describe('inference -- safe tiles', () => {
  it('marks an honour as safe once three copies are visible', () => {
    // Three red dragons in the discard log -> the fourth is safe to throw.
    const log = [entry(1, dragon('red', 0), 0), entry(2, dragon('red', 1), 1), entry(3, dragon('red', 2), 2)];
    const { safeToDiscard } = inferTable(makeState([player(0), player(1), player(2), player(3)], log));
    expect(safeToDiscard.some(n => n.label === 'red dragon' && n.certainty === 'safe')).toBe(true);
  });

  it('counts an exposed pung toward the three-copies-visible threshold', () => {
    const p2 = player(2, [pung([dragon('white', 0), dragon('white', 1), dragon('white', 2)])]);
    const { safeToDiscard } = inferTable(makeState([player(0), player(1), p2, player(3)], []));
    expect(safeToDiscard.some(n => n.label === 'white dragon')).toBe(true);
  });
});

describe('inference -- plumbing (justDrawn through the turn engine)', () => {
  it('records justDrawn=true when a player discards the tile they just drew', () => {
    // East opens holding 13 + a wall tile to draw; drawing then discarding it
    // should be flagged as just-drawn.
    const east = player(0);
    const handEast = ALL.filter(t => t.category === 'suited').slice(0, 13);
    const drawTile = bam(1);
    const start: GameState = makeState(
      [
        { ...east, concealed: handEast },
        { ...player(1), concealed: ALL.filter(t => t.category === 'suited').slice(20, 33) },
        { ...player(2), concealed: ALL.filter(t => t.category === 'suited').slice(33, 46) },
        { ...player(3), concealed: ALL.filter(t => t.category === 'suited').slice(46, 59) },
      ],
      [],
      { phase: 'DRAWING', wall: { live: [drawTile], dead: [] } as Wall },
    );
    const afterDraw = dispatch(start, { type: 'BEGIN_TURN' });
    expect(afterDraw.lastDrawnTileId).toBe(drawTile.id);
    const afterDiscard = dispatch(afterDraw, { type: 'DISCARD', tileId: drawTile.id });
    const last = afterDiscard.discardLog!.at(-1)!;
    expect(last.tile.id).toBe(drawTile.id);
    expect(last.justDrawn).toBe(true);
  });
});

// --- Playtesting feedback (2026-06-18 session): targeted regression cases -----

describe('inference -- honours needs real evidence', () => {
  it('does not infer winds & dragons from a single early suited discard', () => {
    // C's only discard is the 2 of bamboo. You cannot read an honours hand from that.
    const log = [entry(2, bam(2), 0)];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log));
    const honours = inf[2]!.topGuesses.find(g => g.kind === 'honours');
    expect(honours).toBeUndefined();
  });

  it('does not infer honours merely because no honour was discarded', () => {
    // Four bamboo discards, no honours thrown: a one-suit lean, not an honours lean.
    const log = [entry(1, bam(2), 0), entry(1, bam(5), 1), entry(1, bam(7), 2), entry(1, bam(9), 3)];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log));
    expect(inf[1]!.topGuesses.map(g => g.kind)).not.toContain('honours');
  });
});

describe('inference -- exposed melds rule out an all-honours hand', () => {
  it('drops the honours guess when a dragon pung is paired with a suited chow', () => {
    // C: exposed pung of green dragons + a chow of characters. A chow makes an
    // all-honours hand impossible, so "winds & dragons" must not appear.
    const p2 = player(2, [
      pung([dragon('green'), dragon('green', 1), dragon('green', 2)]),
      chow([cha(4), cha(5), cha(6)]),
    ]);
    const inf = inferPlayers(makeState([player(0), player(1), p2, player(3)], []));
    const kinds = inf[2]!.topGuesses.map(g => g.kind);
    expect(kinds).toContain('characters');
    expect(kinds).not.toContain('honours');
  });
});

describe('inference -- knitting suit pair', () => {
  it('names the two kept suits when a knitter sheds circles + honours', () => {
    const cfg = { ...DEFAULT_CONFIG, knittingEnabled: true };
    const log = [
      entry(3, cir(2), 0), entry(3, wind('north'), 1), entry(3, cir(6), 2), entry(3, dragon('white'), 3),
    ];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), player(3)], log, { config: cfg }));
    const knit = inf[3]!.topGuesses.find(g => g.kind === 'knitting')!;
    expect(knit.label).toBe('knitting bamboo and characters');
    expect(knit.label).not.toContain('two-suit pairs');
  });

  it('rules out knitting once the player has any exposed meld', () => {
    const cfg = { ...DEFAULT_CONFIG, knittingEnabled: true };
    // Same shedding fingerprint, but the player has exposed a meld -> not wall-only.
    const p3 = player(3, [chow([bam(4), bam(5), bam(6)])]);
    const log = [
      entry(3, cir(2), 0), entry(3, wind('north'), 1), entry(3, cir(6), 2), entry(3, dragon('white'), 3),
    ];
    const inf = inferPlayers(makeState([player(0), player(1), player(2), p3], log, { config: cfg }));
    expect(inf[3]!.topGuesses.map(g => g.kind)).not.toContain('knitting');
  });
});

describe('inference -- safe tiles vs out of play', () => {
  it('does not list a tile as safe once all four copies are visible', () => {
    // Exposed pung of green dragons (3) + the fourth discarded = all four out.
    const p1 = player(1, [pung([dragon('green', 0), dragon('green', 1), dragon('green', 2)])]);
    const log = [entry(0, dragon('green', 3), 0)];
    const { safeToDiscard, outOfPlay } =
      inferTable(makeState([player(0), p1, player(2), player(3)], log));
    expect(safeToDiscard.some(n => n.label === 'green dragon')).toBe(false);
    expect(outOfPlay.some(n => n.label === 'green dragon')).toBe(true);
  });

  it('still lists a tile as safe when exactly three copies are visible', () => {
    const log = [entry(1, dragon('red', 0), 0), entry(2, dragon('red', 1), 1), entry(3, dragon('red', 2), 2)];
    const { safeToDiscard } = inferTable(makeState([player(0), player(1), player(2), player(3)], log));
    expect(safeToDiscard.some(n => n.label === 'red dragon' && n.certainty === 'safe')).toBe(true);
  });
});

describe('inference -- out-of-play tracking', () => {
  it('reports a fully-exhausted kind under every player as not held', () => {
    const p1 = player(1, [pung([dragon('green', 0), dragon('green', 1), dragon('green', 2)])]);
    const log = [entry(0, dragon('green', 3), 0)];
    const table = inferTable(makeState([player(0), p1, player(2), player(3)], log));
    for (const p of table.players) {
      expect(p.notHolding.some(n => n.label === 'green dragon')).toBe(true);
    }
  });
});
