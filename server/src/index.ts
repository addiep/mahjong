/**
 * Mah Jong game server -- entry point.
 *
 * Starts an Express HTTP server and a Socket.io WebSocket server on the same
 * port. Express serves the compiled React app (static files); Socket.io handles
 * all real-time game events.
 *
 * Environment variables (set in .env -- see .env.example):
 *   GAME_PASSWORD  Required. Password the creator must enter to start a game.
 *   PORT           Optional. Defaults to 3000.
 *   STATIC_DIR     Optional. Path to the compiled React build. Defaults to
 *                  ../../dist relative to this file (i.e. the repo root dist/).
 *   CORS_ORIGIN    Optional. Comma-separated allowlist of origins for the
 *                  Socket.io handshake. Defaults to the production host plus
 *                  localhost dev ports.
 */

import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ServerToClientEvents, ClientToServerEvents } from './events.js';
import { setupLobby } from './lobby.js';
import { createServerState } from './server-state.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const GAME_PASSWORD = process.env['GAME_PASSWORD'] ?? '';
const STATIC_DIR = path.resolve(
  process.env['STATIC_DIR'] ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist'),
);

// Allowed CORS origins for the Socket.io handshake. In production the client and
// server share one origin (mj.adamsmith.cv), so same-origin requests need no
// CORS at all; this allowlist mainly covers the Vite dev server on another port.
// Override with a comma-separated CORS_ORIGIN env var if the host changes.
const DEFAULT_CORS_ORIGINS = [
  'https://mj.adamsmith.cv',
  'http://localhost:5173',
  'http://localhost:3000',
];
const CORS_ORIGINS =
  process.env['CORS_ORIGIN']?.split(',').map(s => s.trim()).filter(Boolean) ??
  DEFAULT_CORS_ORIGINS;

if (!GAME_PASSWORD) {
  console.error('ERROR: GAME_PASSWORD is not set. Set it in your .env file.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP + Socket.io
// ---------------------------------------------------------------------------

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  // Restricted to a known allowlist rather than '*' (see CORS_ORIGINS above).
  cors: { origin: CORS_ORIGINS },
});

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

// Serve the Vite build output (JS, CSS, assets).
app.use(express.static(STATIC_DIR));

// SPA fallback: unmatched routes serve index.html so React handles routing.
app.get('*', (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

const state = createServerState();
setupLobby(io, state, GAME_PASSWORD);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`Mahjong server listening on :${PORT}`);
});
