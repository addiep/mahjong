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
 * The hard structural hands (Mixed Pungs, All Kongs, Three Great Scholars,
 * Windy Dragons, Dragonfly, Run Pung and Pair, Knitting/Crocheting, Buried
 * Treasure) are Module 4.6b.
 *
 * Dependencies: tiles.ts, game-state.ts, scoring-config.ts, hand-evaluator.ts.
 * No UI, no side effects.
 */

import {
  Tile, TileKey, Suit, Wind, Dragon,
  isSuited, isWind, isDragon, isHonour, isTerminal,
  tileKey, SUITS, WINDS, DRAGONS,
} from '../tiles.js';
import { DeclaredMeld, GameState, SeatIndex } from '../game-state.js';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from '../scoring-config.js';
import { decomposeStandard } from '../hand-evaluator.js';

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
  /** Mixed Pungs / Buried Treasure only (both 4.6b). */
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

// ─── The scan ─────────────────────────────────────────────────────────────────

/** All Module 4.6a specs. 4.6b will extend this list with the hard hands. */
export const TARGET_SPECS: readonly TargetSpec[] = [
  uniqueWonder, sparrowsSanctuary, wrigglySnake, gatesOfHeaven,
  headsAndTails, allWindsAndDragons, allHonours, chineseOdds, imperialJade,
  heavenlyTwins, cleanPairs, allPairsHonours, fourBlessings,
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
