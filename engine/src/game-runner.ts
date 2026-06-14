/**
 * Module 1.4b — Game Runner
 *
 * Sits above the turn engine (Module 1.4) and drives the game loop for a
 * single hand. For every automatic state transition (drawing, replacing bonus
 * tiles) it dispatches actions immediately. For every decision point
 * (discarding, claiming) it delegates to the appropriate PlayerController.
 *
 * The PlayerController interface defined here is the seam between the engine
 * and any player-facing code — human UI or AI strategy module. Neither side
 * needs to know about the other; both just implement / use this interface.
 *
 * Usage:
 *
 *   const runner = new GameRunner(initialState, controllers, onStateChange);
 *   const finalState = await runner.run(); // resolves at HAND_OVER
 *
 * Between-hand concerns (seat rotation, score carry-over, starting a new hand)
 * are the caller's responsibility; GameRunner handles exactly one hand.
 *
 * Dependencies: game-state.ts, turn-engine.ts
 * No UI dependencies.
 */

import { GameState, SeatIndex, ClaimDecision } from './game-state.js';
import { Action, DiscardAction, dispatch } from './turn-engine.js';

// ─── PlayerController ─────────────────────────────────────────────────────────

/**
 * Implemented by anything that controls a player's seat — a human UI, a
 * pass-and-play shim, or a Phase 3 AI strategy module.
 *
 * The runner calls exactly one method per decision point and waits for the
 * Promise to resolve before dispatching the returned action. Returning an
 * illegal action causes the runner to propagate the error thrown by dispatch().
 *
 * Controllers must NOT mutate the GameState they receive.
 */
export interface PlayerController {
  /**
   * Called during DISCARDING phase when it is this controller's turn.
   *
   * The returned action must be one of:
   *   { type: 'DISCARD', tileId }            — discard the named tile.
   *   { type: 'DECLARE_CONCEALED_KONG', tileId } — declare a concealed kong.
   *   { type: 'DECLARE_WIN' }                — claim Mahjong (self-draw).
   */
  getDiscardAction(state: GameState, seat: SeatIndex): Promise<DiscardAction>;

  /**
   * Called during CLAIM_WINDOW for every non-discarder seat.
   *
   * All non-discarder controllers are called concurrently with the same
   * state snapshot; the runner serialises the dispatch of their responses.
   *
   * The returned decision must be one of:
   *   { type: 'win' }                      — claim for Mahjong.
   *   { type: 'pung' }                     — claim for a pung.
   *   { type: 'kong' }                     — claim for a kong.
   *   { type: 'chow', chowTiles: [id,id] } — claim for a chow (left player only).
   *   { type: 'pass' }                     — decline.
   */
  getClaimDecision(state: GameState, seat: SeatIndex): Promise<ClaimDecision>;
}

// ─── GameRunner ──────────────────────────────────────────────────────────────────

export class GameRunner {
  private state:         GameState;
  private readonly controllers:   readonly PlayerController[];
  private readonly onStateChange: (state: GameState) => void;
  private stopped = false;

  /**
   * @param initialState  GameState produced by createGameState().
   * @param controllers   One controller per seat, in seat order.
   * @param onStateChange Called after every state transition; useful for
   *                      rendering and logging. Defaults to a no-op.
   */
  constructor(
    initialState:  GameState,
    controllers:   readonly PlayerController[],
    onStateChange: (state: GameState) => void = () => {},
  ) {
    if (controllers.length !== initialState.config.playerCount) {
      throw new Error(
        `GameRunner: expected ${initialState.config.playerCount} controllers, ` +
        `got ${controllers.length}`,
      );
    }
    this.state         = initialState;
    this.controllers   = controllers;
    this.onStateChange = onStateChange;
  }

  /** Returns the current game state snapshot. */
  getState(): GameState {
    return this.state;
  }

  /**
   * Run the hand to completion.
   *
   * Resolves with the final GameState (phase === 'HAND_OVER') when the hand
   * ends naturally, or with whatever state exists when stop() is called.
   *
   * Rejects if any controller rejects or returns an illegal action.
   */
  async run(): Promise<GameState> {
    while (!this.stopped && this.state.phase !== 'HAND_OVER') {
      await this.step();
    }
    return this.state;
  }

  /**
   * Signal the runner to stop after the current step completes.
   * The run() promise will resolve with the state at that point.
   */
  stop(): void {
    this.stopped = true;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private advance(action: Action): void {
    this.state = dispatch(this.state, action);
    this.onStateChange(this.state);
  }

  /**
   * Execute one logical step of the game loop.
   *
   * Automatic phases (DRAWING, CHECK_BONUS) dispatch their action immediately.
   * Decision phases (DISCARDING, CLAIM_WINDOW) await the relevant controller(s).
   */
  private async step(): Promise<void> {
    switch (this.state.phase) {
      case 'DRAWING': {
        // Automatic: start the current player's turn.
        this.advance({ type: 'BEGIN_TURN' });
        break;
      }

      case 'CHECK_BONUS': {
        // Automatic: draw one replacement tile from the dead wall.
        this.advance({ type: 'DRAW_REPLACEMENT' });
        break;
      }

      case 'DISCARDING': {
        // Decision: ask the current player's controller what to do.
        const seat     = this.state.currentSeat;
        const decision = await this.controllers[seat]
          .getDiscardAction(this.state, seat);
        this.advance(decision as Action);
        break;
      }

      case 'CLAIM_WINDOW': {
        // Decision: ask all non-discarder controllers concurrently with a
        // consistent state snapshot, then apply their responses one at a time.
        const snapshot     = this.state;
        const discarder    = snapshot.currentSeat;
        const count        = snapshot.config.playerCount;
        const cw           = snapshot.claimWindow!;

        // Gather decisions in parallel — each controller sees the same snapshot.
        const resolved: Array<{ seat: SeatIndex; decision: ClaimDecision }> = [];
        await Promise.all(
          Array.from({ length: count }, async (_, i) => {
            const seat = i as SeatIndex;
            if (seat === discarder)           return; // pre-filled as pass
            if (cw.responses[seat] !== null)  return; // already responded
            const decision = await this.controllers[seat]
              .getClaimDecision(snapshot, seat);
            resolved.push({ seat, decision });
          }),
        );

        // Apply responses serially so each dispatch sees the updated state.
        for (const { seat, decision } of resolved) {
          if (this.state.phase !== 'CLAIM_WINDOW') break; // resolved early
          this.advance({ type: 'CLAIM_RESPONSE', seat, decision });
        }
        break;
      }

      case 'HAND_OVER': {
        // Terminal — run() will exit on the next iteration check.
        break;
      }
    }
  }
}
