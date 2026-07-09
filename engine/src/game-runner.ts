/**
 * Module 1.4b — Game Runner
 *
 * Drives the game loop for a single hand above the turn engine. Automatic
 * transitions are dispatched immediately; decision points delegate to a
 * PlayerController.
 *
 * CLAIM_WINDOW / ROBBING_KONG dispatch-as-resolved (bug fix, 2026-07-09):
 * gatherClaims used to await Promise.all() over every pending seat's
 * decision and only dispatch CLAIM_RESPONSE for any of them once ALL had
 * resolved. That's harmless for headless AI-vs-AI play (every controller
 * resolves near-instantly), but online a human seat can stay pending
 * indefinitely (FallbackController waits for a real socket click) -- so
 * the broadcast state stayed frozen at all-null responses the whole time,
 * even after the AI seats had already decided to pass. The client's
 * ActionBar picks the lowest-indexed still-null seat as "who needs to act",
 * so whenever that frozen state pointed at an AI seat instead of the human
 * (i.e. the human wasn't seated immediately next to the discarder), the
 * human saw no Pass button at all and the hand froze -- the human WAS the
 * one being waited on, they just had no way to know it. Fixed by dispatching
 * each CLAIM_RESPONSE the moment its controller resolves, so already-decided
 * seats show up immediately and the still-pending seat is always the real
 * bottleneck.
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

  /**
   * Asks every pending seat (except `excludeSeat`) for its claim decision
   * concurrently, but -- unlike the old batch-then-apply version -- dispatches
   * each CLAIM_RESPONSE the instant its own promise resolves, rather than
   * waiting for every seat to answer first. `phaseAtStart` guards against
   * applying a now-stale decision after the window has already resolved from
   * another seat's response (e.g. a win came in before this seat replied) --
   * dispatching onto a state that has moved to a different phase would throw.
   */
  private async gatherClaims(excludeSeat: SeatIndex, alreadyResponded: ReadonlyArray<ClaimDecision | null>): Promise<void> {
    const snapshot      = this.state;
    const count         = snapshot.config.playerCount;
    const phaseAtStart  = this.state.phase;
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const seat = i as SeatIndex;
      if (seat === excludeSeat) continue;
      if (alreadyResponded[seat] !== null) continue;
      tasks.push(
        this.controllers[seat]!.getClaimDecision(snapshot, seat).then(decision => {
          if (this.state.phase !== phaseAtStart) return; // window already resolved by another seat
          this.advance({ type: 'CLAIM_RESPONSE', seat, decision });
        }),
      );
    }
    await Promise.all(tasks);
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
        const cw = this.state.claimWindow!;
        await this.gatherClaims(this.state.currentSeat, cw.responses);
        break;
      }
      case 'ROBBING_KONG': {
        const rk = this.state.robbingKong!;
        await this.gatherClaims(rk.melderSeat, rk.responses);
        break;
      }
      case 'HAND_OVER': {
        break;
      }
    }
  }
}
