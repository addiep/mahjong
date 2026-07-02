/**
 * @mahjong/engine -- public API
 *
 * Re-exports everything from the engine modules.
 */

export * from './tiles.js';
export * from './wall.js';
export * from './game-state.js';
export * from './turn-engine.js';
export * from './game-runner.js';
export * from './meld-validator.js';
export * from './claim-window.js';
export * from './hand-evaluator.js';
export * from './scoring-config.js';
export * from './scoring.js';
export * from './flower-scoring.js';
export * from './inference.js';

// Client <-> server wire protocol (shared by the Node server and the React
// client so the socket event types are defined exactly once).
export * from './protocol.js';


// Module 4.x -- AI players (Phase 3)
export * from './ai/targets.js';
export * from './ai/assessment.js';
export * from './ai/discard.js';
export * from './ai/claims.js';
export * from './ai/heuristic-controller.js';
