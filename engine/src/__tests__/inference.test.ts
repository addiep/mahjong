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
  it('reads a dragon pung as going for winds and dragons', () => {
    const p0 = player(0, [pung([dragon('red'), dragon('red', 1), dragon('red', 2)])]);
    const inf = inferPlayers(makeState([p0, player(1), player(2), player(3)], []));
    expect(inf[0]!.topGuesses[0]!.kind).toBe('honours');
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

  it('detects a fishing tempo from repeated just-drawn discards', () => {
    const p1 = player(1, [pung([cha(2), cha(2, 1), cha(2, 2)]), pung([cha(5), cha(5, 1), cha(5, 2)])]);
    const log = [entry(1, cir(1), 0, true), entry(1, cir(9), 1, true)];
    const inf = inferPlayers(makeState([player(0), p1, player(2), player(3)], log));
    expect(inf[1]!.closeness.fishing).toBe(true);
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
