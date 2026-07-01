/**
 * Module 4.1 -- AI Scaffold + Controller
 *
 * HeuristicController implements the engine's PlayerController interface
 * (Module 1.4b) so an AI seat can be driven by the GameRunner or the UI with no
 * engine changes. It composes the two layers:
 *
 *   assessment.ts  -> the per-turn plan (target suit, clean/dirty mode)
 *   discard.ts     -> which tile to throw
 *   claims.ts      -> whether/how to claim a discard or rob a kong
 *
 * The controller carries the small strategy state the pure layers cannot: how
 * many discard turns this seat has had, and the sticky clean/dirty mode. State
 * resets automatically when a new hand starts (the discard history shrinks), so
 * the same instance is safe to reuse across hands.
 *
 * One instance drives one seat. A "self-draw win first" check means the AI
 * declares Mah Jong as soon as its hand is legal rather than discarding.
 *
 * Added kong (Module 4.4): when the AI draws the 4th tile of an exposed pung,
 * it promotes the pung to an open kong — unless the tile can complete a chow
 * sequence with two other tiles already in hand, in which case it keeps the tile
 * for the chow instead.  Honours (winds, dragons) can never form chows, so they
 * always trigger the kong.
 *
 * Dependencies: game-state.ts, turn-engine.ts, game-runner.ts, inference.ts,
 * hand-evaluator.ts, and the ai/* layers. No UI, no side effects beyond the
 * controller's own private counters.
 */

import { GameState, SeatIndex, PlayerState } from '../game-state.js';
import { DiscardAction } from '../turn-engine.js';
import { PlayerController } from '../game-runner.js';
import { ClaimDecision } from '../game-state.js';
import { tileKey, isSuited, type TileId } from '../tiles.js';
import { inferTable } from '../inference.js';
import { isWinningHand } from '../hand-evaluator.js';
import { assessHand, nudgeSpecialTarget, HandPlan, SpecialPlan, AiMode } from './assessment.js';
import { chooseDiscardTile } from './discard.js';
import { chooseClaimDecision, chooseRobDecision } from './claims.js';

/**
 * Returns the TileId of the first concealed tile that can promote an exposed
 * pung to an open kong, or null if no such tile exists.
 */
function findAddedKong(player: PlayerState): TileId | null {
  for (const meld of player.melds) {
    if (meld.type !== 'pung') continue;
    const pungTile = meld.tiles[0];
    if (!pungTile) continue;
    const key = tileKey(pungTile);
    const match = player.concealed.find(t => tileKey(t) === key);
    if (match) return match.id;
  }
  return null;
}

/**
 * Returns true when the tile with the given ID can complete a chow sequence
 * with two other tiles already in the player's concealed hand.
 *
 * Checks all three patterns where the tile sits as the low, middle, or high
 * piece of a run.  Honours (winds, dragons) always return false — they can
 * never form chows.
 */
function canFormCompleteChow(player: PlayerState, tileId: TileId): boolean {
  const tile = player.concealed.find(t => t.id === tileId);
  if (!tile || !isSuited(tile)) return false;

  const { suit, value } = tile;

  // Collect values of all other suited tiles of the same suit in hand.
  const otherVals: number[] = [];
  for (const t of player.concealed) {
    if (t.id !== tileId && isSuited(t) && t.suit === suit) {
      otherVals.push(t.value);
    }
  }

  // Three chow patterns: tile as high, middle, or low piece.
  const patterns: [number, number][] = [
    [value - 2, value - 1],  // tile is the high piece  (e.g. 5 completes 3-4-5)
    [value - 1, value + 1],  // tile is the middle piece (e.g. 5 completes 4-5-6)
    [value + 1, value + 2],  // tile is the low piece    (e.g. 5 completes 5-6-7)
  ];
  return patterns.some(
    ([v1, v2]) => v1 >= 1 && v2 <= 9 && otherVals.includes(v1) && otherVals.includes(v2)
  );
}

export class HeuristicController implements PlayerController {
  private mode:       AiMode = 'clean';
  private turnsTaken: number = 0;
  /** Discard-history length last seen; a drop signals a fresh hand. */
  private lastMoves:  number = 0;

  constructor(private readonly seat: SeatIndex) {}

  /** Forget all per-hand strategy state (called automatically on a new hand). */
  reset(): void {
    this.mode = 'clean';
    this.turnsTaken = 0;
    this.lastMoves = 0;
  }

  private syncHand(state: GameState): void {
    const moves = (state.discardLog?.length ?? state.discardPool.length);
    if (moves < this.lastMoves) this.reset();
    this.lastMoves = moves;
  }

  /** The current plan for this seat (re-assessed; advances the turn counter when discarding). */
  private planFor(state: GameState, advanceTurn: boolean): HandPlan {
    const inference = inferTable(state);
    const plan = assessHand(state, this.seat, this.mode, this.turnsTaken, inference);
    this.mode = plan.mode;          // sticky update
    if (advanceTurn) this.turnsTaken += 1;
    return plan;
  }

  async getDiscardAction(state: GameState, seat: SeatIndex): Promise<DiscardAction> {
    this.syncHand(state);
    const player = state.players[seat]!;

    // Declare Mah Jong on a self-draw whenever the hand is already legal.
    if (isWinningHand(player.concealed, player.melds, state.config)) {
      return { type: 'DECLARE_WIN' };
    }

    // Added kong: promote an exposed pung to a kong using the matching drawn tile —
    // but only when the tile cannot complete a chow with tiles already in hand.
    // If a complete chow sequence is available (the tile sits as low, middle, or
    // high piece of a run), keep the tile for the chow instead: it is likely to
    // contribute to winning faster than the extra kong replacement draw.
    const kongTileId = findAddedKong(player);
    if (kongTileId !== null && !canFormCompleteChow(player, kongTileId)) {
      return { type: 'DECLARE_ADDED_KONG', tileId: kongTileId };
    }

    const plan   = this.planFor(state, true);
    const tileId = chooseDiscardTile(state, seat, plan);
    return { type: 'DISCARD', tileId };
  }

  async getClaimDecision(state: GameState, seat: SeatIndex): Promise<ClaimDecision> {
    this.syncHand(state);

    // Robbing the Kong: only a winning rob or a pass is legal.
    if (state.phase === 'ROBBING_KONG' || state.robbingKong) {
      return chooseRobDecision(state, seat);
    }

    const plan = this.planFor(state, false);
    return chooseClaimDecision(state, seat, plan);
  }
}

/**
 * Convenience for the UI hint feature (Module 4.7) and tests: the plan plus the
 * action the AI would take for a seat right now, without mutating any
 * controller state. `claim` is populated during the claim phases, `discard`
 * during DISCARDING.
 */
export interface SeatAdvice {
  readonly plan:    HandPlan;
  readonly discard?: ReturnType<typeof chooseDiscardTile>;
  readonly claim?:   ClaimDecision;
  readonly winNow:   boolean;
  /**
   * Module 4.7: the special-hand nudge -- the best feasible special target
   * under the chattier NUDGE_MARGIN, or null. The UI surfaces the name only
   * ("you could aim for Imperial Jade"). Chattier than `plan.special`, which
   * uses the AI's stricter commit test.
   */
  readonly nudge:   SpecialPlan | null;
}

export function adviseSeat(state: GameState, seat: SeatIndex): SeatAdvice {
  const inference = inferTable(state);
  const plan = assessHand(state, seat, 'clean', 0, inference);
  const player = state.players[seat]!;
  const nudge = nudgeSpecialTarget(state, seat);

  if (state.phase === 'DISCARDING' && state.currentSeat === seat) {
    const winNow = isWinningHand(player.concealed, player.melds, state.config);
    return winNow
      ? { plan, winNow, nudge }
      : { plan, discard: chooseDiscardTile(state, seat, plan), winNow, nudge };
  }
  if (state.phase === 'CLAIM_WINDOW') {
    return { plan, claim: chooseClaimDecision(state, seat, plan), winNow: false, nudge };
  }
  if (state.phase === 'ROBBING_KONG' || state.robbingKong) {
    return { plan, claim: chooseRobDecision(state, seat), winNow: false, nudge };
  }
  return { plan, winNow: false, nudge };
}
