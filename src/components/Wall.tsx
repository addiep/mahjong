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
 * and a ↻ marks the draw direction.
 *
 * Each stack is two tiles: a darker bottom tile and a lighter top tile raised to
 * sit on it. The stack count is bound to the live wall, and an odd remainder is
 * drawn as a single bottom tile at the front — so every individual draw produces
 * a visible change (top tile gone, then the bottom).
 *
 * The dead wall (reserved kong / flower replacements) is shown as a small tray
 * at the top, with the two "loose" tiles kept topped up from the reserve.
 *
 * Presentational only: it reads counts from the GameState wall and renders; the
 * discards are passed as children and sit inset within the ring.
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
  /** Number of tiles reserved in the dead wall (kong / flower replacements). */
  readonly deadCount: number;
  /** The discard pool, rendered inset within the ring. */
  readonly children: ReactNode;
}

export function WallFrame({ liveCount, deadCount, children }: WallFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(ref);
  const slots = w > 0 && h > 0 ? perimeterSlots(w, h) : [];

  const odd = liveCount % 2 === 1;
  const nStacks = Math.min(slots.length, Math.ceil(liveCount / 2));

  // The two loose tiles are kept topped up from the dead-wall reserve.
  const looseCount = Math.max(0, Math.min(2, deadCount));
  const deadStacks = Math.max(0, Math.ceil((deadCount - looseCount) / 2));

  return (
    <div
      ref={ref}
      className={styles.frame}
      aria-label={`Wall: ${liveCount} live tiles, ${deadCount} in the dead wall, drawn clockwise`}
    >
      {slots.slice(0, nStacks).map((s, i) => {
        const isHalf = odd && i === 0; // front stack: its top tile has been drawn
        return (
          <div
            key={i}
            className={styles.stack}
            style={{ left: `${s.x}px`, top: `${s.y}px`, transform: `translate(-50%, -50%) rotate(${s.vertical ? 90 : 0}deg)` }}
          >
            <span className={`${styles.backTile} ${styles.backBottom} ${i === 0 && isHalf ? styles.drawNext : ''}`} />
            {!isHalf && <span className={`${styles.backTile} ${styles.backTop} ${i === 0 ? styles.drawNext : ''}`} />}
          </div>
        );
      })}

      {nStacks > 0 && slots[0] && (
        <span
          className={styles.drawArrow}
          style={{ left: `${slots[0].x + 14}px`, top: `${Math.max(8, slots[0].y)}px` }}
          aria-hidden="true"
        >↻</span>
      )}

      <div
        className={styles.kongBox}
        title="Dead wall — kong and flower replacements. The two loose tiles are topped up from the dead wall."
      >
        <span className={styles.kongLabel}>dead</span>
        <div className={styles.kongRun}>
          {Array.from({ length: deadStacks }).map((_, i) => <span key={i} className={styles.deadMini} />)}
        </div>
        <span className={styles.kongLabel}>loose</span>
        <div className={styles.kongRun}>
          {Array.from({ length: looseCount }).map((_, i) => <span key={i} className={styles.looseTile} />)}
        </div>
      </div>

      <div className={styles.inner}>{children}</div>
    </div>
  );
}

export default WallFrame;
