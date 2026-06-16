/**
 * Module 1.4b — Game Runner
 *
 * Drives the game loop for a single hand above the turn engine. Automatic
 * transitions are dispatched immediately; decision points delegate to a
 * PlayerController.
 *
 * Dependencies: game-state.ts, turn-engine.ts
 */

import { GameState, SeatIndex, ClaimDecision } from './game-state.js';
import { Action, DiscardAction, dispatch } from './turn-engine.js';

export interface PlayerController {
  /**
   * Called during DISCARDING. Returns a discard, a concealed or added kong, or
   * a self-draw win.
   */
  getDiscardAction(state: GameState, seat: SeatIndex): Promise<DiscardAction>;

  /**
   * Called during CLAIM_WINDOW and ROBBING_KONG for every eligible seat. During
   * ROBBING_KONG only { type: 'win' } or { type: 'pass' } are legal, and the
   * claimable tile is `state.robbingKong.tile`.
   */
  getClaimDecision(state: GameState, seat: SeatIndex): Promise<ClaimDecision>;
}

export class GameRunner {
  private state:         GameState;
  private readonly controllers:   readonly PlayerController[];
  private readonly onStateChange: (state: GameState) => void;
  private stopped = false;

  constructor(
    initialState:  GameState,
    controllers:   readonly PlayerController[],
    onStateChange: (state: GameState) => void = () => {},
  ) {
    if (controllers.length !== initialState.config.playerCount) {
      throw new Error(`GameRunner: expected ${initialState.config.playerCount} controllers, got ${controllers.length}`);
    }
    this.state         = initialState;
    this.controllers   = controllers;
    this.onStateChange = onStateChange;
  }

  getState(): GameState { return this.state; }

  async run(): Promise<GameState> {
    while (!this.stopped && this.state.phase !== 'HAND_OVER') {
      await this.step();
    }
    return this.state;
  }

  stop(): void { this.stopped = true; }

  private advance(action: Action): void {
    this.state = dispatch(this.state, action);
    this.onStateChange(this.state);
  }

  private async gatherClaims(excludeSeat: SeatIndex, alreadyResponded: ReadonlyArray<ClaimDecision | null>): Promise<Array<{ seat: SeatIndex; decision: ClaimDecision }>> {
    const snapshot = this.state;
    const count    = snapshot.config.playerCount;
    const resolved: Array<{ seat: SeatIndex; decision: ClaimDecision }> = [];
    await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const seat = i as SeatIndex;
        if (seat === excludeSeat) return;
        if (alreadyResponded[seat] !== null) return;
        const decision = await this.controllers[seat]!.getClaimDecision(snapshot, seat);
        resolved.push({ seat, decision });
      }),
    );
    return resolved;
  }

  private async step(): Promise<void> {
    switch (this.state.phase) {
      case 'DRAWING': {
        this.advance({ type: 'BEGIN_TURN' });
        break;
      }
      case 'CHECK_BONUS': {
        this.advance({ type: 'DRAW_REPLACEMENT' });
        break;
      }
      case 'DISCARDING': {
        const seat     = this.state.currentSeat;
        const decision = await this.controllers[seat]!.getDiscardAction(this.state, seat);
        this.advance(decision as Action);
        break;
      }
      case 'CLAIM_WINDOW': {
        const cw       = this.state.claimWindow!;
        const resolved = await this.gatherClaims(this.state.currentSeat, cw.responses);
        for (const { seat, decision } of resolved) {
          if (this.state.phase !== 'CLAIM_WINDOW') break;
          this.advance({ type: 'CLAIM_RESPONSE', seat, decision });
        }
        break;
      }
      case 'ROBBING_KONG': {
        const rk       = this.state.robbingKong!;
        const resolved = await this.gatherClaims(rk.melderSeat, rk.responses);
        for (const { seat, decision } of resolved) {
          if (this.state.phase !== 'ROBBING_KONG') break;
          this.advance({ type: 'CLAIM_RESPONSE', seat, decision });
        }
        break;
      }
      case 'HAND_OVER': {
        break;
      }
    }
  }
}
