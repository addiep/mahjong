/**
 * Module 2.5 — Score Panel
 *
 * Shown at HAND_OVER. For a win: displays the winning hand's score breakdown,
 * each player's bonus-tile points, and running cumulative totals.
 * For a draw (wall exhausted): shows "Draw" with no score breakdown and no
 * running total update — the totals are unchanged.
 */
import type { ScoreResult } from '@mahjong/engine';
import type { BonusScoreResult } from '@mahjong/engine';
import type { SeatIndex } from '@mahjong/engine';
import styles from './ScorePanel.module.css';

export interface PlayerBonusInfo {
  name: string;
  seat: SeatIndex;
  bonus: BonusScoreResult;
}

export interface ScorePanelProps {
  /** Name of the winner, or null for a draw. */
  winnerName: string | null;
  /** Full score result for the winning hand; null for draws. */
  result: ScoreResult | null;
  /** Per-player bonus-tile scores; empty array for draws. */
  playerBonuses: PlayerBonusInfo[];
  /** Cumulative per-player totals (unchanged on a draw). */
  runningTotals: { name: string; total: number }[];
  onNewHand: () => void;
}

export function ScorePanel({
  winnerName,
  result,
  playerBonuses,
  runningTotals,
  onNewHand,
}: ScorePanelProps) {
  const isDraw = winnerName === null && result === null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <h2 className={styles.title}>
          {winnerName ? `${winnerName} wins!` : 'Draw — wall exhausted'}
        </h2>

        {isDraw && (
          <p className={styles.drawNote}>No winner this hand. Scores are unchanged.</p>
        )}

        {/* Winning hand breakdown (wins only) */}
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

        {/* Bonus tiles (wins only) */}
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

        {/* Running totals */}
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
