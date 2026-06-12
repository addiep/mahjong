import { describe, it, expect } from 'vitest';
import {
  buildTileSet,
  tileKey,
  tileEquals,
  sameInstance,
  adjacentValue,
  isSuited,
  isWind,
  isDragon,
  isFlower,
  isSeason,
  isHonour,
  isBonus,
  isTerminal,
  isSimple,
  SUITS,
  SUITED_VALUES,
  WINDS,
  DRAGONS,
  FLOWERS,
  SEASONS,
  type Tile,
  type SuitedTile,
  type WindTile,
  type DragonTile,
  type FlowerTile,
  type SeasonTile,
} from '../tiles.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pulls all tiles of a given category from the set. */
function ofCategory(tiles: Tile[], cat: Tile['category']): Tile[] {
  return tiles.filter(t => t.category === cat);
}

// ─── buildTileSet ─────────────────────────────────────────────────────────────

describe('buildTileSet', () => {
  const tiles = buildTileSet();

  it('returns exactly 144 tiles', () => {
    expect(tiles).toHaveLength(144);
  });

  it('all tile IDs are unique', () => {
    const ids = tiles.map(t => t.id);
    expect(new Set(ids).size).toBe(144);
  });

  it('contains 108 suited tiles', () => {
    expect(ofCategory(tiles, 'suited')).toHaveLength(108);
  });

  it('contains 16 wind tiles', () => {
    expect(ofCategory(tiles, 'wind')).toHaveLength(16);
  });

  it('contains 12 dragon tiles', () => {
    expect(ofCategory(tiles, 'dragon')).toHaveLength(12);
  });

  it('contains 4 flower tiles', () => {
    expect(ofCategory(tiles, 'flower')).toHaveLength(4);
  });

  it('contains 4 season tiles', () => {
    expect(ofCategory(tiles, 'season')).toHaveLength(4);
  });

  it('has exactly 4 copies of every suited kind', () => {
    const suited = ofCategory(tiles, 'suited') as SuitedTile[];
    for (const suit of SUITS) {
      for (const value of SUITED_VALUES) {
        const count = suited.filter(t => t.suit === suit && t.value === value).length;
        expect(count, `${suit} ${value}`).toBe(4);
      }
    }
  });

  it('has exactly 4 copies of every wind', () => {
    const winds = ofCategory(tiles, 'wind') as WindTile[];
    for (const wind of WINDS) {
      const count = winds.filter(t => t.wind === wind).length;
      expect(count, wind).toBe(4);
    }
  });

  it('has exactly 4 copies of every dragon', () => {
    const dragons = ofCategory(tiles, 'dragon') as DragonTile[];
    for (const dragon of DRAGONS) {
      const count = dragons.filter(t => t.dragon === dragon).length;
      expect(count, dragon).toBe(4);
    }
  });

  it('has exactly 1 copy of every flower', () => {
    const flowers = ofCategory(tiles, 'flower') as FlowerTile[];
    for (const flower of FLOWERS) {
      const count = flowers.filter(t => t.flower === flower).length;
      expect(count, flower).toBe(1);
    }
  });

  it('has exactly 1 copy of every season', () => {
    const seasons = ofCategory(tiles, 'season') as SeasonTile[];
    for (const season of SEASONS) {
      const count = seasons.filter(t => t.season === season).length;
      expect(count, season).toBe(1);
    }
  });

  it('is deterministic — two calls produce the same IDs in the same order', () => {
    const a = buildTileSet().map(t => t.id);
    const b = buildTileSet().map(t => t.id);
    expect(a).toEqual(b);
  });
});

// ─── tileKey ──────────────────────────────────────────────────────────────────

describe('tileKey', () => {
  const tiles = buildTileSet();

  it('two copies of the same suited tile share a key', () => {
    const bam5 = tiles.filter(
      t => t.category === 'suited' &&
           (t as SuitedTile).suit === 'bamboo' &&
           (t as SuitedTile).value === 5,
    );
    expect(bam5).toHaveLength(4);
    const keys = new Set(bam5.map(tileKey));
    expect(keys.size).toBe(1);
  });

  it('two copies of the same wind share a key', () => {
    const easts = tiles.filter(
      t => t.category === 'wind' && (t as WindTile).wind === 'east',
    );
    expect(easts).toHaveLength(4);
    const keys = new Set(easts.map(tileKey));
    expect(keys.size).toBe(1);
  });

  it('different suited tiles have different keys', () => {
    const bam5 = tiles.find(
      t => t.category === 'suited' &&
           (t as SuitedTile).suit === 'bamboo' &&
           (t as SuitedTile).value === 5,
    )!;
    const bam6 = tiles.find(
      t => t.category === 'suited' &&
           (t as SuitedTile).suit === 'bamboo' &&
           (t as SuitedTile).value === 6,
    )!;
    const circ5 = tiles.find(
      t => t.category === 'suited' &&
           (t as SuitedTile).suit === 'circles' &&
           (t as SuitedTile).value === 5,
    )!;
    expect(tileKey(bam5)).not.toBe(tileKey(bam6));
    expect(tileKey(bam5)).not.toBe(tileKey(circ5));
  });

  it('the total number of distinct keys equals the number of distinct kinds (34 + 8 = 42)', () => {
    // 27 suited kinds + 4 winds + 3 dragons + 4 flowers + 4 seasons = 42
    const allKeys = new Set(tiles.map(tileKey));
    expect(allKeys.size).toBe(42);
  });
});

// ─── Predicates ───────────────────────────────────────────────────────────────

describe('predicates', () => {
  const tiles = buildTileSet();

  const aSuited  = tiles.find(t => t.category === 'suited')!;
  const aWind    = tiles.find(t => t.category === 'wind')!;
  const aDragon  = tiles.find(t => t.category === 'dragon')!;
  const aFlower  = tiles.find(t => t.category === 'flower')!;
  const aSeason  = tiles.find(t => t.category === 'season')!;
  const bamboo1  = tiles.find(
    t => t.category === 'suited' && (t as SuitedTile).suit === 'bamboo' && (t as SuitedTile).value === 1,
  )!;
  const bamboo9  = tiles.find(
    t => t.category === 'suited' && (t as SuitedTile).suit === 'bamboo' && (t as SuitedTile).value === 9,
  )!;
  const bamboo5  = tiles.find(
    t => t.category === 'suited' && (t as SuitedTile).suit === 'bamboo' && (t as SuitedTile).value === 5,
  )!;

  describe('isSuited', () => {
    it('true for suited tiles', () => expect(isSuited(aSuited)).toBe(true));
    it('false for winds',       () => expect(isSuited(aWind)).toBe(false));
    it('false for dragons',     () => expect(isSuited(aDragon)).toBe(false));
    it('false for flowers',     () => expect(isSuited(aFlower)).toBe(false));
    it('false for seasons',     () => expect(isSuited(aSeason)).toBe(false));
  });

  describe('isWind', () => {
    it('true for wind tiles',   () => expect(isWind(aWind)).toBe(true));
    it('false for suited',      () => expect(isWind(aSuited)).toBe(false));
    it('false for dragons',     () => expect(isWind(aDragon)).toBe(false));
  });

  describe('isDragon', () => {
    it('true for dragon tiles', () => expect(isDragon(aDragon)).toBe(true));
    it('false for winds',       () => expect(isDragon(aWind)).toBe(false));
    it('false for suited',      () => expect(isDragon(aSuited)).toBe(false));
  });

  describe('isFlower', () => {
    it('true for flower tiles', () => expect(isFlower(aFlower)).toBe(true));
    it('false for seasons',     () => expect(isFlower(aSeason)).toBe(false));
    it('false for suited',      () => expect(isFlower(aSuited)).toBe(false));
  });

  describe('isSeason', () => {
    it('true for season tiles', () => expect(isSeason(aSeason)).toBe(true));
    it('false for flowers',     () => expect(isSeason(aFlower)).toBe(false));
    it('false for suited',      () => expect(isSeason(aSuited)).toBe(false));
  });

  describe('isHonour', () => {
    it('true for winds',        () => expect(isHonour(aWind)).toBe(true));
    it('true for dragons',      () => expect(isHonour(aDragon)).toBe(true));
    it('false for suited',      () => expect(isHonour(aSuited)).toBe(false));
    it('false for flowers',     () => expect(isHonour(aFlower)).toBe(false));
    it('false for seasons',     () => expect(isHonour(aSeason)).toBe(false));
  });

  describe('isBonus', () => {
    it('true for flowers',      () => expect(isBonus(aFlower)).toBe(true));
    it('true for seasons',      () => expect(isBonus(aSeason)).toBe(true));
    it('false for suited',      () => expect(isBonus(aSuited)).toBe(false));
    it('false for winds',       () => expect(isBonus(aWind)).toBe(false));
    it('false for dragons',     () => expect(isBonus(aDragon)).toBe(false));
  });

  describe('isTerminal', () => {
    it('true for suited 1',     () => expect(isTerminal(bamboo1)).toBe(true));
    it('true for suited 9',     () => expect(isTerminal(bamboo9)).toBe(true));
    it('false for suited 5',    () => expect(isTerminal(bamboo5)).toBe(false));
    it('false for winds',       () => expect(isTerminal(aWind)).toBe(false));
    it('false for dragons',     () => expect(isTerminal(aDragon)).toBe(false));
    it('false for flowers',     () => expect(isTerminal(aFlower)).toBe(false));

    it('all 1s and 9s are terminals', () => {
      const terminals = tiles.filter(isTerminal) as SuitedTile[];
      // 3 suits × 2 values (1 and 9) × 4 copies = 24
      expect(terminals).toHaveLength(24);
      for (const t of terminals) {
        expect(t.category).toBe('suited');
        expect([1, 9]).toContain(t.value);
      }
    });
  });

  describe('isSimple', () => {
    it('true for suited 2–8',   () => expect(isSimple(bamboo5)).toBe(true));
    it('false for suited 1',    () => expect(isSimple(bamboo1)).toBe(false));
    it('false for suited 9',    () => expect(isSimple(bamboo9)).toBe(false));
    it('false for winds',       () => expect(isSimple(aWind)).toBe(false));
    it('false for dragons',     () => expect(isSimple(aDragon)).toBe(false));

    it('terminals and simples partition the suited tiles', () => {
      const suited = tiles.filter(isSuited);
      const terminals = suited.filter(isTerminal);
      const simples   = suited.filter(isSimple);
      expect(terminals.length + simples.length).toBe(suited.length);
    });
  });
});

// ─── tileEquals / sameInstance ────────────────────────────────────────────────

describe('tileEquals', () => {
  const tiles = buildTileSet();

  it('is true for two copies of the same kind', () => {
    const [copy0, copy1] = tiles.filter(
      t => t.category === 'suited' &&
           (t as SuitedTile).suit === 'circles' &&
           (t as SuitedTile).value === 3,
    );
    expect(tileEquals(copy0!, copy1!)).toBe(true);
  });

  it('is false for different kinds', () => {
    const bam3 = tiles.find(
      t => t.category === 'suited' && (t as SuitedTile).suit === 'bamboo' && (t as SuitedTile).value === 3,
    )!;
    const circ3 = tiles.find(
      t => t.category === 'suited' && (t as SuitedTile).suit === 'circles' && (t as SuitedTile).value === 3,
    )!;
    expect(tileEquals(bam3, circ3)).toBe(false);
  });

  it('is false between a wind and a dragon', () => {
    const wind   = tiles.find(t => t.category === 'wind')!;
    const dragon = tiles.find(t => t.category === 'dragon')!;
    expect(tileEquals(wind, dragon)).toBe(false);
  });
});

describe('sameInstance', () => {
  const tiles = buildTileSet();

  it('is true for the same object reference', () => {
    const tile = tiles[0]!;
    expect(sameInstance(tile, tile)).toBe(true);
  });

  it('is false for two different copies of the same kind', () => {
    const [copy0, copy1] = tiles.filter(
      t => t.category === 'suited' &&
           (t as SuitedTile).suit === 'bamboo' &&
           (t as SuitedTile).value === 1,
    );
    expect(sameInstance(copy0!, copy1!)).toBe(false);
  });
});

// ─── adjacentValue ────────────────────────────────────────────────────────────

describe('adjacentValue', () => {
  it('5 + 1 → 6',     () => expect(adjacentValue(5,  1)).toBe(6));
  it('5 - 1 → 4',     () => expect(adjacentValue(5, -1)).toBe(4));
  it('1 - 1 → null',  () => expect(adjacentValue(1, -1)).toBeNull());
  it('9 + 1 → null',  () => expect(adjacentValue(9,  1)).toBeNull());
  it('1 + 1 → 2',     () => expect(adjacentValue(1,  1)).toBe(2));
  it('9 - 1 → 8',     () => expect(adjacentValue(9, -1)).toBe(8));
});
