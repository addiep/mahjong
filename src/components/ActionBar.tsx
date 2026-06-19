/**
 * Module 2.4 — Action Bar
 *
 * Shown during CLAIM_WINDOW and ROBBING_KONG phases. For pass-and-play,
 * cycles through each seat that hasn't responded yet, showing that player's
 * name and the claim buttons they're legally entitled to use.
 *
 * The auto-advance in App.tsx already passes for any seat with no legal
 * action, so this bar only appears when there's a genuine decision to make.
 *
 * Claim priority displayed left-to-right: Mah Jong > Kong > Pung > Chow > Pass.
 * Multiple Chow options (different sequences) get separate buttons labelled
 * with the three tile values, e.g. "Chow 3-4-5".
 *
 * Priority enforcement: if any seat has already submitted a pung/kong/win
 * claim, chow is suppressed for remaining seats (a pung always beats a chow;
 * no point asking). A win claim always stays available since it beats
 * everything.
 */

import {
  canPung, canKong, canChow, isWinningHand, isSuited,
  type Tile, type TileId, type SuitedTile,
  type GameState, type SeatIndex, type ClaimDecision,
} from '@mahjong/engine';
import styles from './ActionBar.module.css';

interface ActionBarProps {
  state: GameState;
  onClaim: (seat: SeatIndex, decision: ClaimDecision) => void;
  /** Seats the human may act for. When set, the bar is hidden for any other
   *  (AI-controlled) pending seat so the human is not prompted on its behalf. */
  humanSeats?: ReadonlySet<number> | undefined;
}

/**
 * Find all valid chow tile-pairs from the concealed hand for a given discard.
 * Returns up to three pairs, one per legal sequence pattern.
 */
function chowOptions(concealed: readonly Tile[], discard: Tile): [TileId, TileId][] {
  if (!isSuited(discard)) return [];
  const d = discard as SuitedTile;
  const patterns: [number, number][] = [
    [d.value - 2, d.value - 1],
    [d.value - 1, d.value + 1],
    [d.value + 1, d.value + 2],
  ];
  const result: [TileId, TileId][] = [];
  for (const [v1, v2] of patterns) {
    if (v1 < 1 || v2 > 9) continue;
    const t1 = concealed.find(
      t => isSuited(t) && (t as SuitedTile).suit === d.suit && (t as SuitedTile).value === v1,
    );
    const t2 = concealed.find(
      t => isSuited(t) && (t as SuitedTile).suit === d.suit && (t as SuitedTile).value === v2,
    );
    if (t1 && t2) result.push([t1.id, t2.id]);
  }
  return result;
}

/** "3-4-5" label for a chow button, showing the full sorted sequence. */
function chowLabel(id1: TileId, id2: TileId, concealed: readonly Tile[], discard: Tile): string {
  const t1 = concealed.find(t => t.id === id1);
  const t2 = concealed.find(t => t.id === id2);
  if (!t1 || !t2 || !isSuited(t1) || !isSuited(t2) || !isSuited(discard)) return '';
  const vals = [
    (t1 as SuitedTile).value,
    (t2 as SuitedTile).value,
    (discard as SuitedTile).value,
  ].sort((a, b) => a - b);
  return vals.join('-');
}

export function ActionBar({ state, onClaim, humanSeats }: ActionBarProps) {
  const { phase, claimWindow, robbingKong, players, config, currentSeat, discardPool } = state;

  // --- CLAIM_WINDOW ---
  if (phase === 'CLAIM_WINDOW' && claimWindow) {
    const pendingIdx = claimWindow.responses.findIndex(r => r === null);
    if (pendingIdx < 0) return null;
    const pendingSeat = pendingIdx as SeatIndex;
    if (humanSeats && !humanSeats.has(pendingSeat)) return null;
    const claimer = players[pendingSeat];
    const discard = discardPool[discardPool.length - 1];
    if (!claimer || !discard) return null;

    // If any seat already has a higher-priority claim in, suppress chow for
    // remaining seats (pung/kong beats chow; only a win can still override).
    const higherClaimIn = claimWindow.responses.some(
      r => r !== null && (r.type === 'pung' || r.type === 'kong' || r.type === 'win'),
    );

    const leftSeat = ((currentSeat + 1) % config.playerCount) as SeatIndex;
    const canW = isWinningHand([...claimer.concealed, discard], claimer.melds, config);
    const canK = canKong(claimer.concealed, discard);
    const canP = canPung(claimer.concealed, discard);
    const canC = !higherClaimIn && pendingSeat === leftSeat && canChow(claimer.concealed, discard);
    const chows = canC ? chowOptions(claimer.concealed, discard) : [];

    const respond = (decision: ClaimDecision) => onClaim(pendingSeat, decision);

    return (
      <div className={styles.bar} role="group" aria-label={`${claimer.name}: claim decision`}>
        <div className={styles.prompt}>
          <span className={styles.name}>{claimer.name}</span>
          <span className={styles.promptText}>— claim?</span>
        </div>
        <div className={styles.buttons}>
          {canW && (
            <button type="button" className={`${styles.btn} ${styles.win}`}
              onClick={() => respond({ type: 'win' })}>
              Mah Jong
            </button>
          )}
          {canK && (
            <button type="button" className={`${styles.btn} ${styles.kong}`}
              onClick={() => respond({ type: 'kong' })}>
              Kong
            </button>
          )}
          {canP && (
            <button type="button" className={`${styles.btn} ${styles.pung}`}
              onClick={() => respond({ type: 'pung' })}>
              Pung
            </button>
          )}
          {chows.map(([id1, id2], i) => (
            <button key={i} type="button" className={`${styles.btn} ${styles.chow}`}
              onClick={() => respond({ type: 'chow', chowTiles: [id1, id2] })}>
              Chow {chowLabel(id1, id2, claimer.concealed, discard)}
            </button>
          ))}
          <button type="button" className={`${styles.btn} ${styles.pass}`}
            onClick={() => respond({ type: 'pass' })}>
            Pass
          </button>
        </div>
      </div>
    );
  }

  // --- ROBBING_KONG ---
  if (phase === 'ROBBING_KONG' && robbingKong) {
    const pendingIdx = robbingKong.responses.findIndex(r => r === null);
    if (pendingIdx < 0) return null;
    const pendingSeat = pendingIdx as SeatIndex;
    if (humanSeats && !humanSeats.has(pendingSeat)) return null;
    const claimer = players[pendingSeat];
    if (!claimer) return null;

    const respond = (decision: ClaimDecision) => onClaim(pendingSeat, decision);

    return (
      <div className={styles.bar} role="group" aria-label={`${claimer.name}: rob the kong?`}>
        <div className={styles.prompt}>
          <span className={styles.name}>{claimer.name}</span>
          <span className={styles.promptText}>— rob the kong?</span>
        </div>
        <div className={styles.buttons}>
          <button type="button" className={`${styles.btn} ${styles.win}`}
            onClick={() => respond({ type: 'win' })}>
            Mah Jong
          </button>
          <button type="button" className={`${styles.btn} ${styles.pass}`}
            onClick={() => respond({ type: 'pass' })}>
            Pass
          </button>
        </div>
      </div>
    );
  }

  return null;
}
