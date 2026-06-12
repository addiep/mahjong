# Mahjong

Hong Kong / Cantonese Mahjong web app built with React and TypeScript.

## Overview

A fully rule-compliant implementation of Hong Kong Mahjong, supporting 3 or 4 players. Phase 1 targets a local pass-and-play game; Phase 2 will add online multiplayer via Socket.io; Phase 3 will add rule-based AI opponents.

## Project Structure

```
mahjong/
  engine/     Pure TypeScript game engine — no UI dependencies.
              Contains all game logic: tile definitions, wall builder,
              game state, turn engine, hand evaluator, scoring.
              Shared between the React app and the future Node server.

  src/        React + TypeScript front end.
              Board layout, tile rendering, player hands, action bar,
              score panel.

  config/     Game configuration files.
              Scoring tables, game variants, rule switches.
```

## Tech Stack

- **Frontend:** React, TypeScript
- **Backend (Phase 2):** Node.js, Socket.io
- **Engine:** Pure TypeScript, zero UI dependencies

## Build Plan

### Phase 1 — Rules Engine + Local Board
Fully playable pass-and-play game with correct rule enforcement.

### Phase 2 — Online Multiplayer
Node.js + Socket.io server; authoritative game state; sanitised state broadcast to each client.

### Phase 3 — AI Players
Rule-based heuristic AI opponents; at least two difficulty levels.

## Variant

Hong Kong / Cantonese Mahjong. 144-tile set including Flowers and Seasons. Standard special hands supported. Optional Knitting and Crocheting hands controlled by a single config flag.
