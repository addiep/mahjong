/**
 * Tests for the private discard log (Modules 1.3 / 1.4).
 *
 * The log records who discarded which tile, in what order, and whether it was
 * subsequently claimed. It is append-only: claimed tiles leave the communal
 * pool but their log entry remains, annotated with the claimer's seat.
 */
import { describe, it, expect } from 'vitest';
import { dispatch } from '../turn-engine.js';
import {
  GameState, PlayerState, SeatIndex, DEFAULT_CONFIG,
} from '../game-state.js';
import { Tile, buildTileSet, Wind } from '../tiles.js';
import { Wall } from '../wall.js';

const ALL    = buildTileSet();
const SUITED = ALL.filter(t => t.category === 'suited');
const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

function suited(n: number, off = 0): Tile[] { return SUITED.slice(off, off + n); }
function bam(v: number): Tile[] {
  return ALL.filter(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === v);
}
function makeWall(live: Tile[] = [], dead: Tile[] = []): Wall { return { live, dead }; }

function makePlayer(
  seat: SeatIndex,
  concealed: Tile[],
  overrides: Partial<Omit<PlayerState, 'seat' | 'concealed'>> = {},
): PlayerState {
  return { name: `P${seat}`, seat, seatWind: WINDS[seat]!, concealed, melds: [], bonusTiles: [], score: 0, ...overrides };
}

function discardingState(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: DEFAULT_CONFIG,
    players,
    wall: makeWall(),
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

describe('discard log — recording discards', () => {
  it('appends an entry with author, ordinal, and unclaimed status on DISCARD', () => {
    const tiles = suited(14);
    const state = discardingState([
      makePlayer(0, tiles),
      makePlayer(1, suited(13, 20)),
      makePlayer(2, suited(13, 33)),
      makePlayer(3, suited(13, 46)),
    ]);
    const next = dispatch(state, { type: 'DISCARD', tileId: tiles[0]!.id });
    expect(next.discardLog).toHaveLength(1);
    expect(next.discardLog![0]).toMatchObject({ seat: 0, moveIndex: 0, claimedBy: null });
    expect(next.discardLog![0]!.tile.id).toBe(tiles[0]!.id);
  });

  it('treats an absent log as empty (backward compatible)', () => {
    const tiles = suited(14);
    const legacy = discardingState([
      makePlayer(0, tiles),
      makePlayer(1, suited(13, 20)),
      makePlayer(2, suited(13, 33)),
      makePlayer(3, suited(13, 46)),
    ]);
    delete (legacy as { discardLog?: unknown }).discardLog;
    const next = dispatch(legacy, { type: 'DISCARD', tileId: tiles[0]!.id });
    expect(next.discardLog).toHaveLength(1);
    expect(next.discardLog![0]!.moveIndex).toBe(0);
  });
});

describe('discard log — claim annotation', () => {
  it('marks claimedBy when a discard is punged, and keeps the entry after the pool clears', () => {
    const b5 = bam(5);
    const seat0 = makePlayer(0, [b5[0]!, ...suited(13, 60)]);
    const seat1 = makePlayer(1, [b5[1]!, b5[2]!, ...suited(11, 0)]);
    const state = discardingState([
      seat0, seat1,
      makePlayer(2, suited(13, 20)),
      makePlayer(3, suited(13, 33)),
    ]);

    let s = dispatch(state, { type: 'DISCARD', tileId: b5[0]!.id });
    expect(s.phase).toBe('CLAIM_WINDOW');
    expect(s.discardLog![0]!.claimedBy).toBeNull();

    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pung' } });

    expect(s.phase).toBe('DISCARDING');
    expect(s.discardPool).toHaveLength(0);      // tile left the communal pool
    expect(s.discardLog).toHaveLength(1);       // but the log keeps it
    expect(s.discardLog![0]!.claimedBy).toBe(1);
  });

  it('marks claimedBy on a winning claim', () => {
    const tiles = suited(14);
    const state = discardingState([
      makePlayer(0, tiles),
      makePlayer(1, suited(13, 20)),
      makePlayer(2, suited(13, 33)),
      makePlayer(3, suited(13, 46)),
    ]);
    let s = dispatch(state, { type: 'DISCARD', tileId: tiles[0]!.id });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'win' } });
    expect(s.phase).toBe('HAND_OVER');
    expect(s.discardLog![0]!.claimedBy).toBe(1);
  });

  it('leaves claimedBy null when everyone passes', () => {
    const tiles = suited(14);
    const state = discardingState([
      makePlayer(0, tiles),
      makePlayer(1, suited(13, 20)),
      makePlayer(2, suited(13, 33)),
      makePlayer(3, suited(13, 46)),
    ]);
    let s = dispatch(state, { type: 'DISCARD', tileId: tiles[0]!.id });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    expect(s.phase).toBe('DRAWING');
    expect(s.discardLog).toHaveLength(1);
    expect(s.discardLog![0]!.claimedBy).toBeNull();
  });
});

describe('discard log — append-only across turns', () => {
  it('increments moveIndex per discard and preserves earlier claim annotations', () => {
    const b5 = bam(5);
    const seat0 = makePlayer(0, [b5[0]!, ...suited(13, 60)]);
    const seat1 = makePlayer(1, [b5[1]!, b5[2]!, ...suited(11, 0)]);
    let s: GameState = discardingState([
      seat0, seat1,
      makePlayer(2, suited(13, 20)),
      makePlayer(3, suited(13, 33)),
    ]);

    s = dispatch(s, { type: 'DISCARD', tileId: b5[0]!.id });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pung' } });
    expect(s.currentSeat).toBe(1);

    const second = s.players[1]!.concealed[0]!;
    s = dispatch(s, { type: 'DISCARD', tileId: second.id });

    expect(s.discardLog).toHaveLength(2);
    expect(s.discardLog![1]).toMatchObject({ seat: 1, moveIndex: 1, claimedBy: null });
    expect(s.discardLog![1]!.tile.id).toBe(second.id);
    expect(s.discardLog![0]!.claimedBy).toBe(1);
  });
});
