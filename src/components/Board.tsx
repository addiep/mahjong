/**
 * Module 2.0 — UI: Board Layout
 *
 * The structural shell for a pass-and-play table. `Board` is a pure,
 * presentational component driven entirely by a `GameState` prop: it arranges
 * the four (or three) seats around a central table and lays out the regions the
 * later UI modules fill in.
 *
 * Region ownership:
 *   - Seat panels (name, wind, score, exposed melds + bonus, concealed hand).
 *     The local seat's concealed hand is the interactive, reorderable
 *     PlayerHand (Module 2.2); other seats render a static strip. Exposed melds
 *     sit towards the centre (above the hand for the bottom/top seats).
 *   - Central table: the wall (face-down ring drawn from both ends, Module 2.3)
 *     frames the discards, which scatter without overlapping.
 *   - Action bar (below the local seat) — Module 2.4.
 *   - Score panel (corner) — Module 2.5 (placeholder here).
 *
 * The board adapts to 3- or 4-player games (the engine supports both): with
 * three players the seat opposite is dropped. The local seat (the player to
 * show at the bottom) defaults to whoever's turn it is.
 *
 * Updated Module 2.2: accepts onDiscard and threads isDiscarding + onDiscard
 * into the interactive seat's PlayerHand.
 * Updated Module 2.4: accepts onClaimResponse and renders ActionBar.
 *
 * Dependencies: @mahjong/engine (types only), Tile (Module 2.1), PlayerHand
 * (Module 2.2), WallFrame (Module 2.3), ActionBar (Module 2.4).
 * No engine logic and no game mutation here.
 */

import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import type {
  GameState, PlayerState, SeatIndex, Wind, DeclaredMeld, TileId, ClaimDecision,
} from '@mahjong/engine';
import { Tile } from './Tile';
import { PlayerHand } from './PlayerHand';
import { WallFrame } from './Wall';
import { ActionBar } from './ActionBar';
import styles from './Board.module.css';

type SeatPosition = 'bottom' | 'right' | 'top' | 'left';

const WIND_LABEL: Record<Wind, string> = {
  east: 'East', south: 'South', west: 'West', north: 'North',
};

/** Where each seat sits on screen, by its offset (anticlockwise) from the local seat. */
function seatPositions(playerCount: number): SeatPosition[] {
  return playerCount === 3
    ? ['bottom', 'right', 'left']
    : ['bottom', 'right', 'top', 'left'];
}

export interface BoardProps {
  readonly state: GameState;
  /** Which seat to show at the bottom of the board. Defaults to the current turn. */
  readonly localSeat?: SeatIndex;
  /**
   * Reveal every player's concealed tiles (pass-and-play on one screen).
   * When false, only the local seat's hand is face-up. Defaults to true.
   */
  readonly revealAll?: boolean;
  /**
   * Called with the tile ID to discard. Provided by App only during the
   * DISCARDING phase; undefined otherwise so the hand is not interactive.
   */
  readonly onDiscard?: (tileId: TileId) => void;
  /**
   * Called when a player responds to a claim window (CLAIM_WINDOW or
   * ROBBING_KONG phase). Provided by App; the ActionBar component uses it.
   */
  readonly onClaimResponse?: (seat: SeatIndex, decision: ClaimDecision) => void;
}

export function Board({ state, localSeat, revealAll = true, onDiscard, onClaimResponse }: BoardProps) {
  const { players, config, currentSeat, phase } = state;
  const base = localSeat ?? currentSeat;
  const positions = seatPositions(config.playerCount);

  // Map each on-screen position to the seat that occupies it.
  const seatByPosition = new Map<SeatPosition, PlayerState>();
  for (const player of players) {
    const offset = (player.seat - base + config.playerCount) % config.playerCount;
    const position = positions[offset];
    if (position) seatByPosition.set(position, player);
  }

  const renderSeat = (position: SeatPosition) => {
    const player = seatByPosition.get(position);
    if (!player) return <div className={styles.seatEmpty} aria-hidden="true" />;
    const isInteractive = player.seat === base;
    // isDiscarding: it's this player's turn, they're the interactive (bottom)
    // seat, and the engine is waiting for a discard.
    const isDiscarding = isInteractive && phase === 'DISCARDING' && player.seat === currentSeat;
    return (
      <SeatPanel
        player={player}
        position={position}
        isCurrent={player.seat === currentSeat}
        faceDown={!revealAll && player.seat !== base}
        interactive={isInteractive}
        isDiscarding={isDiscarding}
        onDiscard={isInteractive ? onDiscard : undefined}
      />
    );
  };

  return (
    <div
      className={styles.board}
      data-players={config.playerCount}
      role="group"
      aria-label={`Mah Jong table, ${config.playerCount} players`}
    >
      <ScorePanel players={players} prevailingWind={state.prevailingWind} handNumber={state.handNumber} />

      <div className={styles.slotTop}>{renderSeat('top')}</div>
      <div className={styles.slotLeft}>{renderSeat('left')}</div>
      <div className={styles.slotRight}>{renderSeat('right')}</div>

      <div className={styles.slotCentre}>
        <DiscardArea state={state} />
      </div>

      <div className={styles.slotBottom}>
        {renderSeat('bottom')}
        {onClaimResponse && (
          <ActionBar state={state} onClaim={onClaimResponse} />
        )}
      </div>
    </div>
  );
}

// ─── Seat panel ─────────────────────────────────────────────────────────────────

function SeatPanel({
  player, position, isCurrent, faceDown, interactive, isDiscarding, onDiscard,
}: {
  player: PlayerState;
  position: SeatPosition;
  isCurrent: boolean;
  faceDown: boolean;
  interactive: boolean;
  isDiscarding?: boolean;
  onDiscard?: (tileId: TileId) => void;
}) {
  const vertical = position === 'left' || position === 'right';
  const handSize = position === 'bottom' ? 56 : 40;

  const handBlock = interactive && !faceDown ? (
    <PlayerHand
      tiles={player.concealed}
      size={handSize}
      isDiscarding={isDiscarding}
      onDiscard={onDiscard}
    />
  ) : (
    <div className={`${styles.hand} ${vertical ? styles.handVertical : ''}`}>
      {player.concealed.map((tile) => (
        <Tile key={tile.id} tile={tile} size={handSize} faceDown={faceDown} />
      ))}
    </div>
  );

  const exposedBlock = (player.melds.length > 0 || player.bonusTiles.length > 0) ? (
    <div className={styles.melds}>
      {player.melds.map((meld, i) => (
        <MeldGroup key={i} meld={meld} size={handSize - 8} />
      ))}
      {player.bonusTiles.length > 0 && (
        <div className={styles.bonus} title="Flowers and seasons">
          {player.bonusTiles.map((tile) => (
            <Tile key={tile.id} tile={tile} size={handSize - 8} />
          ))}
        </div>
      )}
    </div>
  ) : null;

  // Exposed melds sit on the table in front of the player (towards the centre),
  // so for the bottom seat they render above the concealed hand.
  const exposedAbove = position === 'bottom' || position === 'top';

  return (
    <section
      className={`${styles.seat} ${styles[`seat_${position}`]} ${isCurrent ? styles.seatActive : ''}`}
      aria-label={`${player.name}${isCurrent ? ', current turn' : ''}`}
    >
      <header className={styles.seatHeader}>
        <span className={styles.windBadge}>{WIND_LABEL[player.seatWind][0]}</span>
        <span className={styles.seatName}>{player.name}</span>
        <span className={styles.seatScore}>{player.score}</span>
      </header>

      {exposedAbove
        ? (<>{exposedBlock}{handBlock}</>)
        : (<>{handBlock}{exposedBlock}</>)}
    </section>
  );
}

function MeldGroup({ meld, size }: { meld: DeclaredMeld; size: number }) {
  const concealed = meld.type === 'concealed_kong';
  return (
    <div className={styles.meld} title={meld.type.replace('_', ' ')}>
      {meld.tiles.map((tile, i) => (
        <Tile
          key={tile.id}
          tile={tile}
          size={size}
          // A concealed kong shows its two end tiles face-down by convention.
          faceDown={concealed && (i === 0 || i === meld.tiles.length - 1)}
        />
      ))}
    </div>
  );
}

// ─── Central table: wall + discard pool (Module 2.3) ─────────────────────────

/** Stable pseudo-random in [0, 1) from a string and a salt (FNV-1a based). */
function hashFloat(str: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Discard scatter. Each tile drops into its own grid cell, sized comfortably
// larger than a tilted tile so neighbouring cells can never collide.
const DISCARD_TILE = 46;
const CELL_W = 62;
const CELL_H = 66;
const BBOX_W = 42; // tilted-tile bounding box, used to bound the in-cell jitter
const BBOX_H = 52;

/** Measures an element in px, updating on resize. */
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

/** A spread (shuffled) ordering of the grid's cells, stable for a given grid. */
function cellOrder(cols: number, rows: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  return cells.sort((a, b) => hashFloat(`${a[0]}-${a[1]}`, 7) - hashFloat(`${b[0]}-${b[1]}`, 7));
}

/**
 * Scatters discards across the whole central area without overlapping. The area
 * is divided into a grid of cells each comfortably larger than a tilted tile;
 * discards drop into cells in a spread, shuffled order, with a small in-cell
 * jitter and tilt. Placement is stable — a tile never moves once it has landed.
 */
function discardStyle(id: string, index: number, cols: number, rows: number, w: number, h: number): CSSProperties {
  const order = cellOrder(cols, rows);
  const [c, r] = order[index % order.length] ?? [0, 0];
  const cw = w / cols;
  const ch = h / rows;
  const maxJx = Math.max(0, (cw - BBOX_W) / 2);
  const maxJy = Math.max(0, (ch - BBOX_H) / 2);
  const left = (c + 0.5) * cw + (hashFloat(id, 1) * 2 - 1) * maxJx;
  const top = (r + 0.5) * ch + (hashFloat(id, 2) * 2 - 1) * maxJy;
  const rot = (hashFloat(id, 3) * 2 - 1) * 10;
  return { left: `${left}px`, top: `${top}px`, ['--rot' as string]: `${rot}deg` } as CSSProperties;
}

function DiscardArea({ state }: { state: GameState }) {
  const { discardPool, wall, phase } = state;
  const poolRef = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(poolRef);
  const cols = Math.max(1, Math.floor(w / CELL_W));
  const rows = Math.max(1, Math.floor(h / CELL_H));
  const current = state.players.find((p) => p.seat === state.currentSeat);
  return (
    <div className={styles.centre}>
      <div className={styles.wallInfo}>
        <span><strong>{wall.live.length + wall.dead.length}</strong> tiles in wall</span>
        <span className={styles.turnInfo}>
          {current ? `${current.name}` : '—'} · {phase.toLowerCase().replace('_', ' ')} · drawn clockwise ↻
        </span>
      </div>

      <WallFrame liveCount={wall.live.length} deadCount={wall.dead.length}>
        <div ref={poolRef} className={styles.discardPool} aria-label={`${discardPool.length} tiles discarded`}>
          {w > 0 && discardPool.map((tile, i) => (
            <div key={tile.id} className={styles.discardTile} style={discardStyle(tile.id, i, cols, rows, w, h)}>
              <Tile tile={tile} size={DISCARD_TILE} />
            </div>
          ))}
        </div>
      </WallFrame>
    </div>
  );
}

// ─── Score panel placeholder (refined in Module 2.5) ────────────────────────────

function ScorePanel({
  players, prevailingWind, handNumber,
}: {
  players: readonly PlayerState[];
  prevailingWind: Wind;
  handNumber: number;
}) {
  return (
    <aside className={styles.scorePanel}>
      <div className={styles.scoreHead}>
        <span>Hand {handNumber + 1}</span>
        <span>{WIND_LABEL[prevailingWind]} round</span>
      </div>
      <ul className={styles.scoreList}>
        {players.map((p) => (
          <li key={p.seat}>
            <span>{p.name}</span>
            <span>{p.score}</span>
          </li>
        ))}
      </ul>
      <span className={styles.placeholderTag}>Score panel — Module 2.5</span>
    </aside>
  );
}

export default Board;
