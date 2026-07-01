/**
 * Module 2.1 — UI: Tile Component (visual polish pass, Module 2.7)
 *
 * Renders any engine `Tile` as a self-contained, scalable SVG. No external
 * assets and no licensing concerns: every one of the 36 designs is drawn here
 * (Chinese numerals/characters as text, rosette pips for Dots, jointed stick
 * motifs for Bamboo with a bird for the 1, and labelled bonus tiles). The tile
 * face uses fixed physical colours so it looks identical in light and dark mode.
 *
 * Visual polish (2026-07-01): tiles are drawn as physical objects — an ivory
 * face layer with a subtle vertical gradient and bevel sits on a coloured
 * resin base that shows along the bottom edge (the classic two-layer tile).
 * Dots are proper rosettes (the 1-Dot a large ornate one), Bamboo sticks are
 * jointed capsules, the White Dragon has a stepped frame, and the face-down
 * back carries a lattice motif on the reversed layer scheme.
 *
 * Characters carry a small Latin digit (1–9) and Winds an E/S/W/N letter in the
 * corner, so players who can't read the Chinese can still identify them at a glance.
 *
 * Resolves OQ-6 (custom SVG over scraped imagery or Unicode glyphs).
 *
 * Dependencies: @mahjong/engine (Tile type only). No engine logic imported.
 */

import React from 'react';
import type { Tile, SuitedValue, Wind, Dragon, Flower, Season } from '@mahjong/engine';

export interface TileProps {
  /** The engine tile to render. */
  readonly tile: Tile;
  /** Rendered height in px; width scales to keep the 54:74 ratio. Default 74. */
  readonly size?: number;
  /** Render the tile face-down (back pattern) instead of its face. */
  readonly faceDown?: boolean;
  /** Draw a selection highlight around the tile (green). */
  readonly selected?: boolean;
  /**
   * Draw a coloured highlight border:
   * - 'gold'  — newly drawn tile
   * - 'red'   — most recently discarded tile (claim window)
   */
  readonly highlight?: 'gold' | 'red' | undefined;
  readonly onClick?: () => void;
  readonly className?: string;
  /** Accessible label; defaults to a generated description of the tile. */
  readonly ariaLabel?: string;
}

// ─── Palette (fixed physical colours; identical in light/dark mode) ─────────────

const COL = {
  faceHi: '#FBF8EF', faceFill: '#F4F0E2', faceLo: '#E9E3D0',
  faceEdge: '#C6BEA6', bevelHi: '#FFFFFF', bevelLo: '#D8D1BC', ink: '#2A2A22',
  corner: '#6B6657',
  baseHi: '#2E8A70', baseLo: '#1B5646', baseEdge: '#123F34',
  red: '#C2362B', redDk: '#8E2118',
  green: '#2E7D32', greenDk: '#1B5E20', greenHi: '#4C9B50',
  blue: '#225E9B', navy: '#1F3A5F',
  purple: '#6E4FA3', amber: '#BD8A18', selected: '#2E7D32',
  backHi: '#27836C', backFill: '#1F6F5C', backLo: '#164F41', backEdge: '#0F3B30',
  backMotif: '#57B294', backMotifDim: '#3D8F76',
  gold: '#D4A017', highlightRed: '#C2362B',
} as const;

const CJK = "'Noto Serif SC','Songti SC','SimSun','STSong',serif";

// ─── Pip / stick layouts (cx, cy within the 54×74 face) ─────────────────────────

const LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[27, 35]],
  2: [[27, 20], [27, 50]],
  3: [[14, 17], [27, 35], [40, 53]],
  4: [[16, 20], [38, 20], [16, 50], [38, 50]],
  5: [[16, 20], [38, 20], [27, 35], [16, 50], [38, 50]],
  6: [[16, 18], [38, 18], [16, 35], [38, 35], [16, 52], [38, 52]],
  7: [[14, 15], [27, 15], [40, 15], [16, 38], [38, 38], [16, 54], [38, 54]],
  8: [[16, 13], [16, 28], [16, 43], [16, 58], [38, 13], [38, 28], [38, 43], [38, 58]],
  9: [[14, 17], [27, 17], [40, 17], [14, 35], [27, 35], [40, 35], [14, 53], [27, 53], [40, 53]],
};

const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

// ─── Drawing helpers ────────────────────────────────────────────────────────────

function CjkGlyph({ ch, x, y, size, fill }: { ch: string; x: number; y: number; size: number; fill: string }) {
  return (
    <text x={x} y={y} fontFamily={CJK} fontSize={size} fill={fill} fontWeight={500}
      textAnchor="middle" dominantBaseline="central">{ch}</text>
  );
}

/** Small Latin label in the top-left corner (digit for Characters, letter for Winds). */
function CornerLabel({ text }: { text: string }) {
  return (
    <text x={9} y={11} fontFamily="sans-serif" fontSize={10} fontWeight={600} fill={COL.corner}
      textAnchor="middle" dominantBaseline="central">{text}</text>
  );
}

/**
 * A dot pip drawn as a rosette: outer ring, a circle of petals, and a red
 * centre — much closer to real circle tiles than plain concentric rings.
 */
function Pip({ cx, cy, r = 5.4 }: { cx: number; cy: number; r?: number }) {
  const petals = 6;
  const petalR = r * 0.62;
  const petalSize = r * 0.30;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={COL.blue} />
      <circle cx={cx} cy={cy} r={r * 0.82} fill={COL.faceFill} />
      {Array.from({ length: petals }, (_, i) => {
        const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle key={i}
            cx={cx + Math.cos(a) * petalR} cy={cy + Math.sin(a) * petalR}
            r={petalSize} fill={i % 2 === 0 ? COL.green : COL.blue} />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.3} fill={COL.red} />
    </g>
  );
}

/** The 1-Dot: a single large ornate rosette filling the face. */
function BigPip() {
  const cx = 27, cy = 36;
  const petals = 8;
  return (
    <g>
      <circle cx={cx} cy={cy} r={17.5} fill={COL.blue} />
      <circle cx={cx} cy={cy} r={16} fill={COL.faceFill} />
      <circle cx={cx} cy={cy} r={13.5} fill="none" stroke={COL.blue} strokeWidth={0.8}
        strokeDasharray="2.4 1.6" />
      {Array.from({ length: petals }, (_, i) => {
        const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
        return (
          <g key={i}>
            <circle cx={cx + Math.cos(a) * 10} cy={cy + Math.sin(a) * 10} r={2.6}
              fill={i % 2 === 0 ? COL.red : COL.green} />
            <circle cx={cx + Math.cos(a) * 10} cy={cy + Math.sin(a) * 10} r={1.1}
              fill={COL.faceFill} />
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={5} fill={COL.red} />
      <circle cx={cx} cy={cy} r={3.2} fill={COL.amber} />
      <circle cx={cx} cy={cy} r={1.5} fill={COL.red} />
    </g>
  );
}

/**
 * A bamboo stick drawn as two jointed capsule segments with a node band and a
 * light highlight, rather than a flat rounded rectangle.
 */
function Stick({ cx, cy, colour }: { cx: number; cy: number; colour: string }) {
  const dark = colour === COL.red ? COL.redDk : COL.greenDk;
  const hi = colour === COL.red ? '#E06B5F' : COL.greenHi;
  return (
    <g>
      {/* two capsule segments (total height 11 so dense layouts never touch) */}
      <rect x={cx - 2.5} y={cy - 5.5} width={5} height={4.9} rx={1.8} fill={colour} stroke={dark} strokeWidth={0.5} />
      <rect x={cx - 2.5} y={cy + 0.6} width={5} height={4.9} rx={1.8} fill={colour} stroke={dark} strokeWidth={0.5} />
      {/* node band */}
      <rect x={cx - 3} y={cy - 0.8} width={6} height={1.6} rx={0.8} fill={dark} />
      {/* highlight */}
      <line x1={cx - 1.1} y1={cy - 4.3} x2={cx - 1.1} y2={cy - 1.6} stroke={hi} strokeWidth={0.8} strokeLinecap="round" />
      <line x1={cx - 1.1} y1={cy + 1.8} x2={cx - 1.1} y2={cy + 4.5} stroke={hi} strokeWidth={0.8} strokeLinecap="round" />
    </g>
  );
}

/** The 1-Bamboo bird (a sparrow perched on a bamboo shoot). */
function Bird() {
  return (
    <g>
      {/* bamboo shoot it perches on */}
      <rect x={12} y={52} width={30} height={3.6} rx={1.8} fill={COL.green} stroke={COL.greenDk} strokeWidth={0.6} />
      <rect x={25} y={51.4} width={4} height={4.8} rx={1} fill={COL.greenDk} />
      {/* tail feathers */}
      <path d="M14 42 Q5 36 6 48 Q12 47 18 44 Z" fill={COL.red} stroke={COL.redDk} strokeWidth={0.6} />
      <path d="M15 44 Q8 42 8 50 Q14 49 19 46 Z" fill={COL.amber} stroke={COL.redDk} strokeWidth={0.4} />
      {/* body */}
      <path d="M16 40 Q16 31 25 30 Q36 29 37 38 Q37 47 27 48 Q17 48 16 40 Z"
        fill={COL.green} stroke={COL.greenDk} strokeWidth={0.8} />
      {/* wing */}
      <path d="M20 38 Q26 33 33 37 Q28 43 21 42 Q19 40 20 38 Z"
        fill={COL.greenDk} opacity={0.85} />
      <path d="M22 39.5 Q27 36 31 38.5" stroke={COL.greenHi} strokeWidth={0.8} fill="none" />
      {/* head */}
      <circle cx={36} cy={28} r={6.2} fill={COL.green} stroke={COL.greenDk} strokeWidth={0.8} />
      {/* beak */}
      <path d="M41.5 26.5 L48.5 25 L42.5 30.5 Z" fill={COL.amber} stroke={COL.redDk} strokeWidth={0.4} />
      {/* eye */}
      <circle cx={37.5} cy={27} r={1.6} fill="#fff" />
      <circle cx={37.9} cy={27.2} r={0.9} fill={COL.ink} />
      {/* legs */}
      <path d="M24 48 L23 52.5 M29 48 L29.5 52.5" stroke={COL.redDk} strokeWidth={1.3} strokeLinecap="round" />
    </g>
  );
}

function Badge({ n, colour }: { n: number; colour: string }) {
  return (
    <g>
      <circle cx={12} cy={13} r={7} fill={colour} />
      <circle cx={12} cy={13} r={7} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.8} />
      <text x={12} y={13} fontFamily="sans-serif" fontSize={9} fill="#fff" fontWeight={600}
        textAnchor="middle" dominantBaseline="central">{n}</text>
    </g>
  );
}

// ─── Per-category faces ─────────────────────────────────────────────────────────

function Characters({ value }: { value: SuitedValue }) {
  return (<>
    <CornerLabel text={String(value)} />
    <CjkGlyph ch={NUMERALS[value]} x={27} y={26} size={22} fill={COL.ink} />
    <CjkGlyph ch="萬" x={27} y={52} size={22} fill={COL.red} />
  </>);
}

function Dots({ value }: { value: SuitedValue }) {
  if (value === 1) return <BigPip />;
  const r = value >= 8 ? 4.6 : value >= 6 ? 5.0 : 5.6;
  return <>{LAYOUTS[value]!.map(([cx, cy], i) => <Pip key={i} cx={cx} cy={cy} r={r} />)}</>;
}

function Bamboo({ value }: { value: SuitedValue }) {
  if (value === 1) return <Bird />;
  return <>{LAYOUTS[value]!.map(([cx, cy], i) => {
    const centre = cx === 27 && (value === 5 || value === 7 || value === 9);
    return <Stick key={i} cx={cx} cy={cy} colour={centre ? COL.red : COL.green} />;
  })}</>;
}

const WINDS: Record<Wind, { glyph: string; letter: string }> = {
  east: { glyph: '東', letter: 'E' },
  south: { glyph: '南', letter: 'S' },
  west: { glyph: '西', letter: 'W' },
  north: { glyph: '北', letter: 'N' },
};

function WindFace({ wind }: { wind: Wind }) {
  const w = WINDS[wind];
  return (<>
    <CornerLabel text={w.letter} />
    <circle cx={27} cy={37} r={19} fill="none" stroke={COL.navy} strokeWidth={0.9} opacity={0.35} />
    <CjkGlyph ch={w.glyph} x={27} y={37} size={28} fill={COL.navy} />
  </>);
}

/** The White Dragon's classic stepped frame. */
function WhiteDragonFrame() {
  // A rectangular frame with notched (stepped) corners, drawn as one path.
  const outer = `
    M 18 12 H 36 V 16 H 40 V 20 H 44 V 54 H 40 V 58 H 36 V 62 H 18 V 58 H 14 V 54 H 10 V 20 H 14 V 16 H 18 Z`;
  const inner = `
    M 20.5 17 H 33.5 V 20.5 H 37 V 24 H 39 V 50 H 37 V 53.5 H 33.5 V 57 H 20.5 V 53.5 H 17 V 50 H 15 V 24 H 17 V 20.5 H 20.5 Z`;
  return (
    <g>
      <path d={outer} fill="none" stroke={COL.blue} strokeWidth={2} strokeLinejoin="miter" />
      <path d={inner} fill="none" stroke={COL.blue} strokeWidth={0.9} strokeLinejoin="miter" opacity={0.75} />
    </g>
  );
}

function DragonFace({ dragon }: { dragon: Dragon }) {
  if (dragon === 'red') return <CjkGlyph ch="中" x={27} y={36} size={31} fill={COL.red} />;
  if (dragon === 'green') return <CjkGlyph ch="發" x={27} y={36} size={29} fill={COL.green} />;
  return <WhiteDragonFrame />;
}

const FLOWER: Record<Flower, { ch: string; colour: string; index: number }> = {
  plum: { ch: '梅', colour: COL.red, index: 1 },
  orchid: { ch: '蘭', colour: COL.purple, index: 2 },
  chrysanthemum: { ch: '菊', colour: COL.amber, index: 3 },
  bamboo: { ch: '竹', colour: COL.green, index: 4 },
};

const SEASON: Record<Season, { ch: string; colour: string; index: number }> = {
  spring: { ch: '春', colour: COL.green, index: 1 },
  summer: { ch: '夏', colour: COL.red, index: 2 },
  autumn: { ch: '秋', colour: COL.amber, index: 3 },
  winter: { ch: '冬', colour: COL.blue, index: 4 },
};

function BonusFace({ ch, colour, index }: { ch: string; colour: string; index: number }) {
  return (<>
    <Badge n={index} colour={colour} />
    {/* a soft petal wash behind the glyph so bonus tiles read as special */}
    <g opacity={0.14}>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return <ellipse key={i} cx={27 + Math.cos(a) * 9} cy={39 + Math.sin(a) * 9}
          rx={7} ry={4.5} fill={colour}
          transform={`rotate(${(a * 180) / Math.PI + 90} ${27 + Math.cos(a) * 9} ${39 + Math.sin(a) * 9})`} />;
      })}
    </g>
    <CjkGlyph ch={ch} x={27} y={39} size={26} fill={colour} />
  </>);
}

// ─── Accessible label ───────────────────────────────────────────────────────────

function describe(tile: Tile): string {
  switch (tile.category) {
    case 'suited': return `${tile.value} of ${tile.suit}`;
    case 'wind': return `${tile.wind} wind`;
    case 'dragon': return `${tile.dragon} dragon`;
    case 'flower': return `${tile.flower} flower`;
    case 'season': return `${tile.season} season`;
    default: { const _exhaustive: never = tile; return _exhaustive; }
  }
}

function Face({ tile }: { tile: Tile }): React.ReactElement {
  switch (tile.category) {
    case 'suited':
      if (tile.suit === 'characters') return <Characters value={tile.value} />;
      if (tile.suit === 'circles') return <Dots value={tile.value} />;
      return <Bamboo value={tile.value} />;
    case 'wind': return <WindFace wind={tile.wind} />;
    case 'dragon': return <DragonFace dragon={tile.dragon} />;
    case 'flower': { const f = FLOWER[tile.flower]; return <BonusFace ch={f.ch} colour={f.colour} index={f.index} />; }
    case 'season': { const s = SEASON[tile.season]; return <BonusFace ch={s.ch} colour={s.colour} index={s.index} />; }
    default: { const _exhaustive: never = tile; return _exhaustive; }
  }
}

// ─── Shared defs (gradients). Duplicate IDs across tile instances are fine:
//     every instance defines identical gradients, so whichever the browser
//     resolves, the result is the same. ───────────────────────────────────────────

function Defs() {
  return (
    <defs>
      <linearGradient id="mjFace" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={COL.faceHi} />
        <stop offset="0.55" stopColor={COL.faceFill} />
        <stop offset="1" stopColor={COL.faceLo} />
      </linearGradient>
      <linearGradient id="mjBase" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={COL.baseHi} />
        <stop offset="1" stopColor={COL.baseLo} />
      </linearGradient>
      <linearGradient id="mjBack" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={COL.backHi} />
        <stop offset="0.6" stopColor={COL.backFill} />
        <stop offset="1" stopColor={COL.backLo} />
      </linearGradient>
    </defs>
  );
}

/** The physical tile body: coloured resin base with the ivory face layer on top. */
function TileBody() {
  return (
    <g>
      {/* resin base — its colour shows along the bottom edge */}
      <rect x={1} y={1} width={52} height={72} rx={7} fill="url(#mjBase)" stroke={COL.baseEdge} strokeWidth={1} />
      {/* ivory face layer */}
      <rect x={1} y={1} width={52} height={66.5} rx={6.5} fill="url(#mjFace)" stroke={COL.faceEdge} strokeWidth={1} />
      {/* bevel: light along the top-left of the face, shade along its foot */}
      <path d="M 7 2.6 H 47 Q 51.4 2.6 51.4 7" fill="none" stroke={COL.bevelHi} strokeWidth={1.2} opacity={0.75} strokeLinecap="round" />
      <path d="M 2.6 7 Q 2.6 2.6 7 2.6" fill="none" stroke={COL.bevelHi} strokeWidth={1.2} opacity={0.75} strokeLinecap="round" />
      <line x1={3} y1={66.4} x2={51} y2={66.4} stroke={COL.bevelLo} strokeWidth={1.4} opacity={0.9} />
      {/* thin seam highlight where face meets base */}
      <line x1={3} y1={68.2} x2={51} y2={68.2} stroke="rgba(255,255,255,0.28)" strokeWidth={0.7} />
    </g>
  );
}

/** The face-down body: back colour on top, the ivory layer showing at the foot. */
function TileBackBody() {
  return (
    <g>
      {/* ivory base peeking along the bottom edge */}
      <rect x={1} y={1} width={52} height={72} rx={7} fill={COL.faceLo} stroke={COL.faceEdge} strokeWidth={1} />
      {/* back layer */}
      <rect x={1} y={1} width={52} height={66.5} rx={6.5} fill="url(#mjBack)" stroke={COL.backEdge} strokeWidth={1} />
      {/* bevel light */}
      <path d="M 7 2.6 H 47 Q 51.4 2.6 51.4 7" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} strokeLinecap="round" />
      {/* lattice motif */}
      <g stroke={COL.backMotifDim} strokeWidth={1} fill="none">
        <rect x={15} y={22} width={24} height={24} rx={3} transform="rotate(45 27 34)" />
        <rect x={19.5} y={26.5} width={15} height={15} rx={2} transform="rotate(45 27 34)" stroke={COL.backMotif} />
      </g>
      <circle cx={27} cy={34} r={2.2} fill={COL.backMotif} />
      <circle cx={27} cy={12} r={1.2} fill={COL.backMotifDim} />
      <circle cx={27} cy={56} r={1.2} fill={COL.backMotifDim} />
      <circle cx={9} cy={34} r={1.2} fill={COL.backMotifDim} />
      <circle cx={45} cy={34} r={1.2} fill={COL.backMotifDim} />
    </g>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function Tile({ tile, size = 74, faceDown = false, selected = false, highlight, onClick, className, ariaLabel }: TileProps) {
  const width = (size * 54) / 74;
  const label = faceDown ? 'face-down tile' : (ariaLabel ?? describe(tile));
  const highlightColour = highlight === 'gold' ? COL.gold : highlight === 'red' ? COL.highlightRed : null;
  return (
    <svg
      viewBox="0 0 54 74" width={width} height={size} className={className}
      role="img" aria-label={label}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <Defs />
      {faceDown ? <TileBackBody /> : (<>
        <TileBody />
        <Face tile={tile} />
      </>)}
      {selected && (
        <rect x={1.5} y={1.5} width={51} height={71} rx={7} fill="none" stroke={COL.selected} strokeWidth={2.5} />
      )}
      {highlightColour && !selected && (<>
        <rect x={1} y={1} width={52} height={72} rx={7.5} fill="none" stroke={highlightColour} strokeWidth={3.5} />
        <rect x={2.8} y={2.8} width={48.4} height={68.4} rx={6} fill="none" stroke={highlightColour} strokeWidth={1.2} opacity={0.45} />
      </>)}
    </svg>
  );
}

export default Tile;
