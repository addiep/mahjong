/**
 * Module 1.4 — Turn Engine (State Machine)
 *
 * Implements the pure dispatch() function that drives the game through its
 * phases. Every call takes a GameState and an Action and returns a new
 * GameState — nothing is ever mutated.
 *
 * Phase flow:
 *
 *   DRAWING ──BEGIN_TURN──► draw from wall
 *          │                  │ bonus tile in hand
 *          │                  ▼
 *          │           CHECK_BONUS ──DRAW_REPLACEMENT──► (loop or DISCARDING)
 *          │                  │ no bonus
 *          │                  ▼
 *          └────────► DISCARDING ──DISCARD──────────────► CLAIM_WINDOW
 *                          │                                    │ all pass
 *                          │ DECLARE_WIN (self-draw)             ▼
 *                          │                            DRAWING (next player)
 *                          ▼                                    │ pung/kong/chow
 *                    HAND_OVER  ◄───────────────────────────────┤
 *                                                               │ win
 *                                                               ▼
 *                                                         HAND_OVER
 *
 * What this module does NOT do:
 *   - Validate winning hands (Module 1.7)
 *   - Calculate scores (Module 1.8)
 *   - Rotate seats between hands (Game Runner / caller)
 *
 * Dependencies: game-state.ts, tiles.ts, wall.ts
 * No UI dependencies. No side effects.
 */

import { Tile, TileId, isBonus, tileKey } from './tiles.js';
import {
  GameState,
  SeatIndex,
  PlayerState,
  DeclaredMeld,
  MeldType,
  ClaimDecision,
  ClaimWindowState,
} from './game-state.js';
import { drawFromWall, drawReplacement } from './wall.js';

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * Every state transition is triggered by exactly one Action.
 *
 * Automatic actions — dispatched by the Game Runner without consulting a
 * PlayerController:
 *   BEGIN_TURN       — start the current player's turn; draws from wall if needed.
 *   DRAW_REPLACEMENT — draw one tile from the dead wall during CHECK_BONUS.
 *
 * Decision actions — dispatched after a PlayerController returns a choice:
 *   DISCARD                — discard a specific tile.
 *   DECLARE_CONCEALED_KONG — declare a concealed kong; enters CHECK_BONUS.
 *   DECLARE_WIN            — claim Mahjong on a self-drawn tile.
 *   CLAIM_RESPONSE         — one player's decision in the claim window.
 */
export type Action =
  | { readonly type: 'BEGIN_TURN' }
  | { readonly type: 'DRAW_REPLACEMENT' }
  | { readonly type: 'DISCARD';                readonly tileId:   TileId }
  | { readonly type: 'DECLARE_CONCEALED_KONG'; readonly tileId:   TileId }
  | { readonly type: 'DECLARE_WIN' }
  | { readonly type: 'CLAIM_RESPONSE'; readonly seat: SeatIndex; readonly decision: ClaimDecision };

/**
 * The subset of Action that a PlayerController may return during DISCARDING.
 * Exported so the Game Runner and AI modules can use it as a return type.
 */
export type DiscardAction =
  | { readonly type: 'DISCARD';                readonly tileId: TileId }
  | { readonly type: 'DECLARE_CONCEALED_KONG'; readonly tileId: TileId }
  | { readonly type: 'DECLARE_WIN' };

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * The sole entry point for advancing game state.
 *
 * Throws an Error if the action is not legal in the current phase, or if the
 * referenced tiles are not where the action expects them to be.
 */
export function dispatch(state: GameState, action: Action): GameState {
  switch (state.phase) {
    case 'DRAWING':      return handleDrawing(state, action);
    case 'CHECK_BONUS':  return handleCheckBonus(state, action);
    case 'DISCARDING':   return handleDiscarding(state, action);
    case 'CLAIM_WINDOW': return handleClaimWindow(state, action);
    case 'HAND_OVER':
      throw new Error('dispatch: cannot act on a completed hand (HAND_OVER)');
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`dispatch: unhandled phase "${_exhaustive as string}"`);
    }
  }
}

// ─── DRAWING ──────────────────────────────────────────────────────────────────

function handleDrawing(state: GameState, action: Action): GameState {
  if (action.type !== 'BEGIN_TURN') {
    throw new Error(`DRAWING phase expects BEGIN_TURN, got "${action.type}"`);
  }

  const player = state.players[state.currentSeat];

  // Invariant: at discard time a player holds (14 + kongCount) tiles in total
  // (concealed + all declared meld tiles).  At the start of a draw turn they
  // hold (13 + kongCount), so a draw is needed.  East on the initial deal already
  // holds 14 tiles, so the draw is skipped for their very first turn.
  const kongCount  = countKongs(player);
  const totalHeld  = player.concealed.length
    + player.melds.reduce((s, m) => s + m.tiles.length, 0);
  const needsDraw  = totalHeld < 14 + kongCount;

  let next = state;

  if (needsDraw) {
    const { tile, wall } = drawFromWall(state.wall);
    if (tile === null) {
      // Live wall exhausted — the hand ends in a draw.
      return {
        ...state,
        wall,
        phase:      'HAND_OVER',
        handResult: { reason: 'draw', winnerSeat: null, selfDraw: null },
      };
    }
    next = {
      ...replacePlayer(state, withConcealed(player, tile)),
      wall,
    };
  }

  return transitionToDiscard(next);
}

// ─── CHECK_BONUS ──────────────────────────────────────────────────────────────

function handleCheckBonus(state: GameState, action: Action): GameState {
  if (action.type !== 'DRAW_REPLACEMENT') {
    throw new Error(`CHECK_BONUS phase expects DRAW_REPLACEMENT, got "${action.type}"`);
  }

  const { tile, wall } = drawReplacement(state.wall);
  if (tile === null) {
    // Dead wall exhausted — treat defensively as a draw game.
    return {
      ...state,
      wall,
      phase:      'HAND_OVER',
      handResult: { reason: 'draw', winnerSeat: null, selfDraw: null },
    };
  }

  const player = state.players[state.currentSeat];
  const next   = { ...state, wall };

  if (isBonus(tile)) {
    // The replacement is itself a bonus — set it aside and loop.
    return {
      ...replacePlayer(next, {
        ...player,
        bonusTiles: [...player.bonusTiles, tile],
      }),
      phase: 'CHECK_BONUS',
    };
  }

  // Regular tile — add to the concealed hand and re-check for any remaining
  // bonus tiles (handles multiple bonus tiles in the initial deal).
  return transitionToDiscard(
    replacePlayer(next, { ...player, concealed: [...player.concealed, tile] }),
  );
}

// ─── DISCARDING ───────────────────────────────────────────────────────────────

function handleDiscarding(state: GameState, action: Action): GameState {
  const player = state.players[state.currentSeat];

  switch (action.type) {
    case 'DISCARD': {
      const tile = player.concealed.find(t => t.id === action.tileId);
      if (!tile) {
        throw new Error(`DISCARD: tile "${action.tileId}" not found in concealed hand`);
      }
      const updatedPlayer = {
        ...player,
        concealed: removeOne(player.concealed, tile),
      };
      // Open the claim window; pre-fill the discarder's slot with 'pass'.
      const responses: (ClaimDecision | null)[] =
        Array.from({ length: state.config.playerCount }, (_, i) =>
          i === state.currentSeat ? { type: 'pass' as const } : null,
        );
      return {
        ...replacePlayer(state, updatedPlayer),
        discardPool: [...state.discardPool, tile],
        phase:       'CLAIM_WINDOW',
        claimWindow: { responses },
      };
    }

    case 'DECLARE_CONCEALED_KONG': {
      const tile = player.concealed.find(t => t.id === action.tileId);
      if (!tile) {
        throw new Error(`DECLARE_CONCEALED_KONG: tile "${action.tileId}" not found`);
      }
      const matching = player.concealed.filter(t => tileKey(t) === tileKey(tile));
      if (matching.length !== 4) {
        throw new Error(
          `DECLARE_CONCEALED_KONG: need 4 matching tiles, found ${matching.length}`,
        );
      }
      const meld: DeclaredMeld = { type: 'concealed_kong', tiles: matching };
      return {
        ...replacePlayer(state, {
          ...player,
          concealed: player.concealed.filter(t => tileKey(t) !== tileKey(tile)),
          melds:     [...player.melds, meld],
        }),
        // Enter CHECK_BONUS to draw the replacement tile from the dead wall.
        phase: 'CHECK_BONUS',
      };
    }

    case 'DECLARE_WIN': {
      // Self-draw win. Module 1.7 will validate the hand; for now accepted unconditionally.
      return {
        ...state,
        phase:      'HAND_OVER',
        handResult: { reason: 'win', winnerSeat: state.currentSeat, selfDraw: true },
      };
    }

    default:
      throw new Error(`DISCARDING phase: unexpected action "${(action as Action).type}"`);
  }
}

// ─── CLAIM_WINDOW ─────────────────────────────────────────────────────────────

function handleClaimWindow(state: GameState, action: Action): GameState {
  if (action.type !== 'CLAIM_RESPONSE') {
    throw new Error(`CLAIM_WINDOW expects CLAIM_RESPONSE, got "${action.type}"`);
  }

  const { seat, decision } = action;
  const cw = state.claimWindow!;

  if (seat === state.currentSeat) {
    throw new Error('CLAIM_WINDOW: the discarder cannot claim their own tile');
  }
  if (cw.responses[seat] !== null) {
    throw new Error(`CLAIM_WINDOW: seat ${seat} has already responded`);
  }
  if (decision.type === 'chow') {
    const leftSeat = nextSeat(state.currentSeat, state.config.playerCount);
    if (seat !== leftSeat) {
      throw new Error(
        `CLAIM_WINDOW: only seat ${leftSeat} (left of discarder) may chow`,
      );
    }
  }

  const newResponses = [...cw.responses] as (ClaimDecision | null)[];
  newResponses[seat] = decision;
  const newState: GameState = { ...state, claimWindow: { responses: newResponses } };

  // Still waiting for one or more players to respond.
  if (newResponses.some(r => r === null)) return newState;

  return resolveClaimWindow(newState);
}

// ─── Claim resolution ─────────────────────────────────────────────────────────

function resolveClaimWindow(state: GameState): GameState {
  const responses = state.claimWindow!.responses;

  // Priority 1 — win (beats everything else).
  const winSeats = responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .filter(({ r }) => r?.type === 'win')
    .map(({ seat }) => seat);

  if (winSeats.length > 0) {
    // OQ-3: simultaneous wins not yet resolved. Placeholder: closest clockwise
    // to the discarder takes the win.
    const winner = closestClockwise(winSeats, state.currentSeat, state.config.playerCount);
    return {
      ...state,
      claimWindow: null,
      phase:       'HAND_OVER',
      handResult:  { reason: 'win', winnerSeat: winner, selfDraw: false },
    };
  }

  // Priority 2 — pung or kong (beats chow).
  const pungKong = responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .find(({ r }) => r?.type === 'pung' || r?.type === 'kong');

  if (pungKong) return resolvePungOrKong(state, pungKong.seat, pungKong.r!);

  // Priority 3 — chow (only from left player; enforced at response time).
  const chow = responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .find(({ r }) => r?.type === 'chow');

  if (chow) return resolveChow(state, chow.seat, chow.r!);

  // All passed — advance to the next player.
  return advanceTurn(state);
}

function resolvePungOrKong(
  state:       GameState,
  claimerSeat: SeatIndex,
  decision:    ClaimDecision,
): GameState {
  const discarded = state.discardPool[state.discardPool.length - 1];
  const claimer   = state.players[claimerSeat];
  const isPung    = decision.type === 'pung';
  const needCount = isPung ? 2 : 3; // from hand; +1 discard = 3 (pung) or 4 (kong)

  const matching = claimer.concealed.filter(t => tileKey(t) === tileKey(discarded));
  if (matching.length < needCount) {
    throw new Error(
      `${decision.type.toUpperCase()}: need ${needCount} matching tiles in hand, ` +
      `found ${matching.length}`,
    );
  }

  const fromHand: readonly Tile[] = matching.slice(0, needCount);
  const meldType: MeldType        = isPung ? 'pung' : 'open_kong';
  const meld: DeclaredMeld        = { type: meldType, tiles: [...fromHand, discarded] };

  const updatedClaimer = {
    ...claimer,
    concealed: removeTiles(claimer.concealed, fromHand),
    melds:     [...claimer.melds, meld],
  };

  return {
    ...replacePlayer(state, updatedClaimer),
    currentSeat: claimerSeat,
    discardPool: state.discardPool.slice(0, -1),
    claimWindow: null,
    // A kong needs a replacement draw; a pung goes straight to discarding.
    phase: isPung ? 'DISCARDING' : 'CHECK_BONUS',
  };
}

function resolveChow(
  state:       GameState,
  claimerSeat: SeatIndex,
  decision:    ClaimDecision,
): GameState {
  if (!decision.chowTiles) {
    throw new Error('CHOW: chowTiles must be provided in the claim decision');
  }

  const discarded  = state.discardPool[state.discardPool.length - 1];
  const claimer    = state.players[claimerSeat];
  const [id1, id2] = decision.chowTiles;

  const t1 = claimer.concealed.find(t => t.id === id1);
  const t2 = claimer.concealed.find(t => t.id === id2);
  if (!t1 || !t2) throw new Error('CHOW: specified tiles not found in concealed hand');

  const meld: DeclaredMeld = { type: 'chow', tiles: [t1, t2, discarded] };
  const updatedClaimer = {
    ...claimer,
    concealed: claimer.concealed.filter(t => t.id !== id1 && t.id !== id2),
    melds:     [...claimer.melds, meld],
  };

  return {
    ...replacePlayer(state, updatedClaimer),
    currentSeat: claimerSeat,
    discardPool: state.discardPool.slice(0, -1),
    claimWindow: null,
    phase:       'DISCARDING',
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * After a draw (or when the player already holds enough tiles), scan the
 * concealed hand for bonus tiles. If any are found, move the first one aside
 * and enter CHECK_BONUS to draw a replacement. Otherwise go to DISCARDING.
 *
 * Processing one bonus tile at a time means every individual replacement draw
 * is captured as a distinct state snapshot — useful for UI animation and tests.
 */
function transitionToDiscard(state: GameState): GameState {
  const player     = state.players[state.currentSeat];
  const firstBonus = player.concealed.find(isBonus);
  if (!firstBonus) return { ...state, phase: 'DISCARDING' };

  return {
    ...replacePlayer(state, {
      ...player,
      concealed:  removeOne(player.concealed, firstBonus),
      bonusTiles: [...player.bonusTiles, firstBonus],
    }),
    phase: 'CHECK_BONUS',
  };
}

/** Advance currentSeat clockwise and reset to DRAWING for the next player's turn. */
function advanceTurn(state: GameState): GameState {
  return {
    ...state,
    currentSeat: nextSeat(state.currentSeat, state.config.playerCount),
    phase:       'DRAWING',
    claimWindow: null,
  };
}

/** The seat immediately clockwise (to the left in play order) of `seat`. */
function nextSeat(seat: SeatIndex, playerCount: number): SeatIndex {
  return ((seat + 1) % playerCount) as SeatIndex;
}

/**
 * Among a list of seats, return the one that is clockwise-closest to `from`.
 * Used as the OQ-3 placeholder for simultaneous win resolution.
 */
function closestClockwise(
  seats:       SeatIndex[],
  from:        SeatIndex,
  playerCount: number,
): SeatIndex {
  return seats.reduce((best, s) => {
    const dS    = (s    - from + playerCount) % playerCount;
    const dBest = (best - from + playerCount) % playerCount;
    return dS < dBest ? s : best;
  });
}

/** Count the kongs (open or concealed) in a player's declared melds. */
function countKongs(player: PlayerState): number {
  return player.melds.filter(
    m => m.type === 'open_kong' || m.type === 'concealed_kong',
  ).length;
}

/** Return a new PlayerState with `tile` appended to the concealed hand. */
function withConcealed(player: PlayerState, tile: Tile): PlayerState {
  return { ...player, concealed: [...player.concealed, tile] };
}

/** Return a new GameState with one PlayerState replaced (matched by seat index). */
function replacePlayer(state: GameState, updated: PlayerState): GameState {
  return {
    ...state,
    players: state.players.map((p, i) => (i === updated.seat ? updated : p)),
  };
}

/** Remove the first occurrence of `target` (matched by id) from `tiles`. */
function removeOne(tiles: readonly Tile[], target: Tile): readonly Tile[] {
  const idx = tiles.findIndex(t => t.id === target.id);
  if (idx === -1) throw new Error(`removeOne: tile "${target.id}" not found`);
  return [...tiles.slice(0, idx), ...tiles.slice(idx + 1)];
}

/** Remove all tiles in `toRemove` (by id) from `tiles`. */
function removeTiles(tiles: readonly Tile[], toRemove: readonly Tile[]): readonly Tile[] {
  const ids = new Set(toRemove.map(t => t.id));
  return tiles.filter(t => !ids.has(t.id));
}
