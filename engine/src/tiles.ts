/**
 * Module 1.1 — Tile Definitions
 *
 * Defines the TypeScript types for every tile in a Hong Kong Mahjong set,
 * assigns stable unique IDs to each of the 144 physical tiles, and provides
 * the predicate and utility functions used throughout the engine.
 *
 * This module has zero UI dependencies and no side effects.
 */

// ─── Branded primitives ────────────────────────────────────────────────────────

/**
 * A unique identifier for one specific physical tile (one of the 144 in the
 * set).  Four copies of "Bamboo 5" each have a distinct TileId.
 *
 * Using a branded string rather than a plain string lets TypeScript catch
 * accidental mix-ups (e.g. passing a TileKey where a TileId is expected).
 */
export type TileId = string & { readonly _brand: 'TileId' };

/**
 * A canonical string key that identifies a tile's *kind*, ignoring which
 * physical copy it is.  All four copies of "Bamboo 5" share the same TileKey.
 *
 * Useful as a Map key when counting tiles or grouping hands by kind.
 */
export type TileKey = string & { readonly _brand: 'TileKey' };

// ─── Enumerated sub-types ──────────────────────────────────────────────────────

export type Suit        = 'bamboo' | 'characters' | 'circles';
export type SuitedValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Wind        = 'east' | 'south' | 'west' | 'north';
export type Dragon      = 'red' | 'green' | 'white';  // Chun / Fah / Bak

/**
 * Names for the four flower bonus tiles.
 * Note: 'bamboo' here is the Bamboo flower (竹), entirely distinct from
 * the Bamboo suit.  The category field ('flower' vs 'suited') disambiguates.
 */
export type Flower      = 'plum' | 'orchid' | 'chrysanthemum' | 'bamboo';
export type Season      = 'spring' | 'summer' | 'autumn' | 'winter';

// ─── Tile interfaces ───────────────────────────────────────────────────────────

export interface SuitedTile {
  readonly id:       TileId;
  readonly category: 'suited';
  readonly suit:     Suit;
  readonly value:    SuitedValue;
}

export interface WindTile {
  readonly id:       TileId;
  readonly category: 'wind';
  readonly wind:     Wind;
}

export interface DragonTile {
  readonly id:       TileId;
  readonly category: 'dragon';
  readonly dragon:   Dragon;
}

export interface FlowerTile {
  readonly id:       TileId;
  readonly category: 'flower';
  readonly flower:   Flower;
}

export interface SeasonTile {
  readonly id:       TileId;
  readonly category: 'season';
  readonly season:   Season;
}

/** The discriminated union of all five tile types. */
export type Tile = SuitedTile | WindTile | DragonTile | FlowerTile | SeasonTile;

// ─── Canonical constant arrays ─────────────────────────────────────────────────

/** All three suited suits, in canonical order. */
export const SUITS: readonly Suit[] = ['bamboo', 'characters', 'circles'];

/** All nine suited values, in ascending order. */
export const SUITED_VALUES: readonly SuitedValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** All four wind directions, in seating order (East → South → West → North). */
export const WINDS: readonly Wind[] = ['east', 'south', 'west', 'north'];

/** All three dragon colours, in canonical order. */
export const DRAGONS: readonly Dragon[] = ['red', 'green', 'white'];

/** All four flower bonus tiles. */
export const FLOWERS: readonly Flower[] = ['plum', 'orchid', 'chrysanthemum', 'bamboo'];

/** All four season bonus tiles. */
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

// ─── Key function ──────────────────────────────────────────────────────────────

/**
 * Returns a canonical key that identifies a tile's *kind*, ignoring its
 * physical copy.  Two tiles with the same key are interchangeable in melds.
 *
 * Format examples:
 *   suited:bamboo:5    (Bamboo 5)
 *   wind:east          (East Wind)
 *   dragon:red         (Red Dragon / Chun)
 *   flower:plum        (Plum Flower)
 *   season:spring      (Spring Season)
 */
export function tileKey(tile: Tile): TileKey {
  switch (tile.category) {
    case 'suited':  return `suited:${tile.suit}:${tile.value}` as TileKey;
    case 'wind':    return `wind:${tile.wind}`                 as TileKey;
    case 'dragon':  return `dragon:${tile.dragon}`             as TileKey;
    case 'flower':  return `flower:${tile.flower}`             as TileKey;
    case 'season':  return `season:${tile.season}`             as TileKey;
  }
}

// ─── Predicates ────────────────────────────────────────────────────────────────

/** Suited tile: any value 1–9 in Bamboo, Characters, or Circles. */
export function isSuited(tile: Tile): tile is SuitedTile {
  return tile.category === 'suited';
}

/** Wind tile: East, South, West, or North. */
export function isWind(tile: Tile): tile is WindTile {
  return tile.category === 'wind';
}

/** Dragon tile: Red (Chun), Green (Fah), or White (Bak). */
export function isDragon(tile: Tile): tile is DragonTile {
  return tile.category === 'dragon';
}

/** Flower bonus tile: Plum, Orchid, Chrysanthemum, or Bamboo (flower). */
export function isFlower(tile: Tile): tile is FlowerTile {
  return tile.category === 'flower';
}

/** Season bonus tile: Spring, Summer, Autumn, or Winter. */
export function isSeason(tile: Tile): tile is SeasonTile {
  return tile.category === 'season';
}

/** Honour tile: a Wind or Dragon.  Not suited, not bonus. */
export function isHonour(tile: Tile): tile is WindTile | DragonTile {
  return tile.category === 'wind' || tile.category === 'dragon';
}

/**
 * Bonus tile: a Flower or Season.
 * Bonus tiles are set aside when drawn and score independently at hand end.
 * They are never part of a meld and are replaced from the dead wall.
 */
export function isBonus(tile: Tile): tile is FlowerTile | SeasonTile {
  return tile.category === 'flower' || tile.category === 'season';
}

/**
 * Terminal tile: the 1 or 9 of any suited suit.
 * Terminals score more than simples and feature in several special hands.
 */
export function isTerminal(tile: Tile): boolean {
  return isSuited(tile) && (tile.value === 1 || tile.value === 9);
}

/**
 * Simple tile: a suited tile with value 2–8.
 * The complement of terminals among suited tiles.
 */
export function isSimple(tile: Tile): boolean {
  return isSuited(tile) && tile.value > 1 && tile.value < 9;
}

// ─── Equality ──────────────────────────────────────────────────────────────────

/**
 * True if a and b are the same *kind* of tile.
 * Four copies of Bamboo 5 are all equal by this function.
 * Use this when validating melds (pungs, kongs, pairs).
 */
export function tileEquals(a: Tile, b: Tile): boolean {
  return tileKey(a) === tileKey(b);
}

/**
 * True if a and b are the exact same physical tile (same TileId).
 * Use this when tracking individual tiles through the game state.
 */
export function sameInstance(a: Tile, b: Tile): boolean {
  return a.id === b.id;
}

// ─── Value adjacency ───────────────────────────────────────────────────────────

/**
 * Returns the next or previous suited value in sequence, or null if the
 * result would be out of the 1–9 range.
 *
 * Used by the meld validator (module 1.6) when checking chow sequences.
 *
 * @example
 *   adjacentValue(5,  1)  // → 6
 *   adjacentValue(9,  1)  // → null  (no value above 9)
 *   adjacentValue(1, -1)  // → null  (no value below 1)
 */
export function adjacentValue(
  value: SuitedValue,
  offset: 1 | -1,
): SuitedValue | null {
  const next = value + offset;
  if (next < 1 || next > 9) return null;
  return next as SuitedValue;
}

// ─── Tile set builder ──────────────────────────────────────────────────────────

function mkId(raw: string): TileId {
  return raw as TileId;
}

/**
 * Builds the canonical 144-tile set in a fixed, deterministic order.
 * IDs are stable across calls — the wall builder (module 1.2) shuffles them.
 *
 * Tile counts:
 *   108 suited   (9 values × 3 suits × 4 copies)
 *    16 winds     (4 directions × 4 copies)
 *    12 dragons   (3 colours × 4 copies)
 *     4 flowers   (1 copy each)
 *     4 seasons   (1 copy each)
 *   ─────────────
 *   144 total
 *
 * ID format:
 *   bamboo-5-2        → Bamboo 5, third copy (0-indexed)
 *   wind-east-0       → East Wind, first copy
 *   dragon-red-3      → Red Dragon, fourth copy
 *   flower-plum       → Plum Flower (unique)
 *   season-spring     → Spring Season (unique)
 */
export function buildTileSet(): Tile[] {
  const tiles: Tile[] = [];

  // 108 suited tiles
  for (const suit of SUITS) {
    for (const value of SUITED_VALUES) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({
          id:       mkId(`${suit}-${value}-${copy}`),
          category: 'suited',
          suit,
          value,
        });
      }
    }
  }

  // 16 wind tiles
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({
        id:       mkId(`wind-${wind}-${copy}`),
        category: 'wind',
        wind,
      });
    }
  }

  // 12 dragon tiles
  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({
        id:       mkId(`dragon-${dragon}-${copy}`),
        category: 'dragon',
        dragon,
      });
    }
  }

  // 4 flower tiles (unique — no copy suffix)
  for (const flower of FLOWERS) {
    tiles.push({
      id:       mkId(`flower-${flower}`),
      category: 'flower',
      flower,
    });
  }

  // 4 season tiles (unique — no copy suffix)
  for (const season of SEASONS) {
    tiles.push({
      id:       mkId(`season-${season}`),
      category: 'season',
      season,
    });
  }

  return tiles;
}
