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
  WinContext, detectCircumstance,
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
  /** Hand was waiting on exactly one tile (the only tile that could complete it). */
  readonly onlyPossibleTile?: boolean;
  /** Declared fishing immediately after the player's very first discard. */
  readonly originalCall?:  boolean;
  /** Won on the very last discard of the hand. */
  readonly lastDiscard?:   boolean;
  /** Dealer won on the opening deal before any discard (Heavenly Hand). */
  readonly heavenlyHand?:  boolean;
  /** Non-dealer won on East's very first discard (Earthly Hand). */
  readonly earthlyHand?:   boolean;
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

// ─── Tile helpers ──────────────────────────────────────────────

function isMajorTile(t: Tile): boolean {
  return isHonour(t) || isTerminal(t);
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
  if (isWind(t) && (t.wind === input.prevailingWind || t.wind === input.seatWind)) return cfg.scoringPair;
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
      lines.push({ label: `${exposure} ${g.kind} of ${tileKey(g.tiles[0]!)}`, points: p });
      base += p;
    }
  }
  const pairPts = pairBasePoints(hand, input, cfg);
  if (pairPts > 0) { lines.push({ label: `scoring pair of ${tileKey(hand.pair[0]!)}`, points: pairPts }); base += pairPts; }

  // ── Going Mah-Jong bonuses (winner) ──
  const noChows  = hand.groups.every(g => g.kind !== 'chow');
  const allChows = hand.groups.every(g => g.kind === 'chow');
  lines.push({ label: 'going Mah-Jong', points: cfg.goingMahjong });
  base += cfg.goingMahjong;
  if (input.winContext.source === 'self-draw-wall') {
    lines.push({ label: 'won from the live wall', points: cfg.winFromLiveWall });
    base += cfg.winFromLiveWall;
  }
  if (input.onlyPossibleTile) {
    lines.push({ label: 'only possible tile', points: cfg.onlyPossibleTile });
    base += cfg.onlyPossibleTile;
  }
  if (noChows) { lines.push({ label: 'no chows', points: cfg.noChows }); base += cfg.noChows; }
  else if (allChows) { lines.push({ label: 'all chows', points: cfg.allChows }); base += cfg.allChows; }

  // ── Doublings ──
  let doublings = 0;
  const addDouble = (label: string, n: number) => { if (n > 0) { doublings += n; doublingLines.push({ label, doublings: n }); } };

  // Major pung/kong, once per qualifying meld (applies to all players).
  const majorMelds = hand.groups.filter(g => g.kind !== 'chow' && isMajorTile(g.tiles[0]!)).length;
  addDouble('pung/kong of a major tile', majorMelds);

  // Complete set of flowers / seasons (doubles twice each).
  if (hasCompleteSet(input.bonusTiles, isFlower)) addDouble('complete set of flowers', 2);
  if (hasCompleteSet(input.bonusTiles, isSeason)) addDouble('complete set of seasons', 2);

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

  // Winds and Dragons only (×3).
  if (!hasSuited && all.every(isHonour)) addDouble('winds and dragons only', 3);

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
 * specific / prestigious hand wins the *label*. The generic All Pungs ranks
 * lowest; bespoke and circumstance hands rank highest. Payout is unaffected.
 */
const PRIORITY = {
  allPungs: 1,
  allKongs: 2,
  buriedTreasure: 3,
  bespokePungHand: 4, // Heads and Tails, All Honours, Three Great Scholars, Four Blessings, Imperial Jade
  bespokeShape: 5,    // seven pairs, snake, wonders, nine gates, windy dragons, dragonfly, knitting
  circumstance: 6,
} as const;

/** Detectors that work from the four-group + pair view (allow declared melds). */
function detectGroupSpecials(hand: FullHand, input: ScoreInput, cfg: ScoringConfig): SpecialHit[] {
  const hits: SpecialHit[] = [];
  const { groups, pair } = hand;
  const noChows = groups.every(g => g.kind !== 'chow');
  const all = allTilesOf(hand);

  if (groups.length === 4 && groups.every(g => g.kind === 'kong')) {
    hits.push({ name: 'All Kongs (Fourfold Plenty)', score: cfg.limit, priority: PRIORITY.allKongs });
  }
  if (noChows) {
    hits.push({ name: 'All Pungs', score: cfg.limit, priority: PRIORITY.allPungs });

    // Three Great Scholars: pung/kong of all three dragons + one more + pair.
    const dragonKinds = new Set(groups.filter(g => isDragon(g.tiles[0]!)).map(g => tileKey(g.tiles[0]!)));
    if (dragonKinds.size === 3) hits.push({ name: 'Three Great Scholars', score: cfg.limit, priority: PRIORITY.bespokePungHand });

    // Four Blessings: pung/kong of each of the four winds + any pair.
    const windKinds = new Set(groups.filter(g => isWind(g.tiles[0]!)).map(g => tileKey(g.tiles[0]!)));
    if (windKinds.size === 4) hits.push({ name: 'Four Blessings Hovering Over the Door', score: cfg.limit, priority: PRIORITY.bespokePungHand });

    // All Honours: every group + pair is honour-or-terminal, with at least one honour.
    if (all.every(isMajorTile) && all.some(isHonour)) {
      hits.push({ name: 'All Honours', score: cfg.limit, priority: PRIORITY.bespokePungHand });
    }
    // Heads and Tails: terminals only (1s and 9s), no honours.
    if (all.every(t => isSuited(t) && isTerminal(t))) {
      hits.push({ name: 'Heads and Tails', score: cfg.limit, priority: PRIORITY.bespokePungHand });
    }
    // Imperial Jade: all tiles green.
    if (all.every(isGreenTile)) hits.push({ name: 'Imperial Jade', score: cfg.limit, priority: PRIORITY.bespokePungHand });

    // Buried Treasure: any fully concealed pung/kong hand (any tile composition).
    const fullyConcealed = groups.every(g => g.concealed);
    if (fullyConcealed) {
      hits.push({ name: 'Buried Treasure', score: cfg.limit, priority: PRIORITY.buriedTreasure });
    }
  }
  void pair;
  return hits;
}

/** Detectors that need the raw 14-tile concealed hand (no declared melds, no kongs). */
function detectConcealedSpecials(tiles: readonly Tile[], input: ScoreInput, cfg: ScoringConfig): SpecialHit[] {
  const hits: SpecialHit[] = [];
  if (tiles.length !== 14) return hits;

  const P = PRIORITY.bespokeShape;

  // Seven-pairs family.
  if (isSevenPairs(tiles)) {
    const allHonour = tiles.every(isHonour);
    const allMajor = tiles.every(isMajorTile);
    const oneSuit = suitedSuits(tiles).size <= 1;
    if (allHonour) hits.push({ name: 'Honour Pairs', score: cfg.limit, priority: P });
    else if (allMajor) hits.push({ name: 'All Pairs Honours', score: cfg.allPairsHonours, priority: P });
    else if (oneSuit && !tiles.some(isHonour)) hits.push({ name: 'Heavenly Twins', score: cfg.limit, priority: P });
    else if (oneSuit) hits.push({ name: 'Clean Pairs', score: cfg.halfLimit, priority: P });
  }

  if (isWrigglingSnake(tiles)) hits.push({ name: 'Wriggling Snake', score: cfg.limit, priority: P });
  if (isThirteenWonders(tiles)) hits.push({ name: '13 Unique Wonders', score: cfg.limit, priority: P });
  if (isWindyDragons(tiles)) hits.push({ name: 'Windy Dragons', score: cfg.limit, priority: P });
  if (isDragonfly(tiles)) hits.push({ name: 'Dragonfly', score: cfg.limit, priority: P });
  if (isNineGates(tiles)) hits.push({ name: 'Gates of Heaven (Nine Chances)', score: cfg.limit, priority: P });
  if (input.gameConfig.knittingEnabled) {
    if (isKnitting(tiles)) hits.push({ name: 'Knitting', score: cfg.limit, priority: P });
    if (isCrocheting(tiles)) hits.push({ name: 'Crocheting (Triple Knitting)', score: cfg.halfLimit, priority: P });
  }
  return hits;
}

/** Detectors driven purely by circumstance (tile composition irrelevant). */
function detectCircumstanceSpecials(input: ScoreInput, cfg: ScoringConfig): SpecialHit[] {
  const hits: SpecialHit[] = [];
  const P = PRIORITY.circumstance;
  if (input.heavenlyHand) hits.push({ name: 'Heavenly Hand', score: cfg.limit, priority: P });
  if (input.earthlyHand) hits.push({ name: 'Earthly Hand', score: cfg.limit, priority: P });
  for (const c of detectCircumstance(input.winningTile, input.winContext)) {
    if (c === 'plum_blossom') hits.push({ name: 'Gathering the Plum Blossom from the Roof', score: cfg.limit, priority: P });
    if (c === 'moon') hits.push({ name: 'Plucking the Moon from the Bottom of the Sea', score: cfg.limit, priority: P });
    if (c === 'twofold_fortune') hits.push({ name: 'Twofold Fortune', score: cfg.limit, priority: P });
  }
  return hits;
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
  const winds = tiles.filter(isWind);
  if (winds.length !== 4 || new Set(winds.map(tileKey)).size !== 4) return false;
  if (tiles.some(isDragon)) return false;
  const suited = tiles.filter(isSuited);
  if (suited.length !== 10 || suitedSuits(tiles).size !== 1) return false;
  const v = emptyVals();
  for (const t of suited) if (isSuited(t)) v[t.value] = (v[t.value] ?? 0) + 1;
  let doubled = 0;
  for (let i = 1; i <= 9; i++) {
    const c = v[i] ?? 0;
    if (c === 0) return false;
    if (c === 2) doubled++;
    else if (c !== 1) return false;
  }
  return doubled === 1;
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

/** Gates of Heaven (Nine Gates): 1112345678999 in one suit + any one extra of that suit. */
function isNineGates(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (!tiles.every(isSuited)) return false;
  if (suitedSuits(tiles).size !== 1) return false;
  const v = emptyVals();
  for (const t of tiles) if (isSuited(t)) v[t.value] = (v[t.value] ?? 0) + 1;
  if ((v[1] ?? 0) < 3 || (v[9] ?? 0) < 3) return false;
  for (let i = 2; i <= 8; i++) if ((v[i] ?? 0) < 1) return false;
  return true; // 3+3+7 = 13 mandatory tiles + exactly one extra (total 14)
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

  // ── Combine: best of normal vs special, capped at the limit ──
  const normalTotal = best ? best.total : 0;
  const specialScore = bestSpecial ? bestSpecial.score : 0;

  if (bestSpecial && specialScore >= normalTotal) {
    return {
      total:         Math.min(cfg.limit, specialScore),
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
