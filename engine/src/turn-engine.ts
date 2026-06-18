/**
 * Module 1.4 -- Turn Engine (State Machine)
 *
 * Implements the pure dispatch() function that drives the game through its
 * phases. Every call takes a GameState and an Action and returns a new
 * GameState -- nothing is ever mutated.
 *
 * Phase flow:
 *
 *   DRAWING --BEGIN_TURN--> draw from wall --> CHECK_BONUS / DISCARDING
 *   CHECK_BONUS --DRAW_REPLACEMENT--> (loop on bonus) --> DISCARDING
 *   DISCARDING --DISCARD--> CLAIM_WINDOW
 *              --DECLARE_CONCEALED_KONG--> CHECK_BONUS
 *              --DECLARE_ADDED_KONG--> ROBBING_KONG
 *              --DECLARE_WIN (self-draw)--> HAND_OVER
 *   CLAIM_WINDOW --CLAIM_RESPONSE--> next player / claimer / HAND_OVER
 *   ROBBING_KONG --CLAIM_RESPONSE--> robbed win (HAND_OVER) or, if nobody robs,
 *                  the melder's kong replacement draw (CHECK_BONUS)
 *
 * What this module does NOT do:
 *   - Calculate scores (Module 1.8)
 *   - Rotate seats between hands (Game Runner / caller)
 *
 * Win validation for ordinary discard claims is still deferred; Module 1.7 is
 * wired only where a structural win is required -- the Robbing the Kong window,
 * where a rob must be a genuine winning hand on the added tile.
 *
 * Discard log: the turn engine is the only place state advances, so it owns the
 * private `discardLog` (Module 1.3). It appends an entry on every DISCARD and
 * annotates `claimedBy` when a discard is claimed (pung/kong/chow/win). The log
 * is provenance for the intelligence module and the AI; it is never shown to
 * players. Robbing the Kong does not touch the log (the robbed tile is a kong
 * tile, not a discard).
 *
 * Dependencies: game-state.ts, tiles.ts, wall.ts, claim-window.ts, hand-evaluator.ts
 */

import { Tile, TileId, isBonus, tileKey } from './tiles.js';
import {
  GameState,
  SeatIndex,
  PlayerState,
  DeclaredMeld,
  MeldType,
  ClaimDecision,
  DiscardLogEntry,
} from './game-state.js';
import { drawFromWall, drawReplacement } from './wall.js';
import { validateClaimDecision, selectWinClaimant } from './claim-window.js';
import { isWinningHand } from './hand-evaluator.js';

// --- Actions -----

export type Action =
  | { readonly type: 'BEGIN_TURN' }
  | { readonly type: 'DRAW_REPLACEMENT' }
  | { readonly type: 'DISCARD';                readonly tileId:   TileId }
  | { readonly type: 'DECLARE_CONCEALED_KONG'; readonly tileId:   TileId }
  | { readonly type: 'DECLARE_ADDED_KONG';     readonly tileId:   TileId }
  | { readonly type: 'DECLARE_WIN' }
  | { readonly type: 'CLAIM_RESPONSE'; readonly seat: SeatIndex; readonly decision: ClaimDecision };

/**
 * The subset of Action a PlayerController may return during DISCARDING.
 * DECLARE_ADDED_KONG promotes an exposed pung to a kong using a drawn tile.
 */
export type DiscardAction =
  | { readonly type: 'DISCARD';                readonly tileId: TileId }
  | { readonly type: 'DECLARE_CONCEALED_KONG'; readonly tileId: TileId }
  | { readonly type: 'DECLARE_ADDED_KONG';     readonly tileId: TileId }
  | { readonly type: 'DECLARE_WIN' };

// --- Dispatch -----

export function dispatch(state: GameState, action: Action): GameState {
  switch (state.phase) {
    case 'DRAWING':      return handleDrawing(state, action);
    case 'CHECK_BONUS':  return handleCheckBonus(state, action);
    case 'DISCARDING':   return handleDiscarding(state, action);
    case 'CLAIM_WINDOW': return handleClaimWindow(state, action);
    case 'ROBBING_KONG': return handleRobbingKong(state, action);
    case 'HAND_OVER':
      throw new Error('dispatch: cannot act on a completed hand (HAND_OVER)');
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`dispatch: unhandled phase "${_exhaustive as string}"`);
    }
  }
}

// --- DRAWING -----

function handleDrawing(state: GameState, action: Action): GameState {
  if (action.type !== 'BEGIN_TURN') {
    throw new Error(`DRAWING phase expects BEGIN_TURN, got "${action.type}"`);
  }
  const player = state.players[state.currentSeat]!;
  const kongCount  = countKongs(player);
  const totalHeld  = player.concealed.length
    + player.melds.reduce((s, m) => s + m.tiles.length, 0);
  const needsDraw  = totalHeld < 14 + kongCount;

  let next = state;
  if (needsDraw) {
    const { tile, wall } = drawFromWall(state.wall);
    if (tile === null) {
      return { ...state, wall, phase: 'HAND_OVER', handResult: { reason: 'draw', winnerSeat: null, selfDraw: null } };
    }
    next = { ...replacePlayer(state, withConcealed(player, tile)), wall, lastDrawSource: 'live-wall' as const, lastDrawnTileId: tile.id };
  }
  return transitionToDiscard(next);
}

// --- CHECK_BONUS -----

function handleCheckBonus(state: GameState, action: Action): GameState {
  if (action.type !== 'DRAW_REPLACEMENT') {
    throw new Error(`CHECK_BONUS phase expects DRAW_REPLACEMENT, got "${action.type}"`);
  }
  const { tile, wall } = drawReplacement(state.wall);
  if (tile === null) {
    return { ...state, wall, phase: 'HAND_OVER', handResult: { reason: 'draw', winnerSeat: null, selfDraw: null } };
  }
  const player = state.players[state.currentSeat]!;
  const next   = { ...state, wall, lastDrawSource: 'dead-wall' as const };

  if (isBonus(tile)) {
    return { ...replacePlayer(next, { ...player, bonusTiles: [...player.bonusTiles, tile] }), phase: 'CHECK_BONUS' };
  }
  const drew = { ...replacePlayer(next, { ...player, concealed: [...player.concealed, tile] }), lastDrawnTileId: tile.id };
  return transitionToDiscard(drew);
}

// --- DISCARDING -----

function handleDiscarding(state: GameState, action: Action): GameState {
  const player = state.players[state.currentSeat]!;

  switch (action.type) {
    case 'DISCARD': {
      const tile = player.concealed.find(t => t.id === action.tileId);
      if (!tile) throw new Error(`DISCARD: tile "${action.tileId}" not found in concealed hand`);
      const updatedPlayer = { ...player, concealed: removeOne(player.concealed, tile) };
      const justDrawn = state.lastDrawnTileId === tile.id;
      const responses: (ClaimDecision | null)[] =
        Array.from({ length: state.config.playerCount }, (_, i) =>
          i === state.currentSeat ? { type: 'pass' as const } : null);
      const { lastDrawnTileId: _consumed, ...rest } = state;
      return {
        ...replacePlayer(rest, updatedPlayer),
        discardPool: [...state.discardPool, tile],
        discardLog:  appendDiscard(state.discardLog, state.currentSeat, tile, justDrawn),
        phase:       'CLAIM_WINDOW',
        claimWindow: { responses },
      };
    }

    case 'DECLARE_CONCEALED_KONG': {
      const tile = player.concealed.find(t => t.id === action.tileId);
      if (!tile) throw new Error(`DECLARE_CONCEALED_KONG: tile "${action.tileId}" not found`);
      const matching = player.concealed.filter(t => tileKey(t) === tileKey(tile));
      if (matching.length !== 4) {
        throw new Error(`DECLARE_CONCEALED_KONG: need 4 matching tiles, found ${matching.length}`);
      }
      const meld: DeclaredMeld = { type: 'concealed_kong', tiles: matching };
      return {
        ...replacePlayer(state, {
          ...player,
          concealed: player.concealed.filter(t => tileKey(t) !== tileKey(tile)),
          melds:     [...player.melds, meld],
        }),
        phase: 'CHECK_BONUS',
      };
    }

    case 'DECLARE_ADDED_KONG': {
      // Promote an existing exposed pung to an open kong using a drawn tile.
      const tile = player.concealed.find(t => t.id === action.tileId);
      if (!tile) throw new Error(`DECLARE_ADDED_KONG: tile "${action.tileId}" not found in concealed hand`);
      const key = tileKey(tile);
      const pungIndex = player.melds.findIndex(
        m => m.type === 'pung' && m.tiles.length > 0 && tileKey(m.tiles[0]!) === key,
      );
      if (pungIndex === -1) {
        throw new Error(`DECLARE_ADDED_KONG: no exposed pung of ${key} to promote`);
      }
      const pung = player.melds[pungIndex]!;
      const kong: DeclaredMeld = { type: 'open_kong', tiles: [...pung.tiles, tile] };
      const melds = player.melds.map((m, i) => (i === pungIndex ? kong : m));
      const updatedPlayer = { ...player, concealed: removeOne(player.concealed, tile), melds };
      // Open the Robbing the Kong window: only this tile, only for a win.
      const responses: (ClaimDecision | null)[] =
        Array.from({ length: state.config.playerCount }, (_, i) =>
          i === state.currentSeat ? { type: 'pass' as const } : null);
      return {
        ...replacePlayer(state, updatedPlayer),
        phase:       'ROBBING_KONG',
        claimWindow: null,
        robbingKong: { tile, melderSeat: state.currentSeat, responses },
      };
    }

    case 'DECLARE_WIN': {
      const wp = state.players[state.currentSeat]!;
      const winningTile = wp.concealed[wp.concealed.length - 1];
      if (!winningTile) throw new Error('DECLARE_WIN: no winning tile in concealed hand');
      const isLastWallTile = state.wall.live.length === 0;
      const winSource = state.lastDrawSource === 'dead-wall' ? 'dead-wall-replacement' as const : 'self-draw-wall' as const;
      return {
        ...state, phase: 'HAND_OVER',
        handResult: { reason: 'win', winnerSeat: state.currentSeat, selfDraw: true, winningTile, winSource, isLastWallTile },
      };
    }

    default:
      throw new Error(`DISCARDING phase: unexpected action "${(action as Action).type}"`);
  }
}

// --- CLAIM_WINDOW -----

function handleClaimWindow(state: GameState, action: Action): GameState {
  if (action.type !== 'CLAIM_RESPONSE') {
    throw new Error(`CLAIM_WINDOW expects CLAIM_RESPONSE, got "${action.type}"`);
  }
  const { seat, decision } = action;
  const cw = state.claimWindow!;

  if (seat === state.currentSeat) throw new Error('CLAIM_WINDOW: the discarder cannot claim their own tile');
  if (cw.responses[seat] !== null) throw new Error(`CLAIM_WINDOW: seat ${seat} has already responded`);

  const discard  = state.discardPool[state.discardPool.length - 1]!;
  const claimer  = state.players[seat]!;
  const error    = validateClaimDecision(decision, claimer.concealed, discard, seat, state.currentSeat, state.config.playerCount);
  if (error !== null) throw new Error(`CLAIM_WINDOW: invalid claim from seat ${seat}: ${error}`);

  const newResponses = [...cw.responses] as (ClaimDecision | null)[];
  newResponses[seat] = decision;
  const newState: GameState = { ...state, claimWindow: { responses: newResponses } };

  if (newResponses.some(r => r === null)) return newState;
  return resolveClaimWindow(newState);
}

// --- ROBBING_KONG -----

function handleRobbingKong(state: GameState, action: Action): GameState {
  if (action.type !== 'CLAIM_RESPONSE') {
    throw new Error(`ROBBING_KONG expects CLAIM_RESPONSE, got "${action.type}"`);
  }
  const rk = state.robbingKong!;
  const { seat, decision } = action;

  if (seat === rk.melderSeat) throw new Error('ROBBING_KONG: the kong declarer cannot rob their own kong');
  if (rk.responses[seat] !== null) throw new Error(`ROBBING_KONG: seat ${seat} has already responded`);
  if (decision.type !== 'win' && decision.type !== 'pass') {
    throw new Error(`ROBBING_KONG: only 'win' or 'pass' are allowed, got "${decision.type}"`);
  }

  // A robbing win must be a genuine winning hand on the kong tile (Module 1.7).
  if (decision.type === 'win') {
    const claimer = state.players[seat]!;
    if (!isWinningHand([...claimer.concealed, rk.tile], claimer.melds, state.config)) {
      throw new Error(`ROBBING_KONG: seat ${seat} cannot win on ${tileKey(rk.tile)}`);
    }
  }

  const newResponses = [...rk.responses] as (ClaimDecision | null)[];
  newResponses[seat] = decision;
  const newState: GameState = { ...state, robbingKong: { ...rk, responses: newResponses } };

  if (newResponses.some(r => r === null)) return newState;
  return resolveRobbingKong(newState);
}

function resolveRobbingKong(state: GameState): GameState {
  const rk = state.robbingKong!;
  const winSeats = rk.responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .filter(({ r }) => r?.type === 'win')
    .map(({ seat }) => seat);

  if (winSeats.length > 0) {
    // Closest in turn order from the melder wins the robbed kong.
    const winner = selectWinClaimant(winSeats, rk.melderSeat, state.config.playerCount);
    return { ...state, robbingKong: null, phase: 'HAND_OVER', handResult: { reason: 'win', winnerSeat: winner, selfDraw: false, winningTile: rk.tile, winSource: 'discard' as const, robbedKong: true } };
  }
  // Nobody robbed -- the melder draws the kong replacement and continues their turn.
  return { ...state, robbingKong: null, phase: 'CHECK_BONUS' };
}

// --- Claim resolution -----

function resolveClaimWindow(state: GameState): GameState {
  const responses = state.claimWindow!.responses;

  const winSeats = responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .filter(({ r }) => r?.type === 'win')
    .map(({ seat }) => seat);

  if (winSeats.length > 0) {
    const winner    = selectWinClaimant(winSeats, state.currentSeat, state.config.playerCount);
    const discarded = state.discardPool[state.discardPool.length - 1]!;
    return {
      ...state,
      claimWindow: null,
      phase:       'HAND_OVER',
      handResult:  { reason: 'win', winnerSeat: winner, selfDraw: false, winningTile: discarded, winSource: 'discard' as const },
      discardLog:  markClaimed(state.discardLog, discarded.id, winner),
    };
  }

  const pungKong = responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .find(({ r }) => r?.type === 'pung' || r?.type === 'kong');
  if (pungKong) return resolvePungOrKong(state, pungKong.seat, pungKong.r!);

  const chow = responses
    .map((r, i) => ({ r, seat: i as SeatIndex }))
    .find(({ r }) => r?.type === 'chow');
  if (chow) return resolveChow(state, chow.seat, chow.r!);

  return advanceTurn(state);
}

function resolvePungOrKong(state: GameState, claimerSeat: SeatIndex, decision: ClaimDecision): GameState {
  const discarded = state.discardPool[state.discardPool.length - 1]!;
  const claimer   = state.players[claimerSeat]!;
  const isPung    = decision.type === 'pung';
  const needCount = isPung ? 2 : 3;

  const matching = claimer.concealed.filter(t => tileKey(t) === tileKey(discarded));
  if (matching.length < needCount) {
    throw new Error(`${decision.type.toUpperCase()}: need ${needCount} matching tiles in hand, found ${matching.length}`);
  }
  const fromHand: readonly Tile[] = matching.slice(0, needCount);
  const meldType: MeldType        = isPung ? 'pung' : 'open_kong';
  const meld: DeclaredMeld        = { type: meldType, tiles: [...fromHand, discarded] };

  const updatedClaimer = { ...claimer, concealed: removeTiles(claimer.concealed, fromHand), melds: [...claimer.melds, meld] };
  const { lastDrawnTileId: _pk, ...base } = state;
  return {
    ...replacePlayer(base, updatedClaimer),
    currentSeat: claimerSeat,
    discardPool: state.discardPool.slice(0, -1),
    discardLog:  markClaimed(state.discardLog, discarded.id, claimerSeat),
    claimWindow: null,
    phase: isPung ? 'DISCARDING' : 'CHECK_BONUS',
  };
}

function resolveChow(state: GameState, claimerSeat: SeatIndex, decision: ClaimDecision): GameState {
  if (!decision.chowTiles) throw new Error('CHOW: chowTiles must be provided in the claim decision');
  const discarded  = state.discardPool[state.discardPool.length - 1]!;
  const claimer    = state.players[claimerSeat]!;
  const [id1, id2] = decision.chowTiles;

  const t1 = claimer.concealed.find(t => t.id === id1);
  const t2 = claimer.concealed.find(t => t.id === id2);
  if (!t1 || !t2) throw new Error('CHOW: specified tiles not found in concealed hand');

  const meld: DeclaredMeld = { type: 'chow', tiles: [t1, t2, discarded] };
  const updatedClaimer = { ...claimer, concealed: claimer.concealed.filter(t => t.id !== id1 && t.id !== id2), melds: [...claimer.melds, meld] };
  const { lastDrawnTileId: _ch, ...base } = state;
  return {
    ...replacePlayer(base, updatedClaimer),
    currentSeat: claimerSeat,
    discardPool: state.discardPool.slice(0, -1),
    discardLog:  markClaimed(state.discardLog, discarded.id, claimerSeat),
    claimWindow: null,
    phase:       'DISCARDING',
  };
}

// --- Discard log helpers -----

/**
 * Append a new (unclaimed) discard entry to the log. `moveIndex` is the
 * discard ordinal within the hand (its stage), derived from the log length so
 * the sequence is stable and gap-free. An absent log is treated as empty.
 */
function appendDiscard(
  log:       readonly DiscardLogEntry[] | undefined,
  seat:      SeatIndex,
  tile:      Tile,
  justDrawn: boolean,
): readonly DiscardLogEntry[] {
  const base = log ?? [];
  return [...base, { seat, tile, moveIndex: base.length, claimedBy: null, justDrawn }];
}

/**
 * Annotate the log entry for `tileId` as claimed by `claimerSeat`. Matching is
 * by physical tile id, so it is unambiguous. The claimed tile leaves the
 * communal pool but its log entry is preserved (append-only history).
 */
function markClaimed(
  log:         readonly DiscardLogEntry[] | undefined,
  tileId:      TileId,
  claimerSeat: SeatIndex,
): readonly DiscardLogEntry[] {
  const base = log ?? [];
  return base.map(e => (e.tile.id === tileId ? { ...e, claimedBy: claimerSeat } : e));
}

// --- Internal helpers -----

function transitionToDiscard(state: GameState): GameState {
  const player     = state.players[state.currentSeat]!;
  const firstBonus = player.concealed.find(isBonus);
  if (!firstBonus) return { ...state, phase: 'DISCARDING' };
  return {
    ...replacePlayer(state, { ...player, concealed: removeOne(player.concealed, firstBonus), bonusTiles: [...player.bonusTiles, firstBonus] }),
    phase: 'CHECK_BONUS',
  };
}

function advanceTurn(state: GameState): GameState {
  return { ...state, currentSeat: nextSeat(state.currentSeat, state.config.playerCount), phase: 'DRAWING', claimWindow: null };
}

function nextSeat(seat: SeatIndex, playerCount: number): SeatIndex {
  return ((seat + 1) % playerCount) as SeatIndex;
}

function countKongs(player: PlayerState): number {
  return player.melds.filter(m => m.type === 'open_kong' || m.type === 'concealed_kong').length;
}

function withConcealed(player: PlayerState, tile: Tile): PlayerState {
  return { ...player, concealed: [...player.concealed, tile] };
}

function replacePlayer(state: GameState, updated: PlayerState): GameState {
  return { ...state, players: state.players.map((p, i) => (i === updated.seat ? updated : p)) };
}

function removeOne(tiles: readonly Tile[], target: Tile): readonly Tile[] {
  const idx = tiles.findIndex(t => t.id === target.id);
  if (idx === -1) throw new Error(`removeOne: tile "${target.id}" not found`);
  return [...tiles.slice(0, idx), ...tiles.slice(idx + 1)];
}

function removeTiles(tiles: readonly Tile[], toRemove: readonly Tile[]): readonly Tile[] {
  const ids = new Set(toRemove.map(t => t.id));
  return tiles.filter(t => !ids.has(t.id));
}
