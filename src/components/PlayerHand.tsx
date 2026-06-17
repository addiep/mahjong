/**
 * Module 2.2 — UI: Player Hand (interactive, local seat)
 *
 * Two interactions:
 *
 * 1. Drag to reorder — tiles can be dragged horizontally to group pungs/runs.
 *    Drag is custom pointer events (mouse + touch, no library).
 *
 * 2. Discard — two ways:
 *    a. Tap to select (lifts tile, green border), tap again to confirm discard.
 *    b. Drag upward past a threshold to fling a tile directly to the discard
 *       pool (dy < -50px and more vertical than horizontal).
 *
 * 3. Mah Jong button — shown during DISCARDING when the hand is already
 *    complete (self-draw win). Calls onDeclareWin. Moved to the right end of
 *    the toolbar in playtesting round 2 to separate it from the Sort button.
 *
 * Order persistence: accepts savedOrder (restored IDs from a previous turn for
 * this seat) and onOrderChange (fires whenever the order changes) so App.tsx can
 * preserve each seat's arrangement across board rotations.
 */

import { useEffect, useRef, useState } from 'react';
import type { Tile, TileId, Suit, Wind, Dragon } from '@mahjong/engine';
import { Tile as TileView } from './Tile';
import { useHandOrder } from '../hooks/useHandOrder';
import styles from './PlayerHand.module.css';

const SUIT_ORDER: Record<Suit, number> = { bamboo: 0, characters: 1, circles: 2 };
const WIND_ORDER: Record<Wind, number> = { east: 0, south: 1, west: 2, north: 3 };
const DRAGON_ORDER: Record<Dragon, number> = { red: 0, green: 1, white: 2 };

/** Sort key: suits (by suit then value), then winds, then dragons. */
function sortKey(t: Tile): [number, number, number] {
  switch (t.category) {
    case 'suited': return [0, SUIT_ORDER[t.suit], t.value];
    case 'wind':   return [1, WIND_ORDER[t.wind], 0];
    case 'dragon': return [2, DRAGON_ORDER[t.dragon], 0];
    default:       return [3, 0, 0];
  }
}

function compareKey(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

interface DragState {
  readonly id: string;
  readonly from: number;
  readonly startX: number;
  readonly startY: number;
  readonly pitch: number;
  dx: number;
  dy: number;
  target: number;
}

export interface PlayerHandProps {
  readonly tiles: readonly Tile[];
  /** Tile height in px. Default 56. */
  readonly size?: number;
  /**
   * When true, tiles are selectable for discard: first tap selects (lifts
   * the tile), second tap on the same tile calls onDiscard.
   * Upward drag also triggers discard directly.
   */
  readonly isDiscarding?: boolean;
  /** Called with the chosen tile's ID when the player confirms a discard. */
  readonly onDiscard?: (tileId: TileId) => void;
  /**
   * Called when the player clicks the Mah Jong button (self-draw win).
   * Only shown when the hand is already complete.
   */
  readonly onDeclareWin?: () => void;
  /** ID of the tile just drawn from the wall — shown with a gold border. */
  readonly drawnTileId?: TileId | null;
  /** Saved display order from the player's previous turn (IDs). */
  readonly savedOrder?: string[];
  /** Fires whenever the display order changes, for the caller to persist. */
  readonly onOrderChange?: (ids: string[]) => void;
}

export function PlayerHand({
  tiles,
  size = 56,
  isDiscarding = false,
  onDiscard,
  onDeclareWin,
  drawnTileId,
  savedOrder,
  onOrderChange,
}: PlayerHandProps) {
  const { ordered, setOrder, moveTile } = useHandOrder(tiles, savedOrder, onOrderChange);
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedId, setSelectedId] = useState<TileId | null>(null);

  const n = ordered.length;

  // Clear selection whenever the set of tiles changes (a tile drawn, claimed,
  // or discarded by the engine).
  const tilesSignature = tiles.map(t => t.id).join(',');
  useEffect(() => {
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesSignature]);

  const sortHand = () => {
    const ids = [...ordered].sort((a, b) => compareKey(sortKey(a), sortKey(b))).map((t) => t.id);
    setOrder(ids);
  };

  const handleTap = (tileId: TileId) => {
    if (!isDiscarding) return;
    if (tileId === selectedId) {
      onDiscard?.(tileId);
      setSelectedId(null);
    } else {
      setSelectedId(tileId);
    }
  };

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const row = rowRef.current;
    if (!row) return;
    const items = Array.from(row.querySelectorAll<HTMLElement>('[data-tile]'));
    const rects = items.map((el) => el.getBoundingClientRect());
    const pitch = rects.length > 1 && rects[0] && rects[1]
      ? rects[1].left - rects[0].left
      : (rects[0]?.width ?? size);
    e.currentTarget.setPointerCapture(e.pointerId);
    const tile = ordered[index];
    if (!tile) return;
    setDrag({ id: tile.id, from: index, startX: e.clientX, startY: e.clientY, pitch, dx: 0, dy: 0, target: index });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d) return d;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const target = Math.max(0, Math.min(n - 1, Math.round(d.from + dx / d.pitch)));
      return { ...d, dx, dy, target };
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag) {
      const absDx = Math.abs(drag.dx);
      const absDy = Math.abs(drag.dy);
      const wasTap = absDx < 5 && absDy < 5;

      if (wasTap) {
        // Pure tap: select / confirm discard.
        const tile = ordered[drag.from];
        if (tile) handleTap(tile.id);
      } else if (isDiscarding && drag.dy < -50 && absDy > absDx) {
        // Upward fling: direct discard without tap confirmation.
        const tile = ordered[drag.from];
        if (tile) {
          onDiscard?.(tile.id);
          setSelectedId(null);
        }
      } else {
        // Horizontal drag: reorder.
        moveTile(drag.from, drag.target);
      }
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    setDrag(null);
  };

  /** Transform for the tile at on-screen index i, given the current drag. */
  const tileTransform = (i: number): string | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) {
      // During an upward fling drag, follow the pointer vertically too.
      const isDiscardFling = isDiscarding && drag.dy < -10 && Math.abs(drag.dy) > Math.abs(drag.dx);
      if (isDiscardFling) return `translate(${drag.dx}px, ${drag.dy}px)`;
      return `translateX(${drag.dx}px)`;
    }
    if (drag.from < drag.target && i > drag.from && i <= drag.target) return `translateX(${-drag.pitch}px)`;
    if (drag.target < drag.from && i >= drag.target && i < drag.from) return `translateX(${drag.pitch}px)`;
    return undefined;
  };

  const hint = isDiscarding
    ? (selectedId ? 'tap again to discard, or drag up' : 'tap a tile to select, or drag up to discard')
    : 'drag tiles to rearrange · sort';

  return (
    <div className={`${styles.wrap} ${isDiscarding ? styles.discarding : ''}`}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.sortBtn} onClick={sortHand} title="Sort by suit then number">
          Sort
        </button>
        <span className={styles.hint}>{hint}</span>
        {onDeclareWin && (
          <button
            type="button"
            className={styles.mjBtn}
            onClick={onDeclareWin}
            title="Declare Mah Jong (self-draw win)"
          >
            Mah Jong!
          </button>
        )}
      </div>

      <div ref={rowRef} className={styles.row} role="list" aria-label="Your hand (drag to rearrange)">
        {ordered.map((tile, i) => {
          const isDragged = drag?.id === tile.id;
          const isSelected = tile.id === selectedId;
          const isDrawn = tile.id === drawnTileId;
          return (
            <div
              key={tile.id}
              data-tile
              role="listitem"
              className={`${styles.slot} ${isDragged ? styles.dragging : ''} ${isSelected && !isDragged ? styles.isSelected : ''}`}
              style={{ transform: tileTransform(i), touchAction: 'none' }}
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <TileView
                tile={tile}
                size={size}
                selected={isSelected}
                highlight={!isSelected && isDrawn ? 'gold' : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PlayerHand;
