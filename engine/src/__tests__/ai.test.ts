/**
 * Tests for the AI player (Phase 3, Modules 4.1-4.5)
 *   - assessment: target-suit selection and the clean/dirty switch
 *   - discard:    least-useful-tile selection and the honour rules
 *   - claims:     win / pung / chow logic and the chow-vs-pung tension
 *   - harness:    full AI-vs-AI hands run to completion with tiles conserved
 */

import { describe, it, expect } from 'vitest';
import {
  buildTileSet, Tile, SuitedTile, Suit, Wind,
} from '../tiles.js';
import {
  GameState, PlayerState, SeatIndex, DeclaredMeld, DEFAULT_CONFIG, GameConfig,
} from '../game-state.js';
import { Wall, buildWall, PlayerCount } from '../wall.js';
import { createGameState } from '../game-state.js';
import { GameRunner } from '../game-runner.js';
import { assessHand, HandPlan } from '../ai/assessment.js';
import { keepValue, chooseDiscardTile } from '../ai/discard.js';
import { chooseClaimDecision } from '../ai/claims.js';
import { HeuristicController } from '../ai/heuristic-controller.js';

// --- fixtures -----
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

function player(seat: SeatIndex, concealed: Tile[], melds: DeclaredMeld[] = []): PlayerState {
  return { name: `P${seat}`, seat, seatWind: WINDS_ORDER[seat]!, concealed, melds, bonusTiles: [], score: 0 };
}

function makeState(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: DEFAULT_CONFIG,
    players,
    wall: { live: [], dead: [] } as Wall,
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

const cleanPlan = (targetSuit: Suit | null, seatWind: Wind = 'east'): HandPlan => ({
  seat: 0, mode: 'clean', targetSuit, seatWind, special: false,
  suitScores: { bamboo: 0, characters: 0, circles: 0 },
});

// --- assessment -----

describe('assessHand -- target suit', () => {
  it('picks the dominant suit and plays clean', () => {
    const concealed = [bam(1), bam(2), bam(3), bam(5), bam(5,1), bam(7), bam(8), bam(9), chr(2), cir(6)];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.targetSuit).toBe('bamboo');
    expect(plan.mode).toBe('clean');
  });

  it('two pairs in a suit outweigh more scattered singles in another', () => {
    // bamboo: two pairs (4 tiles). characters: four scattered singles, little adjacency.
    const concealed = [bam(3), bam(3,1), bam(6), bam(6,1), chr(1), chr(4), chr(6), chr(9)];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    const plan = assessHand(st, 0, 'clean', 0);
    expect(plan.targetSuit).toBe('bamboo');
    expect(plan.suitScores.bamboo).toBeGreaterThan(plan.suitScores.characters);
  });
});

describe('assessHand -- clean/dirty switch', () => {
  const spread = [bam(1), bam(3), bam(5), chr(2), chr(4), chr(6), cir(1), cir(4), cir(8)];

  it('stays clean before the switch turn', () => {
    const st = makeState([player(0, spread), player(1, []), player(2, []), player(3, [])]);
    expect(assessHand(st, 0, 'clean', 4).mode).toBe('clean');
  });

  it('switches to dirty at turn 5 when the hand is hard to clean', () => {
    const st = makeState([player(0, spread), player(1, []), player(2, []), player(3, [])]);
    const plan = assessHand(st, 0, 'clean', 5);
    expect(plan.mode).toBe('dirty');
    expect(plan.targetSuit).toBeNull();
  });

  it('dirty is sticky once chosen', () => {
    const clean = [bam(1), bam(2), bam(3), bam(4), bam(5), bam(6), bam(7), bam(8)];
    const st = makeState([player(0, clean), player(1, []), player(2, []), player(3, [])]);
    expect(assessHand(st, 0, 'dirty', 1).mode).toBe('dirty');
  });
});

// --- discard -----

describe('keepValue / chooseDiscardTile', () => {
  it('throws an off-suit lone tile before an in-target pair', () => {
    const plan = cleanPlan('bamboo');
    const concealed = [bam(4), bam(4,1), bam(5), cir(9)];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    expect(chooseDiscardTile(st, 0, plan)).toBe(cir(9).id);
  });

  it('sheds a non-own wind before a dragon', () => {
    const plan = cleanPlan('bamboo', 'east');
    const concealed = [bam(2), bam(3), dragon('red'), wind('south')]; // south is not the seat wind
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    expect(chooseDiscardTile(st, 0, plan)).toBe(wind('south').id);
  });

  it('keeps the AI own wind like a dragon', () => {
    const plan = cleanPlan('bamboo', 'east');
    expect(keepValue(wind('east'), plan, [wind('east')]))
      .toBeGreaterThan(keepValue(wind('south'), plan, [wind('south')]));
  });

  it('cleans off-suit suited tiles before guest winds (clean mode)', () => {
    const plan = cleanPlan('bamboo', 'east');
    const concealed = [bam(2), bam(3), chr(5), wind('south')];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    // The off-suit 5-characters is shed before the guest south wind: clean first.
    expect(chooseDiscardTile(st, 0, plan)).toBe(chr(5).id);
  });

  it('sheds a guest wind first in dirty mode (no suit to clean)', () => {
    const plan: HandPlan = { ...cleanPlan(null, 'east'), mode: 'dirty' };
    const concealed = [bam(2), chr(5), wind('south')];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    expect(chooseDiscardTile(st, 0, plan)).toBe(wind('south').id);
  });

  it('sheds the weaker off-suit suit first (2 characters before 4 bamboo)', () => {
    // Target circles. Off-suit: 4 bamboo (a developed second suit) vs 2 characters.
    // Characters have no pair or run shape (1 and 9 are too far apart), so they
    // rank as offSuitWeak=2 while bamboo tiles with run shapes rank higher.
    const plan = cleanPlan('circles', 'east');
    const concealed = [
      bam(1), bam(2), bam(3), bam(4), chr(1), chr(9),
      cir(2), cir(2,1), cir(5), cir(5,1),
    ];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    const id = chooseDiscardTile(st, 0, plan);
    const discarded = concealed.find(t => t.id === id)!;
    expect(discarded.category).toBe('suited');
    expect((discarded as SuitedTile).suit).toBe('characters');
  });

  // --- bug-fix regression tests (2026-06-21) ---

  it('holds an off-suit pair over an isolated off-suit of equal count (bug 1)', () => {
    // Both off-suit suits have 3 tiles, but characters hold a pair of 3s + run partner
    // while circles are fully isolated. Old code ranked both as offSuitStrong and used
    // alphabetical tiebreak (chr < cir), discarding characters first (wrong).
    // Fix: circles -> offSuitStrong=3; chr(3) -> offSuitPair=5; chr(4) -> offSuitRun=4.
    const plan = cleanPlan('bamboo', 'east');
    const concealed = [
      bam(1), bam(2), bam(3),
      cir(1), cir(5), cir(9),   // 3 isolated circles: offSuitStrong
      chr(3), chr(3,1), chr(4), // 3 characters: a pair of 3s + run partner
    ];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    const id = chooseDiscardTile(st, 0, plan);
    const t = concealed.find(tile => tile.id === id)!;
    expect((t as SuitedTile).suit).toBe('circles');
  });

  it('sheds a developed off-suit suit (3+ tiles) before a guest wind in clean mode (bug 2)', () => {
    // Old code: guestWindClean=3 < offSuitStrong=4, so the wind was shed first (wrong).
    // Fix: guestWindClean raised to 6, above all off-suit suited-tile values.
    const plan = cleanPlan('bamboo', 'east');
    const concealed = [bam(1), bam(2), bam(3), cir(1), cir(5), cir(9), wind('south')];
    const st = makeState([player(0, concealed), player(1, []), player(2, []), player(3, [])]);
    const id = chooseDiscardTile(st, 0, plan);
    const t = concealed.find(tile => tile.id === id)!;
    // A circle tile should be shed before the guest south wind.
    expect((t as SuitedTile).suit).toBe('circles');
  });

  it('does not count a tile adjacent only to a triplet as having a run partner (bug 3)', () => {
    // Old valueSet() included values where count >= 3, so bam(6) adjacent to the
    // bam(7) triplet falsely got inRun. Fix: runValueSet() excludes count >= 3 values.
    const plan = cleanPlan('bamboo', 'east');
    const withTriplet  = [bam(6), bam(7), bam(7,1), bam(7,2)];
    const trulyIsolated = [bam(6)];
    // Both should return inIsolated, not inRun.
    expect(keepValue(bam(6), plan, withTriplet)).toBe(keepValue(bam(6), plan, trulyIsolated));
  });
});

// --- claims -----

function claimState(claimerConcealed: Tile[], discard: Tile, claimerSeat: SeatIndex, discarderSeat: SeatIndex): GameState {
  const players = ([0,1,2,3] as SeatIndex[]).map(s =>
    player(s, s === claimerSeat ? claimerConcealed : []));
  return makeState(players, {
    currentSeat: discarderSeat,
    phase: 'CLAIM_WINDOW',
    discardPool: [discard],
  });
}

describe('chooseClaimDecision', () => {
  it('declares a win when the discard completes the hand', () => {
    const concealed = [bam(1),bam(1,1),bam(1,2), bam(2),bam(2,1),bam(2,2), bam(3),bam(3,1),bam(3,2), bam(4),bam(4,1),bam(4,2), bam(5)];
    const st = claimState(concealed, bam(5,1), 1, 0);
    expect(chooseClaimDecision(st, 1, cleanPlan('bamboo')).type).toBe('win');
  });

  it('pungs a tile in the target suit', () => {
    const concealed = [bam(7), bam(7,1), chr(2), cir(9)];
    const st = claimState(concealed, bam(7,2), 1, 0);
    expect(chooseClaimDecision(st, 1, cleanPlan('bamboo')).type).toBe('pung');
  });

  it('does not pung an off-suit tile in clean mode', () => {
    const concealed = [chr(7), chr(7,1), bam(2), bam(3)];
    const st = claimState(concealed, chr(7,2), 1, 0);
    expect(chooseClaimDecision(st, 1, cleanPlan('bamboo')).type).toBe('pass');
  });

  it('always pungs a dragon', () => {
    const concealed = [dragon('red'), dragon('red',1), bam(2), bam(3)];
    const st = claimState(concealed, dragon('red',2), 1, 0);
    expect(chooseClaimDecision(st, 1, cleanPlan('bamboo')).type).toBe('pung');
  });

  it('only the seat right of the discarder may chow', () => {
    const concealed = [bam(3), bam(5), chr(1)];
    const right = claimState(concealed, bam(4), 1, 0);
    expect(chooseClaimDecision(right, 1, cleanPlan('bamboo')).type).toBe('chow');
    const notRight = claimState(concealed, bam(4), 2, 0);
    expect(chooseClaimDecision(notRight, 2, cleanPlan('bamboo')).type).toBe('pass');
  });

  it('does not break a good pair for a chow while the pung is realistic', () => {
    // holds b3,b3 (a pair) and b5; discard b4. The only chow uses a b3 -> breaks the pair.
    const concealed = [bam(3), bam(3,1), bam(5)];
    const st = claimState(concealed, bam(4), 1, 0);
    expect(chooseClaimDecision(st, 1, cleanPlan('bamboo')).type).toBe('pass');
  });

  it('takes the chow once a copy of the pair is visible (pung unlikely)', () => {
    const concealed = [bam(3), bam(3,1), bam(5)];
    const st = claimState(concealed, bam(4), 1, 0);
    const withCopy = { ...st, discardPool: [bam(3,2), bam(4)] }; // a b3 already discarded
    expect(chooseClaimDecision(withCopy, 1, cleanPlan('bamboo')).type).toBe('chow');
  });
});

// --- AI vs AI harness (Module 4.5) -----

function tileCount(state: GameState): number {
  let n = state.wall.live.length + state.wall.dead.length + state.discardPool.length;
  for (const p of state.players) {
    n += p.concealed.length + p.bonusTiles.length;
    for (const m of p.melds) n += m.tiles.length;
  }
  return n;
}

async function playOneHand(playerCount: PlayerCount): Promise<GameState> {
  const config: GameConfig = { ...DEFAULT_CONFIG, playerCount };
  const deal  = buildWall(playerCount, config.deadWall ?? false);
  const names = Array.from({ length: playerCount }, (_, i) => `AI${i}`);
  const state = createGameState(config, deal, names);
  const controllers = Array.from({ length: playerCount }, (_, i) => new HeuristicController(i as SeatIndex));
  const runner = new GameRunner(state, controllers);
  return runner.run();
}

describe('AI vs AI harness', () => {
  it('plays 25 four-player hands to completion with tiles conserved', async () => {
    for (let i = 0; i < 25; i++) {
      const final = await playOneHand(4);
      expect(final.phase).toBe('HAND_OVER');
      expect(final.handResult).not.toBeNull();
      expect(['win', 'draw']).toContain(final.handResult!.reason);
      expect(tileCount(final)).toBe(144);
    }
  });

  it('plays three-player hands to completion', async () => {
    for (let i = 0; i < 10; i++) {
      const final = await playOneHand(3);
      expect(final.phase).toBe('HAND_OVER');
      expect(tileCount(final)).toBe(144);
    }
  });
});
