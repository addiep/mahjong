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
 * In Hong Kong mahjong players take turns anticlockwise but tiles leave the wall
 * clockwise, so a ↻ marks the live (normal) draw point.
 *
 * Each stack is two tiles: a darker bottom and a lighter top raised onto it. An
 * odd remaining count renders the front stack as a single bottom tile, so every
 * individual draw is visible (the top goes, then the bottom).
 *
 * Presentational only: it reads counts from the GameState wall; the discards are
 * passed as children and sit inset within the ring.
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

/** Renders one stack at a slot: a darker bottom tile and (unless half) a lighter top. */
function Stack({ slot, half, front }: { slot: Slot; half: boolean; front: boolean }) {
  return (
    <div
      className={styles.stack}
      style={{ left: `${slot.x}px`, top: `${slot.y}px`, transform: `translate(-50%, -50%) rotate(${slot.vertical ? 90 : 0}deg)` }}
    >
      <span className={`${styles.backTile} ${styles.backBottom} ${front && half ? styles.drawNext : ''}`} />
      {!half && <span className={`${styles.backTile} ${styles.backTop} ${front ? styles.drawNext : ''}`} />}
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

  // Live wall fills from the start (slot 0) and is drawn from its far, most-
  // clockwise end. The loose end fills from the last slot inward and is drawn
  // from its inner end. Each is anchored at the end it is NOT drawn from, so
  // remaining tiles never move.
  const liveStacks = Math.min(cap, Math.ceil(liveCount / 2));
  const deadStacks = Math.min(Math.max(0, cap - liveStacks), Math.ceil(deadCount / 2));
  const liveFront = liveStacks - 1;
  const liveArrow = slots[liveFront];

  return (
    <div
      ref={ref}
      className={styles.frame}
      aria-label={`Wall: ${liveCount + deadCount} tiles remaining, drawn clockwise`}
    >
      {slots.slice(0, liveStacks).map((slot, i) => (
        <Stack key={`L${i}`} slot={slot} half={liveCount % 2 === 1 && i === liveFront} front={i === liveFront} />
      ))}

      {deadStacks > 0 && slots.slice(cap - deadStacks).map((slot, j) => (
        <Stack key={`D${cap - deadStacks + j}`} slot={slot} half={deadCount % 2 === 1 && j === 0} front={j === 0} />
      ))}

      {liveStacks > 0 && liveArrow && (
        <span
          className={styles.drawArrow}
          style={{ left: `${liveArrow.x + 14}px`, top: `${Math.max(8, liveArrow.y)}px` }}
          aria-hidden="true"
        >↻</span>
      )}

      <div className={styles.inner}>{children}</div>
    </div>
  );
}

export default WallFrame;
