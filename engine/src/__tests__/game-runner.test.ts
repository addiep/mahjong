/**
 * Tests for Module 1.4b — Game Runner, specifically the CLAIM_WINDOW /
 * ROBBING_KONG "dispatch as each decision resolves" fix (2026-07-09).
 *
 * Bug this guards against: gatherClaims used to await Promise.all() over
 * every pending seat before dispatching ANY of their responses. Online, a
 * human seat can stay pending indefinitely (waiting for a real socket click),
 * so the broadcast state stayed frozen at all-null the whole time even after
 * fast AI seats had already decided to pass -- the client's ActionBar picks
 * the lowest-indexed still-null seat as "who needs to act", so it kept
 * pointing at an already-decided AI seat instead of the human who was
 * actually the real bottleneck. The hand froze with no visible Pass button.
 */
import { describe, it, expect } from 'vitest';
import { GameRunner, type PlayerController } from '../game-runner.js';
import {
  DEFAULT_CONFIG,
  type GameState, type PlayerState, type SeatIndex, type ClaimDecision,
} from '../game-state.js';
import { Tile, buildTileSet, Wind } from '../tiles.js';

const ALL_TILES = buildTileSet();
const SUITED    = ALL_TILES.filter(t => t.category === 'suited');

function suited(n: number, offset = 0): Tile[] { return SUITED.slice(offset, offset + n); }

function makePlayer(seat: SeatIndex, concealed: Tile[]): PlayerState {
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  return { name: `P${seat}`, seat, seatWind: winds[seat]!, concealed, melds: [], bonusTiles: [], score: 0 };
}

/** Four-player state right after East (seat 0) discarded; nobody has responded yet. */
function claimWindowState(): GameState {
  const config    = { ...DEFAULT_CONFIG, playerCount: 4 as const };
  const discarded = suited(1, 99)[0]!;
  const players: PlayerState[] = Array.from({ length: 4 }, (_, i) =>
    makePlayer(i as SeatIndex, suited(13, i * 13)));
  return {
    config,
    players,
    wall:           { live: [], dead: [] },
    discardPool:    [discarded],
    currentSeat:    0,
    phase:          'CLAIM_WINDOW',
    prevailingWind: 'east',
    handNumber:     0,
    handResult:     null,
    claimWindow:    { responses: [{ type: 'pass' }, null, null, null] },
    robbingKong:    null,
  };
}

function stubController(getClaimDecision: PlayerController['getClaimDecision']): PlayerController {
  return {
    getDiscardAction: () => { throw new Error('getDiscardAction should not be called in this test'); },
    getClaimDecision,
  };
}

describe('GameRunner — CLAIM_WINDOW dispatches as each decision resolves', () => {
  it('reflects fast seats immediately instead of waiting for the slowest one', async () => {
    // Seat 3 stands in for a real human whose socket hasn't answered yet
    // (a promise we control by hand); seats 1 and 2 are fast AI passes.
    let resolveSlow: (d: ClaimDecision) => void = () => {};
    const slow = new Promise<ClaimDecision>(resolve => { resolveSlow = resolve; });

    const controllers: PlayerController[] = [
      stubController(async () => { throw new Error('seat 0 is the discarder and must not be asked'); }),
      stubController(async () => ({ type: 'pass' })), // seat 1: fast
      stubController(async () => ({ type: 'pass' })), // seat 2: fast
      stubController(() => slow),                     // seat 3: slow ("human")
    ];

    const broadcasts: GameState[] = [];
    const runner    = new GameRunner(claimWindowState(), controllers, s => broadcasts.push(s));
    const runPromise = runner.run();

    // Let every already-resolved promise's .then() chain flush before the
    // slow seat answers -- setTimeout only fires after the microtask queue
    // (which includes chained .then callbacks) has fully drained.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(broadcasts.length).toBeGreaterThan(0);
    const midState = broadcasts.at(-1)!;
    expect(midState.phase).toBe('CLAIM_WINDOW');
    // The bug: these used to stay null until seat 3 (the slow one) answered too.
    expect(midState.claimWindow!.responses[1]).toEqual({ type: 'pass' });
    expect(midState.claimWindow!.responses[2]).toEqual({ type: 'pass' });
    expect(midState.claimWindow!.responses[3]).toBeNull();

    // This is exactly what the client's ActionBar reads to decide who is
    // "pending" -- it must now correctly point at the real bottleneck (seat 3),
    // not an already-decided seat.
    const pendingSeat = midState.claimWindow!.responses.findIndex(r => r === null);
    expect(pendingSeat).toBe(3);

    // Resolve the slow seat and let the hand finish normally.
    resolveSlow({ type: 'pass' });
    const finalState = await runPromise;
    expect(['DRAWING', 'HAND_OVER']).toContain(finalState.phase);
  });

  it('still requires every pending seat to answer before resolving (win priority needs all responses in)', async () => {
    // The turn engine only resolves a CLAIM_WINDOW once every pending seat's
    // response is non-null (so simultaneous win claims can be compared by
    // priority) -- dispatching each response as it resolves must not change
    // that invariant. Seat 2 answers 'win' fast; seat 3 is still slow, so the
    // window must stay open until seat 3 also answers, even though a win is
    // already recorded.
    let resolveSlow: (d: ClaimDecision) => void = () => {};
    const slow = new Promise<ClaimDecision>(resolve => { resolveSlow = resolve; });

    const controllers: PlayerController[] = [
      stubController(async () => { throw new Error('seat 0 is the discarder and must not be asked'); }),
      stubController(async () => ({ type: 'pass' })),
      stubController(async () => ({ type: 'win' })),
      stubController(() => slow),
    ];

    const runner     = new GameRunner(claimWindowState(), controllers);
    const runPromise = runner.run();

    await new Promise(resolve => setTimeout(resolve, 0));
    // Win recorded, but seat 3 hasn't answered -- must NOT have resolved yet.
    expect(runner.getState().phase).toBe('CLAIM_WINDOW');
    expect(runner.getState().claimWindow!.responses[2]).toEqual({ type: 'win' });
    expect(runner.getState().claimWindow!.responses[3]).toBeNull();

    resolveSlow({ type: 'pass' });
    const finalState = await runPromise;
    expect(finalState.phase).toBe('HAND_OVER');
    expect(finalState.handResult?.winnerSeat).toBe(2);
  });
});
