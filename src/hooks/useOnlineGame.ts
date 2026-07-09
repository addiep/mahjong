/**
 * Online multiplayer mode -- socket listeners, per-seat filtered server
 * state, server-authoritative scoring payloads, and the action handlers.
 *
 * Extracted verbatim from App.tsx in the Todo G refactor (2026-07-02); no
 * behaviour change. The server is authoritative for everything: this hook
 * only mirrors what it broadcasts and emits the local player's actions.
 */

import { useEffect, useRef, useState } from 'react';
import type { OnlineSocket } from '../components/OnlineLobby';
import {
  type GameState,
  type SeatIndex,
  type TileId,
  type ClaimDecision,
  type HandScorePayload,
} from '@mahjong/engine';
import { buildHintText, sortedTileIds, type HandScoreInfo } from '../lib/game-helpers';

/**
 * Populated by OnlineLobby when game_start fires.
 *
 * `isCreator` is fixed for the whole session (identity 0 -- see
 * game-session.ts); `seat` is NOT fixed -- it is the player's physical
 * seat/wind for the CURRENT hand only, and is refreshed by the game_start
 * listener below every time the server re-sends it (start of every hand,
 * and on reconnect), because seat rotation (Todo A) can move a player to a
 * different physical seat between hands.
 */
export interface OnlineGameInfo {
  seat: number;
  isCreator: boolean;
  socket: OnlineSocket;
}

export function useOnlineGame(
  logEvent: (msg: string) => void,
  clearEvents: () => void,
) {
  const [onlineGameInfo, setOnlineGameInfo] = useState<OnlineGameInfo | null>(null);

  // Online game state received from the server (filtered per seat).
  const [onlineState, setOnlineState] = useState<GameState | null>(null);
  const [onlineHandScore, setOnlineHandScore] = useState<HandScoreInfo | null>(null);
  const [onlineRunningTotals, setOnlineRunningTotals] = useState<number[]>([0, 0, 0, 0]);
  const [onlineCurrentOrder, setOnlineCurrentOrder] = useState<string[] | undefined>(undefined);
  const onlineHandOrderRef  = useRef<string[] | undefined>(undefined);
  // True while the socket is connected mid-game; false while reconnecting (Module 3.4).
  const [onlineConnected, setOnlineConnected] = useState(true);
  // Testing/debug aid (2026-07-09): ask the server to include every seat's
  // real concealed tiles instead of placeholders for opponents. Off by
  // default, per-connection -- see set_reveal_all in game-session.ts. Not a
  // GameConfig field (a display/testing preference, not a rule), same as
  // speakEvents.
  const [onlineRevealAll, setOnlineRevealAll] = useState(false);

  // -- Listen for game_state, game_event, disconnect and reconnect -----

  useEffect(() => {
    if (!onlineGameInfo) return;
    const { socket } = onlineGameInfo;

    socket.on('game_state', (newState: GameState) => {
      setOnlineConnected(true); // receiving state confirms the connection is live
      setOnlineState(newState);
      // Clear the score panel as soon as the new hand starts.
      if (newState.phase !== 'HAND_OVER') {
        setOnlineHandScore(null);
      }
      // A fresh deal (empty pool, no melds yet) clears the previous hand's log.
      // The meld guard matters: a claim on the very first discard empties the
      // pool mid-hand, and that must NOT wipe the log.
      if (
        newState.discardPool.length === 0 &&
        newState.players.every(p => p.melds.length === 0) &&
        newState.phase !== 'HAND_OVER'
      ) {
        clearEvents();
      }
    });

    // Authoritative event feed: the server emits one ready-to-display line per
    // move (discard, claim, added kong, win/draw); the client just appends it.
    // This replaces the old client-side snapshot diffing, which dropped events
    // when React batched several game_state messages into a single render.
    socket.on('game_event', (message: string) => logEvent(message));

    // Seat rotation (Todo A online follow-on, 2026-07-02): the server
    // re-sends game_start at the start of every hand (not just the initial
    // deal/reconnect) whenever seat rotation may have moved this player to a
    // different physical seat. Update just seat/isCreator in place so the
    // Board keeps rendering the right seat at the bottom.
    socket.on('game_start', ({ seat, isCreator }) => {
      setOnlineGameInfo(info => info ? { ...info, seat, isCreator } : info);
    });

    // When the socket drops, show the reconnecting banner.
    socket.on('disconnect', () => setOnlineConnected(false));

    // When socket.io auto-reconnects, re-send stored credentials so the server
    // can re-attach the socket to the ongoing hand (Module 3.4).
    //
    // sessionStorage is per-tab (codebase review finding 15, 2026-07-09): a
    // reload of the SAME tab reconnects cleanly, but opening the game in a
    // second tab/window does not inherit these credentials -- it looks like a
    // fresh joiner rather than a reconnect. Fine for the stated use case (one
    // browser tab per player); noted here since it is not obvious from the
    // code alone.
    socket.on('connect', () => {
      const storedSeat = sessionStorage.getItem('mj_seat');
      const storedName = sessionStorage.getItem('mj_name');
      if (storedSeat !== null && storedName !== null) {
        socket.emit('reconnect_attempt', {
          seat: parseInt(storedSeat, 10),
          name: storedName,
        });
      }
    });

    // Server-authoritative score payload (Finding 3 fix, 2026-07-02): the
    // server computes this once per hand from its own unfiltered state and
    // sends the identical payload to every client, so onlineRunningTotals can
    // no longer diverge between clients the way independent client-side
    // scoring used to. Replaces the old per-client HAND_OVER scoring effect.
    socket.on('hand_score', (payload: HandScorePayload) => {
      setOnlineHandScore({
        winnerName:   payload.winnerName,
        result:       payload.result,
        playerBonuses: [...payload.playerBonuses],
        winnerHand:   payload.winnerHand,
        // Todo F: computed server-side (only the server sees every loser's real
        // concealed tiles, so only it can work out the loser-to-loser leg).
        settlement:   payload.settlement,
      });
      setOnlineRunningTotals([...payload.runningTotals]);
    });

    return () => {
      socket.off('game_state');
      socket.off('game_event');
      socket.off('game_start');
      socket.off('disconnect');
      socket.off('connect');
      socket.off('hand_score');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineGameInfo]);

  // -- Auto-sort tiles when the local seat becomes active -----

  useEffect(() => {
    if (!onlineState || !onlineGameInfo) return;
    if (onlineState.phase !== 'DISCARDING') return;
    if (onlineState.currentSeat !== onlineGameInfo.seat) return;
    const player = onlineState.players[onlineGameInfo.seat];
    if (!player) return;
    const sortedIds = sortedTileIds(player.concealed);
    onlineHandOrderRef.current = sortedIds;
    setOnlineCurrentOrder(sortedIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineState?.currentSeat, onlineState?.phase]);

  // -- Action handlers -----
  // Only ever invoked while a game is running, i.e. when onlineGameInfo (and
  // its socket) exist; the optional chaining is just type safety.

  const socket = onlineGameInfo?.socket ?? null;

  const handleOnlineDiscard = (tileId: TileId) => {
    socket?.emit('game_action', { type: 'DISCARD', tileId });
  };

  const handleOnlineDeclareWin = () => {
    socket?.emit('game_action', { type: 'DECLARE_WIN' });
  };

  const handleOnlineAddKong = (tileId: TileId) => {
    socket?.emit('game_action', { type: 'DECLARE_ADDED_KONG', tileId });
  };

  const handleOnlineConcealedKong = (tileId: TileId) => {
    socket?.emit('game_action', { type: 'DECLARE_CONCEALED_KONG', tileId });
  };

  const handleOnlineClaimResponse = (_claimSeat: SeatIndex, decision: ClaimDecision) => {
    // The server knows which seat we are from the socket identity.
    socket?.emit('game_action', { type: 'CLAIM_RESPONSE', decision });
  };

  const handleOnlineSetRevealAll = (enabled: boolean) => {
    setOnlineRevealAll(enabled);
    socket?.emit('set_reveal_all', { revealAll: enabled });
  };

  const handleOnlineOrderChange = (ids: string[]) => {
    onlineHandOrderRef.current = ids;
  };

  const handleOnlineHint = () => {
    if (!onlineState || !onlineGameInfo) return;
    const localSeat = onlineGameInfo.seat;
    if (onlineState.phase !== 'DISCARDING' || onlineState.currentSeat !== localSeat) {
      logEvent('Hint: wait until it is your turn to discard.');
      return;
    }
    logEvent(buildHintText(onlineState, localSeat as SeatIndex));
  };

  const handleOnlineNewHand = () => {
    // Clear local panel; server will broadcast the next dealt state.
    setOnlineHandScore(null);
    setOnlineCurrentOrder(undefined);
    onlineHandOrderRef.current = undefined;
    socket?.emit('new_hand');
  };

  return {
    onlineGameInfo,
    setOnlineGameInfo,
    onlineState,
    onlineHandScore,
    onlineRunningTotals,
    onlineCurrentOrder,
    onlineConnected,
    onlineRevealAll,
    handleOnlineDiscard,
    handleOnlineDeclareWin,
    handleOnlineAddKong,
    handleOnlineConcealedKong,
    handleOnlineClaimResponse,
    handleOnlineSetRevealAll,
    handleOnlineOrderChange,
    handleOnlineHint,
    handleOnlineNewHand,
  };
}
