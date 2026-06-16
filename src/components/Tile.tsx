/**
 * Module 2.1 — UI: Tile Component
 *
 * Renders any engine `Tile` as a self-contained, scalable SVG. No external
 * assets and no licensing concerns: every one of the 36 designs is drawn here
 * (Chinese numerals/characters as text, geometric pips for Dots, stick motifs
 * for Bamboo with a bird for the 1, and labelled bonus tiles). The tile face
 * uses fixed physical colours so it looks identical in light and dark mode.
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
  /** Draw a selection highlight around the tile. */
  readonly selected?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
  /** Accessible label; defaults to a generated description of the tile. */
  readonly ariaLabel?: string;
}

// ─── Palette (fixed physical colours; identical in light/dark mode) ─────────────

const COL = {
  faceFill: '#F7F4EA', faceEdge: '#CFC8B4', faceInner: '#E7E1D0', ink: '#2A2A22',
  corner: '#6B6657',
  red: '#C2362B', green: '#2E7D32', greenDk: '#1B5E20', blue: '#225E9B', navy: '#1F3A5F',
  purple: '#6E4FA3', amber: '#BD8A18', selected: '#2E7D32',
  back: '#1F6F5C', backEdge: '#15523F', backMotif: '#52A98F',
} as const;

const CJK = "'Noto Serif SC','Songti SC','SimSun','STSong',serif";

// ─── Pip / stick layouts (cx, cy within the 54×74 face) ─────────────────────────

const LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[27, 37]],
  2: [[27, 21], [27, 53]],
  3: [[14, 18], [27, 37], [40, 56]],
  4: [[16, 21], [38, 21], [16, 53], [38, 53]],
  5: [[16, 21], [38, 21], [27, 37], [16, 53], [38, 53]],
  6: [[16, 19], [38, 19], [16, 37], [38, 37], [16, 55], [38, 55]],
  7: [[14, 16], [27, 16], [40, 16], [16, 40], [38, 40], [16, 57], [38, 57]],
  8: [[16, 15], [16, 30], [16, 44], [16, 59], [38, 15], [38, 30], [38, 44], [38, 59]],
  9: [[14, 18], [27, 18], [40, 18], [14, 37], [27, 37], [40, 37], [14, 56], [27, 56], [40, 56]],
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
    <text x={9} y={12} fontFamily="sans-serif" fontSize={11} fontWeight={500} fill={COL.corner}
      textAnchor="middle" dominantBaseline="central">{text}</text>
  );
}

function Pip({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={4.9} fill={COL.blue} />
      <circle cx={cx} cy={cy} r={2.8} fill={COL.faceFill} />
      <circle cx={cx} cy={cy} r={1.4} fill={COL.red} />
    </g>
  );
}

function Stick({ cx, cy, colour }: { cx: number; cy: number; colour: string }) {
  return (
    <g>
      <rect x={cx - 2.8} y={cy - 8} width={5.6} height={16} rx={2.8} fill={colour} />
      <line x1={cx - 2.8} y1={cy - 2.5} x2={cx + 2.8} y2={cy - 2.5} stroke={COL.greenDk} strokeWidth={0.9} />
      <line x1={cx - 2.8} y1={cy + 2.5} x2={cx + 2.8} y2={cy + 2.5} stroke={COL.greenDk} strokeWidth={0.9} />
    </g>
  );
}

function Bird() {
  return (
    <g>
      <ellipse cx={27} cy={42} rx={11} ry={8} fill={COL.green} />
      <circle cx={34} cy={31} r={6} fill={COL.green} />
      <path d="M39 30 L46 28 L40 34 Z" fill={COL.amber} />
      <circle cx={35.5} cy={30} r={1.4} fill={COL.ink} />
      <path d="M16 40 Q9 36 8 47 Q15 46 19 44 Z" fill={COL.red} />
      <path d="M22 49 Q24 58 20 60 M30 49 Q31 58 27 60" stroke={COL.greenDk} strokeWidth={1.5} fill="none" />
      <path d="M20 44 Q27 50 34 45" stroke={COL.greenDk} strokeWidth={1} fill="none" />
    </g>
  );
}

function Badge({ n, colour }: { n: number; colour: string }) {
  return (
    <g>
      <circle cx={12} cy={13} r={7} fill={colour} />
      <text x={12} y={13} fontFamily="sans-serif" fontSize={9} fill="#fff" fontWeight={500}
        textAnchor="middle" dominantBaseline="central">{n}</text>
    </g>
  );
}

// ─── Per-category faces ─────────────────────────────────────────────────────────

function Characters({ value }: { value: SuitedValue }) {
  return (<>
    <CornerLabel text={String(value)} />
    <CjkGlyph ch={NUMERALS[value]} x={27} y={28} size={22} fill={COL.ink} />
    <CjkGlyph ch="萬" x={27} y={56} size={21} fill={COL.red} />
  </>);
}

function Dots({ value }: { value: SuitedValue }) {
  return <>{LAYOUTS[value]!.map(([cx, cy], i) => <Pip key={i} cx={cx} cy={cy} />)}</>;
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
    <CjkGlyph ch={w.glyph} x={28} y={40} size={29} fill={COL.navy} />
  </>);
}

function DragonFace({ dragon }: { dragon: Dragon }) {
  if (dragon === 'red') return <CjkGlyph ch="中" x={27} y={38} size={30} fill={COL.red} />;
  if (dragon === 'green') return <CjkGlyph ch="發" x={27} y={38} size={28} fill={COL.green} />;
  return (<>
    <rect x={13} y={15} width={28} height={44} rx={3} fill="none" stroke={COL.blue} strokeWidth={1.6} />
    <rect x={16.5} y={18.5} width={21} height={37} rx={2} fill="none" stroke={COL.blue} strokeWidth={0.8} />
  </>);
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
    <CjkGlyph ch={ch} x={28} y={41} size={26} fill={colour} />
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

// ─── Component ──────────────────────────────────────────────────────────────────

export function Tile({ tile, size = 74, faceDown = false, selected = false, onClick, className, ariaLabel }: TileProps) {
  const width = (size * 54) / 74;
  const label = faceDown ? 'face-down tile' : (ariaLabel ?? describe(tile));
  return (
    <svg
      viewBox="0 0 54 74" width={width} height={size} className={className}
      role="img" aria-label={label}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {faceDown ? (<>
        <rect x={1.5} y={1.5} width={51} height={71} rx={7} fill={COL.back} stroke={COL.backEdge} strokeWidth={1.5} />
        <rect x={14} y={24} width={26} height={26} rx={4} fill="none" stroke={COL.backMotif} strokeWidth={1.5} transform="rotate(45 27 37)" />
      </>) : (<>
        <rect x={1.5} y={1.5} width={51} height={71} rx={7} fill={COL.faceFill} stroke={COL.faceEdge} strokeWidth={1.5} />
        <rect x={5} y={5} width={44} height={64} rx={5} fill="none" stroke={COL.faceInner} strokeWidth={1} />
        <Face tile={tile} />
      </>)}
      {selected && (
        <rect x={1.5} y={1.5} width={51} height={71} rx={7} fill="none" stroke={COL.selected} strokeWidth={2.5} />
      )}
    </svg>
  );
}

export default Tile;
