/**
 * Module 2.3 (part) — UI: the Wall
 *
 * Renders the undrawn tiles as a square ring of face-down stacks around the
 * central table, two tiles high, exactly as the wall sits between the players
 * and the discards in a real game.
 *
 * It is one continuous wall drawn from both ends. Normal draws come off the
 * "live" end and the wall recedes from there, one tile at a time, starting at
 * the most-clockwise point — every remaining tile stays exactly where it is
 * (nothing shifts). Loose tiles (kong / flower replacements) simply come off
 * the *other* end of the same wall; there is nothing special about them beyond
 * that, so they are drawn identically and recede from the far end.
 *
 * Each stack is two tiles: a darker bottom and a lighter top raised onto it. An
 * odd remaining count renders the front stack as a single bottom tile, so every
 * individual draw is visible (the top goes, then the bottom).
 *
 * Presentational only: it reads counts from the GameState wall; the discards are
 * passed as children and sit inset within the ring.
 *
 * Playtesting round 2 changes:
 * - Tile stacks enlarged to match face-up tile size (34×52 px, PITCH 36).
 * - Yellow next-tile border and ↻ draw-point arrow removed.
 */

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import styles from './Wall.module.css';

const PITCH  = 36;  // spacing between stack centres along an edge
const MARGIN = 22;  // distance from the frame edge to a stack's centre line

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

/** Renders one stack at a slot: a darker bottom tile and (unless half) a lighter top. */
function Stack({ slot, half }: { slot: Slot; half: boolean }) {
  return (
    <div
      className={styles.stack}
      style={{
        left: `${slot.x}px`,
        top: `${slot.y}px`,
        transform: `translate(-50%, -50%) rotate(${slot.vertical ? 90 : 0}deg)`,
      }}
    >
      <span className={`${styles.backTile} ${styles.backBottom}`} />
      {!half && <span className={`${styles.backTile} ${styles.backTop}`} />}
    </div>
  );
}

export interface WallFrameProps {
  /** Live (normally drawable) tiles remaining; two tiles per stack. */
  readonly liveCount: number;
  /** Tiles remaining at the far end (the loose / kong-replacement end). */
  readonly deadCount: number;
  /** The discard pool, rendered inset within the ring. */
  readonly children: ReactNode;
}

export function WallFrame({ liveCount, deadCount, children }: WallFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(ref);
  const slots = w > 0 && h > 0 ? perimeterSlots(w, h) : [];
  const cap = slots.length;

  const liveStacks = Math.min(cap, Math.ceil(liveCount / 2));
  const deadStacks = Math.min(Math.max(0, cap - liveStacks), Math.ceil(deadCount / 2));

  return (
    <div
      ref={ref}
      className={styles.frame}
      aria-label={`Wall: ${liveCount + deadCount} tiles remaining`}
    >
      {slots.slice(0, liveStacks).map((slot, i) => (
        <Stack
          key={`L${i}`}
          slot={slot}
          half={liveCount % 2 === 1 && i === liveStacks - 1}
        />
      ))}

      {deadStacks > 0 && slots.slice(cap - deadStacks).map((slot, j) => (
        <Stack
          key={`D${cap - deadStacks + j}`}
          slot={slot}
          half={deadCount % 2 === 1 && j === 0}
        />
      ))}

      <div className={styles.inner}>{children}</div>
    </div>
  );
}

export default WallFrame;
