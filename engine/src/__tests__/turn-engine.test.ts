/**
 * Tests for Module 1.4 — Turn Engine
 *
 * Each test builds a minimal GameState for the scenario under test and
 * verifies the resulting state after dispatching an action.
 */

import { describe, it, expect } from 'vitest';
import { dispatch } from '../turn-engine.js';
import {
  GameState, GameConfig, PlayerState, SeatIndex,
  DEFAULT_CONFIG, ClaimDecision, ClaimWindowState,
} from '../game-state.js';
import { Tile, buildTileSet, Wind } from '../tiles.js';
import { Wall } from '../wall.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const ALL_TILES  = buildTileSet();
const SUITED     = ALL_TILES.filter(t => t.category === 'suited');
const BONUS_TILES = ALL_TILES.filter(t => t.category === 'flower' || t.category === 'season');

/** Grab `n` suited tiles from the pool (distinct instances). */
function suited(n: number, offset = 0): Tile[] {
  return SUITED.slice(offset, offset + n);
}

function makeWall(live: Tile[] = [], dead: Tile[] = []): Wall {
  return { live, dead };
}

function makePlayer(
  seat:      SeatIndex,
  concealed: Tile[],
  overrides: Partial<Omit<PlayerState, 'seat' | 'concealed'>> = {},
): PlayerState {
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  return {
    name:       `P${seat}`,
    seat,
    seatWind:   winds[seat],
    concealed,
    melds:      [],
    bonusTiles: [],
    score:      0,
    ...overrides,
  };
}

/** Build a minimal 4-player GameState with configurable overrides. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const config = overrides.config ?? DEFAULT_CONFIG;
  const pc     = config.playerCount;

  // Default: each player has 13 suited tiles (East has 14), empty walls.
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
  };
}

/** Convenience: a state where a single player holds `tiles` and it is their DISCARDING turn. */
function discardingState(seat: SeatIndex, tiles: Tile[], pc = 4): GameState {
  const config = { ...DEFAULT_CONFIG, playerCount: pc as 3 | 4 };
  const tilePool = suited(13 * pc, 50); // offset to avoid collision with `tiles`
  const players: PlayerState[] = Array.from({ length: pc }, (_, i) =>
    i === seat
      ? makePlayer(i as SeatIndex, tiles)
      : makePlayer(i as SeatIndex, tilePool.slice(i * 13, i * 13 + 13)),
  );
  return makeState({ config, players, currentSeat: seat, phase: 'DISCARDING' });
}

/** Convenience: a state in CLAIM_WINDOW, discarder = seat 0, responses all null except seat 0. */
function claimWindowState(
  discardedTile: Tile,
  pc             = 4,
  partialResponses: Partial<Record<SeatIndex, ClaimDecision>> = {},
): GameState {
  const config   = { ...DEFAULT_CONFIG, playerCount: pc as 3 | 4 };
  const tilePool = suited(13 * pc, 20);
  const players: PlayerState[] = Array.from({ length: pc }, (_, i) =>
    makePlayer(i as SeatIndex, tilePool.slice(i * 13, i * 13 + 13)),
  );
  const responses: (ClaimDecision | null)[] = Array.from({ length: pc }, (_, i) => {
    if (i === 0) return { type: 'pass' }; // discarder
    return partialResponses[i as SeatIndex] ?? null;
  });
  return makeState({
    config,
    players,
    currentSeat:  0,
    phase:        'CLAIM_WINDOW',
    discardPool:  [discardedTile],
    claimWindow:  { responses },
  });
}

// ─── DRAWING ──────────────────────────────────────────────────────────────────

describe('dispatch — DRAWING', () => {
  it('draws a tile from the live wall and transitions to DISCARDING', () => {
    const drawTile = suited(1, 80)[0];
    const state    = makeState({
      wall:        makeWall([drawTile], BONUS_TILES.slice(0, 4)),
      // Seat 0 has 13 tiles so needs to draw.
      players:     [makePlayer(0, suited(13)), ...Array.from({ length: 3 }, (_, i) =>
        makePlayer((i + 1) as SeatIndex, suited(13, 13 + i * 13)),
      )],
    });
    const next = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[0].concealed).toHaveLength(14);
    expect(next.players[0].concealed.at(-1)?.id).toBe(drawTile.id);
    expect(next.wall.live).toHaveLength(0);
  });

  it('skips the draw when East already holds 14 tiles (initial deal)', () => {
    // Default makeState gives East 14 tiles; wall is empty.
    const state = makeState({ wall: makeWall([], BONUS_TILES.slice(0, 4)) });
    const next  = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[0].concealed).toHaveLength(14);
  });

  it('enters HAND_OVER (draw game) when the live wall is exhausted', () => {
    const state = makeState({
      // Seat 0 has only 13 tiles and needs to draw — wall is empty.
      players: [makePlayer(0, suited(13)), ...Array.from({ length: 3 }, (_, i) =>
        makePlayer((i + 1) as SeatIndex, suited(13, 13 + i * 13)),
      )],
      wall: makeWall([], []),
    });
    const next = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.reason).toBe('draw');
    expect(next.handResult?.winnerSeat).toBeNull();
  });

  it('enters CHECK_BONUS if a bonus tile is among the concealed tiles', () => {
    const bonusTile = BONUS_TILES[0];
    // East already holds 14 tiles, one of which is a bonus.
    const state = makeState({
      players: [
        makePlayer(0, [...suited(13), bonusTile]),
        ...Array.from({ length: 3 }, (_, i) =>
          makePlayer((i + 1) as SeatIndex, suited(13, 13 + i * 13)),
        ),
      ],
      wall: makeWall([], BONUS_TILES.slice(1, 5)),
    });
    const next = dispatch(state, { type: 'BEGIN_TURN' });
    expect(next.phase).toBe('CHECK_BONUS');
    expect(next.players[0].bonusTiles).toContainEqual(bonusTile);
    expect(next.players[0].concealed).not.toContainEqual(bonusTile);
  });

  it('throws if the action is not BEGIN_TURN', () => {
    const state = makeState();
    expect(() => dispatch(state, { type: 'DRAW_REPLACEMENT' }))
      .toThrow('DRAWING phase expects BEGIN_TURN');
  });
});

// ─── CHECK_BONUS ──────────────────────────────────────────────────────────────

describe('dispatch — CHECK_BONUS', () => {
  function checkBonusState(dead: Tile[]): GameState {
    return makeState({
      phase: 'CHECK_BONUS',
      wall:  makeWall([], dead),
    });
  }

  it('draws a replacement and transitions to DISCARDING when it is not a bonus', () => {
    const replacement = suited(1, 90)[0];
    const state       = checkBonusState([replacement]);
    const next        = dispatch(state, { type: 'DRAW_REPLACEMENT' });
    expect(next.phase).toBe('DISCARDING');
    expect(next.players[0].concealed).toContainEqual(replacement);
    expect(next.wall.dead).toHaveLength(0);
  });

  it('stays in CHECK_BONUS when the replacement is itself a bonus tile', () => {
    const bonusReplacement = BONUS_TILES[1];
    const state            = checkBonusState([bonusReplacement]);
    const next             = dispatch(state, { type: 'DRAW_REPLACEMENT' });
    expect(next.phase).toBe('CHECK_BONUS');
    expect(next.players[0].bonusTiles).toContainEqual(bonusReplacement);
    expect(next.players[0].concealed).not.toContainEqual(bonusReplacement);
  });

  it('chains correctly through multiple bonus replacements', () => {
    const [b1, b2, regular] = [BONUS_TILES[2], BONUS_TILES[3], suited(1, 95)[0]];
    let state = checkBonusState([b1, b2, regular]);

    state = dispatch(state, { type: 'DRAW_REPLACEMENT' }); // draws b1 → bonus
    expect(state.phase).toBe('CHECK_BONUS');

    state = dispatch(state, { type: 'DRAW_REPLACEMENT' }); // draws b2 → bonus
    expect(state.phase).toBe('CHECK_BONUS');

    state = dispatch(state, { type: 'DRAW_REPLACEMENT' }); // draws regular
    expect(state.phase).toBe('DISCARDING');
    expect(state.players[0].bonusTiles).toHaveLength(2);
    expect(state.players[0].concealed).toContainEqual(regular);
  });

  it('enters HAND_OVER (draw) when the dead wall is exhausted', () => {
    const state = checkBonusState([]);
    const next  = dispatch(state, { type: 'DRAW_REPLACEMENT' });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.reason).toBe('draw');
  });

  it('throws if the action is not DRAW_REPLACEMENT', () => {
    const state = makeState({ phase: 'CHECK_BONUS' });
    expect(() => dispatch(state, { type: 'BEGIN_TURN' }))
      .toThrow('CHECK_BONUS phase expects DRAW_REPLACEMENT');
  });
});

// ─── DISCARDING ───────────────────────────────────────────────────────────────

describe('dispatch — DISCARDING', () => {
  it('removes the discarded tile from hand and opens a claim window', () => {
    const tiles = suited(14);
    const state = discardingState(0, tiles);
    const next  = dispatch(state, { type: 'DISCARD', tileId: tiles[0].id });

    expect(next.phase).toBe('CLAIM_WINDOW');
    expect(next.players[0].concealed).toHaveLength(13);
    expect(next.players[0].concealed.map(t => t.id)).not.toContain(tiles[0].id);
    expect(next.discardPool.at(-1)?.id).toBe(tiles[0].id);
  });

  it('pre-fills the discarder slot in the claim window as pass', () => {
    const tiles = suited(14);
    const state = discardingState(0, tiles);
    const next  = dispatch(state, { type: 'DISCARD', tileId: tiles[0].id });

    expect(next.claimWindow).not.toBeNull();
    expect(next.claimWindow!.responses[0]).toEqual({ type: 'pass' });
    expect(next.claimWindow!.responses[1]).toBeNull();
    expect(next.claimWindow!.responses[2]).toBeNull();
    expect(next.claimWindow!.responses[3]).toBeNull();
  });

  it('throws when the tile to discard is not in the concealed hand', () => {
    const tiles = suited(14);
    const state = discardingState(0, tiles);
    const ghost = suited(1, 100)[0];
    expect(() => dispatch(state, { type: 'DISCARD', tileId: ghost.id }))
      .toThrow('not found in concealed hand');
  });

  it('declares a concealed kong and enters CHECK_BONUS', () => {
    // 4 copies of the same tile kind + 10 others = 14 tiles
    const quadCopies = ALL_TILES.filter(t =>
      t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 5,
    ); // exactly 4
    const rest  = suited(10, 40);
    const state = discardingState(0, [...quadCopies, ...rest]);

    const next = dispatch(state, {
      type:   'DECLARE_CONCEALED_KONG',
      tileId: quadCopies[0].id,
    });
    expect(next.phase).toBe('CHECK_BONUS');
    expect(next.players[0].melds).toHaveLength(1);
    expect(next.players[0].melds[0].type).toBe('concealed_kong');
    expect(next.players[0].melds[0].tiles).toHaveLength(4);
    expect(next.players[0].concealed).toHaveLength(10);
  });

  it('throws on DECLARE_CONCEALED_KONG with fewer than 4 matching tiles', () => {
    const tiles = suited(14);
    const state = discardingState(0, tiles);
    expect(() => dispatch(state, { type: 'DECLARE_CONCEALED_KONG', tileId: tiles[0].id }))
      .toThrow('need 4 matching tiles');
  });

  it('declares a self-draw win and ends the hand', () => {
    const state = discardingState(2, suited(14));
    const next  = dispatch(state, { type: 'DECLARE_WIN' });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.reason).toBe('win');
    expect(next.handResult?.winnerSeat).toBe(2);
    expect(next.handResult?.selfDraw).toBe(true);
  });

  it('throws on an unexpected action type in DISCARDING', () => {
    const state = discardingState(0, suited(14));
    expect(() => dispatch(state, { type: 'BEGIN_TURN' }))
      .toThrow('DISCARDING phase: unexpected action');
  });
});

// ─── CLAIM_WINDOW ─────────────────────────────────────────────────────────────

describe('dispatch — CLAIM_WINDOW', () => {
  const discardedTile = suited(1, 99)[0];

  it('records a response and stays in CLAIM_WINDOW while others have not yet replied', () => {
    const state = claimWindowState(discardedTile);
    const next  = dispatch(state, {
      type:     'CLAIM_RESPONSE',
      seat:     1,
      decision: { type: 'pass' },
    });
    expect(next.phase).toBe('CLAIM_WINDOW');
    expect(next.claimWindow!.responses[1]).toEqual({ type: 'pass' });
    expect(next.claimWindow!.responses[2]).toBeNull(); // still waiting
  });

  it('advances to the next player (DRAWING) when all players pass', () => {
    // Pre-fill seats 1 and 2 as pass; seat 3 is the final respondent.
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' }, 2: { type: 'pass' } });
    const next  = dispatch(state, {
      type:     'CLAIM_RESPONSE',
      seat:     3,
      decision: { type: 'pass' },
    });
    expect(next.phase).toBe('DRAWING');
    expect(next.currentSeat).toBe(1); // next clockwise from discarder (seat 0)
    expect(next.claimWindow).toBeNull();
  });

  it('resolves a pung claim — claimer enters DISCARDING with the meld formed', () => {
    const discarded = discardedTile;
    // Give seat 1 two tiles that match the discard.
    const match1  = ALL_TILES.find(t => t.category === 'suited'
      && (t as any).suit === discarded.category // will fail; let's use a real match
    );
    // Use a concrete approach: find two tiles with same tileKey as discarded.
    const discardKey = `suited:${(discarded as any).suit}:${(discarded as any).value}`;
    const sameKind   = ALL_TILES.filter(t => {
      if (t.category !== 'suited') return false;
      const st = t as any;
      return `suited:${st.suit}:${st.value}` === discardKey && t.id !== discarded.id;
    });
    const [m1, m2] = sameKind;
    const otherTiles = suited(11, 60);

    const config  = { ...DEFAULT_CONFIG, playerCount: 4 as const };
    const players = [
      makePlayer(0, suited(13, 0)),
      makePlayer(1, [m1, m2, ...otherTiles]),
      makePlayer(2, suited(13, 30)),
      makePlayer(3, suited(13, 43)),
    ];
    const state: GameState = {
      ...makeState({ config, players }),
      currentSeat:  0 as SeatIndex,
      phase:        'CLAIM_WINDOW',
      discardPool:  [discarded],
      claimWindow:  {
        responses: [
          { type: 'pass' }, // seat 0 (discarder)
          null,             // seat 1 — will pung
          { type: 'pass' }, // seat 2
          { type: 'pass' }, // seat 3
        ],
      },
    };

    const next = dispatch(state, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pung' } });
    expect(next.phase).toBe('DISCARDING');
    expect(next.currentSeat).toBe(1);
    expect(next.players[1].melds).toHaveLength(1);
    expect(next.players[1].melds[0].type).toBe('pung');
    expect(next.players[1].melds[0].tiles).toHaveLength(3);
    // Discard removed from pool after being claimed.
    expect(next.discardPool).toHaveLength(0);
  });

  it('resolves a chow claim — claimer enters DISCARDING with the meld', () => {
    // Seat 1 (left of discarder seat 0) chows the discard.
    // Discard = bamboo-5, seat 1 holds bamboo-4 and bamboo-6.
    const b4 = ALL_TILES.find(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 4)!;
    const b5 = ALL_TILES.find(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 5)!;
    const b6 = ALL_TILES.find(t => t.category === 'suited' && (t as any).suit === 'bamboo' && (t as any).value === 6)!;

    const otherTiles = suited(11, 60);
    const config     = { ...DEFAULT_CONFIG, playerCount: 4 as const };
    const players    = [
      makePlayer(0, suited(13, 0)),
      makePlayer(1, [b4, b6, ...otherTiles]),
      makePlayer(2, suited(13, 30)),
      makePlayer(3, suited(13, 43)),
    ];
    const state: GameState = {
      ...makeState({ config, players }),
      currentSeat:  0 as SeatIndex,
      phase:        'CLAIM_WINDOW',
      discardPool:  [b5],
      claimWindow:  {
        responses: [
          { type: 'pass' },
          null,
          { type: 'pass' },
          { type: 'pass' },
        ],
      },
    };

    const next = dispatch(state, {
      type:     'CLAIM_RESPONSE',
      seat:     1,
      decision: { type: 'chow', chowTiles: [b4.id as any, b6.id as any] },
    });
    expect(next.phase).toBe('DISCARDING');
    expect(next.currentSeat).toBe(1);
    expect(next.players[1].melds[0].type).toBe('chow');
    expect(next.players[1].melds[0].tiles.map(t => t.id))
      .toEqual(expect.arrayContaining([b4.id, b6.id, b5.id]));
    expect(next.discardPool).toHaveLength(0);
  });

  it('resolves a win claim — HAND_OVER with the correct winner', () => {
    const state = claimWindowState(discardedTile, 4, { 2: { type: 'pass' }, 3: { type: 'pass' } });
    const next  = dispatch(state, {
      type:     'CLAIM_RESPONSE',
      seat:     1,
      decision: { type: 'win' },
    });
    expect(next.phase).toBe('HAND_OVER');
    expect(next.handResult?.reason).toBe('win');
    expect(next.handResult?.winnerSeat).toBe(1);
    expect(next.handResult?.selfDraw).toBe(false);
  });

  it('picks the closest-clockwise winner on simultaneous win claims (OQ-3 placeholder)', () => {
    // Discarder = seat 0. Seats 2 and 3 both claim win.
    // Closest clockwise from 0 is 2 (distance 2) vs 3 (distance 3).
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' }, 2: { type: 'win' } });
    const next  = dispatch(state, {
      type:     'CLAIM_RESPONSE',
      seat:     3,
      decision: { type: 'win' },
    });
    expect(next.handResult?.winnerSeat).toBe(2);
  });

  it('enforces the chow-from-left rule', () => {
    // Seat 0 discards; only seat 1 may chow.
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' }, 3: { type: 'pass' } });
    expect(() =>
      dispatch(state, {
        type:     'CLAIM_RESPONSE',
        seat:     2,
        decision: { type: 'chow', chowTiles: [suited(1, 70)[0].id as any, suited(1, 71)[0].id as any] },
      }),
    ).toThrow('only seat 1');
  });

  it('throws if a player tries to respond twice', () => {
    const state = claimWindowState(discardedTile, 4, { 1: { type: 'pass' } });
    expect(() =>
      dispatch(state, { type: 'CLAIM_RESPONSE', seat: 1, decision: { type: 'pass' } }),
    ).toThrow('already responded');
  });

  it('throws if the discarder tries to claim', () => {
    const state = claimWindowState(discardedTile);
    expect(() =>
      dispatch(state, { type: 'CLAIM_RESPONSE', seat: 0, decision: { type: 'pass' } }),
    ).toThrow('discarder cannot claim');
  });

  it('throws if action is not CLAIM_RESPONSE', () => {
    const state = makeState({ phase: 'CLAIM_WINDOW', claimWindow: { responses: [] } });
    expect(() => dispatch(state, { type: 'BEGIN_TURN' }))
      .toThrow('CLAIM_WINDOW expects CLAIM_RESPONSE');
  });
});

// ─── HAND_OVER ────────────────────────────────────────────────────────────────

describe('dispatch — HAND_OVER', () => {
  it('throws on any action after the hand has ended', () => {
    const state = makeState({
      phase:      'HAND_OVER',
      handResult: { reason: 'draw', winnerSeat: null, selfDraw: null },
    });
    expect(() => dispatch(state, { type: 'BEGIN_TURN' }))
      .toThrow('cannot act on a completed hand');
  });
});
