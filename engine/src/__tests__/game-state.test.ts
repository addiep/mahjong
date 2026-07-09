import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  createGameState,
  type GameConfig,
} from '../game-state.js';
import { buildWall, type Wall } from '../wall.js';
import { buildTileSet, isBonus, type Tile } from '../tiles.js';

const NAMES_4 = ['Alice', 'Bob', 'Carol', 'Dave'];
const NAMES_3 = ['Alice', 'Bob', 'Carol'];

const ALL_TILES = buildTileSet();
const SUITED     = ALL_TILES.filter(t => t.category === 'suited');
const BONUS_TILES = ALL_TILES.filter(isBonus);

function suited(n: number, offset = 0): Tile[] { return SUITED.slice(offset, offset + n); }

// ─── DEFAULT_CONFIG ────────────────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('defaults to 4 players', () => {
    expect(DEFAULT_CONFIG.playerCount).toBe(4);
  });

  it('defaults to discards visible', () => {
    expect(DEFAULT_CONFIG.discardsVisible).toBe(true);
  });

  it('defaults knitting to disabled', () => {
    expect(DEFAULT_CONFIG.knittingEnabled).toBe(false);
  });

  it('defaults the dead-wall reserve off (the family rule)', () => {
    expect(DEFAULT_CONFIG.deadWall).toBe(false);
  });
});

// ─── createGameState — 4 players ──────────────────────────────────────

describe('createGameState (4 players)', () => {
  const deal  = buildWall(4);
  const state = createGameState(DEFAULT_CONFIG, deal, NAMES_4);

  it('stores the config unchanged', () => {
    expect(state.config).toBe(DEFAULT_CONFIG);
  });

  it('creates one player per seat', () => {
    expect(state.players).toHaveLength(4);
  });

  it('assigns names in seat order', () => {
    expect(state.players.map(p => p.name)).toEqual(NAMES_4);
  });

  it('assigns seat indices 0–3', () => {
    expect(state.players.map(p => p.seat)).toEqual([0, 1, 2, 3]);
  });

  it('assigns seat winds East → South → West → North', () => {
    expect(state.players.map(p => p.seatWind)).toEqual(
      ['east', 'south', 'west', 'north'],
    );
  });

  it('gives East (seat 0) 14 concealed tiles', () => {
    expect(state.players[0].concealed).toHaveLength(14);
  });

  it('gives non-dealers 13 concealed tiles each', () => {
    expect(state.players[1].concealed).toHaveLength(13);
    expect(state.players[2].concealed).toHaveLength(13);
    expect(state.players[3].concealed).toHaveLength(13);
  });

  it('starts every player with no declared melds', () => {
    state.players.forEach(p => expect(p.melds).toHaveLength(0));
  });

  it('resolves any bonus tiles the real shuffle happened to deal, immediately', () => {
    // buildWall(4) is a real random shuffle of all 144 tiles (including the 8
    // bonus tiles), so any player MAY have been dealt one -- unlike the old
    // behaviour (bonus tiles only resolved lazily on a seat's own first
    // turn), createGameState now resolves them all up front. Whichever seats
    // ended up with bonus tiles in bonusTiles, none should remain sitting in
    // any player's concealed hand.
    state.players.forEach(p => expect(p.concealed.some(isBonus)).toBe(false));
  });

  it('conserves all 144 tiles across hands, bonus tiles, and the wall', () => {
    const total =
      state.players.reduce((sum, p) => sum + p.concealed.length + p.bonusTiles.length, 0)
      + state.wall.live.length + state.wall.dead.length;
    expect(total).toBe(144);
  });

  it('starts every player with a score of 0', () => {
    state.players.forEach(p => expect(p.score).toBe(0));
  });

  it('starts with an empty discard pool', () => {
    expect(state.discardPool).toHaveLength(0);
  });

  it('starts with East as the current seat', () => {
    expect(state.currentSeat).toBe(0);
  });

  it('starts in the DRAWING phase', () => {
    expect(state.phase).toBe('DRAWING');
  });

  it('starts with East as the prevailing wind', () => {
    expect(state.prevailingWind).toBe('east');
  });

  it('starts at hand number 0', () => {
    expect(state.handNumber).toBe(0);
  });

  it('starts with no hand result', () => {
    expect(state.handResult).toBeNull();
  });

  it('draws replacements for any initial bonus tiles from the same deal.wall (no reserve style)', () => {
    // deal.wall.dead is empty under the family default (no dead-wall
    // reserve), so any replacement draws come off the far end of the live
    // wall -- the total live+dead count shrinks by exactly the number of
    // bonus tiles resolved up front.
    const bonusCount = state.players.reduce((sum, p) => sum + p.bonusTiles.length, 0);
    expect(state.wall.live.length + state.wall.dead.length)
      .toBe(deal.wall.live.length + deal.wall.dead.length - bonusCount);
  });
});

// ─── createGameState — initial-deal bonus tiles (bug fix, 2026-07-09) ─────

describe('createGameState resolves initial-deal bonus tiles for every seat', () => {
  it('exposes a non-dealer\'s dealt-in bonus tile immediately, not on their first turn', () => {
    // South (seat 1) is dealt a flower among its 13 opening tiles. Before the
    // fix this sat in `concealed` until South's own first BEGIN_TURN; it must
    // now already be in `bonusTiles` the moment the hand is created.
    const flower = BONUS_TILES[0]!;
    const deal = {
      hands: [
        suited(14, 0),                       // East: no bonus
        [flower!, ...suited(12, 20)],        // South: one flower
        suited(13, 40),                      // West: no bonus
        suited(13, 60),                      // North: no bonus
      ],
      wall: { live: suited(20, 80), dead: [] } as Wall,
    };
    const state = createGameState(DEFAULT_CONFIG, deal, NAMES_4);

    expect(state.players[1]!.bonusTiles).toContainEqual(flower);
    expect(state.players[1]!.concealed.some(isBonus)).toBe(false);
    expect(state.players[1]!.concealed).toHaveLength(13); // replacement kept the count whole
  });

  it('resolves bonus tiles for every seat that has one, in the same pass', () => {
    const [f1, f2, f3] = BONUS_TILES;
    const deal = {
      hands: [
        [f1!, ...suited(13, 0)],   // East: one bonus (14 total before replacement)
        [f2!, ...suited(12, 20)],  // South: one bonus
        suited(13, 40),            // West: none
        [f3!, ...suited(12, 60)],  // North: one bonus
      ],
      wall: { live: suited(20, 80), dead: [] } as Wall,
    };
    const state = createGameState(DEFAULT_CONFIG, deal, NAMES_4);

    expect(state.players[0]!.bonusTiles).toContainEqual(f1);
    expect(state.players[1]!.bonusTiles).toContainEqual(f2);
    expect(state.players[2]!.bonusTiles).toHaveLength(0);
    expect(state.players[3]!.bonusTiles).toContainEqual(f3);
    state.players.forEach(p => expect(p.concealed.some(isBonus)).toBe(false));
    // East keeps 14, non-dealers keep 13 -- replacements top each hand back up.
    expect(state.players[0]!.concealed).toHaveLength(14);
    expect(state.players[1]!.concealed).toHaveLength(13);
    expect(state.players[3]!.concealed).toHaveLength(13);
  });

  it('keeps looping per seat when more than one bonus tile was dealt', () => {
    const [f1, f2] = BONUS_TILES;
    const deal = {
      hands: [
        suited(14, 0),
        [f1!, f2!, ...suited(11, 20)], // South: two bonus tiles in the opening hand
        suited(13, 40),
        suited(13, 60),
      ],
      wall: { live: suited(20, 80), dead: [] } as Wall,
    };
    const state = createGameState(DEFAULT_CONFIG, deal, NAMES_4);

    expect(state.players[1]!.bonusTiles).toHaveLength(2);
    expect(state.players[1]!.concealed).toHaveLength(13);
    expect(state.players[1]!.concealed.some(isBonus)).toBe(false);
  });
});

// ─── createGameState — 3 players ──────────────────────────────────────

describe('createGameState (3 players)', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 3 };
  const deal   = buildWall(3);
  const state  = createGameState(config, deal, NAMES_3);

  it('creates one player per seat', () => {
    expect(state.players).toHaveLength(3);
  });

  it('assigns names in seat order', () => {
    expect(state.players.map(p => p.name)).toEqual(NAMES_3);
  });

  it('assigns seat indices 0–2', () => {
    expect(state.players.map(p => p.seat)).toEqual([0, 1, 2]);
  });

  it('assigns seat winds East, South, West', () => {
    expect(state.players.map(p => p.seatWind)).toEqual(
      ['east', 'south', 'west'],
    );
  });

  it('gives East 14 tiles and non-dealers 13', () => {
    expect(state.players[0].concealed).toHaveLength(14);
    expect(state.players[1].concealed).toHaveLength(13);
    expect(state.players[2].concealed).toHaveLength(13);
  });
});

// ─── createGameState — custom config flags ────────────────────────────

describe('createGameState honours config flags', () => {
  it('stores a custom config unchanged', () => {
    const config: GameConfig = {
      playerCount:     4,
      discardsVisible: false,
      knittingEnabled: true,
      deadWall:        true,
    };
    const state = createGameState(config, buildWall(4, true), NAMES_4);
    expect(state.config).toBe(config);
    expect(state.config.discardsVisible).toBe(false);
    expect(state.config.knittingEnabled).toBe(true);
    expect(state.config.deadWall).toBe(true);
  });
});

// ─── createGameState — name validation ───────────────────────────────

describe('createGameState name validation', () => {
  it('throws if too few names are supplied', () => {
    expect(() =>
      createGameState(DEFAULT_CONFIG, buildWall(4), ['Alice', 'Bob', 'Carol']),
    ).toThrow();
  });

  it('throws if too many names are supplied', () => {
    expect(() =>
      createGameState(DEFAULT_CONFIG, buildWall(4), [...NAMES_4, 'Eve']),
    ).toThrow();
  });
});
