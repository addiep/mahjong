/**
 * Module 1.8 — Scoring Engine
 *
 * Calculates the score for a *winning* hand: flat base points (per meld and a
 * scoring pair) plus the going-Mah-Jong bonuses, multiplied by the number of
 * doublings the hand earns, with special / limit hands overriding the normal
 * tally when they pay more. The whole thing is bounded by the agreed limit.
 *
 * The player is entitled to their best reading, so — exactly as Module 1.7's
 * docstring anticipated — we ask the shared `decomposeStandard` helper for
 * *every* carving of the concealed tiles, score each, and keep the maximum.
 *
 * What this module deliberately does NOT do:
 *   - Per-flower / per-season flat points (a flat 4 each) are Module 1.9's job.
 *     We surface the bonus-tile count, and we DO apply the complete-set-of-
 *     flowers / complete-set-of-seasons doublings here (they belong to the
 *     doublings table), but we do not add the flat 4-per-tile points.
 *   - Settling points between players. This scores one winning hand; how the
 *     table tally moves is a higher-level concern.
 *
 * All scoring values live in scoring-config.ts. No UI dependencies, no side
 * effects: a pure function of its inputs.
 *
 * Dependencies: tiles.ts, game-state.ts, hand-evaluator.ts, scoring-config.ts.
 */

import {
  Tile, Suit, Wind, isSuited, isHonour, isDragon, isWind, isTerminal,
  isFlower, isSeason, tileKey, sameInstance,
} from './tiles.js';
import { DeclaredMeld, GameConfig, SeatIndex } from './game-state.js';
import {
  decomposeStandard, StandardDecomposition,
  WinContext,
} from './hand-evaluator.js';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from './scoring-config.js';

// ─── Public input / output ──────────────────────────────────────────

/**
 * Everything the scorer needs about a completed winning hand. The turn engine
 * (Module 1.4) assembles this; tiles must already be a confirmed win (run
 * `isWinningHand` first).
 */
export interface ScoreInput {
  /** Concealed hand INCLUDING the winning tile, EXCLUDING declared melds & bonus tiles. */
  readonly concealed:      readonly Tile[];
  /** Melds laid down during play (chow / pung / open or concealed kong). */
  readonly declaredMelds:  readonly DeclaredMeld[];
  /** Flowers and seasons set aside (used only for the complete-set doublings here). */
  readonly bonusTiles:     readonly Tile[];
  /** The tile that completed the hand (a specific instance from `concealed`). */
  readonly winningTile:    Tile;
  /** Provenance of the winning tile (drives self-draw, loose-tile and circumstance hands). */
  readonly winContext:     WinContext;
  /** The winner's seat wind. */
  readonly seatWind:       Wind;
  /** The prevailing (round) wind. */
  readonly prevailingWind: Wind;
  /** The winner's seat (0 = East / dealer). */
  readonly seat:           SeatIndex;
  /** The immutable game config (knitting / dirty-win flags). */
  readonly gameConfig:     GameConfig;

  // ── Optional circumstance flags the engine knows but tiles cannot reveal ──
  /** Won by claiming a discard rather than self-drawing. */
  readonly wonByDiscard?:  boolean;
  /** Won by robbing an added kong. */
  readonly robbingKong?:   boolean;
  /** Declared fishing immediately after the player's very first discard. */
  readonly originalCall?:  boolean;
  /** Won on the very last discard of the hand. */
  readonly lastDiscard?:   boolean;
}

/** One flat-points line in the breakdown. */
export interface ScoreLine { readonly label: string; readonly points: number; }
/** One doubling line in the breakdown (doublings = number of ×2 multipliers). */
export interface DoublingLine { readonly label: string; readonly doublings: number; }

export interface ScoreResult {
  /** Final score after doublings, special-hand override, and the limit cap. */
  readonly total:        number;
  /** Name of the special / limit hand that set the score, or null for a normal tally. */
  readonly specialHand:  string | null;
  /** True when the score is a limit (or special fixed) payout. */
  readonly isLimitHand:  boolean;
  /** Flat points summed before doublings (normal path only; 0 when a special hand wins). */
  readonly basePoints:   number;
  /** Total doublings applied (normal path only). */
  readonly doublings:    number;
  /** Flat-points breakdown (normal path). */
  readonly lines:        readonly ScoreLine[];
  /** Doublings breakdown (normal path). */
  readonly doublingLines: readonly DoublingLine[];
  /** Number of flowers + seasons (flat 4-per-tile points are Module 1.9's responsibility). */
  readonly bonusTileCount: number;
}

// ─── Internal group model ────────────────────────────────────────

interface ScoreGroup {
  readonly kind:      'pung' | 'kong' | 'chow';
  readonly concealed: boolean;
  readonly tiles:     readonly Tile[];
}

/** The full hand expressed as four groups + a pair (one reading). */
interface FullHand {
  readonly groups: readonly ScoreGroup[];
  readonly pair:   readonly Tile[];
}

function declaredToGroup(m: DeclaredMeld): ScoreGroup {
  switch (m.type) {
    case 'chow':           return { kind: 'chow', concealed: false, tiles: m.tiles };
    case 'pung':           return { kind: 'pung', concealed: false, tiles: m.tiles };
    case 'open_kong':      return { kind: 'kong', concealed: false, tiles: m.tiles };
    case 'concealed_kong': return { kind: 'kong', concealed: true,  tiles: m.tiles };
  }
}

/**
 * Build the four-group + pair view for one decomposition reading. Concealed
 * decomposition melds are concealed, EXCEPT the meld completed by a claimed
 * winning tile, which is treated as exposed (standard discard-completes-meld
 * rule). Declared melds keep their own exposure.
 */
function buildFullHand(
  reading: StandardDecomposition,
  declaredMelds: readonly DeclaredMeld[],
  winningTile: Tile,
  exposeWinningMeld: boolean,
): FullHand {
  const groups: ScoreGroup[] = declaredMelds.map(declaredToGroup);
  for (const m of reading.melds) {
    const containsWin = m.tiles.some(t => sameInstance(t, winningTile));
    const concealed = !(exposeWinningMeld && containsWin && m.kind === 'pung');
    groups.push({ kind: m.kind, concealed, tiles: m.tiles });
  }
  return { groups, pair: reading.pair };
}

// ─── Tile helpers ───────────────────────────────────────────────

function isMajorTile(t: Tile): boolean {
  return isHonour(t) || isTerminal(t);
}

/** Human-readable tile-kind label for score display (e.g. 'circles', 'south wind', 'red dragon'). */
function tileLabel(t: Tile): string {
  if (isSuited(t)) return t.suit;
  if (isWind(t)) return `${t.wind} wind`;
  if (isDragon(t)) return `${t.dragon} dragon`;
  return 'bonus';
}

/** Green tiles for Imperial Jade: bamboo 2,3,4,6,8 and the Green Dragon. */
function isGreenTile(t: Tile): boolean {
  if (isSuited(t)) return t.suit === 'bamboo' && [2, 3, 4, 6, 8].includes(t.value);
  return isDragon(t) && t.dragon === 'green';
}

function suitedSuits(tiles: readonly Tile[]): Set<Suit> {
  const s = new Set<Suit>();
  for (const t of tiles) if (isSuited(t)) s.add(t.suit);
  return s;
}

function allTilesOf(hand: FullHand): Tile[] {
  return [...hand.pair, ...hand.groups.flatMap(g => [...g.tiles])];
}

// ─── Normal (base + doublings) scoring of one reading ──────────────────────

interface NormalScore {
  readonly total:         number;
  readonly basePoints:    number;
  readonly doublings:     number;
  readonly lines:         ScoreLine[];
  readonly doublingLines: DoublingLine[];
}

function meldBasePoints(g: ScoreGroup, cfg: ScoringConfig): number {
  if (g.kind === 'chow') return 0;
  const major = isMajorTile(g.tiles[0]!);
  const table = g.kind === 'kong'
    ? (g.concealed ? cfg.concealedKong : cfg.exposedKong)
    : (g.concealed ? cfg.concealedPung : cfg.exposedPung);
  return major ? table.major : table.minor;
}

function pairBasePoints(hand: FullHand, input: ScoreInput, cfg: ScoringConfig): number {
  const t = hand.pair[0]!;
  if (isDragon(t)) return cfg.scoringPair;
  if (isWind(t) && t.wind === input.seatWind) return cfg.scoringPair;
  if (isWind(t) && t.wind === input.prevailingWind) return cfg.scoringPair;
  return 0;
}

function scoreNormalReading(hand: FullHand, input: ScoreInput, cfg: ScoringConfig): NormalScore {
  const lines: ScoreLine[] = [];
  const doublingLines: DoublingLine[] = [];

  // ── Flat base points ──
  let base = 0;
  for (const g of hand.groups) {
    const p = meldBasePoints(g, cfg);
    if (p > 0) {
      const exposure = g.concealed ? 'concealed' : 'exposed';
      lines.push({ label: `${exposure} ${g.kind} of ${tileLabel(g.tiles[0]!)}`, points: p });
      base += p;
    }
  }
  const pairPts = pairBasePoints(hand, input, cfg);
  if (pairPts > 0) { lines.push({ label: `scoring pair of ${tileLabel(hand.pair[0]!)}`, points: pairPts }); base += pairPts; }

  // ── Going Mah-Jong bonuses (winner) ──
  const noChows = hand.groups.every(g => g.kind !== 'chow');
  lines.push({ label: 'going Mah-Jong', points: cfg.goingMahjong });
  base += cfg.goingMahjong;
  if (input.winContext.source === 'self-draw-wall') {
    lines.push({ label: 'won from the live wall', points: cfg.winFromLiveWall });
    base += cfg.winFromLiveWall;
  }
  if (noChows) { lines.push({ label: 'no chows', points: cfg.noChows }); base += cfg.noChows; }

  // ── Doublings ──
  let doublings = 0;
  const addDouble = (label: string, n: number) => { if (n > 0) { doublings += n; doublingLines.push({ label, doublings: n }); } };

  // Pung/kong of dragons or own-wind only — once per qualifying meld.
  const honourMelds = hand.groups.filter(g =>
    g.kind !== 'chow' &&
    (isDragon(g.tiles[0]!) || (isWind(g.tiles[0]!) && (g.tiles[0]! as { wind: Wind }).wind === input.seatWind))
  ).length;
  addDouble('pung/kong of dragon or own wind', honourMelds);

  // Pung/kong of the prevailing (round) wind -- one further doubling per meld
  // (Todo C). Deliberately stacks with the own-wind doubling above, so a pung
  // of a wind that is BOTH the player's seat wind and the wind of the round
  // earns two doublings (Adam's call, 2026-07-02).
  const roundWindMelds = hand.groups.filter(g =>
    g.kind !== 'chow' &&
    isWind(g.tiles[0]!) && (g.tiles[0]! as { wind: Wind }).wind === input.prevailingWind
  ).length;
  addDouble('pung/kong of the wind of the round', roundWindMelds);

  // Complete set of flowers / seasons (doubles twice each).
  if (hasCompleteSet(input.bonusTiles, isFlower)) addDouble('bouquet (flowers)', 3);
  if (hasCompleteSet(input.bonusTiles, isSeason)) addDouble('bouquet (seasons)', 3);

  // Original call (applies to all players).
  if (input.originalCall) addDouble('original call', 1);

  // ── Winner-only doublings ──
  const all = allTilesOf(hand);
  const suits = suitedSuits(all);
  const hasHonour = all.some(isHonour);
  const hasSuited = all.some(isSuited);

  // Clean hand: suited tiles all one suit (honours permitted); needs at least one suited tile.
  if (hasSuited && suits.size <= 1) addDouble('clean hand', 1);

  // All concealed: no exposed groups at all (self-draw, no exposed melds).
  if (hand.groups.every(g => g.concealed)) addDouble('all concealed', 1);

  // Special winning circumstance (grouped as a single doubling).
  const looseTile = input.winContext.source === 'dead-wall-replacement';
  if (looseTile || input.winContext.isLastWallTile || input.lastDiscard || input.originalCall || input.robbingKong) {
    addDouble('special winning circumstance', 1);
  }

  // Purity: clean hand in one suit, no Winds or Dragons (×3).
  // Stricter than the ×1 clean-hand doubling (which permits W/D); a purity hand earns both.
  if (hasSuited && !hasHonour && suits.size === 1) {
    addDouble('purity', 3);
  }

  // All Honours (×3, winner only): no chows, every tile major (honour or terminal),
  // and at least one honour. The pure-honours and pure-terminals cases are the
  // All Winds and Dragons / Heads and Tails limit hands; this covers the mixed case.
  if (noChows && all.every(isMajorTile) && hasHonour) addDouble('all honours', 3);

  const total = base * Math.pow(2, doublings);
  return { total, basePoints: base, doublings, lines, doublingLines };
}

function hasCompleteSet(bonus: readonly Tile[], pred: (t: Tile) => boolean): boolean {
  const kinds = new Set<string>();
  for (const t of bonus) if (pred(t)) kinds.add(tileKey(t));
  return kinds.size === 4;
}

// ─── Special / limit hand detection ──────────────────────────────────

interface SpecialHit { readonly name: string; readonly score: number; readonly priority: number; }

/**
 * Tie-break priority when several special hands pay the same score: the more
 * specific / prestigious hand wins the *label*. The generic Mixed Pungs ranks
 * lowest; bespoke and circumstance hands rank highest. Payout is unaffected.
 */
const PRIORITY = {
  mixedPungs: 1,
  allKongs: 2,
  buriedTreasure: 3,
  bespokePungHand: 4, // Heads and Tails, Three Great Scholars, Four Blessings, Imperial Jade, Chinese Odds, All Winds and Dragons
  bespokeShape: 5,    // seven pairs, snake, wonders, nine gates, windy dragons, dragonfly, knitting
  bespokeRunPung: 6,  // Run Pung and Pair, Sparrow's Sanctuary — win the label over Buried Treasure / seven-pairs
  circumstance: 7,
} as const;

/** Detectors that work from the four-group + pair view (allow declared melds). */
function detectGroupSpecials(hand: FullHand, input: ScoreInput, cfg: ScoringConfig): SpecialHit[] {
  const hits: SpecialHit[] = [];
  const { groups, pair } = hand;
  const noChows = groups.every(g => g.kind !== 'chow');
  const fullyConcealed = groups.every(g => g.concealed);
  const all = allTilesOf(hand);
  const hasHonour = all.some(isHonour);

  // All Kongs (Fourfold Plenty): four kongs + a pair; the suited tiles must be one suit.
  if (groups.length === 4 && groups.every(g => g.kind === 'kong') && suitedSuits(all).size <= 1) {
    hits.push({ name: 'All Kongs (Fourfold Plenty)', score: cfg.limit, priority: PRIORITY.allKongs });
  }

  // Three Great Scholars: pung/kong of all three dragons + one further meld + a pair,
  // where the further (non-dragon) meld AND the pair are of the same suit.
  const dragonMelds = groups.filter(g => (g.kind === 'pung' || g.kind === 'kong') && isDragon(g.tiles[0]!));
  const dragonKinds = new Set(dragonMelds.map(g => tileKey(g.tiles[0]!)));
  if (dragonKinds.size === 3) {
    const otherMelds = groups.filter(g => !((g.kind === 'pung' || g.kind === 'kong') && isDragon(g.tiles[0]!)));
    // Exactly one further meld; collect its suit plus the pair's suit; they must match (and be a suit).
    const sameSuitFourth = otherMelds.length === 1 && (() => {
      const m0 = otherMelds[0]!.tiles[0]!;
      const p0 = pair[0]!;
      return isSuited(m0) && isSuited(p0) && (m0 as { suit: Suit }).suit === (p0 as { suit: Suit }).suit;
    })();
    if (sameSuitFourth) hits.push({ name: 'Three Great Scholars', score: cfg.limit, priority: PRIORITY.bespokePungHand });
  }

  // Imperial Jade: all tiles green + a pung/kong of Green Dragons + a green-bamboo pair.
  // Chows of green bamboos (2-3-4, 6-7-8) are allowed, so this lives outside the noChows gate.
  if (all.every(isGreenTile)) {
    const greenDragonMeld = groups.some(g =>
      (g.kind === 'pung' || g.kind === 'kong') && isDragon(g.tiles[0]!) && (g.tiles[0]! as { dragon: string }).dragon === 'green');
    const greenBambooPair = pair.length === 2 && isSuited(pair[0]!) && (pair[0]! as { suit: Suit }).suit === 'bamboo';
    if (greenDragonMeld && greenBambooPair) {
      hits.push({ name: 'Imperial Jade', score: cfg.limit, priority: PRIORITY.bespokePungHand });
    }
  }

  // Buried Treasure: fully concealed CLEAN hand in a single suit, no honours, no kongs.
  // Chows are allowed. (Self-draw of the winning tile is implied by fully concealed.)
  if (fullyConcealed && suitedSuits(all).size === 1 && !hasHonour && groups.every(g => g.kind !== 'kong')) {
    hits.push({ name: 'Buried Treasure', score: cfg.limit, priority: PRIORITY.buriedTreasure });
  }

  if (noChows) {
    // Mixed Pungs: four pungs/kongs + a pair, fully self-drawn (fully concealed). Any tiles.
    if (fullyConcealed) {
      hits.push({ name: 'Mixed Pungs', score: cfg.limit, priority: PRIORITY.mixedPungs });
    }

    // Four Blessings: pung/kong of each of the four winds + any pair.
    const windKinds = new Set(groups.filter(g => isWind(g.tiles[0]!)).map(g => tileKey(g.tiles[0]!)));
    if (windKinds.size === 4) hits.push({ name: 'Four Blessings Hovering Over the Door', score: cfg.limit, priority: PRIORITY.bespokePungHand });

    // Heads and Tails: terminals only (1s and 9s), no honours.
    if (all.every(t => isSuited(t) && isTerminal(t))) {
      hits.push({ name: 'Heads and Tails', score: cfg.limit, priority: PRIORITY.bespokePungHand });
    }

    // Chinese Odds: every tile suited, all one suit, every value odd (1,3,5,7,9).
    if (all.every(isSuited) && suitedSuits(all).size === 1 &&
        all.every(t => isSuited(t) && (t.value % 2 === 1))) {
      hits.push({ name: 'Chinese Odds', score: cfg.limit, priority: PRIORITY.bespokePungHand });
    }

    // All Winds and Dragons: every tile an honour (no suited tiles).
    if (all.every(isHonour)) {
      hits.push({ name: 'All Winds and Dragons', score: cfg.limit, priority: PRIORITY.bespokePungHand });
    }
  }
  return hits;
}

/** Detectors that need the raw 14-tile concealed hand (no declared melds). */
function detectConcealedSpecials(tiles: readonly Tile[], input: ScoreInput, cfg: ScoringConfig): SpecialHit[] {
  const hits: SpecialHit[] = [];
  if (tiles.length !== 14) return hits;

  const P = PRIORITY.bespokeShape;

  // Sparrow's Sanctuary: four 1-Bamboos + a pair each of 2,3,4,6,8 Bamboo.
  // This also satisfies isSevenPairs, so detect (and suppress Heavenly Twins) first.
  const sparrow = isSparrowsSanctuary(tiles);
  if (sparrow) hits.push({ name: "Sparrow's Sanctuary", score: cfg.limit, priority: PRIORITY.bespokeRunPung });

  // Seven-pairs family.
  if (!sparrow && isSevenPairs(tiles)) {
    const allMajor = tiles.every(isMajorTile);
    const oneSuit = suitedSuits(tiles).size <= 1;
    if (allMajor) hits.push({ name: 'All Pairs Honours', score: cfg.allPairsHonours, priority: P });
    else if (oneSuit && !tiles.some(isHonour)) hits.push({ name: 'Heavenly Twins', score: cfg.limit, priority: P });
    else if (oneSuit) hits.push({ name: 'Clean Pairs', score: cfg.halfLimit, priority: P });
  }

  // Run, Pung and Pair: single suit, all of 1..9 present, plus a pung and a pair.
  if (isRunPungAndPair(tiles)) hits.push({ name: 'Run, Pung and Pair', score: cfg.limit, priority: PRIORITY.bespokeRunPung });

  if (isWrigglingSnake(tiles)) hits.push({ name: 'Wriggly Snake', score: cfg.limit, priority: P });
  if (isThirteenWonders(tiles)) hits.push({ name: 'Unique Wonder', score: cfg.doubleLimit, priority: P });
  if (isWindyDragons(tiles)) hits.push({ name: 'Windy Dragons', score: cfg.limit, priority: P });
  if (isDragonfly(tiles)) hits.push({ name: 'Dragonfly', score: cfg.halfLimit, priority: P });
  if (isNineGates(tiles)) hits.push({ name: 'Gates of Heaven (Nine Chances)', score: cfg.limit, priority: P });
  if (input.gameConfig.knittingEnabled) {
    if (isKnitting(tiles)) hits.push({ name: 'Knitting', score: cfg.limit, priority: P });
    if (isCrocheting(tiles)) hits.push({ name: 'Crocheting (Triple Knitting)', score: cfg.halfLimit, priority: P });
  }
  return hits;
}

/** Detectors driven purely by circumstance (tile composition irrelevant). */
function detectCircumstanceSpecials(_input: ScoreInput, _cfg: ScoringConfig): SpecialHit[] {
  return [];
}

// ── Raw-multiset special-hand predicates ──

function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) m.set(tileKey(t), (m.get(tileKey(t)) ?? 0) + 1);
  return m;
}

function isSevenPairs(tiles: readonly Tile[]): boolean {
  let pairs = 0;
  for (const c of countByKey(tiles).values()) {
    if (c % 2 !== 0) return false;
    pairs += c / 2;
  }
  return pairs === 7;
}

function emptyVals(): number[] { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }

function isWrigglingSnake(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (tiles.some(isDragon)) return false;
  const suited = tiles.filter(isSuited);
  const winds = tiles.filter(isWind);
  if (suited.length + winds.length !== 14) return false;
  if (suitedSuits(tiles).size !== 1) return false;

  // Wind counts (each of the four winds present; possibly one doubled).
  const windCounts = new Map<string, number>();
  for (const w of winds) windCounts.set(tileKey(w), (windCounts.get(tileKey(w)) ?? 0) + 1);
  const fourWindsPresent = windCounts.size === 4;
  let windDoubled = 0;
  for (const c of windCounts.values()) { if (c === 2) windDoubled++; else if (c !== 1) return false; }

  // Suited value spread: each of 1..9 present; possibly one doubled.
  const v = emptyVals();
  for (const t of suited) if (isSuited(t)) v[t.value] = (v[t.value] ?? 0) + 1;
  let runComplete = true, suitDoubled = 0;
  for (let i = 1; i <= 9; i++) {
    const c = v[i] ?? 0;
    if (c === 0) runComplete = false;
    else if (c === 2) suitDoubled++;
    else if (c !== 1) return false;
  }

  // (a) suited run doubled (10 suited) + four single winds (4 winds).
  if (suited.length === 10 && suitDoubled === 1 && runComplete &&
      winds.length === 4 && fourWindsPresent && windDoubled === 0) return true;
  // (b) suited run exactly 1-9 (9 suited) + four winds with one doubled (5 winds).
  if (suited.length === 9 && suitDoubled === 0 && runComplete &&
      winds.length === 5 && fourWindsPresent && windDoubled === 1) return true;
  return false;
}

const THIRTEEN = new Set<string>([
  'suited:bamboo:1', 'suited:bamboo:9', 'suited:characters:1', 'suited:characters:9',
  'suited:circles:1', 'suited:circles:9',
  'wind:east', 'wind:south', 'wind:west', 'wind:north',
  'dragon:red', 'dragon:green', 'dragon:white',
]);

function isThirteenWonders(tiles: readonly Tile[]): boolean {
  const counts = countByKey(tiles);
  let doubled = 0;
  for (const [k, c] of counts) {
    if (!THIRTEEN.has(k)) return false;
    if (c === 2) doubled++;
    else if (c !== 1) return false;
  }
  return counts.size === 13 && doubled === 1;
}

/** Windy Dragons: pungs of any two dragons + a pair of each of the four winds. */
function isWindyDragons(tiles: readonly Tile[]): boolean {
  if (tiles.some(isSuited)) return false;
  const counts = countByKey(tiles);
  let dragonPungs = 0, windPairs = 0;
  for (const [k, c] of counts) {
    if (k.startsWith('dragon:')) { if (c !== 3) return false; dragonPungs++; }
    else if (k.startsWith('wind:')) { if (c !== 2) return false; windPairs++; }
    else return false;
  }
  return dragonPungs === 2 && windPairs === 4;
}

/** Dragonfly: one of each dragon + a pung in each suit + any pair. */
function isDragonfly(tiles: readonly Tile[]): boolean {
  if (tiles.some(isWind)) return false;
  const dragons = tiles.filter(isDragon);
  if (dragons.length !== 3 || new Set(dragons.map(tileKey)).size !== 3) return false;
  const suited = tiles.filter(isSuited);
  if (suited.length !== 11) return false; // 3 pungs (9) + pair (2)
  // Each suit must contribute a pung; one suit additionally carries the pair.
  const perSuit: Record<Suit, number[]> = { bamboo: emptyVals(), characters: emptyVals(), circles: emptyVals() };
  for (const t of suited) if (isSuited(t)) perSuit[t.suit][t.value] = (perSuit[t.suit][t.value] ?? 0) + 1;
  let pairsFound = 0;
  for (const suit of ['bamboo', 'characters', 'circles'] as Suit[]) {
    const arr = perSuit[suit];
    let pung = 0, pair = 0, other = 0;
    for (let i = 1; i <= 9; i++) {
      const c = arr[i] ?? 0;
      if (c === 0) continue;
      if (c === 3) pung++;
      else if (c === 2) pair++;
      else other++;
    }
    if (other > 0) return false;
    if (pung !== 1) return false;       // exactly one pung per suit
    pairsFound += pair;
  }
  return pairsFound === 1;
}

/**
 * Gates of Heaven (Nine Gates): pung of 1s + pung of 9s + each of 2..8 present,
 * all one suit, with the completing tile a 2-8 (not a 1 or 9). So exactly:
 * v[1]===3 && v[9]===3 && every v[2..8] in {1,2} with exactly one ===2.
 */
function isNineGates(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!tiles.every(isSuited)) return false;
  if (suitedSuits(tiles).size !== 1) return false;
  const v = emptyVals();
  for (const t of tiles) if (isSuited(t)) v[t.value] = (v[t.value] ?? 0) + 1;
  if ((v[1] ?? 0) !== 3 || (v[9] ?? 0) !== 3) return false;
  let doubled = 0;
  for (let i = 2; i <= 8; i++) {
    const c = v[i] ?? 0;
    if (c === 2) doubled++;
    else if (c !== 1) return false; // each of 2..8 present exactly once or twice
  }
  return doubled === 1; // exactly one of 2..8 completed the hand
}

/**
 * Sparrow's Sanctuary: four 1-Bamboos + a pair each of 2,3,4,6,8 Bamboo.
 * counts: bamboo 1 = 4; bamboo 2,3,4,6,8 = 2 each; nothing else.
 */
function isSparrowsSanctuary(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!tiles.every(t => isSuited(t) && t.suit === 'bamboo')) return false;
  const v = emptyVals();
  for (const t of tiles) if (isSuited(t)) v[t.value] = (v[t.value] ?? 0) + 1;
  if ((v[1] ?? 0) !== 4) return false;
  for (const val of [2, 3, 4, 6, 8]) if ((v[val] ?? 0) !== 2) return false;
  for (const val of [5, 7, 9]) if ((v[val] ?? 0) !== 0) return false;
  return true;
}

/**
 * Run, Pung and Pair: single suit, no honours; counts are exactly one value ===4,
 * one other value ===3, and the remaining seven values ===1. (The 4-count value is
 * the run tile that also forms part of the pung; subtracting one of each 1..9 leaves
 * a pung (3) and a pair (2).)
 */
function isRunPungAndPair(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!tiles.every(isSuited)) return false;
  if (suitedSuits(tiles).size !== 1) return false;
  const v = emptyVals();
  for (const t of tiles) if (isSuited(t)) v[t.value] = (v[t.value] ?? 0) + 1;
  let fours = 0, threes = 0, ones = 0;
  for (let i = 1; i <= 9; i++) {
    const c = v[i] ?? 0;
    if (c === 4) fours++;
    else if (c === 3) threes++;
    else if (c === 1) ones++;
    else return false;
  }
  return fours === 1 && threes === 1 && ones === 7;
}

function isKnitting(tiles: readonly Tile[]): boolean {
  if (!tiles.every(isSuited)) return false;
  const present = [...suitedSuits(tiles)];
  if (present.length !== 2) return false;
  const s1 = present[0]!;
  const a = emptyVals(), b = emptyVals();
  for (const t of tiles) if (isSuited(t)) { (t.suit === s1 ? a : b)[t.value] = ((t.suit === s1 ? a : b)[t.value] ?? 0) + 1; }
  for (let i = 1; i <= 9; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  return true;
}

function isCrocheting(tiles: readonly Tile[]): boolean {
  if (!tiles.every(isSuited)) return false;
  const bam = emptyVals(), chr = emptyVals(), cir = emptyVals();
  for (const t of tiles) if (isSuited(t)) {
    const a = t.suit === 'bamboo' ? bam : t.suit === 'characters' ? chr : cir;
    a[t.value] = (a[t.value] ?? 0) + 1;
  }
  for (let p = 1; p <= 9; p++) {
    if ((bam[p] ?? 0) + (chr[p] ?? 0) + (cir[p] ?? 0) < 2) continue;
    if (crochetTriples(bam.slice(), chr.slice(), cir.slice(), p)) return true;
  }
  return false;
}

function crochetTriples(bam: number[], chr: number[], cir: number[], pairValue: number): boolean {
  const arrays = [bam, chr, cir];
  for (const i of [0, 1, 2]) for (const j of [0, 1, 2]) {
    const a = arrays.map(x => x.slice());
    if ((a[i]![pairValue] ?? 0) < 1) continue;
    a[i]![pairValue]!--;
    if ((a[j]![pairValue] ?? 0) < 1) continue;
    a[j]![pairValue]!--;
    let ok = true;
    for (let v = 1; v <= 9 && ok; v++) {
      const x = a[0]![v] ?? 0, y = a[1]![v] ?? 0, z = a[2]![v] ?? 0;
      if (x !== y || y !== z) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

// ─── Public entry point ───────────────────────────────────────────

/**
 * Scores a confirmed winning hand. Enumerates every reading of the concealed
 * tiles, scores each normally, detects special / limit hands, and returns the
 * highest-paying result, capped at the agreed limit.
 *
 * `scoringConfig` defaults to the family table; pass a custom one to retune.
 */
export function scoreWinningHand(
  input: ScoreInput,
  scoringConfig: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScoreResult {
  const cfg = scoringConfig;
  const meldsNeeded = 4 - input.declaredMelds.length;
  const exposeWinningMeld = input.wonByDiscard === true || input.robbingKong === true;

  const bonusTileCount = input.bonusTiles.filter(t => isFlower(t) || isSeason(t)).length;

  // ── Normal scoring over every reading ──
  let best: NormalScore | null = null;
  const specials: SpecialHit[] = [];
  const readings = meldsNeeded >= 0 ? decomposeStandard(input.concealed, meldsNeeded) : [];
  for (const reading of readings) {
    const hand = buildFullHand(reading, input.declaredMelds, input.winningTile, exposeWinningMeld);
    const s = scoreNormalReading(hand, input, cfg);
    if (!best || s.total > best.total) best = s;

    // Group-based special hands depend on the reading, so test them here.
    specials.push(...detectGroupSpecials(hand, input, cfg));
  }

  // ── Special / limit hands ──
  if (input.declaredMelds.length === 0) {
    specials.push(...detectConcealedSpecials(input.concealed, input, cfg));
  }
  specials.push(...detectCircumstanceSpecials(input, cfg));

  const bestSpecial = specials.reduce<SpecialHit | null>((acc, h) => {
    if (!acc) return h;
    if (h.score > acc.score) return h;
    if (h.score === acc.score && h.priority > acc.priority) return h;
    return acc;
  }, null);

  // ── Combine: best of normal vs special ──
  // The normal tally is capped at the limit. A special hand pays its full fixed
  // score *uncapped* (so Unique Wonder pays the double limit), and wins the label
  // whenever its uncapped score is at least the capped normal total.
  const normalTotal = best ? best.total : 0;
  const specialScore = bestSpecial ? bestSpecial.score : 0;
  const cappedNormal = Math.min(cfg.limit, normalTotal);

  if (bestSpecial && specialScore >= cappedNormal) {
    return {
      total:         specialScore,
      specialHand:   bestSpecial.name,
      isLimitHand:   true,
      basePoints:    0,
      doublings:     0,
      lines:         [],
      doublingLines: [],
      bonusTileCount,
    };
  }

  const capped = Math.min(cfg.limit, normalTotal);
  return {
    total:         capped,
    specialHand:   null,
    isLimitHand:   capped >= cfg.limit && normalTotal >= cfg.limit,
    basePoints:    best ? best.basePoints : 0,
    doublings:     best ? best.doublings : 0,
    lines:         best ? best.lines : [],
    doublingLines: best ? best.doublingLines : [],
    bonusTileCount,
  };
}

// ─── Exposed-meld scoring for non-winning players ────────────────────────────

/**
 * Scores the full hand of a player who did NOT win. Non-winners earn base
 * points for declared exposed/concealed pungs and kongs plus any concealed
 * pungs still in hand, and doublings for dragon/own-wind melds, clean-hand,
 * and complete bonus sets. Chows score zero. No going-Mah-Jong bonuses apply.
 *
 * `seatWind` is the non-winner's own seat wind (for own-wind doubling).
 * `concealedTiles` are the player's unmelded hand tiles; when supplied they
 * are scanned for concealed pungs and scoring pairs of dragons / own-wind.
 */
export interface ExposedMeldScoreResult {
  readonly total:         number;
  readonly basePoints:    number;
  readonly doublings:     number;
  readonly lines:         readonly ScoreLine[];
  readonly doublingLines: readonly DoublingLine[];
}

export function scoreExposedMelds(
  melds:           readonly DeclaredMeld[],
  bonusTiles:      readonly Tile[],
  scoringConfig:   ScoringConfig = DEFAULT_SCORING_CONFIG,
  seatWind?:       Wind,
  concealedTiles?: readonly Tile[],
  prevailingWind?: Wind,
): ExposedMeldScoreResult {
  const cfg = scoringConfig;
  const scoreLines: ScoreLine[] = [];
  const dblLines: DoublingLine[] = [];
  let base = 0;

  // ── Declared melds ──
  for (const meld of melds) {
    const g = declaredToGroup(meld);
    if (g.kind === 'chow') continue;
    const pts = meldBasePoints(g, cfg);
    if (pts > 0) {
      const exposure = g.concealed ? 'concealed' : 'exposed';
      const first = g.tiles[0];
      if (first) scoreLines.push({ label: `${exposure} ${g.kind} of ${tileLabel(first)}`, points: pts });
      base += pts;
    }
  }

  // ── Concealed pungs / scoring pairs from unmelded hand tiles ──
  let concealedHonourPungCount = 0;
  let concealedRoundWindPungCount = 0;
  if (concealedTiles && concealedTiles.length > 0) {
    const counts = new Map<string, { tile: Tile; count: number }>();
    for (const t of concealedTiles) {
      const k = tileKey(t);
      if (!counts.has(k)) counts.set(k, { tile: t, count: 0 });
      counts.get(k)!.count++;
    }
    for (const { tile, count } of counts.values()) {
      if (count >= 3) {
        const kind: 'pung' | 'kong' = count >= 4 ? 'kong' : 'pung';
        const pseudo: ScoreGroup = { kind, concealed: true, tiles: Array.from({ length: count }, () => tile) };
        const pts = meldBasePoints(pseudo, cfg);
        if (pts > 0) {
          scoreLines.push({ label: `concealed ${kind} of ${tileLabel(tile)}`, points: pts });
          base += pts;
        }
        if (isDragon(tile) || (seatWind !== undefined && isWind(tile) && (tile as { wind: Wind }).wind === seatWind)) {
          concealedHonourPungCount++;
        }
        if (prevailingWind !== undefined && isWind(tile) && (tile as { wind: Wind }).wind === prevailingWind) {
          concealedRoundWindPungCount++;
        }
      } else if (count === 2) {
        if (
          isDragon(tile) ||
          (seatWind !== undefined && isWind(tile) && (tile as { wind: Wind }).wind === seatWind) ||
          (prevailingWind !== undefined && isWind(tile) && (tile as { wind: Wind }).wind === prevailingWind)
        ) {
          scoreLines.push({ label: `scoring pair of ${tileLabel(tile)}`, points: cfg.scoringPair });
          base += cfg.scoringPair;
        }
      }
    }
  }

  let doublings = 0;
  const addDouble = (label: string, n: number) => {
    if (n > 0) { doublings += n; dblLines.push({ label, doublings: n }); }
  };

  // Pung/kong of dragons or own-wind: declared melds + concealed pungs.
  const declaredHonourCount = melds.filter(m => {
    const g = declaredToGroup(m);
    const first = g.tiles[0];
    if (g.kind === 'chow' || first === undefined) return false;
    return isDragon(first) || (seatWind !== undefined && isWind(first) && (first as { wind: Wind }).wind === seatWind);
  }).length;
  addDouble('pung/kong of dragon or own wind', declaredHonourCount + concealedHonourPungCount);

  // Pung/kong of the prevailing (round) wind (Todo C) -- applies to all
  // players, and stacks with the own-wind doubling when the two winds match.
  const declaredRoundWindCount = prevailingWind === undefined ? 0 : melds.filter(m => {
    const g = declaredToGroup(m);
    const first = g.tiles[0];
    if (g.kind === 'chow' || first === undefined) return false;
    return isWind(first) && (first as { wind: Wind }).wind === prevailingWind;
  }).length;
  addDouble('pung/kong of the wind of the round', declaredRoundWindCount + concealedRoundWindPungCount);

  // Clean-hand doubling: all tiles (declared + concealed) in at most one suit
  // (honours permitted, but at least one suited tile must be present).
  const allTiles = [...melds.flatMap(m => [...m.tiles]), ...(concealedTiles ?? [])];
  const allSuits = suitedSuits(allTiles);
  const hasSuited = allTiles.some(isSuited);
  const hasHonour = allTiles.some(isHonour);
  if (hasSuited && allSuits.size <= 1) addDouble('clean hand', 1);

  // Purity (clean hand, no Winds or Dragons): ×3 — applies to all players.
  if (hasSuited && !hasHonour && allSuits.size === 1) addDouble('purity', 3);

  if (hasCompleteSet(bonusTiles, isFlower)) addDouble('bouquet (flowers)', 3);
  if (hasCompleteSet(bonusTiles, isSeason)) addDouble('bouquet (seasons)', 3);

  // No base points means nothing to double; avoid returning a doubled zero.
  const total = base === 0 ? 0 : base * Math.pow(2, doublings);
  return { total, basePoints: base, doublings, lines: scoreLines, doublingLines: dblLines };
}
