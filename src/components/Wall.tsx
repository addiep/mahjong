/**
 * Module 2.3 (part) — UI: the Wall
 *
 * Renders the undrawn tiles as a square ring of face-down stacks around the
 * central table, two tiles high, exactly as the wall sits between the players
 * and the discards in a real game.
 *
 * It is one continuous wall drawn from both ends. Normal draws come off the
 * "live" end and the wall recedes from there, one tile at a time, in a
 * clockwise direction around the ring — every remaining tile stays exactly
 * where it is (nothing shifts). Loose tiles (kong / flower replacements)
 * simply come off the *other* end of the same wall; there is nothing special
 * about them beyond that, so they recede from the far end, anticlockwise
 * (the two ends of one linear strip, wrapped into a ring, necessarily recede
 * in opposite rotational senses).
 *
 * Each stack is two tiles: a darker bottom and a lighter top raised onto it. An
 * odd remaining count renders the front stack as a single bottom tile with half
 * the full-stack depth, so every individual draw is visible (the top goes, then
 * the bottom) and the remaining tile still reads as a 3D tile.
 *
 * Presentational only: it reads counts from the GameState wall; the discards are
 * passed as children and sit inset within the ring.
 *
 * Playtesting round 2 changes:
 * - Tile stacks enlarged to match face-up tile size (34x52 px, PITCH 36).
 * - Yellow next-tile border and arrow removed.
 *
 * Playtesting round 4 changes (2026-06-18):
 * - Wall capped at MAX_PER_SIDE (18) stacks per side — two layers of 18 = 36
 *   tiles per side maximum, matching a real game's wall layout on any screen.
 * - Single remaining tile (upper drawn) now shown with backHalfTop (−6 px)
 *   rather than a flat rectangle, so it reads as 3D. Full-stack depth increased
 *   from −8 px to −12 px for a clearer two-tile visual.
 *
 * Direction fix (2026-07-02): the live wall was receding anticlockwise, which
 * matched a mistaken 2026-06-18 decisions-log correction ("both directions are
 * the same"). Standard HK/Cantonese play has turn order anticlockwise but the
 * wall itself taken clockwise -- confirmed against MJrules.md's original intent
 * and external references (e.g. the classic "wall pushed out clockwise
 * beginning with East" rule). Fixed by swapping which end of `slots` the live
 * vs. dead segment is sliced from; see MJrules.md / DECISIONS.md for the
 * corrected entry.
 *
 * Todo B (2026-07-02): `startOffset` rotates the whole ring so the wall
 * doesn't always break at the same top-left corner. Purely cosmetic --
 * App passes a fresh random offset each hand.
 */

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import styles from './Wall.module.css';

const PITCH  = 36;  // spacing between stack centres along an edge
const MARGIN = 22;  // distance from the frame edge to a stack's centre line
const MAX_PER_SIDE = 18;  // max stacks per side (2 × 18 = 36 tiles per side)

interface Slot { readonly x: number; readonly y: number; readonly vertical: boolean; }

/** Stack positions around the rectangle perimeter, walking clockwise from top-left.
 *  Each side is capped at MAX_PER_SIDE stacks to match a real game wall. */
function perimeterSlots(w: number, h: number): Slot[] {
  const m = MARGIN;

  const top: Slot[] = [];
  for (let x = m; x <= w - m; x += PITCH) top.push({ x, y: m, vertical: false });

  const right: Slot[] = [];
  for (let y = m + PITCH; y <= h - m; y += PITCH) right.push({ x: w - m, y, vertical: true });

  const bottom: Slot[] = [];
  for (let x = w - m - PITCH; x >= m; x -= PITCH) bottom.push({ x, y: h - m, vertical: false });

  const left: Slot[] = [];
  for (let y = h - m - PITCH; y >= m + PITCH; y -= PITCH) left.push({ x: m, y, vertical: true });

  return [
    ...top.slice(0, MAX_PER_SIDE),
    ...right.slice(0, MAX_PER_SIDE),
    ...bottom.slice(0, MAX_PER_SIDE),
    ...left.slice(0, MAX_PER_SIDE),
  ];
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

/**
 * Renders one stack at a slot.
 *
 * Full stack (half=false): darker bottom tile + lighter top tile at −12 px.
 * Single remaining tile (half=true): darker bottom tile acts as a depth shadow;
 * a same-shade tile sits above it at −6 px (half depth) so it reads as 3D.
 */
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
      {half
        ? <span className={`${styles.backTile} ${styles.backHalfTop}`} />
        : <span className={`${styles.backTile} ${styles.backTop}`} />
      }
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
  /**
   * Rotates the perimeter ring by this many slots before slicing (Todo B).
   * Purely cosmetic -- changes which corner the wall appears to start/break
   * at; does not affect which direction it recedes in. Undefined/0 = the
   * original top-left start.
   */
  readonly startOffset?: number | undefined;
}

export function WallFrame({ liveCount, deadCount, children, startOffset }: WallFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(ref);
  const baseSlots = w > 0 && h > 0 ? perimeterSlots(w, h) : [];
  const cap = baseSlots.length;
  const offset = cap > 0 ? ((startOffset ?? 0) % cap + cap) % cap : 0;
  const slots = offset > 0 ? [...baseSlots.slice(offset), ...baseSlots.slice(0, offset)] : baseSlots;

  const liveStacks = Math.min(cap, Math.ceil(liveCount / 2));
  const deadStacks = Math.min(Math.max(0, cap - liveStacks), Math.ceil(deadCount / 2));

  return (
    <div
      ref={ref}
      className={styles.frame}
      aria-label={`Wall: ${liveCount + deadCount} tiles remaining`}
    >
      {/*
        Live wall: anchored at the far/high end (index cap-1) and recedes from
        its near edge (index cap-liveStacks) upward toward cap-1 as tiles are
        drawn -- increasing index walks the ring clockwise (see
        perimeterSlots), so normal draws deplete the wall clockwise.
      */}
      {slots.slice(cap - liveStacks).map((slot, i) => (
        <Stack
          key={`L${i}`}
          slot={slot}
          half={liveCount % 2 === 1 && i === 0}
        />
      ))}

      {/*
        Dead / loose-tile wall: anchored at the near/low end (index 0) and
        recedes from its high edge (index deadStacks-1) down toward 0 --
        decreasing index walks the ring anticlockwise, the opposite sense
        from the live wall, since the two are opposite ends of one strip.
      */}
      {deadStacks > 0 && slots.slice(0, deadStacks).map((slot, j) => (
        <Stack
          key={`D${j}`}
          slot={slot}
          half={deadCount % 2 === 1 && j === deadStacks - 1}
        />
      ))}

      <div className={styles.inner}>{children}</div>
    </div>
  );
}

export default WallFrame;
