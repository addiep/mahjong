/**
 * OnlineLobby -- Socket.io lobby for the online multiplayer game.
 *
 * Five screens, driven entirely by server events:
 *   connecting    -- initial connection, waiting for server_state
 *   creator_auth  -- server is idle: name + password form
 *   creator_config -- auth accepted: human-count picker
 *   joiner_name   -- server is waiting: name-only form
 *   waiting       -- waiting room for creator and joiners
 *   error         -- disconnected / rejected / creator aborted
 *
 * The event interface types below are intentionally duplicated from
 * server/src/events.ts to avoid cross-package imports. Keep them in sync.
 *
 * Reconnection (Module 3.4):
 *   Player name and seat are stored in sessionStorage on auth/join so that a
 *   refreshed page or a dropped connection can send reconnect_attempt and
 *   re-enter the game without going through the lobby again.
 *
 * Environment:
 *   VITE_SERVER_URL  -- optional; defaults to same-origin (production).
 *                       Set to http://localhost:3000 for local dev.
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GameState, ClaimDecision } from '@mahjong/engine';
import styles from './OnlineLobby.module.css';

// ---------------------------------------------------------------------------
// Event types (must match server/src/events.ts)
// ---------------------------------------------------------------------------

interface LobbySeat { name: string; seat: number; }

/** A game action emitted by the human client during an active hand. */
type GameActionPayload =
  | { type: 'DISCARD';        tileId: string }
  | { type: 'DECLARE_WIN' }
  | { type: 'CLAIM_RESPONSE'; decision: ClaimDecision };

interface ServerToClientEvents {
  server_state: (d: { phase: 'idle' | 'waiting' | 'in-progress' }) => void;
  auth_ok:      () => void;
  auth_fail:    () => void;
  config_ok:    (d: { seat: 0 }) => void;
  join_ok:      (d: { seat: number }) => void;
  join_fail:    (d: { reason: string }) => void;
  lobby_update: (d: { seats: LobbySeat[]; humanCount: number }) => void;
  game_start:   (d: { seat: number }) => void;
  /** Filtered per-seat game state; sent after every engine dispatch. */
  game_state:   (state: GameState) => void;
  /** One human-readable line per move, for the event sidebar (server-derived). */
  game_event:   (message: string) => void;
}

interface ClientToServerEvents {
  creator_auth:      (d: { name: string; password: string }) => void;
  creator_config:    (d: { humanCount: number }) => void;
  joiner_join:       (d: { name: string }) => void;
  creator_deal:      () => void;
  /** Human player's action during DISCARDING, CLAIM_WINDOW, or ROBBING_KONG. */
  game_action:       (payload: GameActionPayload) => void;
  /** Creator requests a new hand after HAND_OVER. */
  new_hand:          () => void;
  /**
   * Reconnecting player identifies their seat (Module 3.4).
   * Sent on connection when sessionStorage has stored credentials and the server
   * reports in-progress. Also sent by App.tsx on socket auto-reconnect.
   */
  reconnect_attempt: (d: { seat: number; name: string }) => void;
}

export type OnlineSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface Props {
  onGameStart: (seat: number, socket: OnlineSocket) => void;
}

type LobbyView =
  | { kind: 'connecting' }
  | { kind: 'creator_auth' }
  | { kind: 'creator_config' }
  | { kind: 'waiting'; seats: LobbySeat[]; humanCount: number; isCreator: boolean; mySeat: number }
  | { kind: 'joiner_name' }
  | { kind: 'error'; message: string };

const SEAT_NAMES = ['East', 'South', 'West', 'North'] as const;
const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;

/** sessionStorage keys for reconnection credentials. */
const SK_SEAT = 'mj_seat';
const SK_NAME = 'mj_name';

export function OnlineLobby({ onGameStart }: Props) {
  const socketRef = useRef<OnlineSocket | null>(null);
  const [view, setView] = useState<LobbyView>({ kind: 'connecting' });

  // Form fields
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [humanCount, setHumanCount] = useState(4);

  // Used by the config_ok handler to know the humanCount the creator submitted,
  // avoiding the stale-closure problem with the humanCount state variable.
  const submittedHumanCountRef = useRef(4);

  // Guard: once game_start fires, App.tsx owns the socket. The cleanup must
  // NOT call socket.disconnect() or the connection drops immediately.
  const gameStartedRef = useRef(false);

  useEffect(() => {
    const socket: OnlineSocket = SERVER_URL ? io(SERVER_URL) : io();
    socketRef.current = socket;

    socket.on('server_state', ({ phase }) => {
      // In-progress: attempt reconnection if we have stored credentials.
      if (phase === 'in-progress') {
        const storedSeat = sessionStorage.getItem(SK_SEAT);
        const storedName = sessionStorage.getItem(SK_NAME);
        if (storedSeat !== null && storedName !== null) {
          socket.emit('reconnect_attempt', {
            seat: parseInt(storedSeat, 10),
            name: storedName,
          });
          // Stay in 'connecting' view until game_start arrives from the server.
          return;
        }
        setView({ kind: 'error', message: 'A game is already in progress. Please try again later.' });
        return;
      }

      // Session ended: clear reconnect credentials.
      if (phase === 'idle') {
        sessionStorage.removeItem(SK_SEAT);
        sessionStorage.removeItem(SK_NAME);
      }

      setView(prev => {
        // Initial connection: route to the right screen.
        if (prev.kind === 'connecting') {
          if (phase === 'idle')    return { kind: 'creator_auth' };
          if (phase === 'waiting') return { kind: 'joiner_name' };
          return prev; // shouldn't reach here after the early returns above
        }
        // Creator aborted while a joiner was in the waiting room.
        if (phase === 'idle' && prev.kind === 'waiting' && !prev.isCreator) {
          return { kind: 'error', message: 'The game was cancelled by the host.' };
        }
        return prev;
      });
    });

    socket.on('auth_ok', () => setView({ kind: 'creator_config' }));

    socket.on('auth_fail', () =>
      setView({ kind: 'error', message: 'Incorrect password.' })
    );

    socket.on('config_ok', ({ seat }) => {
      // Store seat for reconnection (name was stored in handleCreatorAuth).
      sessionStorage.setItem(SK_SEAT, String(seat));
      // humanCount is immediately corrected by the lobby_update that follows.
      setView({ kind: 'waiting', seats: [], humanCount: submittedHumanCountRef.current, isCreator: true, mySeat: seat });
    });

    socket.on('join_ok', ({ seat }) => {
      // Store seat for reconnection (name was stored in handleJoin).
      sessionStorage.setItem(SK_SEAT, String(seat));
      setView(prev => ({
        kind: 'waiting',
        seats:      prev.kind === 'waiting' ? prev.seats      : [],
        humanCount: prev.kind === 'waiting' ? prev.humanCount : 0,
        isCreator: false,
        mySeat: seat,
      }));
    });

    socket.on('join_fail', ({ reason }) =>
      setView({ kind: 'error', message: reason })
    );

    socket.on('lobby_update', ({ seats, humanCount: hc }) => {
      setView(prev =>
        prev.kind === 'waiting'
          ? { ...prev, seats, humanCount: hc }
          : prev
      );
    });

    socket.on('game_start', ({ seat }) => {
      // Mark that the game has started so cleanup does not disconnect the socket
      // (App.tsx now owns it and needs it for the live game).
      gameStartedRef.current = true;
      onGameStart(seat, socket);
    });

    socket.on('disconnect', () => {
      setView(prev =>
        prev.kind !== 'error'
          ? { kind: 'error', message: 'Connection to the server lost.' }
          : prev
      );
    });

    return () => {
      // Remove lobby event listeners.
      socket.off('server_state');
      socket.off('auth_ok');
      socket.off('auth_fail');
      socket.off('config_ok');
      socket.off('join_ok');
      socket.off('join_fail');
      socket.off('lobby_update');
      socket.off('game_start');
      socket.off('disconnect');

      // Only disconnect if the game never started. After game_start, App.tsx
      // owns the socket and we must leave it alive for the active session.
      if (!gameStartedRef.current) {
        socket.disconnect();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCreatorAuth = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // Store name now so it is available for reconnection even before config_ok.
    sessionStorage.setItem(SK_NAME, trimmed);
    socketRef.current?.emit('creator_auth', { name: trimmed, password });
  };

  const handleCreatorConfig = (e: React.FormEvent) => {
    e.preventDefault();
    submittedHumanCountRef.current = humanCount;
    socketRef.current?.emit('creator_config', { humanCount });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // Store name now so it is available for reconnection even before join_ok.
    sessionStorage.setItem(SK_NAME, trimmed);
    socketRef.current?.emit('joiner_join', { name: trimmed });
  };

  const handleDeal = () => {
    socketRef.current?.emit('creator_deal');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (view.kind === 'connecting') {
    return (
      <div className={styles.overlay}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Mah Jong</h1>
          <p className={styles.status}>Connecting...</p>
        </div>
      </div>
    );
  }

  if (view.kind === 'error') {
    return (
      <div className={styles.overlay}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Mah Jong</h1>
          <p className={styles.errorMsg}>{view.message}</p>
          <button
            type="button"
            className={styles.startBtn}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === 'creator_auth') {
    return (
      <div className={styles.overlay}>
        <form className={styles.card} onSubmit={handleCreatorAuth}>
          <h1 className={styles.heading}>Mah Jong</h1>
          <div className={styles.section}>
            <label className={styles.label} htmlFor="ca-name">Your name</label>
            <input
              id="ca-name"
              className={styles.input}
              type="text"
              autoComplete="off"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={32}
            />
          </div>
          <div className={styles.section}>
            <label className={styles.label} htmlFor="ca-pw">Password</label>
            <input
              id="ca-pw"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className={styles.startBtn}>
            Enter
          </button>
        </form>
      </div>
    );
  }

  if (view.kind === 'creator_config') {
    const aiCount = 4 - humanCount;
    return (
      <div className={styles.overlay}>
        <form className={styles.card} onSubmit={handleCreatorConfig}>
          <h1 className={styles.heading}>Mah Jong</h1>
          <div className={styles.section}>
            <label className={styles.label}>Human players (including you)</label>
            <div className={styles.toggle}>
              {([1, 2, 3, 4] as const).map(n => (
                <button
                  key={n}
                  type="button"
                  className={humanCount === n ? styles.activeBtn : styles.inactiveBtn}
                  onClick={() => setHumanCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className={styles.hint}>
              {aiCount === 0
                ? 'Four human players. No AI.'
                : humanCount === 1
                ? 'You play alone against 3 AI opponents.'
                : `${humanCount} humans; ${aiCount} AI seat${aiCount > 1 ? 's' : ''}.`}
            </span>
          </div>
          <button type="submit" className={styles.startBtn}>
            Create game
          </button>
        </form>
      </div>
    );
  }

  if (view.kind === 'joiner_name') {
    return (
      <div className={styles.overlay}>
        <form className={styles.card} onSubmit={handleJoin}>
          <h1 className={styles.heading}>Mah Jong</h1>
          <div className={styles.section}>
            <label className={styles.label} htmlFor="jn-name">Your name</label>
            <input
              id="jn-name"
              className={styles.input}
              type="text"
              autoComplete="off"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={32}
            />
          </div>
          <button type="submit" className={styles.startBtn}>
            Join game
          </button>
        </form>
      </div>
    );
  }

  // view.kind === 'waiting'
  const { seats, humanCount: expected, isCreator, mySeat } = view;
  const aiSeatCount = 4 - expected;
  const allSeated = seats.length === expected;
  const waiting = expected - seats.length;

  // Build the full 4-seat table.
  const seatRows = ([0, 1, 2, 3] as const).map(i => ({
    seat: i,
    name: seats.find(s => s.seat === i)?.name ?? null,
    isAi: i >= expected,
    isMe: i === mySeat,
  }));

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Mah Jong</h1>
        <p className={styles.sub}>
          {allSeated
            ? 'Ready to play'
            : `Waiting for players... (${seats.length}/${expected})`}
        </p>

        <div className={styles.seatList}>
          {seatRows.map(({ seat, name: seatName, isAi, isMe }) => (
            <div key={seat} className={`${styles.seatRow}${isMe ? ` ${styles.mySeatRow}` : ''}`}>
              <span className={styles.seatWind}>{SEAT_NAMES[seat]}</span>
              <span className={styles.seatName}>
                {isAi
                  ? <span className={styles.aiLabel}>AI</span>
                  : seatName
                    ? <>{seatName}{isMe ? <span className={styles.youLabel}> (you)</span> : null}</>
                    : <span className={styles.emptySlot}>waiting...</span>}
              </span>
            </div>
          ))}
        </div>

        {isCreator ? (
          <button
            type="button"
            className={styles.startBtn}
            disabled={!allSeated}
            onClick={handleDeal}
          >
            {allSeated
              ? 'Deal'
              : `Waiting for ${waiting} more player${waiting > 1 ? 's' : ''}...`}
          </button>
        ) : (
          <p className={styles.hint}>
            {allSeated
              ? 'All players connected. Waiting for the host to deal...'
              : `Waiting for ${waiting} more player${waiting > 1 ? 's' : ''}...`}
          </p>
        )}

        {aiSeatCount > 0 && (
          <p className={styles.aiNote}>
            {aiSeatCount} AI seat{aiSeatCount > 1 ? 's' : ''} will be filled automatically.
          </p>
        )}
      </div>
    </div>
  );
}
