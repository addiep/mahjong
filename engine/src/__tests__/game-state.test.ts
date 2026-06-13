import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  createGameState,
  type GameConfig,
} from '../game-state.js';
import { buildWall } from '../wall.js';

// ─── DEFAULT_CONFIG ────────────────────────────────────────────────────────────

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

  it('defaults dirty wins to disallowed', () => {
    expect(DEFAULT_CONFIG.dirtyWinAllowed).toBe(false);
  });
});

// ─── createGameState — 4 players ──────────────────────────────────────────────

describe('createGameState (4 players)', () => {
  const deal  = buildWall(4);
  const state = createGameState(DEFAULT_CONFIG, deal);

  it('stores the config unchanged', () => {
    expect(state.config).toBe(DEFAULT_CONFIG);
  });

  it('creates one player per seat', () => {
    expect(state.players).toHaveLength(4);
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

  it('starts every player with no bonus tiles', () => {
    state.players.forEach(p => expect(p.bonusTiles).toHaveLength(0));
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

  it('carries the wall from the deal', () => {
    expect(state.wall).toBe(deal.wall);
  });
});

// ─── createGameState — 3 players ──────────────────────────────────────────────

describe('createGameState (3 players)', () => {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount: 3 };
  const deal   = buildWall(3);
  const state  = createGameState(config, deal);

  it('creates one player per seat', () => {
    expect(state.players).toHaveLength(3);
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

// ─── createGameState — custom config flags ────────────────────────────────────

describe('createGameState honours config flags', () => {
  it('stores a custom config unchanged', () => {
    const config: GameConfig = {
      playerCount:     4,
      discardsVisible: false,
      knittingEnabled: true,
      dirtyWinAllowed: true,
    };
    const state = createGameState(config, buildWall(4));
    expect(state.config).toBe(config);
    expect(state.config.discardsVisible).toBe(false);
    expect(state.config.knittingEnabled).toBe(true);
    expect(state.config.dirtyWinAllowed).toBe(true);
  });
});
