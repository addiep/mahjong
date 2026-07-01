/**
 * Module 4.4 -- AI Action Selection: Claims
 *
 * Decide whether to claim a discarded tile (or rob a kong), and how.
 *
 *   - Declare Mah Jong whenever the hand is legal (any seat may win on a
 *     discard, per the family rule). No holding back for a bigger hand.
 *   - Pung a tile that fits the plan: target suit, a dragon, or the AI's own
 *     wind. (Baseline pungs even when a kong is possible -- simpler, and avoids
 *     the kong replacement draw. Konging is a later refinement.)
 *   - Chow only when the AI is the seat to the discarder's right and the tile
 *     is in the target suit (or any suit in dirty mode).
 *   - Chow-vs-pung tension: do not break a held pair to form a chow while the
 *     pung is still realistic. If copies of that pair's kind are already visible
 *     elsewhere (discards or exposed melds), the pung is unlikely, so take the
 *     chow to speed the hand up.
 *   - Redundant chow suppression: if the concealed hand already contains exactly
 *     one copy of the discarded tile's kind, claiming a chow would expose a meld
 *     already virtually present in hand and leave a spare copy to throw away —
 *     a wasted turn.  Two held copies are not suppressed: the claim leaves a
 *     pair behind, which can be worth keeping.
 *   - Committed special target (Module 4.6): the target's seek set drives the
 *     claim; concealed-only targets never claim anything short of the win.
 *
 * Dependencies: tiles.ts, game-state.ts, claim-window.ts, hand-evaluator.ts,
 * assessment.ts. No UI, no side effects.
 */

import {
  Tile, TileId, SuitedTile,
  isSuited, isWind, isDragon, tileKey,
} from '../tiles.js';
import { GameState, SeatIndex, ClaimDecision } from '../game-state.js';
import { canPung, canChow } from '../claim-window.js';
import { isWinningHand } from '../hand-evaluator.js';
import { HandPlan } from './assessment.js';

/** Green tiles for Imperial Jade: bamboo 2,3,4,6,8 and the Green Dragon. */
function isGreen(t: Tile): boolean {
  if (isSuited(t)) return t.suit === 'bamboo' && [2, 3, 4, 6, 8].includes(t.value);
  return isDragon(t) && t.dragon === 'green';
}

/** The discard currently on offer (last tile of the pool), or null. */
function tileOnOffer(state: GameState): Tile | null {
  const pool = state.discardPool;
  return pool.length > 0 ? pool[pool.length - 1]! : null;
}

/** Would this tile, as a pung/chow target, advance the plan? */
function fitsForMeld(tile: Tile, plan: HandPlan): boolean {
  if (isDragon(tile)) return true;
  if (isWind(tile))   return tile.wind === plan.seatWind;
  if (isSuited(tile)) {
    if (plan.mode === 'dirty') return true;
    return (tile as SuitedTile).suit === plan.targetSuit;
  }
  return false;
}

/** Copies of a tile's kind already visible to everyone (discards + all exposed melds). */
function visibleElsewhere(state: GameState, tile: Tile): number {
  const key = tileKey(tile);
  let n = 0;
  for (const t of state.discardPool) if (tileKey(t) === key) n += 1;
  for (const p of state.players) {
    for (const m of p.melds) for (const t of m.tiles) if (tileKey(t) === key) n += 1;
  }
  return n;
}

/**
 * Every chow the seat can form with the discard, as concealed tile-id pairs.
 * Mirrors canChow's three positional patterns.
 */
export function chowOptions(concealed: readonly Tile[], discard: Tile): Array<[TileId, TileId]> {
  if (!isSuited(discard)) return [];
  const d = discard as SuitedTile;
  const patterns: [number, number][] = [
    [d.value - 2, d.value - 1],
    [d.value - 1, d.value + 1],
    [d.value + 1, d.value + 2],
  ];
  const find = (v: number): Tile | undefined =>
    concealed.find(t => isSuited(t) && (t as SuitedTile).suit === d.suit && (t as SuitedTile).value === v);

  const options: Array<[TileId, TileId]> = [];
  for (const [v1, v2] of patterns) {
    if (v1 < 1 || v2 > 9) continue;
    const t1 = find(v1);
    const t2 = find(v2);
    if (t1 && t2) options.push([t1.id, t2.id]);
  }
  return options;
}

/**
 * Pick a chow that does not sacrifice a still-realistic pung, and does not
 * claim a chow the hand already holds virtually.  Returns the chosen tile-id
 * pair, or null if no option is worth taking.
 */
function pickChow(state: GameState, concealed: readonly Tile[], discard: Tile): [TileId, TileId] | null {
  const options = chowOptions(concealed, discard);
  if (options.length === 0) return null;

  const counts = new Map<string, number>();
  for (const t of concealed) {
    const k = tileKey(t) as string;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Redundant-chow guard: if the hand already holds exactly one copy of the
  // discard's kind, claiming any chow would expose a sequence virtually already
  // in hand and leave a spare copy of the discard tile to throw immediately —
  // wasted turn.  (Two copies → the spare forms a pair, worth keeping.)
  const discardKey = tileKey(discard) as string;
  if ((counts.get(discardKey) ?? 0) === 1) return null;

  const breaksGoodPair = (pair: [TileId, TileId]): boolean =>
    pair.some(id => {
      const tile = concealed.find(t => t.id === id);
      if (!tile) return false;
      const held = counts.get(tileKey(tile) as string) ?? 0;
      // Using one of a held pair breaks it. The pung is still realistic only if
      // no copy of that kind is visible elsewhere yet.
      return held >= 2 && visibleElsewhere(state, tile) === 0;
    });

  const safe = options.find(o => !breaksGoodPair(o));
  return safe ?? null;
}

/**
 * The AI's claim decision for the tile currently on offer during CLAIM_WINDOW.
 * (Robbing the Kong is handled by the controller, which only allows win/pass.)
 */
export function chooseClaimDecision(state: GameState, seat: SeatIndex, plan: HandPlan): ClaimDecision {
  const discard = tileOnOffer(state);
  if (!discard) return { type: 'pass' };

  const player    = state.players[seat]!;
  const concealed = player.concealed;

  // 1. Win whenever legal.
  if (isWinningHand([...concealed, discard], player.melds, state.config)) {
    return { type: 'win' };
  }

  // 1b. Committed special target (Module 4.6): the target's seek set drives
  //     the claim, and the concealed-only rule is absolute -- never claim a
  //     discard if it would kill the first-group hand being chased.
  if (plan.special) {
    if (plan.special.concealedOnly) return { type: 'pass' };
    const key = tileKey(discard);
    if (canPung(concealed, discard) && plan.special.seek.includes(key)) {
      return { type: 'pung' };
    }
    // Chows only help Imperial Jade (the one 4.6a target that allows them),
    // and only when every tile of the sequence is green.
    if (plan.special.name === 'Imperial Jade' && isGreen(discard)) {
      const count = state.config.playerCount;
      const rightSeat = ((state.currentSeat + 1) % count) as SeatIndex;
      if (seat === rightSeat && canChow(concealed, discard)) {
        const green = chowOptions(concealed, discard).find(pair =>
          pair.every(id => { const t = concealed.find(x => x.id === id); return t !== undefined && isGreen(t); }));
        if (green) return { type: 'chow', chowTiles: green };
      }
    }
    return { type: 'pass' };
  }

  // 2. Pung if it fits the plan.
  if (canPung(concealed, discard) && fitsForMeld(discard, plan)) {
    return { type: 'pung' };
  }

  // 3. Chow (right of discarder only) if it fits, subject to pung tension and
  //    redundant-chow suppression.
  const count = state.config.playerCount;
  const rightSeat = ((state.currentSeat + 1) % count) as SeatIndex;
  if (seat === rightSeat && canChow(concealed, discard) && fitsForMeld(discard, plan)) {
    const chow = pickChow(state, concealed, discard);
    if (chow) return { type: 'chow', chowTiles: chow };
  }

  return { type: 'pass' };
}

/** Robbing the Kong: win on the robbable tile if legal, else pass. */
export function chooseRobDecision(state: GameState, seat: SeatIndex): ClaimDecision {
  const rk = state.robbingKong;
  if (!rk) return { type: 'pass' };
  const player = state.players[seat]!;
  if (isWinningHand([...player.concealed, rk.tile], player.melds, state.config)) {
    return { type: 'win' };
  }
  return { type: 'pass' };
}
