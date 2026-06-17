/**
 * Module 2.2 — UI: Player Hand (interactive, local seat)
 *
 * The local player's concealed tiles, which they can drag to reorder — exactly
 * as you shuffle real tiles into pungs and runs in front of you. Reordering is
 * a view-only concern (see useHandOrder); the engine is never touched.
 *
 * Drag is built on pointer events (works with mouse and touch alike — no
 * library). The tiles form a single equal-width row, so the maths is 1-D: the
 * dragged tile follows the pointer via a translate from its grab point (no
 * array mutation mid-drag, so it never drifts), and the tiles it passes shift
 * by one slot to open a gap. The new order is committed on release.
 *
 * A one-tap Sort arranges the hand by suit then number as a tidy baseline.
 */

import { useRef, useState } from 'react';
import type { Tile, Suit, Wind, Dragon } from '@mahjong/engine';
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
  readonly pitch: number;
  dx: number;
  target: number;
}

export interface PlayerHandProps {
  readonly tiles: readonly Tile[];
  /** Tile height in px. Default 56. */
  readonly size?: number;
}

export function PlayerHand({ tiles, size = 56 }: PlayerHandProps) {
  const { ordered, setOrder, moveTile } = useHandOrder(tiles);
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const n = ordered.length;

  const sortHand = () => {
    const ids = [...ordered].sort((a, b) => compareKey(sortKey(a), sortKey(b))).map((t) => t.id);
    setOrder(ids);
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
    setDrag({ id: tile.id, from: index, startX: e.clientX, pitch, dx: 0, target: index });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d) return d;
      const dx = e.clientX - d.startX;
      const target = Math.max(0, Math.min(n - 1, Math.round(d.from + dx / d.pitch)));
      return { ...d, dx, target };
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag) {
      moveTile(drag.from, drag.target);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    setDrag(null);
  };

  /** Transform for the tile at on-screen index i, given the current drag. */
  const tileTransform = (i: number): string | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return `translateX(${drag.dx}px)`;
    if (drag.from < drag.target && i > drag.from && i <= drag.target) return `translateX(${-drag.pitch}px)`;
    if (drag.target < drag.from && i >= drag.target && i < drag.from) return `translateX(${drag.pitch}px)`;
    return undefined;
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.sortBtn} onClick={sortHand} title="Sort by suit then number">
          Sort
        </button>
        <span className={styles.hint}>drag tiles to rearrange</span>
      </div>

      <div ref={rowRef} className={styles.row} role="list" aria-label="Your hand (drag to rearrange)">
        {ordered.map((tile, i) => {
          const isDragged = drag?.id === tile.id;
          return (
            <div
              key={tile.id}
              data-tile
              role="listitem"
              className={`${styles.slot} ${isDragged ? styles.dragging : ''}`}
              style={{ transform: tileTransform(i), touchAction: 'none' }}
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <TileView tile={tile} size={size} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PlayerHand;
