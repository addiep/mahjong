/**
 * useHandOrder — view-only ordering for a player's concealed hand.
 *
 * Tile order within a hand has no bearing on the rules, so the player is free
 * to drag their tiles into whatever grouping they like (pungs, runs, etc.).
 * That arrangement is a *display* concern only: the engine's `concealed` array
 * stays the source of truth, and this hook keeps a parallel list of tile IDs
 * describing the on-screen order.
 *
 * When the engine hands back a new state (a tile drawn, claimed, or discarded)
 * the hook reconciles: tiles the player already arranged keep their position,
 * a newly added tile appears at the end, and a removed tile drops out. So the
 * player's grouping survives across their turn instead of being reshuffled.
 *
 * Accepts an optional `initialOrder` (saved IDs from a previous turn) so that
 * hand order persists for each seat across the hand, even as the board rotates.
 * The `onOrderChange` callback fires whenever the order changes, allowing the
 * caller to save it for later restoration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Tile } from '@mahjong/engine';

function reconcile(prev: readonly string[], tiles: readonly Tile[]): string[] {
  const present = new Set<string>(tiles.map((t) => t.id));
  const kept = prev.filter((id) => present.has(id));
  const keptSet = new Set(kept);
  const added = tiles.filter((t) => !keptSet.has(t.id)).map((t) => t.id);
  return [...kept, ...added];
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export interface HandOrder {
  /** The tiles in the player's chosen display order. */
  readonly ordered: Tile[];
  /** Replace the whole order (used by the drag handler and the sort button). */
  readonly setOrder: (ids: string[]) => void;
  /** Move the tile at `from` to index `to`, preserving the rest. */
  readonly moveTile: (from: number, to: number) => void;
}

export function useHandOrder(
  tiles: readonly Tile[],
  initialOrder?: string[],
  onOrderChange?: (ids: string[]) => void,
): HandOrder {
  const [orderIds, setOrderIds] = useState<string[]>(() => {
    if (initialOrder && initialOrder.length > 0) {
      return reconcile(initialOrder, tiles);
    }
    return tiles.map((t) => t.id);
  });

  // Reconcile whenever the set of tiles changes (draw / claim / discard).
  const idsSignature = tiles.map((t) => t.id).join(',');
  useEffect(() => {
    setOrderIds((prev) => {
      const next = reconcile(prev, tiles);
      return sameOrder(prev, next) ? prev : next;
    });
    // idsSignature captures the dependency on the tile-id set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsSignature]);

  // Fire onOrderChange whenever orderIds changes, but skip the initial mount.
  const onOrderChangeRef = useRef(onOrderChange);
  onOrderChangeRef.current = onOrderChange;
  const prevOrderRef = useRef<string[]>(orderIds);
  useEffect(() => {
    if (!sameOrder(prevOrderRef.current, orderIds)) {
      prevOrderRef.current = orderIds;
      onOrderChangeRef.current?.(orderIds);
    }
  }, [orderIds]);

  const ordered = useMemo(() => {
    const byId = new Map<string, Tile>(tiles.map((t) => [t.id, t]));
    return reconcile(orderIds, tiles)
      .map((id) => byId.get(id))
      .filter((t): t is Tile => t !== undefined);
  }, [orderIds, tiles]);

  const setOrder = useCallback((ids: string[]) => setOrderIds(ids), []);

  const moveTile = useCallback((from: number, to: number) => {
    setOrderIds((prev) => {
      if (from === to || from < 0 || from >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return prev;
      next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
      return next;
    });
  }, []);

  return { ordered, setOrder, moveTile };
}
