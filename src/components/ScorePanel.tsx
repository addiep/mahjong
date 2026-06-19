/**
 * Module 2.5 — Score Panel
 *
 * Shown at HAND_OVER. For a win: displays the winner's full hand (tiles +
 * declared melds + bonus tiles), the hand score breakdown, non-winners'
 * hand scores (exposed melds + concealed pungs), each player's bonus-tile
 * points, and running totals. For a draw: shows "Draw" with no score
 * breakdown and unchanged totals.
 *
 * Playtesting round 3 (2026-06-18):
 *  - winnerHand prop: winner's tiles rendered at the top of the overlay.
 *
 * Scoring fixes (2026-06-19):
 *  - Section renamed from 'Exposed melds' to 'Other players\' hands'.
 */
import type {
  ScoreResult,
  BonusScoreResult,
  SeatIndex,
  ExposedMeldScoreResult,
  Tile as TileData,
  DeclaredMeld,
  TileId,
} from '@mahjong/engine';
import { Tile as TileView } from './Tile';
import styles from './ScorePanel.module.css';

// ─── Exported interfaces ──────────────────────────────────────────────────────

export interface WinnerHandInfo {
  /** All concealed tiles (includes the winning tile). */
  readonly concealed: readonly TileData[];
  /** Declared melds. */
  readonly melds: readonly DeclaredMeld[];
  /** Flowers and seasons set aside. */
  readonly bonusTiles: readonly TileData[];
  /** ID of the tile that completed the hand, highlighted gold. */
  readonly winningTileId: TileId | null;
}

export interface PlayerBonusInfo {
  name: string;
  seat: SeatIndex;
  bonus: BonusScoreResult;
  /** Full hand score for non-winners (melds + concealed pungs); null for the winner. */
  meldScore: ExposedMeldScoreResult | null;
}

export interface ScorePanelProps {
  winnerName: string | null;
  result: ScoreResult | null;
  playerBonuses: PlayerBonusInfo[];
  runningTotals: { name: string; total: number }[];
  /** Winner's hand tiles for display; null for a draw. */
  winnerHand: WinnerHandInfo | null;
  onNewHand: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const TILE_SIZE = 40;

export function ScorePanel({
  winnerName,
  result,
  playerBonuses,
  runningTotals,
  winnerHand,
  onNewHand,
}: ScorePanelProps) {
  const isDraw = winnerName === null && result === null;

  const nonWinnersWithScore = playerBonuses.filter(
    pb => pb.meldScore !== null && pb.meldScore.total > 0,
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>

        {/* Title */}
        <h2 className={styles.title}>
          {winnerName ? `${winnerName} wins!` : 'Draw — wall exhausted'}
        </h2>

        {isDraw && (
          <p className={styles.drawNote}>No winner this hand. Scores are unchanged.</p>
        )}

        {/* ── Winner's hand display ── */}
        {winnerHand && (
          <div className={styles.winnerHandSection}>
            <div className={styles.winnerHandTiles}>
              {/* Declared melds first */}
              {winnerHand.melds.map((meld, i) => (
                <div key={i} className={styles.winnerMeld}>
                  {meld.tiles.map((tile) => (
                    <TileView
                      key={tile.id}
                      tile={tile}
                      size={TILE_SIZE}
                      highlight={tile.id === winnerHand.winningTileId ? 'gold' : undefined}
                    />
                  ))}
                </div>
              ))}
              {/* Concealed portion (face-up for everyone to see) */}
              {winnerHand.concealed.length > 0 && (
                <div className={styles.winnerMeld}>
                  {winnerHand.concealed.map((tile) => (
                    <TileView
                      key={tile.id}
                      tile={tile}
                      size={TILE_SIZE}
                      highlight={tile.id === winnerHand.winningTileId ? 'gold' : undefined}
                    />
                  ))}
                </div>
              )}
              {/* Bonus tiles */}
              {winnerHand.bonusTiles.length > 0 && (
                <div className={`${styles.winnerMeld} ${styles.winnerBonus}`}>
                  {winnerHand.bonusTiles.map((tile) => (
                    <TileView key={tile.id} tile={tile} size={TILE_SIZE - 4} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Winning hand score breakdown ── */}
        {result && (
          <div className={styles.handScore}>
            {result.specialHand && (
              <div className={styles.specialHand}>{result.specialHand}</div>
            )}

            {result.lines.length > 0 && (
              <table className={styles.table}>
                <tbody>
                  {result.lines.map((l, i) => (
                    <tr key={i}>
                      <td className={styles.labelCell}>{l.label}</td>
                      <td className={styles.numCell}>{l.points}</td>
                    </tr>
                  ))}
                  <tr className={styles.subtotalRow}>
                    <td>Base total</td>
                    <td>{result.basePoints}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {result.doublingLines.length > 0 && (
              <table className={styles.table}>
                <tbody>
                  {result.doublingLines.map((d, i) => (
                    <tr key={i}>
                      <td className={styles.labelCell}>{d.label}</td>
                      <td className={styles.numCell}>×{Math.pow(2, d.doublings)}</td>
                    </tr>
                  ))}
                  <tr className={styles.subtotalRow}>
                    <td>Total multiplier</td>
                    <td>×{Math.pow(2, result.doublings)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {result.isLimitHand && !result.specialHand && (
              <div className={styles.limitNote}>Capped at limit</div>
            )}

            <div className={styles.handTotal}>
              Hand score: <strong>{result.total}</strong>
            </div>
          </div>
        )}

        {/* ── Non-winner hand scores ── */}
        {nonWinnersWithScore.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Other players' hands</h3>
            <table className={styles.table}>
              <tbody>
                {nonWinnersWithScore.map(pb => (
                  <tr key={pb.seat}>
                    <td className={styles.labelCell}>{pb.name}</td>
                    <td className={styles.numCell}>{pb.meldScore!.total} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Bonus tiles ── */}
        {playerBonuses.some(pb => pb.bonus.count > 0) && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Bonus tiles</h3>
            <table className={styles.table}>
              <tbody>
                {playerBonuses.map(pb =>
                  pb.bonus.count > 0 ? (
                    <tr key={pb.seat}>
                      <td className={styles.labelCell}>{pb.name}</td>
                      <td className={styles.numCell}>
                        {pb.bonus.points} pts
                        {pb.bonus.flowerCount > 0 && pb.bonus.seasonCount > 0
                          ? ` (${pb.bonus.flowerCount}f + ${pb.bonus.seasonCount}s)`
                          : pb.bonus.flowerCount > 0
                          ? ` (${pb.bonus.flowerCount} flower${pb.bonus.flowerCount > 1 ? 's' : ''})`
                          : ` (${pb.bonus.seasonCount} season${pb.bonus.seasonCount > 1 ? 's' : ''})`}
                      </td>
                    </tr>
                  ) : null
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Running totals ── */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Running totals{isDraw ? ' (unchanged)' : ''}</h3>
          <table className={styles.table}>
            <tbody>
              {runningTotals.map(({ name, total }) => (
                <tr key={name}>
                  <td className={styles.labelCell}>{name}</td>
                  <td className={styles.numCell}>{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className={styles.newHandBtn} onClick={onNewHand}>
          New hand
        </button>
      </div>
    </div>
  );
}
