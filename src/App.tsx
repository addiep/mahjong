/**
 * App shell -- a thin render layer over the mode hooks.
 *
 * Todo G refactor (2026-07-02): the game orchestration that used to live here
 * (~1,200 lines) was split into cohesive modules with NO behaviour change:
 *   - src/lib/game-helpers.ts    -- pure helpers: tile sorting/naming, hint
 *                                   text, added-kong options, deal setup.
 *   - src/hooks/useEventLog.ts   -- the rolling 6-entry sidebar event log.
 *   - src/hooks/useLocalGame.ts  -- local pass-and-play: game state, Todo A
 *                                   seat rotation, phase auto-advance, the AI
 *                                   driver, HAND_OVER scoring, all handlers.
 *   - src/hooks/useOnlineGame.ts -- online mode: socket listeners, per-seat
 *                                   filtered server state, the server-
 *                                   authoritative score payload (Finding 3),
 *                                   all handlers.
 * The change history this header used to narrate lives in git and in
 * DESIGN.md / DECISIONS.md (kept locally, not in the repo).
 */

import { useState } from 'react';
import { Board } from './components/Board';
import { ScorePanel } from './components/ScorePanel';
import { GameSetup } from './components/GameSetup';
import { OnlineLobby } from './components/OnlineLobby';
import { ErrorBoundary } from './components/ErrorBoundary';
import { inferTable, type SeatIndex } from '@mahjong/engine';
import { SEAT_NAMES, getAddKongOptions, getConcealedKongOptions } from './lib/game-helpers';
import { useEventLog } from './hooks/useEventLog';
import { useLocalGame } from './hooks/useLocalGame';
import { useOnlineGame } from './hooks/useOnlineGame';
import styles from './App.module.css';

// Whether the app is running in online multiplayer mode.
// Set VITE_ONLINE=true in the Dockerfile builder stage (or a local .env).
const ONLINE_MODE = import.meta.env.VITE_ONLINE === 'true';

export function App() {
  const [revealAll, setRevealAll] = useState(true);
  // Todo E: read the event log aloud (Web Speech API). A client-side display
  // preference, not part of GameConfig, so it lives here rather than in
  // engine state -- shared across both modes since useEventLog is shared.
  // Local mode sets it from the "Speak events" checkbox in GameSetup; online
  // mode (which never shows GameSetup) gets its own toolbar toggle below.
  const [speakEvents, setSpeakEvents] = useState(false);
  const { events, logEvent, clearEvents } = useEventLog(speakEvents);
  const online = useOnlineGame(logEvent, clearEvents);
  const local = useLocalGame(logEvent, clearEvents);

  // --- Online mode: lobby until game_start, then the server-driven Board ---
  if (ONLINE_MODE) {
    if (!online.onlineGameInfo) {
      return (
        <div className={styles.app}>
          <OnlineLobby
            onGameStart={(seat, isCreator, socket) =>
              online.setOnlineGameInfo({ seat, isCreator, socket })}
          />
        </div>
      );
    }

    const { seat: localSeat, isCreator } = online.onlineGameInfo;
    const { onlineState } = online;

    // Waiting for the first game_state from the server.
    if (!onlineState) {
      return (
        <div className={styles.app}>
          <div className={styles.toolbar}><span className={styles.title}>Mah Jong</span></div>
          <div className={styles.onlinePlaceholder}>
            <p>Connected as {SEAT_NAMES[localSeat] ?? `seat ${localSeat + 1}`}.</p>
            <p className={styles.onlineHint}>Waiting for the server to deal the tiles...</p>
          </div>
        </div>
      );
    }

    // The drawn-tile gold border: only shown for the local player's own turn.
    const onlineDrawnTileId =
      onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
        ? (onlineState.lastDrawnTileId ?? null)
        : null;

    // Added kong options: only offered when it's the local player's turn to discard.
    const onlineKongOptions =
      onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
        ? getAddKongOptions(onlineState)
        : [];
    const onlineConcealedKongOptions =
      onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
        ? getConcealedKongOptions(onlineState)
        : [];

    return (
      <div className={styles.app}>
        {/* Reconnecting banner (Module 3.4) -- fixed overlay, clears when state arrives */}
        {!online.onlineConnected && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            background: '#b00', color: '#fff',
            textAlign: 'center', padding: '6px 0',
            fontSize: '13px', zIndex: 1000,
          }}>
            Connection lost — reconnecting...
          </div>
        )}

        <div className={styles.toolbar}>
          <span className={styles.title}>Mah Jong</span>
          <div className={styles.controls}>
            <button type="button" className={styles.newHandBtn} onClick={online.handleOnlineHint}>
              Hint
            </button>
            <label>
              <input
                type="checkbox"
                checked={speakEvents}
                onChange={e => setSpeakEvents(e.target.checked)}
              />
              Speak events
            </label>
            <span>{SEAT_NAMES[localSeat]} seat</span>
          </div>
        </div>

        <div className={styles.tableArea}>
          <ErrorBoundary>
            <Board
              state={onlineState}
              localSeat={localSeat as SeatIndex}
              revealAll={false}
              onDiscard={
                onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
                  ? online.handleOnlineDiscard : undefined
              }
              onDeclareWin={
                onlineState.phase === 'DISCARDING' && onlineState.currentSeat === localSeat
                  ? online.handleOnlineDeclareWin : undefined
              }
              onAddKong={onlineKongOptions.length > 0 ? online.handleOnlineAddKong : undefined}
              addKongOptions={onlineKongOptions.length > 0 ? onlineKongOptions : undefined}
              onConcealedKong={onlineConcealedKongOptions.length > 0 ? online.handleOnlineConcealedKong : undefined}
              concealedKongOptions={onlineConcealedKongOptions.length > 0 ? onlineConcealedKongOptions : undefined}
              onClaimResponse={online.handleOnlineClaimResponse}
              humanSeats={new Set([localSeat])}
              drawnTileId={onlineDrawnTileId}
              savedOrder={online.onlineCurrentOrder}
              onOrderChange={online.handleOnlineOrderChange}
              scores={online.onlineRunningTotals}
              inference={inferTable(onlineState)}
              lastEvents={events}
            />
          </ErrorBoundary>
        </div>

        {onlineState.phase === 'HAND_OVER' && online.onlineHandScore && (
          <ErrorBoundary>
            <ScorePanel
              winnerName={online.onlineHandScore.winnerName}
              result={online.onlineHandScore.result}
              playerBonuses={online.onlineHandScore.playerBonuses}
              winnerHand={online.onlineHandScore.winnerHand}
              settlement={online.onlineHandScore.settlement}
              runningTotals={onlineState.players.map((p, i) => ({
                name:  p.name,
                total: online.onlineRunningTotals[i] ?? 0,
              }))}
              onNewHand={isCreator ? online.handleOnlineNewHand : () => {}}
            />
          </ErrorBoundary>
        )}
      </div>
    );
  }

  // --- Local mode: setup screen ---
  if (local.appPhase === 'setup' || !local.state) {
    return (
      <div className={styles.app}>
        <GameSetup
          defaultConfig={local.gameConfig}
          defaultAiSeats={local.aiSeats}
          defaultSpeakEvents={speakEvents}
          onStart={(config, aiSeats, speak) => {
            setSpeakEvents(speak);
            local.startGame(config, aiSeats);
          }}
        />
      </div>
    );
  }

  const { state } = local;

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Mah Jong</span>
        <div className={styles.controls}>
          <label>
            <input
              type="checkbox"
              checked={revealAll}
              onChange={e => setRevealAll(e.target.checked)}
            />
            Reveal all hands
          </label>
          <label>
            <input
              type="checkbox"
              checked={local.stepMode}
              onChange={e => local.toggleStepMode(e.target.checked)}
            />
            Step through AI
          </label>
          {local.stepMode && (
            <button type="button" className={styles.newHandBtn} disabled={!local.aiPending} onClick={local.stepAi}>
              {local.aiPending ? 'Step ▶' : 'Step'}
            </button>
          )}
          <button type="button" className={styles.newHandBtn} onClick={local.handleHint}>
            Hint
          </button>
          <button type="button" className={styles.newHandBtn} onClick={() => local.setAppPhase('setup')}>
            Setup
          </button>
          <button type="button" className={styles.newHandBtn} onClick={local.startNewHand}>
            New hand
          </button>
        </div>
      </div>

      <div className={styles.tableArea}>
        <ErrorBoundary>
          <Board
            state={state}
            revealAll={revealAll}
            onDiscard={state.phase === 'DISCARDING' ? local.handleDiscard : undefined}
            onDeclareWin={state.phase === 'DISCARDING' ? local.handleDeclareWin : undefined}
            onAddKong={local.localKongOptions.length > 0 ? local.handleAddKong : undefined}
            addKongOptions={local.localKongOptions.length > 0 ? local.localKongOptions : undefined}
            onConcealedKong={local.localConcealedKongOptions.length > 0 ? local.handleConcealedKong : undefined}
            concealedKongOptions={local.localConcealedKongOptions.length > 0 ? local.localConcealedKongOptions : undefined}
            onClaimResponse={local.handleClaimResponse}
            humanSeats={local.humanSeats}
            drawnTileId={local.drawnTileId}
            savedOrder={local.currentSeatOrder}
            onOrderChange={local.handleOrderChange}
            lastEvents={events}
            scores={local.runningTotals}
            inference={inferTable(state)}
            wallStartOffset={local.wallStartOffset}
          />
        </ErrorBoundary>
      </div>

      {state.phase === 'HAND_OVER' && local.handScore && (
        <ErrorBoundary>
          <ScorePanel
            winnerName={local.handScore.winnerName}
            result={local.handScore.result}
            playerBonuses={local.handScore.playerBonuses}
            winnerHand={local.handScore.winnerHand}
            settlement={local.handScore.settlement}
            runningTotals={state.players.map((p, i) => ({
              name: p.name,
              total: local.runningTotals[i] ?? 0,
            }))}
            onNewHand={local.startNewHand}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default App;
