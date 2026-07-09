/**
 * Module 4.6a -- Special-Hand Targeting (easy + medium hands)
 *
 * One pure scan that fingerprints how close a hand is to each special / limit
 * hand. The same scan feeds three consumers -- the AI's own play (commit
 * policy, assessment.ts), the human hint (Module 4.7), and later opponent
 * inference (5.2) -- differing only in the HandView passed in.
 *
 * The `away` metric is a shanten-style count of tile swaps still needed. It is
 * a good upper bound, not a provably minimal figure: good enough for ranking.
 * The one hard guarantee, unit-tested against the Module 1.8 completion
 * detectors as oracles, is that `away === 0` agrees with the matching detector
 * on a complete 14-tile hand.
 *
 * 4.6a covers the easy (fixed-tile-set) and medium (predicate-shape) hands.
 * 4.6b adds the hard structural hands (Mixed Pungs, All Kongs, Three Great
 * Scholars, Windy Dragons, Dragonfly, Run Pung and Pair, Knitting/Crocheting,
 * Buried Treasure), which need the real carving search in shanten.ts rather
 * than a fixed-tile-set comparison.
 *
 * Dependencies: tiles.ts, game-state.ts, scoring-config.ts, hand-evaluator.ts,
 * scoring.ts (raw-multiset predicates, used to verify `away === 0`),
 * ai/shanten.ts. No UI, no side effects.
 */

import {
  Tile, TileKey, Suit, Wind, Dragon,
  isSuited, isWind, isDragon, isHonour, isTerminal,
  tileKey, SUITS, WINDS, DRAGONS,
} from '../tiles.js';
import { DeclaredMeld, GameState, SeatIndex } from '../game-state.js';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from '../scoring-config.js';
import { decomposeStandard } from '../hand-evaluator.js';
import { isDragonfly, isKnitting, isCrocheting } from '../scoring.js';
import { countVector, standardUsable, usableInSuit } from './shanten.js';

// ─── Public types (DESIGN Module 4.6) ────────────────────────────────────────

export interface TargetAssessment {
  /** e.g. "Imperial Jade" -- matches the Module 1.8 detector label. */
  readonly name:    string;
  /** Payoff (from the scoring config). */
  readonly score:   number;
  /** Tile swaps to completion (shanten-like upper bound; 0 = complete). */
  readonly away:    number;
  /** Tiles already contributing to the target. */
  readonly inPlace: number;
  /**
   * Tile kinds to hold on to. A key appears once per copy needed, so a spec
   * needing a pung of Green Dragons lists 'dragon:green' three times.
   */
  readonly keep:    readonly TileKey[];
  /** Tile kinds that would advance the target (deduplicated). */
  readonly seek:    readonly TileKey[];
  /**
   * Impossible: a needed kind has too few copies left in play, or a declared
   * meld is incompatible with the hand (e.g. any meld on a concealed-only
   * target). Blocked targets report away = IMPOSSIBLE.
   */
  readonly blocked: boolean;
}

export interface TargetSpec {
  readonly name:  string;
  readonly group: 'first' | 'second';
  /** Claiming any meld kills it (the first-group wall-draw rule). */
  readonly concealedOnly:           boolean;
  /** Mixed Pungs / Buried Treasure only: the winning tile must be self-drawn. */
  readonly lastTileMustBeSelfDrawn: boolean;
  score(cfg: ScoringConfig): number;
  assess(view: HandView, ctx: ScanContext): TargetAssessment;
}

/**
 * The hand being scanned. For one's own (or the human's) seat this is the real
 * concealed tiles + declared melds. For an opponent (Module 5.2, later) it is
 * exposed melds plus a concealed-tile count only, keeping opponent reasoning
 * on public information.
 */
export interface HandView {
  readonly concealed: readonly Tile[];
  readonly melds:     readonly DeclaredMeld[];
}

/** Table context the scan needs beyond the hand itself. */
export interface ScanContext {
  /**
   * Copies of each kind still obtainable by the scanning seat: 4 minus the
   * copies visible on the table (discards + all exposed melds) minus the
   * copies in the scanner's own hand. Kinds absent from the map are fully
   * obtainable (4 minus own holding).
   */
  readonly copiesLeft: (key: TileKey) => number;
  readonly knittingEnabled: boolean;
  readonly cfg: ScoringConfig;
}

/** `away` value reported by blocked (impossible) targets. */
export const IMPOSSIBLE = 99;

// ─── ScanContext builder ──────────────────────────────────────────────────────

/**
 * Build the ScanContext for a seat from live game state. Counts every tile
 * visible on the table (discard log, communal pool, all exposed melds) plus
 * the seat's own concealed tiles, and reports 4 minus that per kind.
 */
export function buildScanContext(
  state: GameState,
  seat: SeatIndex,
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScanContext {
  const seen = new Set<string>();
  const used = new Map<TileKey, number>();
  const see = (t: Tile) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    used.set(tileKey(t), (used.get(tileKey(t)) ?? 0) + 1);
  };
  for (const e of state.discardLog ?? []) see(e.tile);
  for (const t of state.discardPool) see(t);
  for (const p of state.players) for (const m of p.melds) for (const t of m.tiles) see(t);
  for (const t of state.players[seat]!.concealed) see(t);

  return {
    copiesLeft: (key: TileKey) => Math.max(0, 4 - (used.get(key) ?? 0)),
    knittingEnabled: state.config.knittingEnabled ?? false,
    cfg,
  };
}

// ─── Shared primitives ─────────────────────────────────────────────────────────

function countsByKey(tiles: readonly Tile[]): Map<TileKey, number> {
  const m = new Map<TileKey, number>();
  for (const t of tiles) m.set(tileKey(t), (m.get(tileKey(t)) ?? 0) + 1);
  return m;
}

const sKey = (suit: Suit, value: number): TileKey => `suited:${suit}:${value}` as TileKey;
const wKey = (wind: Wind): TileKey => `wind:${wind}` as TileKey;
const dKey = (dragon: Dragon): TileKey => `dragon:${dragon}` as TileKey;

/** Green tiles for Imperial Jade: bamboo 2,3,4,6,8 and the Green Dragon. */
const GREEN_BAMBOO_VALUES = [2, 3, 4, 6, 8] as const;
function isGreenTile(t: Tile): boolean {
  if (isSuited(t)) return t.suit === 'bamboo' && (GREEN_BAMBOO_VALUES as readonly number[]).includes(t.value);
  return isDragon(t) && t.dragon === 'green';
}

/** A fixed multiset requirement: `need` copies of `key`. */
interface CoverNeed { readonly key: TileKey; readonly need: number }

interface CoverResult {
  readonly inPlace: number;
  readonly away:    number;
  readonly keep:    TileKey[];
  readonly seek:    TileKey[];
  readonly blocked: boolean;
}

/**
 * coverDistance -- the entire metric for the fixed-tile-set hands.
 * `away = 14 - Σ min(have_k, need_k)`, plus an optional wildcard 14th tile: a
 * duplicate of any kind in `dupPool` (defaults to the needs themselves).
 * Blocked when a still-missing kind has no copies left in play.
 */
function coverAssess(
  counts: Map<TileKey, number>,
  needs: readonly CoverNeed[],
  ctx: ScanContext,
  dup: { pool: readonly TileKey[] } | null,
): CoverResult {
  let inPlace = 0;
  const keep: TileKey[] = [];
  const seek: TileKey[] = [];
  let blocked = false;

  const needOf = new Map<TileKey, number>();
  for (const n of needs) needOf.set(n.key, (needOf.get(n.key) ?? 0) + n.need);

  for (const [key, need] of needOf) {
    const have = counts.get(key) ?? 0;
    const used = Math.min(have, need);
    inPlace += used;
    for (let i = 0; i < used; i++) keep.push(key);
    if (have < need) {
      seek.push(key);
      if (ctx.copiesLeft(key) < need - have) blocked = true;
    }
  }

  if (dup) {
    // The 14th tile duplicates any kind in the pool: satisfied by a spare copy.
    let dupDone = false;
    for (const key of dup.pool) {
      const have = counts.get(key) ?? 0;
      const need = needOf.get(key) ?? 0;
      if (have > need) { dupDone = true; keep.push(key); break; }
    }
    if (dupDone) inPlace += 1;
    else {
      // Any pool kind with a copy left advances it; blocked only if none do.
      const dupObtainable = dup.pool.some(k => ctx.copiesLeft(k) > 0);
      if (!dupObtainable) blocked = true;
      for (const k of dup.pool) if (!seek.includes(k)) seek.push(k);
    }
  }

  return { inPlace, away: 14 - inPlace, keep, seek, blocked };
}

/**
 * predicateDistance for pungs-and-pair shapes: the hand must become
 * `setKinds` pungs/kongs + one pair, with every set tile satisfying `pred`.
 *
 * Declared melds must all be pungs/kongs of conforming kinds (a chow, or an
 * off-predicate meld, makes the target impossible). Set kinds are chosen
 * greedily by held copies; the pair from `pairPred` kinds (defaults to pred).
 */
interface ShapeOptions {
  /** Predicate a set (pung/kong) tile must satisfy. */
  readonly pred: (t: Tile) => boolean;
  /** Predicate the pair must satisfy; defaults to `pred`. */
  readonly pairPred?: (t: Tile) => boolean;
  /** The sets must be exactly these kinds (e.g. the four winds). */
  readonly requiredSetKinds?: readonly TileKey[];
}

function shapeAssess(view: HandView, ctx: ScanContext, opts: ShapeOptions): CoverResult {
  const pred = opts.pred;
  const pairPred = opts.pairPred ?? pred;

  // Declared melds: every one must be a conforming pung/kong.
  let meldSets = 0;
  const meldKinds: TileKey[] = [];
  for (const m of view.melds) {
    const first = m.tiles[0];
    const isSet = m.type === 'pung' || m.type === 'open_kong' || m.type === 'concealed_kong';
    if (!first || !isSet || !pred(first) ||
        (opts.requiredSetKinds && !opts.requiredSetKinds.includes(tileKey(first)))) {
      return { inPlace: 0, away: IMPOSSIBLE, keep: [], seek: [], blocked: true };
    }
    meldSets += 1;
    meldKinds.push(tileKey(first));
  }
  if (meldSets > 4) return { inPlace: 0, away: IMPOSSIBLE, keep: [], seek: [], blocked: true };

  const counts = countsByKey(view.concealed);
  const keep: TileKey[] = [];
  const seek: TileKey[] = [];
  let blocked = false;
  let inPlace = meldSets * 3; // declared sets count 3 each toward the 14

  // Candidate set kinds from the concealed hand.
  const setsNeeded = 4 - meldSets;
  const sample = new Map<TileKey, Tile>();
  for (const t of view.concealed) if (!sample.has(tileKey(t))) sample.set(tileKey(t), t);

  let setKindsChosen: TileKey[];
  if (opts.requiredSetKinds) {
    setKindsChosen = opts.requiredSetKinds.filter(k => !meldKinds.includes(k));
    if (setKindsChosen.length !== setsNeeded) {
      // A required kind melded twice, or counts off -- treat as impossible.
      return { inPlace: 0, away: IMPOSSIBLE, keep: [], seek: [], blocked: true };
    }
  } else {
    const candidates = [...counts.entries()]
      .filter(([k]) => { const t = sample.get(k); return t !== undefined && pred(t); })
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    setKindsChosen = candidates.slice(0, setsNeeded);
  }

  // Score the chosen set kinds.
  const usedForSets = new Map<TileKey, number>();
  for (const k of setKindsChosen) {
    const have = Math.min(counts.get(k) ?? 0, 3);
    usedForSets.set(k, have);
    inPlace += have;
    for (let i = 0; i < have; i++) keep.push(k);
    if (have < 3) {
      seek.push(k);
      if (ctx.copiesLeft(k) < 3 - have) blocked = true;
    }
  }
  // Fewer conforming kinds held than sets needed: the missing sets must come
  // entirely from unseen kinds -- reflected already (inPlace gains nothing).

  // The pair: best conforming kind not consumed by a set.
  let pairBest = 0;
  let pairKind: TileKey | null = null;
  for (const [k, c] of counts) {
    const t = sample.get(k)!;
    if (!pairPred(t)) continue;
    const spare = c - (usedForSets.get(k) ?? 0);
    const contrib = Math.min(spare, 2);
    if (contrib > pairBest) { pairBest = contrib; pairKind = k; }
  }
  inPlace += pairBest;
  if (pairKind) for (let i = 0; i < pairBest; i++) keep.push(pairKind);

  return { inPlace, away: 14 - inPlace, keep, seek, blocked };
}

/**
 * Seven-pairs distance over the kinds that satisfy `pred`. A kind held 4×
 * counts as two pairs (isSevenPairs allows it). Concealed-only by nature:
 * callers gate on empty melds before using this.
 */
function sevenPairsAssess(view: HandView, ctx: ScanContext, pred: (t: Tile) => boolean): CoverResult {
  const counts = countsByKey(view.concealed);
  const sample = new Map<TileKey, Tile>();
  for (const t of view.concealed) if (!sample.has(tileKey(t))) sample.set(tileKey(t), t);

  let pairs = 0;
  const singles: TileKey[] = [];
  const keep: TileKey[] = [];
  for (const [k, c] of counts) {
    const t = sample.get(k)!;
    if (!pred(t)) continue;
    const p = Math.floor(c / 2);
    pairs += p;
    for (let i = 0; i < p * 2; i++) keep.push(k);
    if (c % 2 === 1) singles.push(k);
  }
  pairs = Math.min(pairs, 7);
  // Each single counts as half a pair; a single with no copies left cannot pair.
  const seek: TileKey[] = [];
  let usableSingles = 0;
  for (const k of singles) {
    if (usableSingles >= 7 - pairs) break;
    if (ctx.copiesLeft(k) > 0) { usableSingles += 1; keep.push(k); seek.push(k); }
  }
  const inPlace = pairs * 2 + usableSingles;
  return { inPlace, away: 14 - inPlace, keep, seek, blocked: false };
}

// ─── Assessment assembly helper ────────────────────────────────────────────────

function blockedResult(): CoverResult {
  return { inPlace: 0, away: IMPOSSIBLE, keep: [], seek: [], blocked: true };
}

/** First-group (concealed-only) gate: any declared meld kills the target. */
function gateConcealed(view: HandView, inner: () => CoverResult): CoverResult {
  return view.melds.length > 0 ? blockedResult() : inner();
}

function finish(spec: { name: string; score(cfg: ScoringConfig): number }, cfg: ScoringConfig, r: CoverResult): TargetAssessment {
  return {
    name: spec.name,
    score: spec.score(cfg),
    away: r.blocked ? IMPOSSIBLE : r.away,
    inPlace: r.inPlace,
    keep: r.keep,
    seek: r.seek,
    blocked: r.blocked,
  };
}

/** Best result across per-suit evaluations. */
function bestOverSuits(evalSuit: (s: Suit) => CoverResult): CoverResult {
  let best: CoverResult | null = null;
  for (const s of SUITS) {
    const r = evalSuit(s);
    if (!best || (r.blocked ? IMPOSSIBLE : r.away) < (best.blocked ? IMPOSSIBLE : best.away)) best = r;
  }
  return best!;
}

// ─── The specs: easy (fixed tile sets) ────────────────────────────────────────

const uniqueWonder: TargetSpec = {
  name: 'Unique Wonder',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.doubleLimit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const thirteen: TileKey[] = [
        ...SUITS.flatMap(s => [sKey(s, 1), sKey(s, 9)]),
        ...WINDS.map(wKey),
        ...DRAGONS.map(dKey),
      ];
      const needs = thirteen.map(key => ({ key, need: 1 }));
      return coverAssess(countsByKey(view.concealed), needs, ctx, { pool: thirteen });
    }));
  },
};

const sparrowsSanctuary: TargetSpec = {
  name: "Sparrow's Sanctuary",
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const needs: CoverNeed[] = [
        { key: sKey('bamboo', 1), need: 4 },
        ...GREEN_BAMBOO_VALUES.map(v => ({ key: sKey('bamboo', v), need: 2 })),
      ];
      return coverAssess(countsByKey(view.concealed), needs, ctx, null);
    }));
  },
};

const wrigglySnake: TargetSpec = {
  name: 'Wriggly Snake',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const counts = countsByKey(view.concealed);
      return bestOverSuits(suit => {
        const thirteen: TileKey[] = [
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => sKey(suit, v)),
          ...WINDS.map(wKey),
        ];
        const needs = thirteen.map(key => ({ key, need: 1 }));
        return coverAssess(counts, needs, ctx, { pool: thirteen });
      });
    }));
  },
};

const gatesOfHeaven: TargetSpec = {
  name: 'Gates of Heaven (Nine Chances)',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const counts = countsByKey(view.concealed);
      return bestOverSuits(suit => {
        const needs: CoverNeed[] = [
          { key: sKey(suit, 1), need: 3 },
          { key: sKey(suit, 9), need: 3 },
          ...[2, 3, 4, 5, 6, 7, 8].map(v => ({ key: sKey(suit, v), need: 1 })),
        ];
        // The completing 14th tile must be a 2-8 of the suit (a 1 or 9 would
        // instead form a kong), so the dup pool is 2-8 only.
        const dupPool = [2, 3, 4, 5, 6, 7, 8].map(v => sKey(suit, v));
        return coverAssess(counts, needs, ctx, { pool: dupPool });
      });
    }));
  },
};

// ─── The specs: medium (predicate shapes) ─────────────────────────────────────

const headsAndTails: TargetSpec = {
  name: 'Heads and Tails',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, shapeAssess(view, ctx, { pred: isTerminal }));
  },
};

const allWindsAndDragons: TargetSpec = {
  name: 'All Winds and Dragons',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, shapeAssess(view, ctx, { pred: isHonour }));
  },
};

/**
 * All Honours is a ×3 doubling rather than a fixed payout, so its `score` is
 * an estimate computed from the config: four exposed major pungs + the
 * going-Mah-Jong and no-chows bonuses, doubled three times.
 */
const allHonours: TargetSpec = {
  name: 'All Honours',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => Math.min(cfg.limit, (4 * cfg.exposedPung.major + cfg.goingMahjong + cfg.noChows) * 8),
  assess(view, ctx) {
    const isMajor = (t: Tile) => isHonour(t) || isTerminal(t);
    const r = shapeAssess(view, ctx, { pred: isMajor });
    // Needs at least one honour among the majors, or it is Heads and Tails.
    const hasHonour =
      view.concealed.some(isHonour) ||
      view.melds.some(m => { const f = m.tiles[0]; return f !== undefined && isHonour(f); });
    const adjusted = !r.blocked && !hasHonour
      ? { ...r, away: Math.max(r.away, 1), seek: [...new Set([...r.seek, ...WINDS.map(wKey), ...DRAGONS.map(dKey)])] }
      : r;
    return finish(this, ctx.cfg, adjusted);
  },
};

const chineseOdds: TargetSpec = {
  name: 'Chinese Odds',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    const r = bestOverSuits(suit =>
      shapeAssess(view, ctx, {
        pred: t => isSuited(t) && t.suit === suit && t.value % 2 === 1,
      }));
    return finish(this, ctx.cfg, r);
  },
};

const imperialJade: TargetSpec = {
  name: 'Imperial Jade',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    // Chows of green bamboos are allowed, so the pungs-and-pair machinery does
    // not fit. Fingerprint: offending = non-green tiles; plus the shortfall of
    // the Green Dragon pung and of a green-bamboo pair.
    for (const m of view.melds) {
      if (!m.tiles.every(isGreenTile)) return finish(this, ctx.cfg, blockedResult());
    }
    const counts = countsByKey(view.concealed);
    const meldTiles = view.melds.reduce((n, m) => n + Math.min(m.tiles.length, 3), 0);
    const greensConcealed = view.concealed.filter(isGreenTile).length;
    const green = Math.min(14, meldTiles + greensConcealed);

    const gdDeclared = view.melds.some(m => {
      const f = m.tiles[0];
      return f !== undefined && isDragon(f) && f.dragon === 'green' && m.type !== 'chow';
    });
    const gdHave = gdDeclared ? 3 : Math.min(counts.get(dKey('green')) ?? 0, 3);
    const gdShort = Math.max(0, 3 - gdHave);

    const hasGreenPair = GREEN_BAMBOO_VALUES.some(v => (counts.get(sKey('bamboo', v)) ?? 0) >= 2);
    const pairShort = hasGreenPair ? 0 : 1;

    let away = (14 - green) + gdShort + pairShort;
    let blocked = false;
    if (gdShort > 0 && ctx.copiesLeft(dKey('green')) < gdShort) blocked = true;

    // The estimate can hit 0 while the greens do not actually decompose into
    // melds; verify structurally at zero so away===0 agrees with the detector.
    if (away === 0 && !blocked && view.concealed.length + meldTiles >= 14) {
      const meldsNeeded = 4 - view.melds.length;
      const ok = meldsNeeded >= 0 && decomposeStandard(view.concealed, meldsNeeded).some(d => {
        const pairTile = d.pair[0];
        const gdPung = gdDeclared || d.melds.some(m => {
          const f = m.tiles[0];
          return m.kind !== 'chow' && f !== undefined && isDragon(f) && f.dragon === 'green';
        });
        return gdPung && pairTile !== undefined && isSuited(pairTile) && pairTile.suit === 'bamboo';
      });
      if (!ok) away = 1;
    }

    const keep: TileKey[] = [];
    for (const t of view.concealed) if (isGreenTile(t)) keep.push(tileKey(t));
    const seek: TileKey[] = [];
    if (gdShort > 0) seek.push(dKey('green'));
    for (const v of GREEN_BAMBOO_VALUES) if (ctx.copiesLeft(sKey('bamboo', v)) > 0) seek.push(sKey('bamboo', v));

    return {
      name: this.name, score: this.score(ctx.cfg),
      away: blocked ? IMPOSSIBLE : away,
      inPlace: green,
      keep, seek, blocked,
    };
  },
};

const heavenlyTwins: TargetSpec = {
  name: 'Heavenly Twins',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () =>
      bestOverSuits(suit =>
        sevenPairsAssess(view, ctx, t => isSuited(t) && t.suit === suit))));
  },
};

const cleanPairs: TargetSpec = {
  name: 'Clean Pairs',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.halfLimit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () =>
      bestOverSuits(suit =>
        sevenPairsAssess(view, ctx, t => isHonour(t) || (isSuited(t) && t.suit === suit)))));
  },
};

const allPairsHonours: TargetSpec = {
  name: 'All Pairs Honours',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.allPairsHonours,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () =>
      sevenPairsAssess(view, ctx, t => isHonour(t) || isTerminal(t))));
  },
};

const fourBlessings: TargetSpec = {
  name: 'Four Blessings Hovering Over the Door',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, shapeAssess(view, ctx, {
      pred: isWind,
      pairPred: () => true, // any pair
      requiredSetKinds: WINDS.map(wKey),
    }));
  },
};

// ═══ Module 4.6b — the hard structural hands ═════════════════════════════════
//
// These are not fixed-tile-set hands, so `coverAssess` alone cannot measure
// them. `standardUsable` (shanten.ts) does the real carving; `blockProgress`
// summarises same-kind blocks for the pungs-and-kongs hands. Every spec below
// verifies structurally when its estimate reaches 0, so the module's one hard
// guarantee -- `away === 0` agrees with the Module 1.8 completion detector --
// holds even where the estimate itself is a heuristic.

/** Meld types that are a set of identical tiles (not a chow). */
function isSetMeld(m: DeclaredMeld): boolean {
  return m.type === 'pung' || m.type === 'open_kong' || m.type === 'concealed_kong';
}

/** Concealed tiles plus declared meld tiles, kongs truncated to three. */
function allTilesCapped(view: HandView): Tile[] {
  return [...view.concealed, ...view.melds.flatMap(m => m.tiles.slice(0, 3))];
}

/** Build a TargetAssessment directly (for specs that compute `away` themselves). */
function assessment(
  spec: { name: string; score(cfg: ScoringConfig): number },
  ctx: ScanContext,
  r: { inPlace: number; away: number; keep: TileKey[]; seek: TileKey[]; blocked: boolean },
): TargetAssessment {
  return {
    name: spec.name,
    score: spec.score(ctx.cfg),
    away: r.blocked ? IMPOSSIBLE : Math.max(0, r.away),
    inPlace: r.inPlace,
    keep: r.keep,
    seek: r.seek,
    blocked: r.blocked,
  };
}

/** Every kind held two or more times, once per copy: the natural `keep` set. */
function keepBlocks(tiles: readonly Tile[]): TileKey[] {
  const keep: TileKey[] = [];
  for (const [k, c] of countsByKey(tiles)) if (c >= 2) for (let i = 0; i < c; i++) keep.push(k);
  return keep;
}

/** Kinds held once or twice with copies left: the tiles that would advance a pung hand. */
function seekBlocks(tiles: readonly Tile[], ctx: ScanContext): TileKey[] {
  const seek: TileKey[] = [];
  for (const [k, c] of countsByKey(tiles)) if (c >= 1 && c < 3 && ctx.copiesLeft(k) > 0) seek.push(k);
  return seek;
}

// ── Mixed Pungs ───────────────────────────────────────────────────────────────
// Four pungs (or kongs) + a pair, any tiles, fully self-drawn including the
// winning tile. The only meld a Mixed Pungs hand may show is a concealed kong:
// anything claimed from a discard kills it.

const mixedPungs: TargetSpec = {
  name: 'Mixed Pungs',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: true,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    if (!view.melds.every(m => m.type === 'concealed_kong')) {
      return finish(this, ctx.cfg, blockedResult());
    }
    const setsFromMelds = view.melds.length;
    if (setsFromMelds > 4) return finish(this, ctx.cfg, blockedResult());

    const usable = standardUsable(countVector(view.concealed), {
      setsNeeded: 4 - setsFromMelds, allowChow: false, needPair: true,
    });
    const inPlace = setsFromMelds * 3 + usable;
    return assessment(this, ctx, {
      inPlace,
      away: 14 - inPlace,
      keep: [...view.melds.flatMap(m => m.tiles.slice(0, 3).map(tileKey)), ...keepBlocks(view.concealed)],
      seek: seekBlocks(view.concealed, ctx),
      blocked: false,
    });
  },
};

// ── All Kongs (Fourfold Plenty) ───────────────────────────────────────────────
// Four kongs + a pair, at most one suit present (honour kongs may sit alongside).
// Eighteen tiles, not fourteen: `away` is measured against that larger target,
// which is exactly why the commit policy will (correctly) almost never chase it.

const ALL_KONGS_SIZE = 18;

const allKongs: TargetSpec = {
  name: 'All Kongs (Fourfold Plenty)',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    // Every declared meld must be a kong, or a pung awaiting its added kong.
    if (!view.melds.every(isSetMeld) || view.melds.length > 4) {
      return finish(this, ctx.cfg, blockedResult());
    }

    const counts = countsByKey(view.concealed);
    const sample = new Map<TileKey, Tile>();
    for (const t of view.concealed) if (!sample.has(tileKey(t))) sample.set(tileKey(t), t);

    // The suited tiles must all be one suit; try each suit, and the all-honours case.
    const options: (Suit | null)[] = [...SUITS, null];
    let best: { inPlace: number; keep: TileKey[]; seek: TileKey[]; blocked: boolean } | null = null;

    for (const suit of options) {
      const inPool = (t: Tile) => isHonour(t) || (suit !== null && isSuited(t) && t.suit === suit);
      if (!view.melds.every(m => { const f = m.tiles[0]; return f !== undefined && inPool(f); })) continue;

      let inPlace = 0;
      const keep: TileKey[] = [];
      const seek: TileKey[] = [];
      let blocked = false;

      // Declared melds: a kong is already 4 tiles in place; a pung needs one more.
      for (const m of view.melds) {
        const k = tileKey(m.tiles[0]!);
        const held = m.type === 'pung' ? 3 : 4;
        inPlace += held;
        for (let i = 0; i < held; i++) keep.push(k);
        if (held < 4) {
          seek.push(k);
          if (ctx.copiesLeft(k) < 1) blocked = true;
        }
      }

      // Remaining kongs: the best-held pool kinds in the concealed hand.
      const kongsNeeded = 4 - view.melds.length;
      const candidates = [...counts.entries()]
        .filter(([k]) => { const t = sample.get(k); return t !== undefined && inPool(t); })
        .sort((a, b) => b[1] - a[1]);
      const chosen = candidates.slice(0, kongsNeeded);
      const usedForKongs = new Map<TileKey, number>();
      for (const [k, c] of chosen) {
        const held = Math.min(c, 4);
        usedForKongs.set(k, held);
        inPlace += held;
        for (let i = 0; i < held; i++) keep.push(k);
        if (held < 4) {
          seek.push(k);
          if (ctx.copiesLeft(k) < 4 - held) blocked = true;
        }
      }
      // Kongs with no candidate kind at all must come entirely from unseen tiles:
      // nothing in place for them, and not blocked (a fresh kind could arrive).

      // The pair: the best pool kind not consumed by a kong.
      let pairBest = 0;
      let pairKind: TileKey | null = null;
      for (const [k, c] of counts) {
        const t = sample.get(k);
        if (!t || !inPool(t)) continue;
        const spare = c - (usedForKongs.get(k) ?? 0);
        const contrib = Math.min(spare, 2);
        if (contrib > pairBest) { pairBest = contrib; pairKind = k; }
      }
      inPlace += pairBest;
      if (pairKind) for (let i = 0; i < pairBest; i++) keep.push(pairKind);

      if (!best || (!blocked && best.blocked) || (blocked === best.blocked && inPlace > best.inPlace)) {
        best = { inPlace, keep, seek, blocked };
      }
    }

    if (!best) return finish(this, ctx.cfg, blockedResult());
    return assessment(this, ctx, {
      inPlace: best.inPlace,
      away: ALL_KONGS_SIZE - best.inPlace,
      keep: best.keep,
      seek: best.seek,
      blocked: best.blocked,
    });
  },
};

// ── Three Great Scholars ──────────────────────────────────────────────────────
// Pungs/kongs of all three dragons + one further meld (pung, kong or chow) +
// a pair, the further meld and the pair both of the same suit.

const threeGreatScholars: TargetSpec = {
  name: 'Three Great Scholars',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    const dragonMelds: DeclaredMeld[] = [];
    const suitedMelds: DeclaredMeld[] = [];
    for (const m of view.melds) {
      const f = m.tiles[0];
      if (!f) return finish(this, ctx.cfg, blockedResult());
      if (isDragon(f) && isSetMeld(m)) dragonMelds.push(m);
      else if (isSuited(f)) suitedMelds.push(m);
      else return finish(this, ctx.cfg, blockedResult()); // a wind meld cannot appear
    }
    if (suitedMelds.length > 1 || dragonMelds.length > 3) return finish(this, ctx.cfg, blockedResult());

    const meldedDragons = new Set(dragonMelds.map(m => tileKey(m.tiles[0]!)));
    if (meldedDragons.size !== dragonMelds.length) return finish(this, ctx.cfg, blockedResult());

    const counts = countsByKey(view.concealed);
    const vec = countVector(view.concealed);

    let dragonInPlace = 0;
    const keep: TileKey[] = [];
    const seek: TileKey[] = [];
    let blocked = false;
    for (const d of DRAGONS) {
      const k = dKey(d);
      if (meldedDragons.has(k)) { dragonInPlace += 3; for (let i = 0; i < 3; i++) keep.push(k); continue; }
      const held = Math.min(counts.get(k) ?? 0, 3);
      dragonInPlace += held;
      for (let i = 0; i < held; i++) keep.push(k);
      if (held < 3) {
        seek.push(k);
        if (ctx.copiesLeft(k) < 3 - held) blocked = true;
      }
    }

    // The fourth meld and the pair share a suit. A declared suited meld fixes it.
    const suitedMeld = suitedMelds[0];
    const suitOptions: Suit[] = suitedMeld
      ? [(suitedMeld.tiles[0] as { suit: Suit }).suit]
      : [...SUITS];

    let bestSuited = -1;
    let bestSuit: Suit | null = null;
    for (const suit of suitOptions) {
      const usable = usableInSuit(vec, suit, {
        setsNeeded: suitedMeld ? 0 : 1, allowChow: true, needPair: true,
      });
      const total = (suitedMeld ? 3 : 0) + usable;
      if (total > bestSuited) { bestSuited = total; bestSuit = suit; }
    }

    if (bestSuit) {
      for (const t of view.concealed) if (isSuited(t) && t.suit === bestSuit) keep.push(tileKey(t));
      if (suitedMeld) for (const t of suitedMeld.tiles.slice(0, 3)) keep.push(tileKey(t));
    }

    const inPlace = dragonInPlace + Math.max(0, bestSuited);
    return assessment(this, ctx, { inPlace, away: 14 - inPlace, keep, seek, blocked });
  },
};

// ── Windy Dragons ─────────────────────────────────────────────────────────────
// Pungs of any two dragons (kongs not permitted) + a pair of each of the four
// winds. Second group per MJrules.md: the dragon pungs may be claimed.

const windyDragons: TargetSpec = {
  name: 'Windy Dragons',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    // Only dragon pungs may be declared: a kong breaks the fingerprint, and the
    // four wind pairs can never be melded.
    if (!view.melds.every(m => { const f = m.tiles[0]; return f !== undefined && m.type === 'pung' && isDragon(f); })
        || view.melds.length > 2) {
      return finish(this, ctx.cfg, blockedResult());
    }
    const counts = countsByKey(allTilesCapped(view));
    const pairsOfDragons: [Dragon, Dragon][] = [['red', 'green'], ['red', 'white'], ['green', 'white']];

    let best: CoverResult | null = null;
    for (const [d1, d2] of pairsOfDragons) {
      // A declared dragon pung must be one of the two chosen dragons.
      const melded = view.melds.map(m => (m.tiles[0] as { dragon: Dragon }).dragon);
      if (!melded.every(d => d === d1 || d === d2)) continue;
      const needs: CoverNeed[] = [
        { key: dKey(d1), need: 3 }, { key: dKey(d2), need: 3 },
        ...WINDS.map(w => ({ key: wKey(w), need: 2 })),
      ];
      const r = coverAssess(counts, needs, ctx, null);
      if (!best || (r.blocked ? IMPOSSIBLE : r.away) < (best.blocked ? IMPOSSIBLE : best.away)) best = r;
    }
    return finish(this, ctx.cfg, best ?? blockedResult());
  },
};

// ── Dragonfly ─────────────────────────────────────────────────────────────────
// One tile of each dragon (three singletons) + a pung/kong in each of the three
// suits + a suited pair. Second group: the suit pungs may be claimed.

const dragonfly: TargetSpec = {
  name: 'Dragonfly',
  group: 'second',
  concealedOnly: false,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.halfLimit,
  assess(view, ctx) {
    // Only suited pungs/kongs may be declared, at most one per suit.
    const meldSuits: Suit[] = [];
    for (const m of view.melds) {
      const f = m.tiles[0];
      if (!f || !isSetMeld(m) || !isSuited(f)) return finish(this, ctx.cfg, blockedResult());
      if (meldSuits.includes(f.suit)) return finish(this, ctx.cfg, blockedResult());
      meldSuits.push(f.suit);
    }

    const counts = countsByKey(view.concealed);
    const keep: TileKey[] = [];
    const seek: TileKey[] = [];
    let blocked = false;
    let inPlace = 0;

    // Three lone dragons.
    for (const d of DRAGONS) {
      const k = dKey(d);
      const held = Math.min(counts.get(k) ?? 0, 1);
      inPlace += held;
      if (held) keep.push(k);
      else {
        seek.push(k);
        if (ctx.copiesLeft(k) < 1) blocked = true;
      }
    }

    // One pung per suit; the best-held value in each suit that has no declared meld.
    const usedForPungs = new Map<TileKey, number>();
    for (const suit of SUITS) {
      if (meldSuits.includes(suit)) { inPlace += 3; continue; }
      let bestKind: TileKey | null = null;
      let bestHeld = 0;
      for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const k = sKey(suit, v);
        const held = Math.min(counts.get(k) ?? 0, 3);
        if (held > bestHeld) { bestHeld = held; bestKind = k; }
      }
      if (bestKind) {
        usedForPungs.set(bestKind, bestHeld);
        inPlace += bestHeld;
        for (let i = 0; i < bestHeld; i++) keep.push(bestKind);
        if (bestHeld < 3) {
          seek.push(bestKind);
          if (ctx.copiesLeft(bestKind) < 3 - bestHeld) blocked = true;
        }
      }
    }

    // The pair: the best suited kind not consumed by a pung.
    let pairBest = 0;
    let pairKind: TileKey | null = null;
    for (const [k, c] of counts) {
      if (!k.startsWith('suited:')) continue;
      const spare = c - (usedForPungs.get(k) ?? 0);
      const contrib = Math.min(spare, 2);
      if (contrib > pairBest) { pairBest = contrib; pairKind = k; }
    }
    inPlace += pairBest;
    if (pairKind) for (let i = 0; i < pairBest; i++) keep.push(pairKind);

    let away = 14 - inPlace;
    // Verify structurally at zero: the greedy pung/pair split can reach 14 on a
    // hand the detector rejects (e.g. a fourth copy of a pung tile).
    if (away === 0 && !blocked) {
      const tiles = allTilesCapped(view);
      if (tiles.length !== 14 || !isDragonfly(tiles)) away = 1;
    }
    return assessment(this, ctx, { inPlace, away, keep, seek, blocked });
  },
};

// ── Run, Pung and Pair ────────────────────────────────────────────────────────
// A 1-9 run + a pung + a pair, all in a single suit. First group: every tile is
// drawn from the wall, so no meld may be declared, but the winning tile may be
// claimed. The fingerprint is a fixed multiset once the pung and pair values
// are chosen, so `coverAssess` handles it -- 3 x 9 x 8 candidate shapes.

const runPungAndPair: TargetSpec = {
  name: 'Run, Pung and Pair',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.limit,
  assess(view, ctx) {
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const counts = countsByKey(view.concealed);
      let best: CoverResult | null = null;
      for (const suit of SUITS) {
        for (let p = 1; p <= 9; p++) {
          for (let q = 1; q <= 9; q++) {
            if (p === q) continue;
            const needs: CoverNeed[] = [
              ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => ({ key: sKey(suit, v), need: 1 })),
              { key: sKey(suit, p), need: 3 },  // the pung, on top of the run tile
              { key: sKey(suit, q), need: 2 },  // the pair, on top of the run tile
            ];
            const r = coverAssess(counts, needs, ctx, null);
            if (!best || (r.blocked ? IMPOSSIBLE : r.away) < (best.blocked ? IMPOSSIBLE : best.away)) best = r;
          }
        }
      }
      return best ?? blockedResult();
    }));
  },
};

// ── Buried Treasure ───────────────────────────────────────────────────────────
// Fully concealed one-suit hand: four melds + a pair, chows allowed, no kongs,
// every tile self-drawn including the winning tile. This is the hand that needs
// the real carving search -- there is no fixed tile set to compare against.

const buriedTreasure: TargetSpec = {
  name: 'Buried Treasure',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: true,
  score: cfg => cfg.buriedTreasure,
  assess(view, ctx) {
    // No kongs, and nothing claimed: any declared meld at all kills it.
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const vec = countVector(view.concealed);
      let bestUsable = 0;
      let bestSuit: Suit | null = null;
      for (const suit of SUITS) {
        const u = usableInSuit(vec, suit, { setsNeeded: 4, allowChow: true, needPair: true });
        if (u > bestUsable) { bestUsable = u; bestSuit = suit; }
      }
      const keep: TileKey[] = [];
      const seek: TileKey[] = [];
      if (bestSuit) {
        for (const t of view.concealed) if (isSuited(t) && t.suit === bestSuit) keep.push(tileKey(t));
        for (let v = 1; v <= 9; v++) {
          const k = sKey(bestSuit, v);
          if (ctx.copiesLeft(k) > 0) seek.push(k);
        }
      }
      return { inPlace: bestUsable, away: 14 - bestUsable, keep, seek, blocked: false };
    }));
  },
};

// ── Knitting / Crocheting (gated by knittingEnabled) ──────────────────────────

/** Per-suit value counts (index 1..9) from a concealed hand. */
function suitValueCounts(tiles: readonly Tile[]): Record<Suit, number[]> {
  const r: Record<Suit, number[]> = {
    bamboo: new Array<number>(10).fill(0),
    characters: new Array<number>(10).fill(0),
    circles: new Array<number>(10).fill(0),
  };
  for (const t of tiles) if (isSuited(t)) r[t.suit][t.value] = (r[t.suit][t.value] ?? 0) + 1;
  return r;
}

const knitting: TargetSpec = {
  name: 'Knitting',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.halfLimit,
  assess(view, ctx) {
    if (!ctx.knittingEnabled) return finish(this, ctx.cfg, blockedResult());
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const c = suitValueCounts(view.concealed);
      const suitPairs: [Suit, Suit][] = [
        ['bamboo', 'characters'], ['bamboo', 'circles'], ['characters', 'circles'],
      ];
      let best: CoverResult | null = null;

      for (const [a, b] of suitPairs) {
        let matched = 0;
        const keep: TileKey[] = [];
        for (let v = 1; v <= 9; v++) {
          const m = Math.min(c[a][v] ?? 0, c[b][v] ?? 0);
          matched += m;
          for (let i = 0; i < m; i++) { keep.push(sKey(a, v)); keep.push(sKey(b, v)); }
        }
        const pairs = Math.min(matched, 7);
        let inPlace = pairs * 2;

        // Unmatched tiles in either suit are each half a pair, if the partner
        // kind still has a copy left to claim or draw.
        const seek: TileKey[] = [];
        let halves = 0;
        for (let v = 1; v <= 9 && halves < 7 - pairs; v++) {
          const extraA = (c[a][v] ?? 0) - Math.min(c[a][v] ?? 0, c[b][v] ?? 0);
          const extraB = (c[b][v] ?? 0) - Math.min(c[a][v] ?? 0, c[b][v] ?? 0);
          for (let i = 0; i < extraA && halves < 7 - pairs; i++) {
            if (ctx.copiesLeft(sKey(b, v)) > 0) { halves++; keep.push(sKey(a, v)); seek.push(sKey(b, v)); }
          }
          for (let i = 0; i < extraB && halves < 7 - pairs; i++) {
            if (ctx.copiesLeft(sKey(a, v)) > 0) { halves++; keep.push(sKey(b, v)); seek.push(sKey(a, v)); }
          }
        }
        inPlace += halves;
        const r: CoverResult = { inPlace, away: 14 - inPlace, keep, seek, blocked: false };
        if (!best || r.away < best.away) best = r;
      }

      const r = best ?? blockedResult();
      if (r.away === 0 && !isKnitting(view.concealed)) return { ...r, away: 1 };
      return r;
    }));
  },
};

const crocheting: TargetSpec = {
  name: 'Crocheting (Triple Knitting)',
  group: 'first',
  concealedOnly: true,
  lastTileMustBeSelfDrawn: false,
  score: cfg => cfg.halfLimit,
  assess(view, ctx) {
    if (!ctx.knittingEnabled) return finish(this, ctx.cfg, blockedResult());
    return finish(this, ctx.cfg, gateConcealed(view, () => {
      const c = suitValueCounts(view.concealed);
      const keep: TileKey[] = [];
      const seek: TileKey[] = [];

      // Per number, how many suits contribute at least one tile (a triple wants 3).
      const width: number[] = new Array<number>(10).fill(0);
      for (let v = 1; v <= 9; v++) {
        width[v] = SUITS.reduce((n, s) => n + Math.min(c[s][v] ?? 0, 1), 0);
      }
      // Take the widest numbers first: full triples, then partials.
      const order = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort((x, y) => (width[y] ?? 0) - (width[x] ?? 0));
      let slots = 4;
      let inPlace = 0;
      const usedValue = new Set<number>();
      for (const v of order) {
        if (slots === 0) break;
        const w = width[v] ?? 0;
        if (w === 0) continue;
        inPlace += w;                 // 3 = complete triple, 1-2 = partial
        slots -= 1;
        usedValue.add(v);
        for (const s of SUITS) {
          if ((c[s][v] ?? 0) > 0) keep.push(sKey(s, v));
          else if (ctx.copiesLeft(sKey(s, v)) > 0) seek.push(sKey(s, v));
        }
      }

      // The pair: two tiles sharing a number, from tiles not used by a triple.
      let pairBest = 0;
      for (let v = 1; v <= 9; v++) {
        const spare = SUITS.reduce((n, s) => n + (c[s][v] ?? 0), 0) - (usedValue.has(v) ? (width[v] ?? 0) : 0);
        pairBest = Math.max(pairBest, Math.min(spare, 2));
      }
      inPlace += pairBest;

      const r: CoverResult = { inPlace, away: 14 - inPlace, keep, seek, blocked: false };
      if (r.away === 0 && !isCrocheting(view.concealed)) return { ...r, away: 1 };
      return r;
    }));
  },
};

// ─── The scan ─────────────────────────────────────────────────────────────────

/** Every special-hand spec: the 4.6a easy/medium hands, then the 4.6b hard ones. */
export const TARGET_SPECS: readonly TargetSpec[] = [
  // 4.6a — easy (fixed tile sets)
  uniqueWonder, sparrowsSanctuary, wrigglySnake, gatesOfHeaven,
  // 4.6a — medium (predicate shapes)
  headsAndTails, allWindsAndDragons, allHonours, chineseOdds, imperialJade,
  heavenlyTwins, cleanPairs, allPairsHonours, fourBlessings,
  // 4.6b — hard (structural)
  mixedPungs, allKongs, threeGreatScholars, windyDragons, dragonfly,
  runPungAndPair, buriedTreasure, knitting, crocheting,
];

/**
 * Run every TargetSpec against the hand and return the assessments ranked
 * best-first: unblocked before blocked, then smallest `away`, then highest
 * payoff. Blocked targets are included (callers may want to show them) but
 * always rank last.
 */
export function scanTargets(view: HandView, ctx: ScanContext): TargetAssessment[] {
  const results = TARGET_SPECS.map(spec => spec.assess(view, ctx));
  return results.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    if (a.away !== b.away) return a.away - b.away;
    return b.score - a.score;
  });
}

/** Look up a spec by its (detector-matching) name. */
export function targetSpecByName(name: string): TargetSpec | undefined {
  return TARGET_SPECS.find(s => s.name === name);
}
