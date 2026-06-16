/**
 * Tests for Module 1.4 — Turn Engine
 */
import { describe, it, expect } from 'vitest';
import { dispatch } from '../turn-engine.js';
import {
  GameState, PlayerState, SeatIndex,
  DEFAULT_CONFIG, ClaimDecision, DeclaredMeld,
} from '../game-state.js';
import { Tile, buildTileSet, Wind } from '../tiles.js';
import { Wall } from '../wall.js';

const ALL_TILES   = buildTileSet();
const SUITED      = ALL_TILES.filter(t => t.category === 'suited');
const BONUS_TILES = ALL_TILES.filter(t => t.category === 'flower' || t.category === 'season');

function suited(n: number, offset = 0): Tile[] { return SUITED.slice(offset, offset + n); }
function makeWall(live: Tile[] = [], dead: Tile[] = []): Wall { return { live, dead }; }

function makePlayer(
  seat: SeatIndex,
  concealed: Tile[],
  overrides: Partial<Omit<PlayerState, 'seat' | 'concealed'>> = {},
): PlayerState {
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  return { name: `P${seat}`, seat, seatWind: winds[seat]!, concealed, melds: [], bonusTiles: [], score: 0, ...overrides };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const config = overrides.config ?? DEFAULT_CONFIG;
  const pc     = config.playerCount;
  const tilePool = suited(14 * pc, 0);
  const defaultPlayers: PlayerState[] = Array.from({ length: pc }, (_, i) => {
    const size  = i === 0 ? 14 : 13;
    const start = i === 0 ? 0 : 14 + (i - 1) * 13;
    return makePlayer(i as SeatIndex, tilePool.slice(start, start + size));
  });
  return {
    config,
    players:        overrides.players        ?? defaultPlayers,
    wall:           overrides.wall           ?? makeWall(),
    discardPool:    overrides.discardPool    ?? [],
    currentSeat:    overrides.currentSeat    ?? 0,
    phase:          overrides.phase          ?? 'DRAWING',
    prevailingWind: overrides.prevailingWind ?? 'east',
    handNumber:     overrides.handNumber     ?? 0,
    handResult:     overrides.handResult     ?? null,
    claimWindow:    overrides.claimWindow    ?? null,
    robbingKong:    overrides.robbingKong    ?? null,
  };
}

function discardingState(seat: SeatIndex, tiles: Tile[], pc = 4): GameState {
  const config = { ...DEFAULT_CONFIG, playerCount: pc as 3 | 4 };
  const tilePool = suited(13 * pc, 50);
  const players: PlayerState[] = Array.from({ length: pc }, (_, i) =>
    i === seat ? makePlayer(i as SeatIndex, tiles) : makePlayer(i as SeatIndex, tilePool.slice(i * 13, i * 13 + 13)));
  return makeState({ config, players, currentSeat: seat, phase: 'DISCARDING' });
}

function claimWindowState(discardedTile: Tile, pc = 4, partialResponses: Partial<Record<SeatIndex, ClaimDecision>> = {}): GameState {
  const config   = { ...DEFAULT_CONFIG, playerCount: pc as 3 | 4 };
  const tilePool = suited(13 * pc, 20);
  const players: PlayerState[] = Array.from({ length: pc }, (_, i) => makePlayer(i as SeatIndex, tilePool.slice(i * 13, i * 13 + 13)));
  const responses: (ClaimDecision | null)[] = Array.from({ length: pc }, (_, i) => {
    if (i === 0) return { type: 'pass' };
    return partialResponses[i as SeatIndex] ?? null;
  });
  return makeState({ config, players, currentSeat: 0, phase: 'CLAIM_WINDOW', discardPool: [discardedTile], claimWindow: { responses } });
}

// ─── DRAWING ─────────────────────────────────────────────────────────────
describe('dispatch — DRAWING', () => {
  it('draws a tile from the live wall and transitions to DISCARDING', () => {
    const drawTile = suited(1, 80)[0]!;
    const state    = makeState({
      wall:    makeWall([drawTile], BONUS_TILES.slice(0, 4)),
      players: [makePlayer(0, suited(13)), ...Array.from({ length: 3 }, (_, i) => makePlayer((i + 1) as SeatIndex, suited(13, 13 + i * 13)))],
    });
    const next = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[0]!.concealed).toHaveLength(14);
    expect(next.players[0]!.concealed.at(-1)?.id).toBe(drawTile.id);
    expect(next.wall.live).toHaveLength(0);
  });

  it('skips the draw when East already holds 14 tiles', () => {
    const state = makeState({ wall: makeWall([], BONUS_TILES.slice(0, 4)) });
    const next  = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[0]!.concealed).toHaveLength(14);
  });

  it('enters HAND_OVER (draw game) when the live wall is exhausted', () => {
    const state = makeState({
      players: [makePlayer(0, suited(13)), ...Array.from({ length: 3 }, (_, i) => makePlayer((i + 1) as SeatIndex, suited(13, 13 + i * 13)))],
      wall: makeWall([], []),
    });
    const next = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.reason).toBe('draw');
  });

  it('enters CHECK_BONUS if a bonus tile is among the concealed tiles', () => {
    const bonusTile = BONUS_TILES[0]!;
    const state = makeState({
      players: [makePlayer(0, [...suited(13), bonusTile]), ...Array.from({ length: 3 }, (_, i) => makePlayer((i + 1) as SeatIndex, suited(13, 13 + i * 13)))],
      wall: makeWall([], BONUS_TILES.slice(1, 5)),
    });
    const next = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('CHECK_BONUS');
    expect(next.players[0]!.bonusTiles).toContainEqual(bonusTile);
  });

  it('throws if the action is not BEGIN_TURN', () => {
    expect(() => dispatch(makeState(), { type: 'DRAW_REPLACEMENT' })).toThrow('DRAWING phase expects BEGIN_TURN');
  });
});

// ─── CHECK_BONUS ───────────────────────────────────────────────────────
describe('dispatch — CHECK_BONUS', () => {
  function checkBonusState(dead: Tile[]): GameState { return makeState({ phase: 'CHECK_BONUS', wall: makeWall([], dead) }); }

  it('draws a replacement and transitions to DISCARDING when it is not a bonus', () => {
    const replacement = suited(1, 90)[0]!;
    const next = dispatch(checkBonusState([replacement]), { type: 'DRAW_REPLACEMENT' });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[0]!.concealed).toContainEqual(replacement);
  });

  it('stays in CHECK_BONUS when the replacement is itself a bonus tile', () => {
    const bonusReplacement = BONUS_TILES[1]!;
    const next = dispatch(checkBonusState([bonusReplacement]), { type: 'DRAW_REPLACEMENT' });
    expect(next.phase).toBe('CHECK_BONUS');
    expect(next.players[0]!.bonusTiles).toContainEqual(bonusReplacement);
  });

  it('chains correctly through multiple bonus replacements', () => {
    const b1 = BONUS_TILES[2]!, b2 = BONUS_TILES[3]!, regular = suited(1, 95)[0]!;
    let s = makeState({ phase: 'CHECK_BONUS', wall: makeWall([], [b1, b2, regular]) });
    s = dispatch(s, { type: 'DRAW_REPLACEMENT' });
    expect(s.phase).toBe('CHECK_BONUS');
    s = dispatch(s, { type: 'DRAW_REPLACEMENT' });
    expect(s.phase).toBe('CHECK_BONUS');
    s = dispatch(s, { type: 'DRAW_REPLACEMENT' });
    expect(s.phase).toBe('DISCARDING');
    expect(s.players[0]!.bonusTiles).toHaveLength(2);
    expect(s.players[0]!.concealed).toContainEqual(regular);
  });

  it('enters HAND_OVER (draw) when the dead wall is exhausted', () => {
    const next = dispatch(checkBonusState([]), { type: 'DRAW_REPLACEMENT' });
    expect(next.phase).toBe('HAND_OVER');
  });

  it('throws if the action is not DRAW_REPLACEMENT', () => {
    expect(() => dispatch(makeState({ phase: 'CHECK_BONUS' }), { type: 'BEGIN_TURN' })).toThrow('CHECK_BONUS phase expects DRAW_REPLACEMENT');
  });
});

// ─── DISCARDING ─────────────────────────────────────────────────────────
describe('dispatch — DISCARDING', () => {
  it('removes the discarded tile and opens a claim window', () => {
    const tiles = suited(14);
    const next  = dispatch(discardingState(0, tiles), { type: 'DISCARD', tileId: tiles[0]!.id });
    expect(next.phase).toBe('CLAIM_WINDOW');
    expect(next.players[0]!.concealed).toHaveLength(13);
    expect(next.discardPool.at(-1)?.id).toBe(tiles[0]!.id);
  });

  it('pre-fills the discarder slot in the claim window as pass', () => {
    const tiles = suited(14);
    const next  = dispatch(discardingState(0, tiles), { type: 'DISCARD', tileId: tiles[0]!.id });
    expect(next.claimWindow!.responses[0]).toEqual({ type: 'pass' });
    expect(next.claimWindow!.responses[1]).toBeNull();
  });

  it('throws when the tile to discard is not in the concealed hand', () => {
    const tiles = suited(14);
    const ghost = suited(1, 100)[0]!;
    expect(() => dispatch(discardingState(0, tiles), { type: 'DISCARD', tileId: ghost.id })).toThrow('not found in concealed hand');
  });

  it('declares a concealed kong and enters CHECK_BONUS', () => {
    const quad = ALL_TILES.filter(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 5);
    const next = dispatch(discardingState(0, [...quad, ...suited(10, 40)]), { type: 'DECLARE_CONCEALED_KONG', tileId: quad[0]!.id });
    expect(next.phase).toBe('CHECK_BONUS');
    expect(next.players[0]!.melds[0]!.type).toBe('concealed_kong');
  });

  it('throws on DECLARE_CONCEALED_KONG with fewer than 4 matching tiles', () => {
    // 14 distinct tile kinds → no kind has 4 copies in hand.
    const tiles = Array.from({ length: 14 }, (_, i) => SUITED[i * 4]!);
    expect(() => dispatch(discardingState(0, tiles), { type: 'DECLARE_CONCEALED_KONG', tileId: tiles[0]!.id })).toThrow('need 4 matching tiles');
  });

  it('declares a self-draw win and ends the hand', () => {
    const next = dispatch(discardingState(2, suited(14)), { type: 'DECLARE_WIN' });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.winnerSeat).toBe(2);
    expect(next.handResult?.selfDraw).toBe(true);
  });

  it('throws on an unexpected action type in DISCARDING', () => {
    expect(() => dispatch(discardingState(0, suited(14)), { type: 'BEGIN_TURN' })).toThrow('DISCARDING phase: unexpected action');
  });
});

// ─── CLAIM_WINDOW ──────────────────────────────────────────────────────
describe('dispatch — CLAIM_WINDOW', () => {
  const discardedTile = suited(1, 99)[0]!;

  it('records a response and stays in CLAIM_WINDOW while others have not replied', () => {
    const next = dispatch(claimWindowState(discardedTile), { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pass' } });
    expect(next.phase).toBe('CLAIM_WINDOW');
    expect(next.claimWindow!.responses[1]).toEqual({ type: 'pass' });
  });

  it('advances to the next player when all pass', () => {
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' }, 2: { type: 'pass' } });
    const next  = dispatch(state, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    expect(next.phase).toBe('DRAWING');
    expect(next.currentSeat).toBe(1);
  });

  it('resolves a pung claim — claimer enters DISCARDING with the meld formed', () => {
    const discarded  = suited(1, 99)[0]!;
    const discardKey = `suited:${(discarded as any).suit}:${(discarded as any).value}`;
    const sameKind   = ALL_TILES.filter(t => t.category === 'suited'
      && `suited:${(t as any).suit}:${(t as any).value}` === discardKey && t.id !== discarded.id);
    const [m1, m2] = sameKind;
    const players  = [makePlayer(0, suited(13, 0)), makePlayer(1, [m1!, m2!, ...suited(11, 60)]), makePlayer(2, suited(13, 30)), makePlayer(3, suited(13, 43))];
    const state = makeState({ players, currentSeat: 0, phase: 'CLAIM_WINDOW', discardPool: [discarded], claimWindow: { responses: [{ type: 'pass' }, null, { type: 'pass' }, { type: 'pass' }] } });
    const next = dispatch(state, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pung' } });
    expect(next.phase).toBe('DISCARDING');
    expect(next.currentSeat).toBe(1);
    expect(next.players[1]!.melds[0]!.type).toBe('pung');
    expect(next.discardPool).toHaveLength(0);
  });

  it('resolves a chow claim — claimer enters DISCARDING with the meld', () => {
    const b4 = ALL_TILES.find(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 4)!;
    const b5 = ALL_TILES.find(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 5)!;
    const b6 = ALL_TILES.find(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 6)!;
    const players = [makePlayer(0, suited(13, 0)), makePlayer(1, [b4, b6, ...suited(11, 60)]), makePlayer(2, suited(13, 30)), makePlayer(3, suited(13, 43))];
    const state = makeState({ players, currentSeat: 0, phase: 'CLAIM_WINDOW', discardPool: [b5], claimWindow: { responses: [{ type: 'pass' }, null, { type: 'pass' }, { type: 'pass' }] } });
    const next = dispatch(state, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'chow', chowTiles: [b4.id, b6.id] } });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[1]!.melds[0]!.type).toBe('chow');
    expect(next.discardPool).toHaveLength(0);
  });

  it('resolves a win claim — HAND_OVER with the correct winner', () => {
    const state = claimWindowState(discardedTile, 4, { 2: { type: 'pass' }, 3: { type: 'pass' } });
    const next  = dispatch(state, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'win' } });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.winnerSeat).toBe(1);
    expect(next.handResult?.selfDraw).toBe(false);
  });

  it('picks the closest-clockwise winner on simultaneous win claims', () => {
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' }, 2: { type: 'win' } });
    const next  = dispatch(state, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'win' } });
    expect(next.handResult?.winnerSeat).toBe(2);
  });

  it('enforces the chow-from-left rule', () => {
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' }, 3: { type: 'pass' } });
    expect(() => dispatch(state, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'chow', chowTiles: [suited(1, 70)[0]!.id, suited(1, 71)[0]!.id] } })).toThrow('only seat 1');
  });

  it('throws if a player tries to respond twice', () => {
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' } });
    expect(() => dispatch(state, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pass' } })).toThrow('already responded');
  });

  it('throws if the discarder tries to claim', () => {
    expect(() => dispatch(claimWindowState(discardedTile), { type: 'CLAIM_RESPONSE', seat: 0, decision: { type: 'pass' } })).toThrow('discarder cannot claim');
  });

  it('throws if action is not CLAIM_RESPONSE', () => {
    expect(() => dispatch(makeState({ phase: 'CLAIM_WINDOW', claimWindow: { responses: [] } }), { type: 'BEGIN_TURN' })).toThrow('CLAIM_WINDOW expects CLAIM_RESPONSE');
  });
});

// ─── DECLARE_ADDED_KONG & ROBBING_KONG ─────────────────────────────────────────
describe('dispatch — added kong and Robbing the Kong', () => {
  const bam = (v: number) => ALL_TILES.filter(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === v);

  /** Seat 0 holds an exposed pung of bamboo-5 and the 4th bamboo-5, ready to promote. */
  function addedKongState(robberConcealed?: Tile[]): GameState {
    const b5 = bam(5);
    const pung: DeclaredMeld = { type: 'pung', tiles: [b5[0]!, b5[1]!, b5[2]!] };
    const seat0 = makePlayer(0, [b5[3]!, ...suited(10, 60)], { melds: [pung] });
    const players: PlayerState[] = [
      seat0,
      makePlayer(1, robberConcealed ?? suited(13, 80)),
      makePlayer(2, suited(13, 30)),
      makePlayer(3, suited(13, 43)),
    ];
    return makeState({ players, currentSeat: 0, phase: 'DISCARDING' });
  }

  it('promotes an exposed pung to an open kong and opens ROBBING_KONG', () => {
    const next = dispatch(addedKongState(), { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id });
    expect(next.phase).toBe('ROBBING_KONG');
    expect(next.players[0]!.melds[0]!.type).toBe('open_kong');
    expect(next.players[0]!.melds[0]!.tiles).toHaveLength(4);
    expect(next.players[0]!.concealed.map(t => t.id)).not.toContain(bam(5)[3]!.id);
    expect(next.robbingKong!.tile.id).toBe(bam(5)[3]!.id);
    expect(next.robbingKong!.melderSeat).toBe(0);
    expect(next.robbingKong!.responses[0]).toEqual({ type: 'pass' });
    expect(next.robbingKong!.responses[1]).toBeNull();
  });

  it('throws when there is no exposed pung to promote', () => {
    const seat0 = makePlayer(0, [bam(5)[3]!, ...suited(13, 60)]);
    const state = makeState({ players: [seat0, makePlayer(1, suited(13, 0)), makePlayer(2, suited(13, 30)), makePlayer(3, suited(13, 90))], currentSeat: 0, phase: 'DISCARDING' });
    expect(() => dispatch(state, { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id })).toThrow('no exposed pung');
  });

  it('lets a waiting player rob the kong and win', () => {
    const robber = [bam(1)[0]!, bam(1)[1]!, bam(2)[0]!, bam(3)[0]!, bam(3)[1]!, bam(4)[0]!, bam(4)[1]!, bam(6)[0]!, bam(7)[0]!, bam(7)[1]!, bam(8)[0]!, bam(8)[1]!, bam(9)[0]!];
    const promoted = dispatch(addedKongState(robber), { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id });
    let s = dispatch(promoted, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'win' } });
    expect(s.phase).toBe('ROBBING_KONG'); // still waiting on seats 2 & 3
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    expect(s.phase).toBe('HAND_OVER');
    expect(s.handResult?.winnerSeat).toBe(1);
    expect(s.handResult?.selfDraw).toBe(false);
  });

  it('continues to the kong replacement draw when nobody robs', () => {
    const promoted = dispatch(addedKongState(), { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id });
    let s = dispatch(promoted, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 2, decision: { type: 'pass' } });
    s = dispatch(s, { type: 'CLAIM_RESPONSE', seat: 3, decision: { type: 'pass' } });
    expect(s.phase).toBe('CHECK_BONUS');
    expect(s.robbingKong).toBeNull();
    expect(s.currentSeat).toBe(0);
  });

  it('rejects a non-win claim during ROBBING_KONG', () => {
    const promoted = dispatch(addedKongState(), { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id });
    expect(() => dispatch(promoted, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pung' } })).toThrow("only 'win' or 'pass'");
  });

  it('forbids the melder from robbing their own kong', () => {
    const promoted = dispatch(addedKongState(), { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id });
    expect(() => dispatch(promoted, { type: 'CLAIM_RESPONSE', seat: 0, decision: { type: 'pass' } })).toThrow('cannot rob their own kong');
  });

  it('rejects a robbing win that is not a winning hand', () => {
    const promoted = dispatch(addedKongState(), { type: 'DECLARE_ADDED_KONG', tileId: bam(5)[3]!.id });
    expect(() => dispatch(promoted, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'win' } })).toThrow('cannot win on');
  });
});

// ─── HAND_OVER ─────────────────────────────────────────────────────────
describe('dispatch — HAND_OVER', () => {
  it('throws on any action after the hand has ended', () => {
    const state = makeState({ phase: 'HAND_OVER', handResult: { reason: 'draw', winnerSeat: null, selfDraw: null } });
    expect(() => dispatch(state, { type: 'BEGIN_TURN' })).toThrow('cannot act on a completed hand');
  });
});
