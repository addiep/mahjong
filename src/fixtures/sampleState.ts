/**
 * A fixed, deterministic sample GameState for developing the board layout
 * (Module 2.0). It is hand-built rather than dealt from the wall so the board
 * always renders the same recognisable arrangement — melds, bonus tiles, a
 * partly-filled discard pool, and a mid-hand turn. The live turn engine is
 * wired in later (interactive) modules; nothing here drives real play.
 */

import type {
  GameState, PlayerState, DeclaredMeld, SeatIndex,
  Tile, TileId, Suit, SuitedValue, Wind, Dragon, Flower, Season,
} from '@mahjong/engine';
import { DEFAULT_CONFIG } from '@mahjong/engine';

// ─── Tile makers (unique ids; values are illustrative, not a legal deal) ────────

let counter = 0;
const id = (raw: string): TileId => `${raw}-${counter++}` as TileId;

const suited = (suit: Suit, value: SuitedValue): Tile =>
  ({ id: id(`${suit}-${value}`), category: 'suited', suit, value });
const wind = (w: Wind): Tile => ({ id: id(`wind-${w}`), category: 'wind', wind: w });
const dragon = (d: Dragon): Tile => ({ id: id(`dragon-${d}`), category: 'dragon', dragon: d });
const flower = (f: Flower): Tile => ({ id: id(`flower-${f}`), category: 'flower', flower: f });
const season = (s: Season): Tile => ({ id: id(`season-${s}`), category: 'season', season: s });

const pung = (t: () => Tile, type: DeclaredMeld['type'] = 'pung'): DeclaredMeld =>
  ({ type, tiles: type === 'open_kong' || type === 'concealed_kong' ? [t(), t(), t(), t()] : [t(), t(), t()] });
const chow = (suit: Suit, low: SuitedValue): DeclaredMeld =>
  ({ type: 'chow', tiles: [suited(suit, low), suited(suit, (low + 1) as SuitedValue), suited(suit, (low + 2) as SuitedValue)] });

// ─── Per-seat hands (illustrative) ──────────────────────────────────────────────

const SEAT_WINDS: readonly Wind[] = ['east', 'south', 'west', 'north'];

function buildPlayers(playerCount: 3 | 4): PlayerState[] {
  const all: PlayerState[] = [
    {
      name: 'You (East)', seat: 0, seatWind: 'east', score: 38,
      melds: [pung(() => suited('circles', 7), 'pung')],
      concealed: [
        suited('bamboo', 2), suited('bamboo', 3), suited('bamboo', 4),
        suited('characters', 5), suited('characters', 5),
        suited('circles', 2), suited('circles', 3), suited('circles', 4),
        wind('east'), wind('east'), dragon('red'),
      ],
      bonusTiles: [flower('plum')],
    },
    {
      name: 'Robot South', seat: 1, seatWind: 'south', score: 12,
      melds: [chow('bamboo', 3)],
      concealed: [
        suited('characters', 1), suited('characters', 1), suited('characters', 1),
        suited('circles', 6), suited('circles', 6),
        suited('bamboo', 7), suited('bamboo', 8), suited('bamboo', 9),
        dragon('green'), dragon('green'),
      ],
      bonusTiles: [season('spring')],
    },
    {
      name: 'Robot West', seat: 2, seatWind: 'west', score: 25,
      melds: [],
      concealed: [
        suited('circles', 1), suited('circles', 2), suited('circles', 3),
        suited('circles', 5), suited('circles', 5), suited('circles', 5),
        suited('characters', 8), suited('characters', 8),
        wind('west'), wind('west'), wind('west'),
        dragon('white'), dragon('white'),
      ],
      bonusTiles: [],
    },
    {
      name: 'Robot North', seat: 3, seatWind: 'north', score: 50,
      melds: [pung(() => wind('north'), 'concealed_kong')],
      concealed: [
        suited('bamboo', 1), suited('bamboo', 1),
        suited('characters', 2), suited('characters', 3), suited('characters', 4),
        suited('characters', 6), suited('characters', 7),
        suited('circles', 8), suited('circles', 9),
        dragon('red'),
      ],
      bonusTiles: [flower('orchid'), season('summer')],
    },
  ];
  return all.slice(0, playerCount).map((p, i) => ({ ...p, seat: i as SeatIndex, seatWind: SEAT_WINDS[i]! }));
}

// ─── Communal discard pool (illustrative) ───────────────────────────────────────

const discardPool: Tile[] = [
  suited('characters', 9), wind('south'), suited('bamboo', 6), dragon('white'),
  suited('circles', 1), suited('characters', 3), wind('north'), suited('bamboo', 5),
  suited('circles', 9), suited('characters', 4), dragon('green'), suited('bamboo', 2),
  suited('circles', 7), wind('west'),
];

// ─── Wall stubs (only their lengths are read by the board) ───────────────────────

const liveWall: Tile[] = Array.from({ length: 42 }, (_, i) => suited('bamboo', ((i % 9) + 1) as SuitedValue));
const deadWall: Tile[] = Array.from({ length: 14 }, (_, i) => suited('circles', ((i % 9) + 1) as SuitedValue));

/**
 * Builds the sample state for the requested table size. The player whose turn
 * it is (seat 0, East) is shown at the bottom of the board.
 */
export function makeSampleState(playerCount: 3 | 4 = 4): GameState {
  return {
    config: { ...DEFAULT_CONFIG, playerCount },
    players: buildPlayers(playerCount),
    wall: { live: liveWall, dead: deadWall },
    discardPool,
    currentSeat: 0,
    phase: 'DISCARDING',
    prevailingWind: 'east',
    handNumber: 2,
    handResult: null,
    claimWindow: null,
    robbingKong: null,
  };
}
