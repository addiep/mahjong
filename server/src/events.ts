/**
 * Typed Socket.io event definitions for the Mah Jong server.
 *
 * The protocol itself now lives in the shared engine package
 * (`engine/src/protocol.ts`) so the server and the React client use one
 * definition instead of two hand-synced copies. This module simply re-exports
 * it, so existing `./events.js` imports across the server keep working.
 */

export type {
  LobbySeat,
  GameActionPayload,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@mahjong/engine';
