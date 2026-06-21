/**
 * Lobby event handling -- Modules 3.1 / 3.2 / 3.3 / 3.4.
 *
 * Manages the full connection lifecycle:
 *   - Creator auth + human-count config
 *   - Joiner name entry + seat assignment
 *   - Waiting-room broadcasts
 *   - Deal trigger -> startGameSession (Module 3.3)
 *   - Disconnection: creator abort resets to idle; joiner drop frees the seat
 *   - Reconnection (Module 3.4): in-progress connections get a 1 s window to
 *     send reconnect_attempt before being disconnected.
 *
 * When startGameSession resolves (normally or on error), the server state is
 * reset to idle and all clients are notified.
 */

import type { Server, Socket } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from './events.js';
import {
  type ServerState,
  resetServerState,
  nextAvailableSeat,
  isReadyToDeal,
} from './server-state.js';
import { startGameSession } from './game-session.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function broadcastLobbyUpdate(io: TypedServer, state: ServerState): void {
  io.emit('lobby_update', {
    seats:      state.seats.map(s => ({ name: s.name, seat: s.seat })),
    humanCount: state.humanCount,
  });
}

export function setupLobby(
  io: TypedServer,
  state: ServerState,
  password: string,
): void {

  io.on('connection', (socket: TypedSocket) => {

    // Per-connection state held in the closure.
    // Only ever set for the creator socket; ignored on joiner sockets.
    let pendingCreatorName = '';

    // Tell the client what phase the server is in so it can show the right screen.
    socket.emit('server_state', { phase: state.phase });

    if (state.phase === 'in-progress') {
      // Game running. Give the client a brief window to identify as a reconnecting
      // player (Module 3.4). If no reconnect_attempt arrives within 1 s, disconnect.
      const kickTimer = setTimeout(() => socket.disconnect(), 1000);

      socket.once('reconnect_attempt', ({ seat, name }) => {
        clearTimeout(kickTimer);
        const ok = state.reconnectHandler?.(socket.id, seat, name) ?? false;
        if (!ok) {
          // Name or seat didn't match -- reject.
          socket.disconnect();
        }
        // If ok: game-session emitted game_start + game_state to the socket.
      });
      return;
    }

    // -----------------------------------------------------------------
    // Creator flow (server must be idle)
    // -----------------------------------------------------------------

    socket.on('creator_auth', ({ name, password: attempt }) => {
      if (state.phase !== 'idle') {
        socket.emit('auth_fail');
        socket.disconnect();
        return;
      }
      if (attempt !== password) {
        socket.emit('auth_fail');
        socket.disconnect();
        return;
      }
      // Auth passed. Stash the creator's socket id and name; await config.
      state.creatorSocketId = socket.id;
      pendingCreatorName = name.trim() || 'Creator';
      socket.emit('auth_ok');
    });

    socket.on('creator_config', ({ humanCount }) => {
      if (state.phase !== 'idle' || socket.id !== state.creatorSocketId) return;
      const count = Math.min(4, Math.max(1, Math.round(humanCount)));
      state.humanCount = count;
      state.seats = [{ socketId: socket.id, name: pendingCreatorName, seat: 0 }];
      state.phase = 'waiting';
      socket.emit('config_ok', { seat: 0 });
      broadcastLobbyUpdate(io, state);
    });

    // -----------------------------------------------------------------
    // Joiner flow (server must be waiting)
    // -----------------------------------------------------------------

    socket.on('joiner_join', ({ name }) => {
      if (state.phase !== 'waiting') {
        socket.emit('join_fail', { reason: 'No game is currently open.' });
        return;
      }
      const seat = nextAvailableSeat(state);
      if (seat === null) {
        socket.emit('join_fail', { reason: 'The game is full.' });
        return;
      }
      const trimmed = name.trim() || `Player ${seat + 1}`;
      state.seats.push({ socketId: socket.id, name: trimmed, seat });
      socket.emit('join_ok', { seat });
      broadcastLobbyUpdate(io, state);
    });

    // -----------------------------------------------------------------
    // Deal -- creator starts the game
    // -----------------------------------------------------------------

    socket.on('creator_deal', () => {
      if (
        state.phase !== 'waiting' ||
        socket.id !== state.creatorSocketId ||
        !isReadyToDeal(state)
      ) return;

      state.phase = 'in-progress';

      // Notify each human player of their assigned seat.
      for (const { socketId, seat } of state.seats) {
        io.to(socketId).emit('game_start', { seat });
      }

      // Run the game session. When it resolves (hand loop ends or creator leaves),
      // reset the server and advertise idle so new players can connect.
      void startGameSession(io, state)
        .then(() => {
          resetServerState(state);
          io.emit('server_state', { phase: 'idle' });
        })
        .catch((err: unknown) => {
          console.error('Game session error:', err);
          resetServerState(state);
          io.emit('server_state', { phase: 'idle' });
        });
    });

    // -----------------------------------------------------------------
    // Disconnection
    // -----------------------------------------------------------------

    socket.on('disconnect', () => {
      if (state.phase === 'idle') {
        if (socket.id === state.creatorSocketId) state.creatorSocketId = null;
        return;
      }

      if (state.phase === 'waiting') {
        if (socket.id === state.creatorSocketId) {
          // Creator aborted -- reset everything and tell remaining clients.
          resetServerState(state);
          io.emit('server_state', { phase: 'idle' });
        } else {
          // A joiner dropped -- free their seat so someone else can take it.
          state.seats = state.seats.filter(s => s.socketId !== socket.id);
          broadcastLobbyUpdate(io, state);
        }
        return;
      }

      // in-progress disconnections are handled by FallbackController (Module 3.4).
      // The game session loop watches the creator socket directly for new_hand.
    });
  });
}
