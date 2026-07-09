# Mahjong

Hong Kong / Cantonese Mahjong web app built with React and TypeScript.

## Overview

A fully rule-compliant implementation of Hong Kong Mahjong for 3 or 4 players. It runs
in two modes:

- **Local pass-and-play**: all hands on one screen, playable in the browser with no server.
- **Online multiplayer**: an authoritative Node.js + Socket.io server that runs the shared
  engine, validates every action, and broadcasts a per-seat filtered view to each client.
  Empty seats are filled by the built-in heuristic AI. The live game runs at
  https://mj.adamsmith.cv.

The rule-based AI opponents and a live opponent-modelling (inference) read-out are both
built in. The AI plays a fixed heuristic strategy (no machine learning) and can also drive a
"hint" for the human seat.

## Project Structure

```
mahjong/
  engine/     Pure TypeScript game engine, no UI dependencies. All game logic:
              tile definitions, wall builder, game state, turn engine, meld and
              hand evaluation, scoring, the heuristic AI (ai/), and the inference
              engine. Imported by both the React app and the Node server.

  src/        React + TypeScript front end. Board layout, custom-SVG tiles,
              interactive player hand, action bar, score panel, game setup, and
              the online lobby.

  server/     Node.js + Socket.io authoritative server for online play. Lobby,
              per-seat state filtering, reconnection, and the game-session loop.
```

Game configuration (scoring tables, rule switches) lives in `engine/src/scoring-config.ts`
and `GameConfig` (`engine/src/game-state.ts`), not in a separate top-level directory.

Design notes, the full rules write-up, and the decisions log are maintained separately and
are not part of this repository.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, CSS Modules. Tiles are custom SVG (no image assets).
- **Server:** Node.js, Express (static hosting), Socket.io (real-time), run with tsx.
- **Engine:** pure TypeScript, zero UI dependencies, shared by client and server.
- **Deployment:** Docker Compose (Caddy reverse proxy with automatic TLS + the game server).

## Getting Started

Requires Node.js 20+.

Local pass-and-play (no server):

```
npm install
npm run dev            # Vite dev server (defaults to http://localhost:5173)
```

Engine tests and type-checking:

```
cd engine
npm install
npm test               # vitest suite
npm run typecheck      # both tsconfig projects (source + tests)
```

Online mode (client + server locally):

```
# Terminal 1 - server
cd server
npm install
GAME_PASSWORD=secret npm run dev      # tsx watch, listens on :3000

# Terminal 2 - client, pointed at the local server
VITE_ONLINE=true VITE_SERVER_URL=http://localhost:3000 npm run dev
```

## Environment Variables

Set these for the server (see `.env.example`):

- `GAME_PASSWORD` (required): password the creator enters to start a game. The server exits
  if it is unset.
- `PORT` (optional, default `3000`): port the server listens on.
- `STATIC_DIR` (optional): path to the compiled React build the server serves.
- `CORS_ORIGIN` (optional, comma-separated): allowed origins for the Socket.io handshake.
  Defaults to the production host plus localhost dev ports. In production the client and
  server share one origin, so CORS is not exercised.

Client build-time variables:

- `VITE_ONLINE=true`: build the client in online mode (baked in by the Docker builder stage).
- `VITE_SERVER_URL`: server URL for local online development.

## Deployment

Production runs on a VPS via Docker Compose with two services:

- **caddy**: reverse proxy that terminates TLS and provisions / auto-renews a Let's Encrypt
  certificate for the game's host name.
- **game-server**: the Node.js process serving the compiled Vite build and handling all game
  logic over HTTP and WebSocket.

State is in-memory only (no database, no volumes); a container restart ends any game in
progress, which is acceptable for a session-only family game. The game password is supplied
as an environment variable and is never committed.

Build and run:

```
docker compose up -d --build
```

## Variant

Hong Kong / Cantonese Mahjong. 144-tile set including Flowers and Seasons. Standard special
and limit hands are supported. Optional Knitting and Crocheting hands are controlled by a
single config flag (off by default).
