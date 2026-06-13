import { describe, it, expect } from 'vitest';
import { buildWall, drawFromWall, drawReplacement, shuffle } from '../wall.js';

// ─── shuffle ───────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  it('returns the same array reference', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toBe(arr);
  });

  it('preserves all elements (is a permutation)', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arr = [...original];
    shuffle(arr);
    expect([...arr].sort((a, b) => a - b)).toEqual(original);
  });

  it('handles an empty array without error', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('handles a single-element array without error', () => {
    expect(shuffle([42])).toEqual([42]);
  });
});

// ─── buildWall — 4 players ─────────────────────────────────────────────────────

describe('buildWall (4 players)', () => {
  // Run once and reuse — avoids re-shuffling on every assertion.
  const deal = buildWall(4);

  it('produces exactly 4 hands', () => {
    expect(deal.hands).toHaveLength(4);
  });

  it('gives the dealer (seat 0) 14 tiles', () => {
    expect(deal.hands[0]).toHaveLength(14);
  });

  it('gives each non-dealer 13 tiles', () => {
    expect(deal.hands[1]).toHaveLength(13);
    expect(deal.hands[2]).toHaveLength(13);
    expect(deal.hands[3]).toHaveLength(13);
  });

  it('dead wall contains exactly 14 tiles', () => {
    expect(deal.wall.dead).toHaveLength(14);
  });

  it('live wall contains exactly 77 tiles', () => {
    // 144 − 14 (dead) − 14 (dealer) − 13 × 3 (others) = 77
    expect(deal.wall.live).toHaveLength(77);
  });

  it('accounts for all 144 tiles exactly once', () => {
    const all = [
      ...deal.hands[0],
      ...deal.hands[1],
      ...deal.hands[2],
      ...deal.hands[3],
      ...deal.wall.live,
      ...deal.wall.dead,
    ];
    expect(all).toHaveLength(144);
    expect(new Set(all.map(t => t.id)).size).toBe(144);
  });
});

// ─── buildWall — 3 players ─────────────────────────────────────────────────────

describe('buildWall (3 players)', () => {
  const deal = buildWall(3);

  it('produces exactly 3 hands', () => {
    expect(deal.hands).toHaveLength(3);
  });

  it('gives the dealer (seat 0) 14 tiles', () => {
    expect(deal.hands[0]).toHaveLength(14);
  });

  it('gives each non-dealer 13 tiles', () => {
    expect(deal.hands[1]).toHaveLength(13);
    expect(deal.hands[2]).toHaveLength(13);
  });

  it('dead wall contains exactly 14 tiles', () => {
    expect(deal.wall.dead).toHaveLength(14);
  });

  it('live wall contains exactly 90 tiles', () => {
    // 144 − 14 (dead) − 14 (dealer) − 13 × 2 (others) = 90
    expect(deal.wall.live).toHaveLength(90);
  });

  it('accounts for all 144 tiles exactly once', () => {
    const all = [
      ...deal.hands[0],
      ...deal.hands[1],
      ...deal.hands[2],
      ...deal.wall.live,
      ...deal.wall.dead,
    ];
    expect(all).toHaveLength(144);
    expect(new Set(all.map(t => t.id)).size).toBe(144);
  });
});

// ─── drawFromWall ──────────────────────────────────────────────────────────────

describe('drawFromWall', () => {
  it('returns the first tile in the live wall', () => {
    const deal = buildWall(4);
    const expected = deal.wall.live[0];
    const { tile } = drawFromWall(deal.wall);
    expect(tile).toBe(expected);
  });

  it('the returned wall has one fewer live tile', () => {
    const deal = buildWall(4);
    const before = deal.wall.live.length;
    const { wall } = drawFromWall(deal.wall);
    expect(wall.live).toHaveLength(before - 1);
  });

  it('does not mutate the original wall', () => {
    const deal = buildWall(4);
    const before = deal.wall.live.length;
    drawFromWall(deal.wall);
    expect(deal.wall.live).toHaveLength(before);
  });

  it('dead wall is unchanged after a live draw', () => {
    const deal = buildWall(4);
    const { wall } = drawFromWall(deal.wall);
    expect(wall.dead).toHaveLength(deal.wall.dead.length);
  });

  it('returns null and the same wall when the live wall is empty', () => {
    const empty = { live: [], dead: [] };
    const { tile, wall } = drawFromWall(empty);
    expect(tile).toBeNull();
    expect(wall).toBe(empty);
  });
});

// ─── drawReplacement ───────────────────────────────────────────────────────────

describe('drawReplacement', () => {
  it('returns the first tile in the dead wall', () => {
    const deal = buildWall(4);
    const expected = deal.wall.dead[0];
    const { tile } = drawReplacement(deal.wall);
    expect(tile).toBe(expected);
  });

  it('the returned wall has one fewer dead tile', () => {
    const deal = buildWall(4);
    const before = deal.wall.dead.length;
    const { wall } = drawReplacement(deal.wall);
    expect(wall.dead).toHaveLength(before - 1);
  });

  it('does not mutate the original wall', () => {
    const deal = buildWall(4);
    const before = deal.wall.dead.length;
    drawReplacement(deal.wall);
    expect(deal.wall.dead).toHaveLength(before);
  });

  it('live wall is unchanged after a replacement draw', () => {
    const deal = buildWall(4);
    const { wall } = drawReplacement(deal.wall);
    expect(wall.live).toHaveLength(deal.wall.live.length);
  });

  it('returns null and the same wall when the dead wall is empty', () => {
    const empty = { live: [], dead: [] };
    const { tile, wall } = drawReplacement(empty);
    expect(tile).toBeNull();
    expect(wall).toBe(empty);
  });
});
