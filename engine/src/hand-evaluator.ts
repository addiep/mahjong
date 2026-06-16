/**
 * Module 1.7 — Hand Evaluator (Win Detector)
 *
 * Answers the single gameplay question the turn engine and the AI need:
 * "is this a legal winning hand?" — a boolean.
 *
 * The hard work is the standard decomposition: carving the tiles into melds
 * and a pair. That search is written once, here, as `decomposeStandard`, and
 * exposed so the scoring engine (Module 1.8) can enumerate every reading and
 * price the best one. The evaluator itself only asks "is there at least one
 * valid carving?" and discards the carvings.
 *
 * Scope (per DESIGN.md §3, Module 1.7):
 *   - Standard win: (4 - declaredMelds) melds + 1 pair from the concealed tiles.
 *   - `dirtyWinAllowed`: when false, an ordinary win must be clean (suited melds
 *     all one suit; honours always allowed). Limit hands bypass this — and a
 *     no-chow standard hand is always at least All Pungs, so it bypasses too.
 *   - Non-standard winning shapes that the meld decomposition cannot express:
 *     the seven-pairs family, Wriggling Snake, 13 Unique Wonders, and (only when
 *     `knittingEnabled`) Knitting and Crocheting. These require a fully concealed
 *     hand (no declared melds).
 *   - Circumstance hands (Plum Blossom, Moon, Twofold Fortune) are recognised
 *     from a provenance context, not tile structure; see `detectCircumstance`.
 *     They presuppose an otherwise-winning hand and so do not affect the binary.
 *
 * Bonus tiles (flowers/seasons) are never part of the hand; callers exclude them.
 *
 * Dependencies: tiles.ts, game-state.ts. No UI dependencies. No side effects.
 */

import {
  Tile, Suit, SuitedValue, SUITS, TileKey, tileKey,
  isSuited, isHonour, isBonus, isTerminal,
} from './tiles.js';
import { DeclaredMeld, GameConfig } from './game-state.js';

// ─── Public result types ──────────────────────────────────────────────────────

/** A complete meld in a decomposition. Always three tiles (kongs are declared). */
export interface StandardMeld {
  readonly kind:  'pung' | 'chow';
  readonly tiles: readonly Tile[];
}

/** One valid reading of a hand as melds + a pair. */
export interface StandardDecomposition {
  readonly pair:  readonly Tile[];        // length 2
  readonly melds: readonly StandardMeld[]; // length = meldsNeeded
}

// ─── Counting representation ───────────────────────────────────────────────────

interface Counts {
  /** suit -> array indexed 1..9 of how many of that value are present. */
  readonly suited: Record<Suit, number[]>;
  /** honour tileKey -> count. */
  readonly honours: Map<TileKey, number>;
  /** any flower/season present (a hand containing one can never win). */
  readonly hasBonus: boolean;
  /** total non-bonus tiles. */
  readonly total: number;
}

function emptySuitArray(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // index 0 unused
}

function buildCounts(tiles: readonly Tile[]): Counts {
  const suited: Record<Suit, number[]> = {
    bamboo: emptySuitArray(), characters: emptySuitArray(), circles: emptySuitArray(),
  };
  const honours = new Map<TileKey, number>();
  let hasBonus = false;
  let total = 0;
  for (const t of tiles) {
    if (isBonus(t)) { hasBonus = true; continue; }
    total++;
    if (isSuited(t)) {
      suited[t.suit][t.value] = (suited[t.suit][t.value] ?? 0) + 1;
    } else {
      const k = tileKey(t);
      honours.set(k, (honours.get(k) ?? 0) + 1);
    }
  }
  return { suited, honours, hasBonus, total };
}

// ─── Structural decomposition (count space) ─────────────────────────────────────

type StructMeld =
  | { readonly kind: 'pung'; readonly suit: Suit; readonly value: SuitedValue }
  | { readonly kind: 'chow'; readonly suit: Suit; readonly low: SuitedValue }
  | { readonly kind: 'pung-honour'; readonly key: TileKey };

interface StructReading {
  readonly pair: { readonly suit: Suit; readonly value: SuitedValue } | { readonly key: TileKey };
  readonly melds: readonly StructMeld[];
}

/** All ways to fully decompose one suit's count array into pungs and chows. */
function decomposeSuit(suit: Suit, arr: readonly number[]): StructMeld[][] {
  let low = -1;
  for (let v = 1; v <= 9; v++) { if ((arr[v] ?? 0) > 0) { low = v; break; } }
  if (low === -1) return [[]]; // fully consumed
  const v = low as SuitedValue;
  const results: StructMeld[][] = [];

  // Option A: pung of v.
  if ((arr[v] ?? 0) >= 3) {
    const next = arr.slice(); next[v] = (next[v] ?? 0) - 3;
    for (const sub of decomposeSuit(suit, next)) {
      results.push([{ kind: 'pung', suit, value: v }, ...sub]);
    }
  }
  // Option B: chow v, v+1, v+2.
  if (v <= 7 && (arr[v + 1] ?? 0) > 0 && (arr[v + 2] ?? 0) > 0) {
    const next = arr.slice();
    next[v] = (next[v] ?? 0) - 1;
    next[v + 1] = (next[v + 1] ?? 0) - 1;
    next[v + 2] = (next[v + 2] ?? 0) - 1;
    for (const sub of decomposeSuit(suit, next)) {
      results.push([{ kind: 'chow', suit, low: v }, ...sub]);
    }
  }
  return results;
}

/** Honours can only form pungs. Returns the single decomposition, or [] if impossible. */
function decomposeHonours(honours: Map<TileKey, number>): StructMeld[][] {
  const melds: StructMeld[] = [];
  for (const [key, count] of honours) {
    if (count === 0) continue;
    if (count === 3) { melds.push({ kind: 'pung-honour', key }); continue; }
    return []; // 1, 2, or 4 of an honour cannot all be melded
  }
  return [melds];
}

function cartesian(lists: StructMeld[][][]): StructMeld[][] {
  let acc: StructMeld[][] = [[]];
  for (const list of lists) {
    if (list.length === 0) return [];
    const nextAcc: StructMeld[][] = [];
    for (const partial of acc) for (const choice of list) nextAcc.push([...partial, ...choice]);
    acc = nextAcc;
  }
  return acc;
}

/** All structural readings (pair + melds) consuming every tile, with exactly meldsNeeded melds. */
function structReadings(counts: Counts, meldsNeeded: number): StructReading[] {
  const readings: StructReading[] = [];

  const tryMelds = (
    suited: Record<Suit, number[]>,
    honours: Map<TileKey, number>,
    pair: StructReading['pair'],
  ): void => {
    const groupLists: StructMeld[][][] = [
      decomposeSuit('bamboo', suited.bamboo),
      decomposeSuit('characters', suited.characters),
      decomposeSuit('circles', suited.circles),
      decomposeHonours(honours),
    ];
    for (const combo of cartesian(groupLists)) {
      if (combo.length === meldsNeeded) readings.push({ pair, melds: combo });
    }
  };

  // Candidate pair from a suit.
  for (const suit of SUITS) {
    for (let v = 1; v <= 9; v++) {
      if ((counts.suited[suit][v] ?? 0) >= 2) {
        const suited = cloneSuited(counts.suited);
        suited[suit][v] = (suited[suit][v] ?? 0) - 2;
        tryMelds(suited, counts.honours, { suit, value: v as SuitedValue });
      }
    }
  }
  // Candidate pair from an honour.
  for (const [key, count] of counts.honours) {
    if (count >= 2) {
      const honours = new Map(counts.honours);
      honours.set(key, count - 2);
      tryMelds(counts.suited, honours, { key });
    }
  }
  return readings;
}

function cloneSuited(s: Record<Suit, number[]>): Record<Suit, number[]> {
  return { bamboo: s.bamboo.slice(), characters: s.characters.slice(), circles: s.circles.slice() };
}

// ─── Converting struct readings to tile-backed decompositions ───────────────────

/** A pool that hands out actual Tile instances by kind. */
function tilePool(tiles: readonly Tile[]): Map<TileKey, Tile[]> {
  const pool = new Map<TileKey, Tile[]>();
  for (const t of tiles) {
    if (isBonus(t)) continue;
    const k = tileKey(t);
    const arr = pool.get(k); if (arr) arr.push(t); else pool.set(k, [t]);
  }
  return pool;
}

function take(pool: Map<TileKey, Tile[]>, key: TileKey): Tile {
  const arr = pool.get(key);
  if (!arr || arr.length === 0) throw new Error(`tilePool: out of ${key}`);
  return arr.pop()!;
}

function suitedKey(suit: Suit, value: number): TileKey {
  return `suited:${suit}:${value}` as TileKey;
}

function toDecomposition(reading: StructReading, tiles: readonly Tile[]): StandardDecomposition {
  const pool = tilePool(tiles);
  const pairKey = 'key' in reading.pair ? reading.pair.key : suitedKey(reading.pair.suit, reading.pair.value);
  const pair = [take(pool, pairKey), take(pool, pairKey)];
  const melds: StandardMeld[] = reading.melds.map(m => {
    if (m.kind === 'pung') {
      const k = suitedKey(m.suit, m.value);
      return { kind: 'pung', tiles: [take(pool, k), take(pool, k), take(pool, k)] };
    }
    if (m.kind === 'pung-honour') {
      return { kind: 'pung', tiles: [take(pool, m.key), take(pool, m.key), take(pool, m.key)] };
    }
    return {
      kind: 'chow',
      tiles: [
        take(pool, suitedKey(m.suit, m.low)),
        take(pool, suitedKey(m.suit, m.low + 1)),
        take(pool, suitedKey(m.suit, m.low + 2)),
      ],
    };
  });
  return { pair, melds };
}

function readingSignature(r: StructReading): string {
  const pair = 'key' in r.pair ? `p:${r.pair.key}` : `p:${r.pair.suit}:${r.pair.value}`;
  const melds = r.melds.map(m =>
    m.kind === 'pung' ? `P${m.suit}${m.value}`
      : m.kind === 'chow' ? `C${m.suit}${m.low}`
        : `H${m.key}`,
  ).sort();
  return pair + '|' + melds.join(',');
}

/**
 * Shared decomposition helper. Returns every valid reading of `tiles` as
 * `meldsNeeded` melds plus one pair. The evaluator checks `.length > 0`;
 * the scorer enumerates and ranks. Returns [] if no valid reading exists.
 */
export function decomposeStandard(tiles: readonly Tile[], meldsNeeded: number): StandardDecomposition[] {
  if (meldsNeeded < 0) return [];
  const counts = buildCounts(tiles);
  if (counts.hasBonus) return [];
  if (counts.total !== meldsNeeded * 3 + 2) return [];
  const seen = new Set<string>();
  const out: StandardDecomposition[] = [];
  for (const reading of structReadings(counts, meldsNeeded)) {
    const sig = readingSignature(reading);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(toDecomposition(reading, tiles));
  }
  return out;
}

// ─── Clean / dirty helpers ──────────────────────────────────────────────────────

function suitsOf(tiles: readonly Tile[]): Set<Suit> {
  const s = new Set<Suit>();
  for (const t of tiles) if (isSuited(t)) s.add(t.suit);
  return s;
}

/** A reading is clean if all suited tiles (reading + declared melds) are one suit. */
function isClean(decomp: StandardDecomposition, declaredMelds: readonly DeclaredMeld[]): boolean {
  const suits = new Set<Suit>();
  for (const t of decomp.pair) if (isSuited(t)) suits.add(t.suit);
  for (const m of decomp.melds) for (const t of m.tiles) if (isSuited(t)) suits.add(t.suit);
  for (const m of declaredMelds) for (const t of m.tiles) if (isSuited(t)) suits.add(t.suit);
  return suits.size <= 1;
}

function readingHasChow(decomp: StandardDecomposition, declaredMelds: readonly DeclaredMeld[]): boolean {
  if (decomp.melds.some(m => m.kind === 'chow')) return true;
  return declaredMelds.some(m => m.type === 'chow');
}

// ─── Non-standard special hands (fully concealed, 14 tiles) ─────────────────────

interface PairAnalysis {
  readonly isSevenGroups: boolean; // every kind appears an even number of times, 7 pairs total
  readonly tiles: readonly Tile[];
}

function asSevenPairs(tiles: readonly Tile[]): PairAnalysis {
  const counts = new Map<TileKey, number>();
  for (const t of tiles) counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) {
    if (c % 2 !== 0) return { isSevenGroups: false, tiles };
    pairs += c / 2;
  }
  return { isSevenGroups: pairs === 7, tiles };
}

/** Seven-pairs family: Heavenly Twins, Clean Pairs, Honour Pairs, All Pairs Honours. */
function isSevenPairsWin(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!asSevenPairs(tiles).isSevenGroups) return false;
  const suits = suitsOf(tiles);
  const allHonour = tiles.every(isHonour);
  const allTerminalOrHonour = tiles.every(t => isHonour(t) || isTerminal(t));
  const suitedAllOneSuit = suits.size <= 1; // honours allowed alongside
  // Honour Pairs (all honours) or All Pairs Honours (terminals + honours) or
  // Heavenly Twins / Clean Pairs (suited all one suit, honours permitted).
  return allHonour || allTerminalOrHonour || suitedAllOneSuit;
}

/** Wriggling Snake: 1–9 run in one suit with one value doubled, plus one of each wind. */
function isWrigglingSnake(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const winds = tiles.filter(t => t.category === 'wind');
  if (winds.length !== 4) return false;
  if (new Set(winds.map(tileKey)).size !== 4) return false; // one of each wind
  const suitedTiles = tiles.filter(isSuited);
  if (suitedTiles.length !== 10) return false;
  if (tiles.some(t => t.category === 'dragon')) return false;
  if (suitsOf(tiles).size !== 1) return false;
  const valCount = emptySuitArray();
  for (const t of suitedTiles) valCount[t.value] = (valCount[t.value] ?? 0) + 1;
  let doubled = 0;
  for (let v = 1; v <= 9; v++) {
    const c = valCount[v] ?? 0;
    if (c === 0) return false;        // every value 1..9 must be present
    if (c === 2) doubled++;
    else if (c !== 1) return false;   // only counts of 1 or (exactly one) 2 allowed
  }
  return doubled === 1;
}

const THIRTEEN_KINDS: readonly TileKey[] = [
  'suited:bamboo:1', 'suited:bamboo:9', 'suited:characters:1', 'suited:characters:9',
  'suited:circles:1', 'suited:circles:9',
  'wind:east', 'wind:south', 'wind:west', 'wind:north',
  'dragon:red', 'dragon:green', 'dragon:white',
].map(s => s as TileKey);

/** 13 Unique Wonders: one of each terminal/honour kind, with exactly one doubled. */
function isThirteenWonders(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = new Map<TileKey, number>();
  for (const t of tiles) counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);
  const required = new Set(THIRTEEN_KINDS);
  let doubled = 0;
  for (const [key, c] of counts) {
    if (!required.has(key)) return false;
    if (c === 2) doubled++;
    else if (c !== 1) return false;
  }
  return counts.size === 13 && doubled === 1;
}

/**
 * Knitting (OQ-13a resolved): all suited, exactly two suits, and the two suits
 * pair up across each other by number. Each of the seven pairs is the same number
 * taken once from each suit (e.g. bamboo-3 + characters-3), so the per-value counts
 * in the two suits must match. Gated behind `knittingEnabled` (off by default).
 */
function isKnitting(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!tiles.every(isSuited)) return false;
  const present = [...suitsOf(tiles)];
  if (present.length !== 2) return false;
  const [s1] = present as [Suit, Suit];
  const a = emptySuitArray(), b = emptySuitArray();
  for (const t of tiles) {
    if (!isSuited(t)) return false;
    if (t.suit === s1) a[t.value] = (a[t.value] ?? 0) + 1;
    else b[t.value] = (b[t.value] ?? 0) + 1;
  }
  for (let v = 1; v <= 9; v++) if ((a[v] ?? 0) !== (b[v] ?? 0)) return false;
  return true; // 14 tiles with matched counts = seven cross-suit number pairs
}

/**
 * Crocheting (triple knitting): four triples, each one tile of the same number
 * from all three suits, plus a pair of same-numbered tiles (any suits, OQ-13b).
 * All suited, no honours. Gated behind `knittingEnabled`.
 */
function isCrocheting(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!tiles.every(isSuited)) return false;
  const bam = emptySuitArray(), chr = emptySuitArray(), cir = emptySuitArray();
  for (const t of tiles) {
    const a = t.suit === 'bamboo' ? bam : t.suit === 'characters' ? chr : cir;
    a[t.value] = (a[t.value] ?? 0) + 1;
  }
  // Try each value as the pair location; form triples from the rest.
  for (let p = 1; p <= 9; p++) {
    if ((bam[p] ?? 0) + (chr[p] ?? 0) + (cir[p] ?? 0) < 2) continue;
    if (canFormTriplesWithPair(bam.slice(), chr.slice(), cir.slice(), p)) return true;
  }
  return false;
}

function canFormTriplesWithPair(bam: number[], chr: number[], cir: number[], pairValue: number): boolean {
  // Remove two tiles at pairValue (a same-numbered pair), trying every suit combination.
  const arrays = [bam, chr, cir];
  const combos: number[][] = [];
  for (const i of [0, 1, 2]) for (const j of [0, 1, 2]) combos.push([i, j]);
  for (const [i, j] of combos) {
    const a = arrays.map(x => x.slice());
    if ((a[i!]![pairValue] ?? 0) < 1) continue;
    a[i!]![pairValue]!--;
    if ((a[j!]![pairValue] ?? 0) < 1) continue;
    a[j!]![pairValue]!--;
    if (triplesConsumeAll(a[0]!, a[1]!, a[2]!)) return true;
  }
  return false;
}

/** True if the three suit arrays can be fully consumed by triples (one of each suit, same number). */
function triplesConsumeAll(bam: number[], chr: number[], cir: number[]): boolean {
  for (let v = 1; v <= 9; v++) {
    const a = bam[v] ?? 0, b = chr[v] ?? 0, c = cir[v] ?? 0;
    if (a !== b || b !== c) return false; // triples need equal counts across suits
  }
  return true;
}

function isNonStandardSpecialWin(tiles: readonly Tile[], config: GameConfig): boolean {
  if (isSevenPairsWin(tiles)) return true;
  if (isWrigglingSnake(tiles)) return true;
  if (isThirteenWonders(tiles)) return true;
  if (config.knittingEnabled && (isKnitting(tiles) || isCrocheting(tiles))) return true;
  return false;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * The binary win detector. `hand` is the full concealed hand INCLUDING the
 * winning tile and EXCLUDING declared melds and bonus tiles.
 *
 * Returns true if the hand is a legal win under the current config.
 */
export function isWinningHand(
  hand: readonly Tile[],
  declaredMelds: readonly DeclaredMeld[],
  config: GameConfig,
): boolean {
  const meldsNeeded = 4 - declaredMelds.length;
  if (meldsNeeded < 0) return false;

  // Standard 4+1 wins (covers the great majority of limit hands too).
  const readings = decomposeStandard(hand, meldsNeeded);
  for (const r of readings) {
    if (config.dirtyWinAllowed) return true;
    if (isClean(r, declaredMelds)) return true;
    // A no-chow hand is at least All Pungs (a limit hand) and bypasses dirty.
    if (!readingHasChow(r, declaredMelds)) return true;
  }

  // Non-standard winning shapes require a fully concealed hand.
  if (declaredMelds.length === 0 && isNonStandardSpecialWin(hand, config)) return true;

  return false;
}

// ─── Circumstance hands ─────────────────────────────────────────────────────────

export type WinningTileSource = 'discard' | 'self-draw-wall' | 'dead-wall-replacement';

/** Provenance of the winning tile, supplied by the turn engine. */
export interface WinContext {
  readonly source: WinningTileSource;
  /** True if the winning tile was the very last tile of the live wall (for Moon). */
  readonly isLastWallTile?: boolean;
  /** Number of consecutive kong replacements that produced this tile (for Twofold Fortune). */
  readonly kongReplacementChain?: number;
}

export type CircumstanceHand = 'plum_blossom' | 'moon' | 'twofold_fortune';

/**
 * Detects circumstance hands from the winning tile and its provenance.
 * Presupposes the hand is already a win (call `isWinningHand` first).
 */
export function detectCircumstance(winningTile: Tile, context: WinContext): CircumstanceHand[] {
  const out: CircumstanceHand[] = [];
  const isCirc = (v: SuitedValue) => isSuited(winningTile) && winningTile.suit === 'circles' && winningTile.value === v;

  if (isCirc(5) && context.source === 'dead-wall-replacement') out.push('plum_blossom');
  if (isCirc(1) && context.source === 'self-draw-wall' && context.isLastWallTile === true) out.push('moon');
  if (context.source === 'dead-wall-replacement' && (context.kongReplacementChain ?? 0) >= 2) out.push('twofold_fortune');
  return out;
}
