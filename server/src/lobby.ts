/**
 * Lobby event handling -- Modules 3.1 / 3.2.
 *
 * Manages the full connection lifecycle:
 *   - Creator auth + human-count config
 *   - Joiner name entry + seat assignment
 *   - Waiting-room broadcasts
 *   - Deal trigger (game start is stubbed; Module 3.3 wires the engine)
 *   - Disconnection: creator abort resets to idle; joiner drop frees the seat
 */

import type { Server, Socket } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from './events.js';
import {
  type ServerState,
  resetServerState,
  nextAvailableSeat,
  isReadyToDeal,
} from './server-state.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function broadcastLobbyUpdate(io: TypedServer, state: ServerState): void {
  io.emit('lobby_update', {
    seats: state.seats.map(s => ({ name: s.name, seat: s.seat })),
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
      // Game running -- reject immediately.
      socket.disconnect();
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

      // Notify each human player of their seat. Module 3.3 will extend
      // game_start to carry the initial filtered GameState.
      for (const { socketId, seat } of state.seats) {
        io.to(socketId).emit('game_start', { seat });
      }

      // TODO (Module 3.3): instantiate GameRunner with HeuristicController
      // for AI seats (indices humanCount..3), wire dispatch and state broadcast.
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

      // in-progress disconnections are handled in Module 3.4.
    });
  });
}
