/**
 * Module 2.3 (part) — UI: the Wall
 *
 * Renders the undrawn tiles as a square ring of face-down stacks around the
 * central table, two tiles high, exactly as the wall sits between the players
 * and the discards in a real game (four rows of stacks pushed into a square).
 *
 * In Hong Kong mahjong two directions run at once: players take turns
 * anticlockwise, but tiles are drawn from the wall *clockwise*. So the ring is
 * laid out clockwise from the top-left, the next-to-draw stack is highlighted,
 * and a ↻ marks the draw direction. The number of stacks is bound to the live
 * wall count, so the ring recedes every time a tile is drawn.
 *
 * Presentational only: it reads `liveCount` from the GameState wall and renders;
 * the discards are passed as children and sit inset within the ring.
 */

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import styles from './Wall.module.css';

const PITCH = 22;   // spacing between stacks along an edge
const MARGIN = 16;  // distance from the frame edge to a stack's centre line

interface Slot { readonly x: number; readonly y: number; readonly vertical: boolean; }

/** Stack positions around the rectangle perimeter, walking clockwise from top-left. */
function perimeterSlots(w: number, h: number): Slot[] {
  const slots: Slot[] = [];
  const m = MARGIN;
  for (let x = m; x <= w - m; x += PITCH) slots.push({ x, y: m, vertical: false });            // top: L→R
  for (let y = m + PITCH; y <= h - m; y += PITCH) slots.push({ x: w - m, y, vertical: true });  // right: T→B
  for (let x = w - m - PITCH; x >= m; x -= PITCH) slots.push({ x, y: h - m, vertical: false });  // bottom: R→L
  for (let y = h - m - PITCH; y >= m + PITCH; y -= PITCH) slots.push({ x: m, y, vertical: true }); // left: B→T
  return slots;
}

function useElementSize<T extends HTMLElement>(ref: RefObject<T>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export interface WallFrameProps {
  /** Number of live (drawable) tiles remaining; two tiles per stack. */
  readonly liveCount: number;
  /** The discard pool, rendered inset within the ring. */
  readonly children: ReactNode;
}

export function WallFrame({ liveCount, children }: WallFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(ref);
  const slots = w > 0 && h > 0 ? perimeterSlots(w, h) : [];
  const nStacks = Math.min(slots.length, Math.ceil(liveCount / 2));
  const head = slots[0];

  return (
    <div ref={ref} className={styles.frame} aria-label={`Wall: ${liveCount} tiles remaining, drawn clockwise`}>
      {slots.slice(0, nStacks).map((s, i) => (
        <div
          key={i}
          className={styles.stack}
          style={{ left: `${s.x}px`, top: `${s.y}px`, transform: `translate(-50%, -50%) rotate(${s.vertical ? 90 : 0}deg)` }}
        >
          <span className={`${styles.backTile} ${styles.back2}`} />
          <span className={`${styles.backTile} ${i === 0 ? styles.drawNext : ''}`} />
        </div>
      ))}

      {head && nStacks > 0 && (
        <span
          className={styles.drawArrow}
          style={{ left: `${head.x + 14}px`, top: `${Math.max(8, head.y)}px` }}
          aria-hidden="true"
        >↻</span>
      )}

      <div className={styles.inner}>{children}</div>
    </div>
  );
}

export default WallFrame;
