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
 * Dependencies: game-state.ts, turn-engine.ts, game-runner.ts, inference.ts,
 * hand-evaluator.ts, and the ai/* layers. No UI, no side effects beyond the
 * controller's own private counters.
 */

import { GameState, SeatIndex } from '../game-state.js';
import { DiscardAction } from '../turn-engine.js';
import { PlayerController } from '../game-runner.js';
import { ClaimDecision } from '../game-state.js';
import { inferTable } from '../inference.js';
import { isWinningHand } from '../hand-evaluator.js';
import { assessHand, HandPlan, AiMode } from './assessment.js';
import { chooseDiscardTile } from './discard.js';
import { chooseClaimDecision, chooseRobDecision } from './claims.js';

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
}

export function adviseSeat(state: GameState, seat: SeatIndex): SeatAdvice {
  const inference = inferTable(state);
  const plan = assessHand(state, seat, 'clean', 0, inference);
  const player = state.players[seat]!;

  if (state.phase === 'DISCARDING' && state.currentSeat === seat) {
    const winNow = isWinningHand(player.concealed, player.melds, state.config);
    return winNow
      ? { plan, winNow }
      : { plan, discard: chooseDiscardTile(state, seat, plan), winNow };
  }
  if (state.phase === 'CLAIM_WINDOW') {
    return { plan, claim: chooseClaimDecision(state, seat, plan), winNow: false };
  }
  if (state.phase === 'ROBBING_KONG' || state.robbingKong) {
    return { plan, claim: chooseRobDecision(state, seat), winNow: false };
  }
  return { plan, winNow: false };
}
