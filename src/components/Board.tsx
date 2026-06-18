/**
 * Module 2.0 — UI: Board Layout
 *
 * Playtesting round 5 (2026-06-18):
 * - 'X tiles in wall' span removed from DiscardArea: it was partially covered
 *   by wall tiles and the count is not useful during play.
 *
 * Playtesting round 4 (2026-06-18):
 * - Score badge removed from each seat header; the ScoreSidebar already shows
 *   every player's running total — no need to repeat it on each seat.
 *
 * Playtesting round 3 (2026-06-18):
 * - scores prop: live running totals passed from App and shown in the score
 *   sidebar (was: always showing the engine's player.score which starts at 0
 *   and is never updated).
 *
 * Playtesting round 2 (2026-06-17):
 * - lastEvent prop: last notable game event shown under the score sidebar.
 * - lastDiscardId: always highlights the most recent discard in red.
 *
 * Phase 1 playtest fixes:
 * - drawnTileId, onDeclareWin, savedOrder/onOrderChange, bigger tiles.
 * - "Drawn clockwise" label removed.
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

function seatPositions(playerCount: number): SeatPosition[] {
  return playerCount === 3
    ? ['bottom', 'right', 'left']
    : ['bottom', 'right', 'top', 'left'];
}

export interface BoardProps {
  readonly state: GameState;
  readonly localSeat?: SeatIndex;
  readonly revealAll?: boolean;
  readonly onDiscard?: (tileId: TileId) => void;
  readonly onDeclareWin?: () => void;
  readonly onClaimResponse?: (seat: SeatIndex, decision: ClaimDecision) => void;
  readonly drawnTileId?: TileId | null;
  readonly savedOrder?: string[];
  readonly onOrderChange?: (ids: string[]) => void;
  readonly lastEvent?: string | null;
  /** Running totals from App — indexed by seat number. Used instead of player.score. */
  readonly scores?: readonly number[];
}

export function Board({
  state,
  localSeat,
  revealAll = true,
  onDiscard,
  onDeclareWin,
  onClaimResponse,
  drawnTileId,
  savedOrder,
  onOrderChange,
  lastEvent,
  scores,
}: BoardProps) {
  const { players, config, currentSeat, phase } = state;
  const base = localSeat ?? currentSeat;
  const positions = seatPositions(config.playerCount);

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
        onDeclareWin={isDiscarding ? onDeclareWin : undefined}
        drawnTileId={isInteractive ? drawnTileId : undefined}
        savedOrder={isInteractive ? savedOrder : undefined}
        onOrderChange={isInteractive ? onOrderChange : undefined}
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
      <ScoreSidebar
        players={players}
        prevailingWind={state.prevailingWind}
        handNumber={state.handNumber}
        lastEvent={lastEvent}
        scores={scores}
      />

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

// ─── Seat panel ───────────────────────────────────────────────────────────────

function SeatPanel({
  player, position, isCurrent, faceDown, interactive, isDiscarding,
  onDiscard, onDeclareWin, drawnTileId, savedOrder, onOrderChange,
}: {
  player: PlayerState;
  position: SeatPosition;
  isCurrent: boolean;
  faceDown: boolean;
  interactive: boolean;
  isDiscarding?: boolean;
  onDiscard?: (tileId: TileId) => void;
  onDeclareWin?: () => void;
  drawnTileId?: TileId | null;
  savedOrder?: string[];
  onOrderChange?: (ids: string[]) => void;
}) {
  const vertical = position === 'left' || position === 'right';
  const handSize = position === 'bottom' ? 68 : 50;

  const handBlock = interactive && !faceDown ? (
    <PlayerHand
      tiles={player.concealed}
      size={handSize}
      isDiscarding={isDiscarding}
      onDiscard={onDiscard}
      onDeclareWin={onDeclareWin}
      drawnTileId={drawnTileId}
      savedOrder={savedOrder}
      onOrderChange={onOrderChange}
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
        <MeldGroup key={i} meld={meld} size={handSize - 10} />
      ))}
      {player.bonusTiles.length > 0 && (
        <div className={styles.bonus} title="Flowers and seasons">
          {player.bonusTiles.map((tile) => (
            <Tile key={tile.id} tile={tile} size={handSize - 10} />
          ))}
        </div>
      )}
    </div>
  ) : null;

  const exposedAbove = position === 'bottom' || position === 'top';

  return (
    <section
      className={`${styles.seat} ${styles[`seat_${position}`]} ${isCurrent ? styles.seatActive : ''}`}
      aria-label={`${player.name}${isCurrent ? ', current turn' : ''}`}
    >
      <header className={styles.seatHeader}>
        <span className={styles.windBadge}>{WIND_LABEL[player.seatWind][0]}</span>
        <span className={styles.seatName}>{player.name}</span>
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
          faceDown={concealed && (i === 0 || i === meld.tiles.length - 1)}
        />
      ))}
    </div>
  );
}

// ─── Central table: wall + discard pool (Module 2.3) ─────────────────────────

function hashFloat(str: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const DISCARD_TILE = 46;
const CELL_W = 62;
const CELL_H = 66;
const BBOX_W = 42;
const BBOX_H = 52;

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

function cellOrder(cols: number, rows: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  return cells.sort((a, b) => hashFloat(`${a[0]}-${a[1]}`, 7) - hashFloat(`${b[0]}-${b[1]}`, 7));
}

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
  const { discardPool, wall } = state;
  const poolRef = useRef<HTMLDivElement>(null);
  const { w, h } = useElementSize(poolRef);
  const cols = Math.max(1, Math.floor(w / CELL_W));
  const rows = Math.max(1, Math.floor(h / CELL_H));
  const current = state.players.find((p) => p.seat === state.currentSeat);

  const lastDiscardId = discardPool[discardPool.length - 1]?.id;

  return (
    <div className={styles.centre}>
      <div className={styles.wallInfo}>
        <span className={styles.turnInfo}>
          {current ? `${current.name}` : '—'} · {state.phase.toLowerCase().replace(/_/g, ' ')}
        </span>
      </div>

      <WallFrame liveCount={wall.live.length} deadCount={wall.dead.length}>
        <div ref={poolRef} className={styles.discardPool} aria-label={`${discardPool.length} tiles discarded`}>
          {w > 0 && discardPool.map((tile, i) => (
            <div key={tile.id} className={styles.discardTile} style={discardStyle(tile.id, i, cols, rows, w, h)}>
              <Tile tile={tile} size={DISCARD_TILE} highlight={tile.id === lastDiscardId ? 'red' : undefined} />
            </div>
          ))}
        </div>
      </WallFrame>
    </div>
  );
}

// ─── Score sidebar ────────────────────────────────────────────────────────────

function ScoreSidebar({
  players, prevailingWind, handNumber, lastEvent, scores,
}: {
  players: readonly PlayerState[];
  prevailingWind: Wind;
  handNumber: number;
  lastEvent?: string | null;
  scores?: readonly number[];
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
            <span>{scores?.[p.seat] ?? p.score}</span>
          </li>
        ))}
      </ul>
      {lastEvent && (
        <p className={styles.lastEvent}>{lastEvent}</p>
      )}
    </aside>
  );
}

export default Board;
