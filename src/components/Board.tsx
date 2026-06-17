/**
 * Module 2.0 — UI: Board Layout
 *
 * The structural shell for a pass-and-play table. `Board` is a pure,
 * presentational component driven entirely by a `GameState` prop: it arranges
 * the four (or three) seats around a central table and lays out the regions the
 * later UI modules fill in.
 *
 * Region ownership:
 *   - Seat panels (name, wind, score, melds, bonus, hand). The local seat's
 *     concealed hand is the interactive, reorderable PlayerHand (Module 2.2);
 *     other seats render a static strip.
 *   - Central discard pool + wall indicator — refined in Module 2.3.
 *   - Action bar (below the local seat) — Module 2.4 (placeholder here).
 *   - Score panel (corner) — Module 2.5 (placeholder here).
 *
 * The board adapts to 3- or 4-player games (the engine supports both): with
 * three players the seat opposite is dropped. The local seat (the player to
 * show at the bottom) defaults to whoever's turn it is.
 *
 * Dependencies: @mahjong/engine (types only), Tile (Module 2.1), PlayerHand
 * (Module 2.2). No engine logic and no game mutation happen here.
 */

import type { GameState, PlayerState, SeatIndex, Wind, DeclaredMeld } from '@mahjong/engine';
import { Tile } from './Tile';
import { PlayerHand } from './PlayerHand';
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
}

export function Board({ state, localSeat, revealAll = true }: BoardProps) {
  const { players, config, currentSeat } = state;
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
    return (
      <SeatPanel
        player={player}
        position={position}
        isCurrent={player.seat === currentSeat}
        faceDown={!revealAll && player.seat !== base}
        interactive={player.seat === base}
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
        <Placeholder label="Action bar — Module 2.4" className={styles.actionBar} />
      </div>
    </div>
  );
}

// ─── Seat panel ─────────────────────────────────────────────────────────────────

function SeatPanel({
  player, position, isCurrent, faceDown, interactive,
}: {
  player: PlayerState;
  position: SeatPosition;
  isCurrent: boolean;
  faceDown: boolean;
  interactive: boolean;
}) {
  const vertical = position === 'left' || position === 'right';
  const handSize = position === 'bottom' ? 56 : 40;

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

      {interactive && !faceDown ? (
        <PlayerHand tiles={player.concealed} size={handSize} />
      ) : (
        <div className={`${styles.hand} ${vertical ? styles.handVertical : ''}`}>
          {player.concealed.map((tile) => (
            <Tile key={tile.id} tile={tile} size={handSize} faceDown={faceDown} />
          ))}
        </div>
      )}

      {(player.melds.length > 0 || player.bonusTiles.length > 0) && (
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
      )}
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

// ─── Central discard pool + wall indicator (refined in Module 2.3) ──────────────

function DiscardArea({ state }: { state: GameState }) {
  const { discardPool, wall, phase } = state;
  const current = state.players.find((p) => p.seat === state.currentSeat);
  return (
    <div className={styles.centre}>
      <div className={styles.wallInfo}>
        <span><strong>{wall.live.length}</strong> wall</span>
        <span><strong>{wall.dead.length}</strong> dead</span>
        <span className={styles.turnInfo}>
          {current ? `${current.name}` : '—'} · {phase.toLowerCase().replace('_', ' ')}
        </span>
      </div>

      <div className={styles.discardPool} aria-label={`${discardPool.length} tiles discarded`}>
        {discardPool.map((tile) => (
          <Tile key={tile.id} tile={tile} size={34} />
        ))}
      </div>
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

// ─── Shared placeholder block ───────────────────────────────────────────────────

function Placeholder({ label, className = '' }: { label: string; className?: string }) {
  return <div className={`${styles.placeholder} ${className}`}>{label}</div>;
}

export default Board;
