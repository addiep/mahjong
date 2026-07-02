/**
 * Pure helpers shared by the local and online game hooks.
 *
 * Extracted from App.tsx in the Todo G refactor (2026-07-02). Everything here
 * is stateless: no React, no side effects. Behaviour is unchanged -- these
 * are the same functions App.tsx used to define inline.
 */

import {
  buildWall,
  createGameState,
  isSuited, isWind, isDragon,
  tileKey,
  adviseSeat,
  type GameState,
  type GameConfig,
  type SeatIndex,
  type TileId,
  type Tile,
  type Suit,
  type Wind,
  type Dragon,
  type ScoreResult,
} from '@mahjong/engine';
import type { PlayerBonusInfo, WinnerHandInfo } from '../components/ScorePanel';

// --- Tile sort helpers (mirrored from PlayerHand.tsx) -----

const SUIT_ORDER: Record<Suit, number> = { bamboo: 0, characters: 1, circles: 2 };
const WIND_ORDER: Record<Wind, number> = { east: 0, south: 1, west: 2, north: 3 };
const DRAGON_ORDER: Record<Dragon, number> = { red: 0, green: 1, white: 2 };

export function sortTileKey(t: Tile): [number, number, number] {
  if (isSuited(t)) return [0, SUIT_ORDER[t.suit], t.value];
  if (isWind(t))   return [1, WIND_ORDER[t.wind], 0];
  if (isDragon(t)) return [2, DRAGON_ORDER[t.dragon], 0];
  return [3, 0, 0];
}

export function compareTileKeys(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Concealed tiles sorted into display order (suit, then value), as IDs. */
export function sortedTileIds(tiles: readonly Tile[]): string[] {
  return [...tiles]
    .sort((a, b) => compareTileKeys(sortTileKey(a), sortTileKey(b)))
    .map(t => t.id);
}

/** Human-readable tile name, e.g. '3 of bamboo', 'east wind', 'red dragon'. */
export function tileName(tile: Tile): string {
  if (isSuited(tile)) return `${tile.value} of ${tile.suit}`;
  if (isWind(tile))   return `${tile.wind} wind`;
  if (isDragon(tile)) return `${tile.dragon} dragon`;
  return 'bonus tile';
}

/**
 * Returns options for declaring an added kong during DISCARDING: tiles in the
 * current player's concealed hand that match an existing exposed pung.
 * Each option carries the tileId to dispatch and a display label.
 */
export function getAddKongOptions(state: GameState): { tileId: TileId; label: string }[] {
  const player = state.players[state.currentSeat];
  if (!player) return [];
  return player.melds
    .filter(m => m.type === 'pung')
    .flatMap(m => {
      const pungTile = m.tiles[0];
      if (!pungTile) return [];
      const key = tileKey(pungTile);
      const match = player.concealed.find(t => tileKey(t) === key);
      return match ? [{ tileId: match.id, label: `Add Kong: ${tileName(pungTile)}` }] : [];
    });
}

// --- Game initialisation (local pass-and-play) -----

// Fixed roster of local-play display names, indexed by a stable "identity"
// slot (0..playerCount-1) -- NOT by seat/wind, which rotates hand to hand
// (Todo A / issue 3 fix, 2026-07-02). Identity 0 is the default local seat;
// identities playerCount-aiSeats..playerCount-1 are AI, matching the
// GameSetup convention ("human is seat 0; AI take the last seats") for the
// very first hand of a session.
export const ROSTER_NAMES = ['Alice', 'Bob', 'Carol', 'Dan'];

const WIND_CYCLE: readonly Wind[] = ['east', 'south', 'west', 'north'];

/** Next wind in rotation order, wrapping within the first `playerCount` winds. */
export function nextWind(w: Wind, playerCount: number): Wind {
  const cycle = WIND_CYCLE.slice(0, playerCount);
  const i = cycle.indexOf(w);
  return cycle[(i + 1) % cycle.length] ?? 'east';
}

export function makeInitialState(config: GameConfig, names: string[], roundWind: Wind): GameState {
  const deal = buildWall(config.playerCount, config.deadWall ?? false);
  return { ...createGameState(config, deal, names), prevailingWind: roundWind };
}

// --- Shared view bits -----

export const SEAT_NAMES = ['East', 'South', 'West', 'North'] as const;

export interface HandScoreInfo {
  winnerName: string | null;
  result: ScoreResult | null;
  playerBonuses: PlayerBonusInfo[];
  /** Winner's full hand for display; null on a draw. */
  winnerHand: WinnerHandInfo | null;
}

/**
 * The Hint button's message (shared by the local and online handlers): the
 * AI's plan for this seat, its suggested discard, and the Module 4.7
 * special-hand nudge (name only). Callers guard the phase/turn first.
 */
export function buildHintText(state: GameState, seat: SeatIndex): string {
  const advice = adviseSeat(state, seat);
  if (advice.winNow) return 'Hint: this hand is a winning hand -- declare Mah Jong!';
  const planText = advice.plan.mode === 'dirty'
    ? 'go for a dirty hand (build melds in any suit, fast)'
    : `collect ${advice.plan.targetSuit}`;
  let discardText = '';
  if (advice.discard) {
    const player = state.players[seat];
    const tile = player?.concealed.find(t => t.id === advice.discard);
    if (tile) discardText = `; the AI would discard the ${tileName(tile)}`;
  }
  // Module 4.7: special-hand nudge -- name only.
  const nudgeText = advice.nudge ? `; you could aim for ${advice.nudge.name}` : '';
  return `Hint: ${planText}${discardText}${nudgeText}.`;
}
