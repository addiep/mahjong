/**
 * Module 5.2 -- Inference Engine (opponent modelling)
 *
 * Reads only the information a human at the table could observe and remember:
 *   - each player's exposed melds (suit / honour signals),
 *   - the private `discardLog` (who discarded what, in what order, who claimed it),
 *   - the communal discard pool (tile counts, for safe-tile reasoning),
 *   - the game config (whether knitting / crochet hands are legal).
 *
 * It NEVER reads any player's concealed hand. The engine retains the discard
 * provenance perfectly; a human approximates the same from fallible memory.
 *
 * The caller re-runs `inferTable(state)` after every discard to refresh the
 * machine's per-player hypothesis about each opponent's target hand.
 *
 * Dependencies: tiles.ts, game-state.ts. No UI dependencies. No side effects.
 */

import {
  Tile, TileKey, Suit,
  tileKey, isSuited, isHonour, isDragon, SUITS,
} from './tiles.js';
import {
  GameState, PlayerState, SeatIndex, DiscardLogEntry,
} from './game-state.js';

// --- Output types -----

/** The candidate targets the engine reasons about for each player. */
export type TargetKind =
  | 'bamboo' | 'characters' | 'circles'   // a clean suited hand
  | 'honours'                             // winds & dragons (an all-honours hand)
  | 'knitting' | 'crochet'                // cross-suit special hands
  | 'mixed';                              // a deliberately dirty (multi-suit) hand

/** How sure the engine is about a guess, derived from the tally magnitude. */
export type Confidence = 'low' | 'medium' | 'high';

/** A single hypothesis about what a player is collecting. */
export interface TargetGuess {
  readonly kind:       TargetKind;
  /** Natural-language target, e.g. "collecting bamboo". */
  readonly label:      string;
  /** The raw tally score behind this guess (higher = stronger). */
  readonly score:      number;
  readonly confidence: Confidence;
}

/** How close a player looks to a win, from public signals only. */
export interface Closeness {
  readonly meldCount: number;
  readonly level:     'none' | 'building' | 'near' | 'ready';
  /** A short phrase, or null when nothing notable. */
  readonly note:      string | null;
  /** True when the player is discarding tiles they just drew (a fishing tempo). */
  readonly fishing:   boolean;
}

/** A tile kind that looks safe for the seat-to-move to discard. */
export interface SafeTileNote {
  readonly key:       TileKey;
  /** Human label, e.g. "red dragon" or "9 of circles". */
  readonly label:     string;
  /** 'safe' = cannot be punged or paired (and, for suited, no chow risk);
   *  'likely' = safe from pung/pair but a chow remains theoretically possible. */
  readonly certainty: 'safe' | 'likely';
}

/** A tile kind that is wholly out of play (all four copies visible). */
export interface OutOfPlayNote {
  readonly key:   TileKey;
  /** Human label, e.g. "green dragon" or "5 of bamboo". */
  readonly label: string;
}

/** The full per-player read-out. */
export interface PlayerInference {
  readonly seat:       SeatIndex;
  readonly name:       string;
  /** The two strongest hypotheses, strongest first. May be empty very early. */
  readonly topGuesses: readonly TargetGuess[];
  readonly closeness:  Closeness;
  /** One natural-language line for the live panel. */
  readonly summary:    string;
  /**
   * Tile kinds we are sure this player does NOT hold, because all four copies
   * are already out of play (in exposed melds and/or discards). A fully out-of-
   * play kind cannot be in anyone's hand, so this list is the same for every
   * seat; it is surfaced per player to feed later opponent-modelling / AI work.
   */
  readonly notHolding: readonly OutOfPlayNote[];
}

/** The table-wide inference: one read-out per player plus safe-tile advice. */
export interface TableInference {
  readonly players:       readonly PlayerInference[];
  /** Tiles that look safe for `state.currentSeat` to discard right now. */
  readonly safeToDiscard: readonly SafeTileNote[];
  /** Tile kinds wholly out of play (all four copies visible) -- held by no one. */
  readonly outOfPlay:     readonly OutOfPlayNote[];
}

// --- Weights (tunable) -----

const W = {
  meldSuit:     6,  // an exposed meld in a suit strongly confirms that suit
  meldHonour:   6,  // an exposed pung/kong of winds or dragons
  cleanBoost:   4,  // exposed meld in suit X *and* later discarding X -> clean hand in X
  discardEarly: 2,  // shedding a suit early counts double (players go clean early)
  discardLate:  1,  // shedding a suit later
  keepHonours:  3,  // dumping two+ suits and never an honour -> an honour-heavy lean
  keepSuit:     3,  // a suit a player conspicuously never discards -> they keep it
  dragonEarly:  4,  // discarding a dragon early: strong negative for honours, "odd"
  knit:         7,  // knitting discard fingerprint
  crochet:      7,  // crochet discard fingerprint
  mixed:        5,  // dirty (multi-suit) exposed melds
  oddNudge:     2,  // early-dragon nudge toward a special / cross-suit hand
} as const;

/** A player's first N discards count as "early". */
const EARLY_DISCARDS = 4;

const SUIT_LIST: readonly Suit[] = SUITS;

// --- Public entry points -----

/**
 * Per-player hypotheses only (no safe-tile advice). Handy for tests.
 * `outOfPlay` is normally supplied by `inferTable`; when omitted it is computed
 * from the state so the function is still usable standalone.
 */
export function inferPlayers(
  state: GameState,
  outOfPlay?: readonly OutOfPlayNote[],
): PlayerInference[] {
  const log = state.discardLog ?? [];
  const oop = outOfPlay ?? computeOutOfPlay(collectVisible(state));
  return state.players.map(p => inferOne(state, p, log, oop));
}

/** Full table read-out: per-player guesses + safe-tile advice for the mover. */
export function inferTable(state: GameState): TableInference {
  const visible       = collectVisible(state);
  const outOfPlay     = computeOutOfPlay(visible);
  const players       = inferPlayers(state, outOfPlay);
  const safeToDiscard = inferSafeTiles(state, players, visible);
  return { players, safeToDiscard, outOfPlay };
}

// --- Per-player inference -----

function inferOne(
  state:     GameState,
  player:    PlayerState,
  log:       readonly DiscardLogEntry[],
  outOfPlay: readonly OutOfPlayNote[],
): PlayerInference {
  const myDiscards = log.filter(e => e.seat === player.seat);
  const knitting   = state.config.knittingEnabled;

  // Any exposed meld is, by definition, claimed from a discard or a declared
  // kong -- so a player with any meld at all cannot be going for a hand that
  // requires every tile to be drawn from the wall (knitting, crochet, and the
  // other concealed-only specials). We gate those targets on this flag.
  const hasAnyMeld = player.melds.length > 0;

  // Running tally per candidate target.
  const tally: Record<TargetKind, number> = {
    bamboo: 0, characters: 0, circles: 0,
    honours: 0, knitting: 0, crochet: 0, mixed: 0,
  };

  // -- Exposed melds: classify suits and honours --
  const suitedMeldCount: Record<Suit, number> = { bamboo: 0, characters: 0, circles: 0 };
  let honourMelds = 0;
  for (const m of player.melds) {
    const t0 = m.tiles[0];
    if (!t0) continue;
    if (isSuited(t0))      suitedMeldCount[t0.suit] += 1;
    else if (isHonour(t0)) honourMelds += 1;
  }
  const meldedSuits = SUIT_LIST.filter(s => suitedMeldCount[s] > 0);
  const hasSuitedMeld = meldedSuits.length > 0;
  const dirty = meldedSuits.length >= 2;

  for (const s of meldedSuits) tally[s] += W.meldSuit * suitedMeldCount[s];
  // A single honour meld (e.g. one dragon pung) is normal in an ordinary suit
  // hand and is NOT evidence of an all-honours hand. Only two or more exposed
  // honour melds point at the (rare) all-honours special hand.
  if (honourMelds >= 2) tally.honours += W.meldHonour * honourMelds;

  // -- Discards: shed suits, honour timing --
  const suitDiscards: Record<Suit, number> = { bamboo: 0, characters: 0, circles: 0 };
  let honourDiscards = 0;
  let earlyDragonDiscard = false;
  myDiscards.forEach((e, idx) => {
    const t = e.tile;
    const early = idx < EARLY_DISCARDS;
    if (isSuited(t)) {
      suitDiscards[t.suit] += 1;
      tally[t.suit] -= early ? W.discardEarly : W.discardLate;
    } else if (isHonour(t)) {
      honourDiscards += 1;
      tally.honours -= early ? W.discardEarly : W.discardLate;
      if (isDragon(t) && early) {
        earlyDragonDiscard = true;
        tally.honours -= W.dragonEarly;
      }
    }
  });
  const distinctSuitsShed = SUIT_LIST.filter(s => suitDiscards[s] > 0).length;
  const totalSuitedDiscards = SUIT_LIST.reduce((n, s) => n + suitDiscards[s], 0);

  // -- Clean-hand boost: melding a suit and then shedding it = comfortable in it --
  for (const s of meldedSuits) {
    if (suitDiscards[s] > 0) tally[s] += W.cleanBoost;
  }

  // -- Kept-suit lean: once a player has shed a few suited tiles, the suits they
  //    conspicuously never discard are the ones they are keeping (players go
  //    clean early, so the suit they avoid throwing is their likely target). --
  if (totalSuitedDiscards >= 3) {
    for (const s of SUIT_LIST) {
      if (suitDiscards[s] === 0) tally[s] += W.keepSuit;
    }
  }

  // -- Keeping honours: a genuine all-honours lean needs real evidence, not just
  //    the absence of honour discards. A normal clean one-suit hand also keeps
  //    its honour pair and never throws one. We only lean towards an honours
  //    hand when the player is actively dumping suited tiles across two or more
  //    suits while never parting with an honour -- and never if a suited meld is
  //    exposed (an all-honours hand has no suited melds). Even then it is a mild
  //    nudge, so a kept-suit clean read usually outranks it. --
  if (!hasSuitedMeld && honourDiscards === 0
      && distinctSuitsShed >= 2 && totalSuitedDiscards >= 4) {
    tally.honours += W.keepHonours;
  }

  // -- Cross-suit special hands: legal only when knitting is enabled AND the
  //    player has nothing exposed (these are drawn entirely from the wall). --
  if (knitting && !hasAnyMeld) {
    // Knitting: shed exactly one suit + honours, keep the other two suits.
    if (honourDiscards >= 1 && distinctSuitsShed === 1) tally.knitting += W.knit;
    // Crochet: shed honours, keep all three suits.
    if (honourDiscards >= 2 && distinctSuitsShed === 0) tally.crochet += W.crochet;
  }

  // -- "Something odd": an early dragon discard nudges toward a special hand.
  //    Knitting/crochet are concealed-only, so only nudge them when nothing is
  //    exposed; the mixed-hand nudge applies regardless. --
  if (earlyDragonDiscard) {
    if (knitting && !hasAnyMeld) {
      tally.knitting += W.oddNudge;
      tally.crochet  += W.oddNudge;
    }
    tally.mixed += W.oddNudge;
  }

  // -- An all-honours hand (winds & dragons only) is impossible once any suited
  //    meld -- pung OR chow -- is on the table. Rule the target out entirely. --
  if (hasSuitedMeld) tally.honours = 0;

  // -- Dirty melds: collapse the per-suit reads into a single "mixed" guess --
  if (dirty) {
    let moved = 0;
    for (const s of meldedSuits) { moved += Math.max(0, tally[s]); tally[s] = 0; }
    tally.mixed += moved + W.mixed;
  }

  // -- Knitting suit pair: the two suits the player is keeping (the ones they
  //    are NOT shedding) are the pair being knitted. Used to label the guess. --
  const keptSuits = SUIT_LIST.filter(s => suitDiscards[s] === 0);
  const knitLabel = keptSuits.length === 2
    ? `knitting ${keptSuits[0]} and ${keptSuits[1]}`
    : 'knitting';

  // -- Rank and label --
  const topGuesses = rankGuesses(tally, { knitting: knitLabel });
  const closeness  = assessCloseness(player, myDiscards);
  const summary    = buildSummary(player.name, topGuesses, closeness, myDiscards.length);

  return {
    seat: player.seat, name: player.name,
    topGuesses, closeness, summary,
    notHolding: outOfPlay,
  };
}

// --- Ranking / labelling -----

function targetLabel(kind: TargetKind): string {
  switch (kind) {
    case 'bamboo':     return 'collecting bamboo';
    case 'characters': return 'collecting characters';
    case 'circles':    return 'collecting circles';
    case 'honours':    return 'going for an all-honours hand (winds & dragons)';
    case 'knitting':   return 'knitting';
    case 'crochet':    return 'crocheting (three-suit sets)';
    case 'mixed':      return 'going for a mixed hand, perhaps all pungs';
  }
}

function confidenceOf(score: number): Confidence {
  if (score >= 6) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function rankGuesses(
  tally:  Record<TargetKind, number>,
  labels: Partial<Record<TargetKind, string>> = {},
): TargetGuess[] {
  const kinds = Object.keys(tally) as TargetKind[];
  return kinds
    .map(kind => ({ kind, score: tally[kind] }))
    .filter(g => g.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(g => ({
      kind:       g.kind,
      label:      labels[g.kind] ?? targetLabel(g.kind),
      score:      g.score,
      confidence: confidenceOf(g.score),
    }));
}

// --- Closeness -----

function assessCloseness(
  player:     PlayerState,
  myDiscards: readonly DiscardLogEntry[],
): Closeness {
  const meldCount = player.melds.length;

  // Fishing tempo: at least two of the last three discards were the tile just drawn.
  const recent = myDiscards.slice(-3);
  const justDrawnCount = recent.filter(e => e.justDrawn === true).length;
  const fishing = justDrawnCount >= 2;

  let level: Closeness['level'];
  let note: string | null;
  if (meldCount >= 4)       { level = 'ready';    note = 'needs only the pair or one tile'; }
  else if (meldCount === 3) { level = 'near';     note = 'may be one or two tiles from a win'; }
  else if (meldCount >= 1)  { level = 'building'; note = null; }
  else                      { level = 'none';     note = null; }

  if (fishing && meldCount >= 2) {
    note = (note ? note + ', and ' : '') + 'discarding freshly-drawn tiles (fishing)';
  }

  return { meldCount, level, note, fishing };
}

// --- Summary line -----

function hedge(confidence: Confidence): string {
  switch (confidence) {
    case 'high':   return 'is';
    case 'medium': return 'seems to be';
    case 'low':    return 'might be';
  }
}

function buildSummary(
  name:        string,
  guesses:     readonly TargetGuess[],
  closeness:   Closeness,
  discardCount: number,
): string {
  const first = guesses[0];
  if (!first) {
    return discardCount < 2
      ? `${name}: too early to read`
      : `${name}: no clear direction yet`;
  }
  let s = `${name} ${hedge(first.confidence)} ${first.label}`;
  const second = guesses[1];
  if (second) s += ` (possibly ${shortLabel(second.kind)})`;
  if (closeness.note) s += `; ${closeness.meldCount} melds down, ${closeness.note}`;
  return s + '.';
}

/** A terse noun for the secondary guess in a summary line. */
function shortLabel(kind: TargetKind): string {
  switch (kind) {
    case 'bamboo':     return 'bamboo';
    case 'characters': return 'characters';
    case 'circles':    return 'circles';
    case 'honours':    return 'an all-honours hand';
    case 'knitting':   return 'knitting';
    case 'crochet':    return 'crocheting';
    case 'mixed':      return 'a mixed hand';
  }
}

// --- Visible-tile accounting (shared by safe-tile and out-of-play passes) -----

interface VisibleTiles {
  readonly counts: Map<TileKey, number>;
  readonly sample: Map<TileKey, Tile>;
}

/**
 * Count every tile a human can see: the discard log, the communal pool, and
 * every exposed meld. Each physical copy is counted once (by tile id).
 */
function collectVisible(state: GameState): VisibleTiles {
  const seenIds = new Set<string>();
  const counts  = new Map<TileKey, number>();
  const sample  = new Map<TileKey, Tile>();

  const see = (t: Tile) => {
    if (seenIds.has(t.id)) return;
    seenIds.add(t.id);
    const k = tileKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!sample.has(k)) sample.set(k, t);
  };

  for (const e of state.discardLog ?? []) see(e.tile);
  for (const t of state.discardPool)     see(t);
  for (const p of state.players)
    for (const m of p.melds)
      for (const t of m.tiles) see(t);

  return { counts, sample };
}

/** Tile kinds with all four copies visible -- nobody can be holding them. */
function computeOutOfPlay({ counts, sample }: VisibleTiles): OutOfPlayNote[] {
  const notes: OutOfPlayNote[] = [];
  for (const [key, n] of counts) {
    if (n < 4) continue;
    const t = sample.get(key);
    if (!t) continue;
    notes.push({ key, label: tileLabel(t) });
  }
  return notes;
}

// --- Safe-tile advice -----

function tileLabel(t: Tile): string {
  switch (t.category) {
    case 'suited': return `${t.value} of ${t.suit}`;
    case 'wind':   return `${t.wind} wind`;
    case 'dragon': return `${t.dragon} dragon`;
    case 'flower': return `${t.flower} flower`;
    case 'season': return `${t.season} season`;
  }
}

/**
 * A kind is safe to discard once exactly three copies are visible (across
 * discards and exposed melds): the one remaining copy can no longer complete a
 * pung or a pair. Once all four are visible the kind is out of play -- there is
 * nothing left to discard, so it is not a "safe discard" at all and is omitted
 * (see `outOfPlay`). Honours are then fully safe (they cannot chow). A suited
 * tile could still be chowed by the only player who can claim it (the next seat
 * in turn order), so it is only 'safe' when that player is not collecting its suit.
 */
function inferSafeTiles(
  state:   GameState,
  players: readonly PlayerInference[],
  { counts, sample }: VisibleTiles,
): SafeTileNote[] {
  // The only player who could chow the mover's discard is the next seat.
  const nextSeat = ((state.currentSeat + 1) % state.config.playerCount) as SeatIndex;
  const nextGuess = players[nextSeat]?.topGuesses[0]?.kind ?? null;

  const notes: SafeTileNote[] = [];
  for (const [key, n] of counts) {
    if (n !== 3) continue;  // <3 still claimable; >=4 is out of play, nothing to throw
    const t = sample.get(key);
    if (!t) continue;
    if (isHonour(t)) {
      notes.push({ key, label: tileLabel(t), certainty: 'safe' });
    } else if (isSuited(t)) {
      const chowRisk = nextGuess === t.suit;
      notes.push({ key, label: tileLabel(t), certainty: chowRisk ? 'likely' : 'safe' });
    }
  }
  return notes;
}
