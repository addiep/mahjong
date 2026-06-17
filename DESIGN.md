# Mah Jong Web App — Project Thinking

> This file is the living design document for the project. Update it as decisions are made,
> rules are clarified, and modules are completed. It is the source of truth for intent.

---

## 1. Game Rules (as established)

### Variant
Hong Kong / Cantonese Mahjong — the most widely played family variant in the West.

### Tile Set (144 tiles)
| Group | Tiles |
|---|---|
| Bamboo (Bam) | 1–9, four copies each = 36 |
| Characters (Char) | 1–9, four copies each = 36 |
| Circles (Circ) | 1–9, four copies each = 36 |
| Winds | East, South, West, North — four copies each = 16 |
| Dragons | Red (Chun), Green (Fah), White (Bak) — four copies each = 12 |
| Flowers | Plum, Orchid, Chrysanthemum, Bamboo (bonus) = 4 |
| Seasons | Spring, Summer, Autumn, Winter (bonus) = 4 |
| **Total** | **144** |

### Players
3 or 4 (flexible — the engine must support both).

### Play Direction
Play passes anticlockwise. The wall is built clockwise.

### Claiming Discards
- **Pung, Kong, or winning tile:** any player may claim, regardless of seat position.
- **Chow:** only the player immediately to the left of the discarder may claim.
- **Priority:** winning claim beats all others; pung/kong beats chow.

### Bonus Tiles (Flowers & Seasons)
- If a player draws a Flower or Season, they set it aside (it scores at the end) and draw a replacement tile from the back of the wall (the "dead wall").
- This replacement draw can itself be a bonus tile, triggering another replacement.
- Bonus tiles are held in a separate list, never in the playing hand; the hand stays at 14 (+ one per declared kong).

### Dead Wall / Wall Reserve
Controlled by the `deadWall` config switch (see §3 Module 1.2 and the Decisions Log).
- **Off (default — the family rule):** no reserve. Replacement (loose) tiles come from
  the far end of the live wall, and play continues until the wall is exhausted (a draw;
  nobody wins).
- **On (traditional):** the last 14 tiles are reserved as a dead wall and replacements
  come from it.

### Knitting & Crocheting
Two additional special hands, enabled or disabled as a single binary switch set before
the game begins. If the switch is off, neither hand is legal and neither appears in the
hand evaluator.

- **Knitting:** seven pairs across exactly two suits, where each pair consists of the same
  number, one tile taken from each suit (e.g. bamboo-3 + characters-3). Numbers may repeat
  across pairs. No Winds or Dragons. (14 tiles: 7 cross-suit pairs.)
- **Crocheting (triple knitting):** four sets of three — one tile of the same number from
  each of the three suits — plus one pair of two tiles sharing a number (any suits).
  Numbers may repeat across sets and the pair. (14 tiles: 4×3 + 2.)

Both hands score as half-limit hands when enabled.

### Dirty Wins
A binary switch, set before the game begins, controls whether a player may declare
Mahjong with a dirty hand (melds spanning more than one suit). Default is **off** —
clean hands only (all melds and the pair from a single suit; Winds and Dragons are
permitted as honours in any clean hand). When the switch is off, special hands are
unaffected — their own definitions govern whether they are clean or dirty.

### Discard Visibility
All discards go into a single communal pool. Players see no record of who discarded which
tile, and a player may discard a tile and later win by claiming the same kind of tile
from the pool (no "fish back" rule). (Internally the engine does retain discard provenance
for the intelligence module; see "Private discard provenance" below.)

- **Default:** the communal discard pool is face-up. All players can see every tile
  that has been discarded. This is strategically important (e.g. knowing a tile is
  "safe" because all four copies are already out).
- **Optional hard mode:** the pool is face-down. No player can see any historical
  discards. The tile just played is visible during the claim window so players can
  decide whether to claim it, but once the window closes it joins the face-down pool.
  This is a configurable game option set before the hand begins, not a mid-game toggle.

**Private discard provenance (for the intelligence module):** although the player-facing
pool records no authorship, the engine privately retains who discarded which tile and when
(an append-only `discardLog`; see Modules 1.3 and 1.4). This is never shown to players in
normal play; it feeds the intelligence module (Phase 4) and, later, the AI. A skilled human
tracks the same information from memory, less reliably.

### Winning Hand
Standard structure: four melds (pung, kong, or chow) + one pair.
Special limit hands are an exception (see below).

### Turn Sequence
1. Player draws a tile (or claims a discard).
2. If a bonus tile is drawn, set aside and draw replacement.
3. Player may declare a concealed kong, or add a drawn tile to an exposed pung to form a kong (draws replacement from dead wall). A declared concealed kong is placed on the table face-down (four tiles turned face-down); the player may not keep all four tiles in their concealed hand. Concealed kongs cannot be robbed — only an added kong opens the Robbing the Kong window.
4. Player discards one tile.
5. Claim window opens for other players (priority: win > pung/kong > chow).
6. If no claim, turn passes left.

### Scoring System
- Points-based with doublings (fan system). No chip or money payments.
- A running points tally is kept per player across hands.
- Seats rotate after every hand regardless of outcome (no dealer bonus for winning).
- No fixed game length — play until the players decide to stop.

#### Base points per meld

| Meld | Minor | Major |
|---|---|---|
| Exposed Pung | 2 | 4 |
| Concealed Pung | 4 | 8 |
| Exposed Kong | 8 | 16 |
| Concealed Kong | 16 | 32 |
| Pair (Dragon / prevailing / seat Wind) | 2 | — |
| Flower or Season | 4 | — |

Minor = simples (2–8 of any suit). Major = terminals (1 or 9) or honours (Winds/Dragons).

#### Going Mah-Jong bonuses (winning player only)

| Condition | Points |
|---|---|
| Going Mah-Jong | 20 |
| Winning tile drawn from the live wall | +2 |
| Winning on the only possible tile | +2 |
| Hand contains no chows | +10 |
| Hand is all chows + one pair | +1 |

#### Doublings that apply to all players

Each qualifying condition doubles the round total once:
- Pung or Kong of any major tile (1, 9, Wind, or Dragon) — once per qualifying meld
- Complete set of Flowers or complete set of Seasons (doubles twice)

#### Additional doublings for the winning player only

- Clean hand (all melds and pair in one suit; Winds and Dragons permitted): ×1
- Purity (clean hand with no Winds or Dragons): ×3
- Winning with a loose tile, last tile of the wall, last discard, or Robbing the Kong: ×1
- Winds and Dragons only (all melds are Winds or Dragons): ×3
- Heads & Tails (all melds are 1s and 9s): ×3

#### Special hand scores
- All Pairs Honours: 500 points (half-limit)
- Buried Treasure: 1,000 points (limit)
- Limit hands: 1,000 points; half-limit hands: 500 points

### Special / Limit Hands
These override normal scoring. Hands in the first group require all tiles to be drawn
from the wall — the only exception is the final winning tile, which may be claimed from
a discard.

**First group (wall-draw rule applies):**

| Hand | Score | Description |
|---|---|---|
| Buried Treasure | Limit | Fully concealed hand — all melds formed from self-drawn tiles; no exposed melds from claimed discards. Any tile composition. Winning tile may be a discard. |
| Heavenly Twins | Limit | Seven pairs, all one suit. No Winds or Dragons. |
| Clean Pairs | ½ limit | Seven pairs of one suit, Winds and Dragons permitted. |
| Honour Pairs | Limit | Seven pairs composed only of Winds and Dragons (no 1s or 9s). |
| All Pairs Honours | 500 pts | Seven pairs composed only of 1s, 9s, Winds, and Dragons. |
| Knitting | ½ limit | Seven cross-suit pairs across exactly two suits (each pair = same number, one from each suit). Numbers may repeat across pairs. No Winds or Dragons. |
| Crocheting (Triple Knitting) | ½ limit | Four sets of three same-numbered tiles across all three suits + one pair of two tiles sharing a number (any suits). Numbers may repeat across sets and the pair. |
| Gates of Heaven (Nine Chances) | Limit | Waiting hand: concealed pung of 1s + run 2–8 + concealed pung of 9s, all one suit (13 tiles). Any tile 1–9 of that suit completes it. |
| Wriggling Snake | Limit | Run 1–9 in one suit with one of those numbers paired (any of 1–9) + one of each Wind. (14 tiles: 10 suited + 4 winds.) |
| 13 Unique Wonders | Limit | One of each Dragon (3) + one of each Wind (4) + 1 and 9 of each suit (6) + any one of those tiles paired. |

**Second group (no wall-draw restriction):**

| Hand | Score | Description |
|---|---|---|
| All Honours | Limit | Pungs/kongs of Winds, Dragons, 1s, and 9s only. |
| All Pungs | Limit | Four pungs (or kongs) + one pair, no chows. Any tiles. |
| All Kongs (Fourfold Plenty) | Limit | Four kongs + one pair. |
| Three Great Scholars | Limit | Pungs/kongs of all three Dragons + one further pung/kong + one pair. No chows. |
| Four Blessings Hovering Over the Door | Limit | Pungs/kongs of each of the four Winds + any pair. |
| Windy Dragons | Limit | Pungs/kongs of any two Dragons + one pair of each Wind (four pairs). |
| Dragonfly | Limit | One tile of each Dragon (3 tiles) + one pung/kong in each of the three suits + any pair. |
| Imperial Jade | Limit | Pungs/kongs composed entirely of green tiles + one pair. |
| Heads and Tails | Limit | Pungs/kongs of 1s and 9s only + one pair. |
| Heavenly Hand | Limit | Dealer wins on the initial deal before any discard is made. |
| Earthly Hand | Limit | Non-dealer wins by claiming East's very first discard. |

**Third group (circumstance hands; tile composition irrelevant; the hand evaluator detects these from the provenance context the turn engine supplies):**

| Hand | Score | Description |
|---|---|---|
| Gathering the Plum Blossom from the Roof | Limit | Player draws the 5 of Circles as a replacement tile from the dead wall and that tile completes their hand. |
| Plucking the Moon from the Bottom of the Sea | Limit | Player draws the 1 of Circles as the very last tile from the live wall and that tile completes their hand. |
| Twofold Fortune | Limit | Player declares a kong, draws a replacement tile and uses it to declare a second kong, then draws another replacement tile that completes their hand. |

---

## 2. Tech Stack

### Frontend
- **React** with **TypeScript**
- Rationale: complex game state benefits from TS type safety; React's component model maps naturally onto tiles, hands, and board regions.
- Styling: **CSS Modules** (decided at Module 2.0 — scoped plain CSS, no utility-class vocabulary or extra build dependency; keeps the "own your code" spirit of the custom-SVG tiles).
- Tile visuals: custom SVG, drawn in `Tile.tsx` (no external assets). See OQ-6.

### Backend (Phase 2 only)
- **Node.js** with **Socket.io**
- Rationale: shared language with the frontend means the core game engine can be used on both sides without duplication.
- The server will be authoritative: clients send actions, server validates and broadcasts state.

### Shared Game Engine
- Written in pure TypeScript with zero UI dependencies.
- Lives in a `engine/` package importable by both the React app and the Node server.
- This is the most important architectural decision: keep logic completely separate from rendering.

---

## 3. Build Plan

### Phase 1 — Rules Engine + Local Board (no server)

All modules in Phase 1 are frontend/engine only. The goal is a fully playable local
pass-and-play game (all four hands visible on one screen) that correctly enforces the rules.

#### Module 1.1 — Tile Definitions
- Status: **complete** — commit `60684e4`

#### Module 1.2 — Wall Builder
- `deadWall` switch (resolves OQ-14): `buildWall(playerCount, deadWall)` either reserves
  a 14-tile dead wall (traditional) or, when off (the family rule, the default), keeps the
  whole wall in play. `drawReplacement` draws loose tiles from the dead wall when present,
  otherwise from the far end of the live wall; the hand ends when the wall is exhausted.
- Status: **complete** — commit `f40e1a6`; `deadWall` wall-style switch added in `afdaa57` (OQ-14).

#### Module 1.3 — Game State Model
- `GameConfig.deadWall?` (optional, default false) carries the wall-style switch; the game
  setup passes it to `buildWall`.
- `discardLog` (built 2026-06-17): a private, append-only `DiscardLogEntry[]` on `GameState`
  recording `{ seat, tile, moveIndex, claimedBy }` per discard. Optional for backward
  compatibility; `createGameState` initialises it to `[]`. Kept separate from the
  player-facing communal pool (which stays unordered and authorless). Read only by the
  intelligence module (Phase 4) and the AI, never rendered in normal play.
- Status: **complete** — commit `7f799e3`; extended in `d59a21` (claimWindow), `f9cb525` (robbingKong + ROBBING_KONG phase), `afdaa57` (`deadWall` config flag), and `7018f4a` (`discardLog`).

#### Module 1.4 — Turn Engine (State Machine)
- Pure `dispatch(state, action): GameState` function — the only way to advance state.
- Drives DRAWING → CHECK_BONUS → DISCARDING → CLAIM_WINDOW → ROBBING_KONG → HAND_OVER.
- Tile count invariant: `14 + kongCount` total tiles at discard time.
- Bonus tile loop processed one tile at a time (distinct snapshots for UI animation).
- Win validation deferred for ordinary discard claims; Module 1.7 is wired where a
  structural win is required (the Robbing the Kong window).
- Added kong (OQ-12): `DECLARE_ADDED_KONG` promotes an exposed pung to an open kong with
  a drawn tile, then opens a `ROBBING_KONG` window. Only that tile may be robbed, only for
  a win (validated via Module 1.7), and only an added kong is robbable — concealed kongs
  are safe. If nobody robs, the melder proceeds to the kong replacement draw.
- `discardLog` (built 2026-06-17): populated here, since the turn engine is the only place
  state advances — appends an entry on `DISCARD` and annotates `claimedBy` (matched by tile
  id) when a discard is claimed via pung/kong/chow/win. Robbing the Kong does not touch the
  log (the robbed tile is a kong tile, not a discard). An absent log is treated as empty.
- Status: **complete** — commits `d59a21`, `dd8d003` (claim-window), `f9cb525` (added kong + Robbing the Kong), `7018f4a` (`discardLog`).

#### Module 1.4b — Game Runner
- `PlayerController` interface: `getDiscardAction` + `getClaimDecision`.
- `GameRunner` drives one hand; auto-dispatches non-decision actions; gathers claim
  decisions concurrently then applies serially. Drives the ROBBING_KONG window too.
- Status: **complete** — commit `9de3f8a`; updated in `f9cb525` (ROBBING_KONG)

#### Module 1.5 — Claim Window Logic
- `canPung`, `canKong`, `canChow` capability helpers.
- `validateClaimDecision`: validates pung/kong/chow/win/pass using Module 1.6.
  Win structural validation deferred to Module 1.7.
- `selectWinClaimant`: resolves OQ-3 — simultaneous wins go to the player closest
  in turn order (smallest positive seat-index offset from the discarder).
- Chow-from-left enforcement and claim priority handled by the turn engine using
  these functions.
- Status: **complete** — commits `5e479a2`, `dd8d003`, `04819f1`, `56e7287`

#### Module 1.6 — Meld Validator
- Pure predicate functions: `isPair`, `isPung`, `isKong`, `isChow`, `identifyMeld`.
- `MeldKind` type: `'pair' | 'pung' | 'kong' | 'chow'` (no open/concealed distinction —
  that is a gameplay concern, not a structural one).
- Chow validation is order-agnostic; honours can never form chows.
- Complete melds only; no partial-meld awareness.
- Status: **complete** — commit `9c22e5a`

#### Module 1.7 — Hand Evaluator (Win Detector)
- Public contract is binary: does this hand win, yes or no, in standard form (4 melds +
  1 pair) or as a special/limit hand. That is all the turn engine and the AI need: a
  player declares Mah Jong and the evaluator confirms the hand is legal.
- Given a player's concealed tiles, declared melds, and the winning tile (plus the
  provenance context, see below). Declared melds are fixed; only the concealed portion is
  decomposed. Bonus tiles (flowers/seasons) are excluded entirely; they score in 1.9.
- Algorithmically the trickiest module: even a yes/no answer requires trying to carve the
  tiles into melds, and a hand can be read multiple ways. The decomposition search is
  written once as a shared helper (`decomposeStandard`). The evaluator asks it "is there
  any valid carving?" (boolean); the scorer (1.8) asks it for every carving and picks the
  highest-scoring one. Choosing between equally-valid readings is a scoring concern.
- Enforces `dirtyWinAllowed`: if `false`, reject standard 4+1 wins where melds span more
  than one suit. A no-chow standard hand is always at least All Pungs (a limit hand) and
  bypasses the restriction. Special hands bypass it entirely.
- Non-standard winning shapes the meld decomposition cannot express are detected
  separately and require a fully concealed hand: the seven-pairs family, Wriggling Snake,
  13 Unique Wonders, and (gated by `knittingEnabled`) Knitting and Crocheting.
- Circumstance hands (Plum Blossom, Moon, Twofold Fortune) detected via a provenance
  context object the turn engine passes in (winning-tile source, last-wall-tile flag,
  kong-replacement chain); `detectCircumstance` presupposes an otherwise-winning hand.
- Knitting/Crocheting follow OQ-13 (resolved): Knitting = seven cross-suit number pairs
  across two suits; the Crocheting pair is any two tiles sharing a number. Numbers may
  repeat. Gated by `knittingEnabled` (off by default).
- Status: **complete** — commits `3b9c7da`, `5a615db` (26 vitest cases passing). Wired into
  Module 1.4's Robbing the Kong validation in `f9cb525`.

#### Module 1.8 — Scoring Engine
- Public entry point `scoreWinningHand(input, scoringConfig?)` returns a `ScoreResult`
  (total, special-hand name, base points, doublings, and a per-line breakdown).
- Uses the shared `decomposeStandard` helper to enumerate every valid reading of the hand,
  scores each, and keeps the highest-paying one (the player is entitled to their best score).
- Config-driven: the points table lives in `scoring-config.ts` (`DEFAULT_SCORING_CONFIG`),
  not hardcoded in the logic.
- Doublings are expressed as a *count* of ×2 multipliers, so a "×3" rule (Winds &
  Dragons only) contributes 3 doublings (×8) and a complete flower/season set contributes 2.
- The winning tile completes an *exposed* meld when it is claimed from a discard (or robbed);
  on a self-draw the completed meld stays concealed. This drives the exposed/concealed
  base-point split and the "all concealed" doubling.
- Special / limit / circumstance hands override the normal tally: every detector runs, the
  best-paying hand is chosen, and a tie-break priority gives the more specific hand the label
  (e.g. Imperial Jade over the generic All Pungs). Heads and Tails is scored as a limit hand
  (not the ×3 doubling), per the 2026-06-14 decision.
- The agreed **limit** (default 1,000; half-limit 500) is also the table-wide cap on any
  single hand, so a heavily-doubled normal hand cannot exceed it.
- Per-flower/season flat points (4 each) are deferred to Module 1.9; the scorer surfaces the
  bonus-tile count and applies the complete-set doublings, but does not add the flat points.
  Settlement of points between players is out of scope (a higher-level concern).
- Buried Treasure detector updated: now fires for any fully concealed hand (any tile
  composition), not just one-suit. Purity detector updated: fires for any one-suit no-W/D
  hand with no chow or concealment restriction. Three scoring test expectations updated.
  Implemented alongside Module 2.5 (commit `278d2a8`).
- `HandResult` extended with `winningTile`, `winSource`, `isLastWallTile`, and `robbedKong`
  fields; `GameState` gains `lastDrawSource`. Both needed by the score panel to display
  provenance context. Populated by the turn engine at every HAND_OVER transition.
- Status: **complete** — commits `14fe9fb` (config + index), `7be1898` (engine + 18 vitest cases),
  `278d2a8` (Buried Treasure + Purity detectors fixed; HandResult provenance fields added).

#### Module 1.9 — Flower / Season Scoring
- `scoreBonusTiles(bonusTiles, scoringConfig?)` banks a flat 4 points per flower or season
  (the `flowerOrSeason` config value) and returns a `{ points, flowerCount, seasonCount, count }`
  breakdown. Non-bonus tiles are ignored, so a whole hand or just the bonus list can be passed.
- Applies to every player, not only the winner — anyone holding bonus tiles banks the points.
- No own-flower distinction and no own-flower doubling (OQ-2 resolved).
- Module 1.8 still owns the complete-set-of-flowers / complete-set-of-seasons doublings and
  exposes `bonusTileCount`; 1.9 owns only the flat 4-per-tile points.
- Status: **complete** — commit `42e5729` (5 vitest cases passing).

#### Module 2.0 — UI: Board Layout
- React app scaffold (Vite + React + TypeScript) set up at the repo root. The shared engine
  is imported as `@mahjong/engine` via a Vite alias + a tsconfig path, both pointing at
  `engine/src` — the engine stays a pure-TS source package with no build step of its own,
  and Vite resolves its internal `.js` import specifiers to their `.ts` sources.
- `Board.tsx`: a pure, presentational component driven entirely by a `GameState` prop. It
  arranges 3 or 4 seats around a central table (local seat at the bottom, the others placed
  anticlockwise), with the communal discard pool + a wall/dead-wall indicator in the centre
  and labelled placeholder regions for the action bar (2.4) and score panel (2.5). Seat
  panels render real tiles via the Module 2.1 `Tile` component, proving the engine → UI
  integration. Adapts to 3 players by dropping the opposite (top) seat.
- Styling: **CSS Modules** (resolves the §2 "CSS Modules or Tailwind" TBD).
- `fixtures/sampleState.ts`: a fixed, hand-built sample `GameState` so the board renders a
  recognisable mid-hand arrangement (melds, bonus tiles, a partly-filled discard pool)
  without the live turn engine — that is wired in the later interactive modules.
- Verified by `tsc --noEmit` (typecheck against the engine types) and `vite build`.
- Status: **complete** — commit `b31c071`

#### Module 2.1 — UI: Tile Component
- `Tile.tsx`: a typed React component rendering any engine `Tile` as self-contained SVG;
  all 36 designs drawn in code (no external assets). Characters show a Latin digit and
  Winds an E/S/W/N letter for readability; Dots/Bamboo are countable. Fixed physical
  colours (identical in light/dark). Props: `size`, `faceDown`, `selected`, `onClick`.
- Resolves OQ-6 (custom SVG). Lives in `src/components/`; the React app scaffold (Vite)
  is set up in Module 2.0.
- Status: **complete** — commit `f4a3fc2`

#### Module 2.2 — UI: Player Hand
- The local seat's concealed hand is interactive:
  - **Drag to reorder** — tiles can be dragged to group pungs/runs, as with real tiles.
    Drag is custom (pointer events; mouse + touch, no library). A one-tap Sort orders
    them by suit then number. Reordering is view-only via `useHandOrder`, which
    reconciles the arrangement when the engine's `concealed` array changes — the engine
    is never touched, since tile order has no rules meaning.
  - **Tap to select / tap again to discard** — active only during the DISCARDING phase
    (App passes `onDiscard` only then). First tap lifts the tile (`translateY`) and
    draws a green border (the existing `Tile.selected` prop). Second tap on the same
    tile calls `onDiscard` with its ID. Tapping a different tile switches selection.
    Selection clears on any tile-set change (draw / claim / discard).
  - Tap vs drag distinguished by `|dx| < 5 px` at pointer-up.
- App.tsx holds a live `GameState` and auto-advances DRAWING/CHECK_BONUS/CLAIM_WINDOW/
  ROBBING_KONG via a phase-guarded functional `setState` (safe under StrictMode double-
  invocation). CLAIM_WINDOW and ROBBING_KONG auto-pass until Module 2.4 adds real claim
  buttons. HAND_OVER shows a banner with a New hand button.
- Status: **complete** — commits `8379f47` (drag-reorder + sort), `86b0fed`
  (tile selection + discard wiring; live engine connected to the UI for the first time).

#### Module 2.3 — UI: Discard Pool + Wall
- Discards scatter across the central table without overlapping: the area is a
  measured grid of non-overlapping cells, each discard dropped into a spread,
  shuffled cell with a small jitter and tilt, stable across renders.
- The wall (undrawn tiles) frames the discards as a square ring of face-down
  stacks two tiles high (`Wall.tsx`). It is one continuous wall drawn from both
  ends. Normal draws come off the live end and it recedes from there one tile at
  a time, starting at the most-clockwise point; every remaining tile keeps its
  exact position (nothing shifts). A ↻ marks the live draw point (HK mahjong:
  turns pass anticlockwise but tiles leave the wall clockwise — see Decisions
  Log). Each stack is two distinctly shaded tiles and an odd remainder renders as
  a single bottom tile, so every individual draw is visible.
- Loose tiles (kong / flower replacements) simply come off the *other* end of
  the same wall — nothing special about them beyond that, no separate reserve and
  no "dead"/"loose" labels. Each end is anchored at the end it is not drawn from,
  so neither shifts. (Counts come from `wall.live`/`wall.dead`.)
- Status: **complete** — commits `04f2ccc`, `82111ce`, `03a9179`, `5345236`.

#### Module 2.4 — UI: Action Bar
- `ActionBar` component: shown during CLAIM_WINDOW and ROBBING_KONG for the first seat still
  awaiting a response. Renders Mah Jong / Kong / Pung / Chow / Pass buttons based on legal
  actions; multiple chow sequences get separate buttons labelled with all three tile values
  (e.g. "Chow 3-4-5"). Returns null outside those phases.
- App.tsx: smarter auto-advance — CLAIM_WINDOW and ROBBING_KONG auto-pass a seat only when
  it has no legal action; otherwise the ActionBar shows and the player decides.
- `chowOptions()` helper: derives the `[TileId, TileId]` pairs from the concealed hand;
  needed because `canChow()` returns boolean only, not tile IDs.
- Status: **complete** — commit `13d82cf`

#### Module 2.5 — UI: Score Panel
- `ScorePanel.tsx` + `ScorePanel.module.css`: overlay shown at HAND_OVER displaying the
  winning player's hand-score breakdown (base points, doublings, total), all players'
  bonus-tile points, and the running totals across hands. Dismissed with a New Hand button.
- `App.tsx`: computes `scoreWinningHand` (Module 1.8) and `scoreBonusTiles` (Module 1.9) at
  HAND_OVER and accumulates running totals per player.
- Status: **complete** — commit `278d2a8`

#### Deliverable — Rules Write-up + HK Diff (when Phase 1 is playable)
- A clean, player-facing write-up of the rules this game uses, drawn mostly from §1 —
  usable as briefing material for new players learning Adam's version.
- A comparison against standard Hong Kong rules flagging the deliberate departures (e.g.
  Purity as a clean+no-W/D ×3 doubling, the no-reserve default wall, the added family
  hands such as Dragonfly / Windy Dragons / Honour Pairs, dirty wins off by default), to
  check the house rules have not strayed too far.
- Status: **not started**

---

### Phase 2 — Online Multiplayer (future)

Authoritative Node + Socket.io server (see §2). Clients send actions; the server runs the
shared engine, validates, and broadcasts the resulting `GameState`. Each client renders its
own seat at the bottom (the Board already supports this), so the same state is shown from
three or four perspectives.

#### Module 3.1 — Server Scaffold + Shared Engine Import
- Node server importing `@mahjong/engine`; reuses `dispatch` and `GameRunner` so the rules
  are never duplicated between client and server.
- Status: **not started**

#### Module 3.2 — Lobby + Game Session
- Create / join a game by room code; seat assignment; start when 3 or 4 players are ready.
- Status: **not started**

#### Module 3.3 — Authoritative State Sync
- Clients send actions over Socket.io; the server validates via the engine and broadcasts
  the new state.
- Per-seat state filtering: a client only receives its own concealed tiles; opponents'
  concealed hands are never sent over the wire (anti-cheat). The discard log (Modules
  1.3/1.4) likewise stays server-side, exposed only to the intelligence module.
- Status: **not started**

#### Module 3.4 — Reconnection + Resilience
- Handle drop / rejoin, turn timeouts, and a player leaving mid-hand.
- Status: **not started**

#### Module 3.5 — Voice Chat (optional, WebRTC)
- Browser-to-browser audio via WebRTC; a three/four-player peer-to-peer mesh. The signalling
  handshake rides the existing Socket.io connection. STUN for NAT traversal (free public
  servers); a TURN server as the fallback for restrictive networks (self-hosted or paid).
- Chosen over an external FaceTime window so voice lives in the same app and ties into the
  game session. Optional, so it never blocks the core online game.
- Status: **not started**

---

### Phase 3 — AI Players (future)

Rule-based heuristic AI. The `PlayerController` interface (Module 1.4b) is the
integration point — the AI implements it and lives in `engine/src/ai/`. No engine
changes needed for Phase 3. A strong AI would consume the Phase 4 intelligence inference.

---

### Phase 4 — Intelligence (Opponent Modelling, future)

A module that infers each opponent's likely strategy from public information only: their
exposed melds and kongs, their claim behaviour, and the discard log (who threw what, and
when). It cannot see concealed tiles — exactly like a human at the table — though it can
track the history more reliably than memory allows.

During the Phase 1 test build it can be displayed live on screen: a read-out per opponent of
what the module thinks they are collecting, as a way to develop and sanity-check it.

Distinct from the Phase 3 AI player (which chooses its own moves), though a strong AI would
consume the same inference. Adam has ideas on the inference approach, to be worked out when
the time comes.

#### Module 5.1 — Discard Provenance Plumbing
- The Module 1.3 / 1.4 `discardLog` (private record of seat, tile, moveIndex, and
  whether/by whom claimed) is now built (commit `7018f4a`). Remaining 5.1 work is exposing
  it to the inference layer (and keeping it server-side in Phase 2 per Module 3.3).
- Status: **not started**

#### Module 5.2 — Inference Engine
- Reads public state (exposed melds, claim history, discard log) and produces a per-opponent
  hypothesis about their target hand / suits / honours. Approach TBD.
- Status: **not started**

#### Module 5.3 — Live Debug Display
- Renders the per-opponent inference on screen during the test build.
- Status: **not started**

---

## 4. Open Questions

| # | Question | Where it blocks us |
|---|---|---|
| ~~OQ-1~~ | ~~Full scoring table: base points per meld, which conditions double~~ | Resolved — see Scoring System in §1 |
| ~~OQ-2~~ | ~~Flower/Season bonus values (own flower vs other)~~ | Resolved — flat 4 pts each; no own/other distinction; no own-flower doubling |
| ~~OQ-3~~ | ~~Simultaneous win claims: how to resolve?~~ | Resolved — closest in turn order (smallest positive seat-index offset from discarder) |
| ~~OQ-4~~ | ~~Any additional special hands?~~ | Resolved |
| ~~OQ-5~~ | ~~Minimum points to declare a win?~~ | Resolved — no minimum |
| ~~OQ-6~~ | ~~Tile visuals: real imagery, Unicode, or custom SVG?~~ | Resolved — custom SVG; all 36 designs drawn in `Tile.tsx`. Commercial-site images avoided (copyright); Wikimedia's free SVGs considered but custom chosen for ownership and theming |
| ~~OQ-7~~ | ~~Crocheting: what is the pair allowed to be?~~ | Resolved — any same-numbered pair |
| ~~OQ-8~~ | ~~Keep All Pungs, All Kongs, Heavenly Hand, Earthly Hand?~~ | Resolved — all kept |
| ~~OQ-9~~ | ~~All Honours: include 1s and 9s?~~ | Resolved — yes |
| ~~OQ-10~~ | ~~Ruby and Emerald: precise tile lists?~~ | Resolved — both hands removed |
| ~~OQ-11~~ | ~~Purity: limit hand or ×3 doubling?~~ | Resolved — Purity redefined as clean hand + no W/D; doubling ×3 (OQ-16) |
| ~~OQ-12~~ | ~~Robbing the Kong: claim-window interaction when an exposed pung is promoted to a kong~~ | Resolved & implemented (commit `f9cb525`) — added kong only; robbed by a player completing their win on that tile; concealed kongs safe |
| ~~OQ-13~~ | ~~Knitting / Crocheting: exact tile structure~~ | Resolved — Knitting = seven cross-suit number pairs across two suits, numbers may repeat; Crocheting pair = any two tiles sharing a number, numbers may repeat |
| ~~OQ-14~~ | ~~Should the dead wall be replenished from the live wall (traditional), or use up the whole wall?~~ | Resolved — added a `deadWall` config switch (default off = the family rule: no reserve, loose tiles from the far end of the wall, play until exhausted; on = traditional 14-tile reserve). Engine commit `afdaa57` |
| OQ-15 | Intelligence module: inference approach (heuristics, scoring of hypotheses, how confidence is shown) | Phase 4 (Module 5.2); Adam has ideas, to be worked out when the time comes |
| ~~OQ-16~~ | ~~Purity (clean hand with no Winds or Dragons): what doubling should it carry?~~ | Resolved — ×3 |

---

## 5. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-12 | Engine written as pure TS, shared between client and server | Avoids duplicating logic; keeps rules testable independently of UI |
| 2026-06-12 | Phase 1 targets pass-and-play (no server) | Lets us validate rules before adding network complexity |
| 2026-06-12 | Scoring config in a JSON/TS file, not hardcoded | Easy to adjust once scoring table is confirmed |
| 2026-06-12 | No minimum points required to declare a win | In practice four melds always yield enough points |
| 2026-06-12 | Discards face-up by default; face-down is optional config | Face-up is standard; face-down is a hard mode variant |
| 2026-06-12 | Knitting & crocheting controlled by a single `knittingEnabled` flag | They come as a pair |
| 2026-06-12 | Kept All Pungs, All Kongs, Heavenly Hand, Earthly Hand | Family plays with these |
| 2026-06-12 | All Honours includes 1s and 9s | Matches reference sheet and family understanding |
| 2026-06-13 | `dirtyWinAllowed` defaults to `false` | Dirty hands too easy; special hands unaffected |
| 2026-06-13 | Single communal discard pool; no per-player tracking | No fish-back rule; discard authorship never recorded |
| 2026-06-13 | Each player has `name: string` on `PlayerState` | Required for display in pass-and-play and online modes |
| 2026-06-14 | Turn engine (1.4) is a pure state machine; Game Runner (1.4b) handles wiring | Keeps engine testable in isolation |
| 2026-06-14 | `PlayerController` interface lives in Game Runner, not the engine | Engine doesn't need to know who is making decisions |
| 2026-06-14 | Bonus tile loop one tile at a time via CHECK_BONUS phase | Each replacement draw is a distinct snapshot for UI animation |
| 2026-06-14 | Tile count invariant: `14 + kongCount` total tiles at discard time | Handles East initial deal and kong replacements correctly |
| 2026-06-14 | OQ-3 resolved: simultaneous wins go to the player closest in turn order | Smallest positive seat-index offset from discarder = whose turn comes soonest |
| 2026-06-14 | AI strategy module implements `PlayerController`; lives in `engine/src/ai/` | No engine changes needed for Phase 3 |
| 2026-06-14 | Module 1.6 exposes complete-meld predicates only; no partial melds, no canChow | Partial melds deferred to AI (Phase 3); canChow deferred to Module 1.5 |
| 2026-06-14 | MeldKind (`pair/pung/kong/chow`) distinct from MeldType (open/concealed kong) | Open vs concealed is a gameplay concern, not a structural one |
| 2026-06-14 | Removed Windy Chow and Ruby — not in reference ruleset | Reference sheet (Peter Gregory, MahJongBritishRules.com) does not include them |
| 2026-06-14 | Buried Treasure: kongs permitted; Winds and Dragons permitted; one suit only | House rule — family note's "any four pungs" variant not adopted |
| 2026-06-14 | Wriggling Snake: pair may be any of 1–9 (not specifically 1s) | Family rule overrides reference sheet |
| 2026-06-14 | Three Great Scholars: fourth meld must be pung or kong (no chow) | Family rule confirmed |
| 2026-06-14 | Heads and Tails: limit hand (not a doubling) | Family rule confirmed |
| 2026-06-14 | Gates of Heaven described as Nine Chances waiting hand | Clearer framing; reference sheet and family note describe the same hand |
| 2026-06-14 | Added Dragonfly, Windy Dragons, Honour Pairs from family note | Present in family rules; absent from reference sheet |
| 2026-06-14 | Scoring: pung/kong of any major tile (1, 9, Wind, Dragon) doubles once per meld | Family rule extends reference sheet (which doubled only for own wind/dragon) |
| 2026-06-14 | Scoring: no-chow hand +10 pts; all-chow hand +1 pt; only-possible-tile +2 pts | From family note |
| 2026-06-14 | Play direction: anticlockwise; wall built clockwise | Confirmed from family note |
| 2026-06-14 | Earthly Hand: win on East's first discard (not non-dealer's first wall draw) | Per reference sheet; engine detects this at claim time, not draw time |
| 2026-06-14 | Added three circumstance hands: Plum Blossom, Moon, Twofold Fortune | Detected from winning-tile provenance; see 2026-06-16 update moving detection into the hand evaluator |
| 2026-06-14 | OQ-1 resolved: scoring table established from reference sheet and family note | Unblocks Module 1.8 |
| 2026-06-14 | Purity: treated as ×3 doubling for winning player, not a limit hand | Unorthodox family rule; most rulesets count this as a limit hand |
| 2026-06-14 | Clean Pairs (½ limit) added alongside Heavenly Twins (limit): same suit but W/D allowed | From family note |
| 2026-06-14 | Module 1.5 claim validation: win claims accepted structurally; full check deferred to 1.7 | Keeps modules decoupled; 1.7 not yet written |
| 2026-06-14 | canChow checks all three positional patterns (discard as low/mid/high tile) | Covers every valid chow sequence without needing meld-validator's isChow directly |
| 2026-06-16 | OQ-2 resolved: each flower/season scores a flat 4 points; no own-vs-other distinction | Family plays a flat bonus, not a seat-matched one |
| 2026-06-16 | Removed the "Own Flower or Season" doubling | No own-flower rule in the family game; complete-set doubling retained |
| 2026-06-16 | Added kong (promoting an exposed pung) and Robbing the Kong logged as a gap (OQ-12) | The `open_kong` type anticipated it, but no action existed |
| 2026-06-16 | Circumstance hands detected by the hand evaluator via a provenance context object, not by the turn engine alone | Keeps all hand-identification in one module for the scorer; supersedes the 2026-06-14 framing |
| 2026-06-16 | Hand evaluator's public result is binary (winning hand or not); enumerating readings to maximise score is the scorer's job | Win detection is all the engine and AI need; the decomposition search is a shared helper both modules call. Supersedes the earlier "returns all decompositions" note |
| 2026-06-16 | Module 1.7 complete: binary `isWinningHand` + shared `decomposeStandard`; All Pungs (no-chow) bypass keeps mixed-suit limit hands valid with dirtyWin off; 25 vitest cases | Trickiest module; built and tested in isolation per conventions |
| 2026-06-16 | OQ-12 resolved: only an added kong (promoted pung) can be robbed, by a player completing their win on that tile; concealed kongs safe | Standard HK rule; matches the existing Robbing the Kong doubling |
| 2026-06-16 | OQ-13a resolved: Knitting = seven cross-suit pairs across two suits (same number from each suit; numbers may repeat across pairs) | Family rule; `isKnitting` updated in commit `5a615db` (26 vitest cases) |
| 2026-06-16 | OQ-13b resolved: the Crocheting pair is any two tiles sharing a number (any suits) | Consistent with OQ-7 |
| 2026-06-17 | OQ-6 resolved: tile visuals are custom SVG (Module 2.1), not scraped imagery or Unicode | Full ownership, no licensing risk, crisp at any size, themeable; commercial-site tile images are copyrighted |
| 2026-06-17 | Characters tiles carry a Latin digit and Winds an E/S/W/N letter | Most players can't read the Chinese numerals or wind characters |
| 2026-06-17 | Module 1.8 complete: `scoreWinningHand` over the shared `decomposeStandard`; config-driven points table in `scoring-config.ts`; 18 vitest cases | Scoring built and tested in isolation per conventions (commits `14fe9fb`, `7be1898`) |
| 2026-06-17 | Doublings stored as a count of ×2 multipliers; a "×3" rule = 3 doublings (×8), a complete flower/season set = 2 | Keeps the doublings table unambiguous and composable |
| 2026-06-17 | The agreed limit (default 1,000) is also the table-wide cap on any single hand | Standard family interpretation: no hand pays more than the limit, doubled or not |
| 2026-06-17 | Winning tile completes an exposed meld when claimed from a discard or robbed; concealed on a self-draw | Drives the exposed/concealed base-point split and the "all concealed" doubling; conventional HK reading not spelled out in the source |
| 2026-06-17 | When several special hands tie on score, a priority order awards the label to the more specific hand (e.g. Imperial Jade over All Pungs) | Payout is identical; the name shown should be the more prestigious/specific one |
| 2026-06-17 | Module 1.8 applies the complete-flower/season-set doublings and reports `bonusTileCount`, but leaves the flat 4-per-tile points to Module 1.9 | Keeps the module boundary clean; 1.9 owns flat bonus-tile points only |
| 2026-06-17 | Module 1.9 complete: `scoreBonusTiles` banks a flat `flowerOrSeason` (4) per bonus tile for any player; non-bonus tiles ignored; 5 vitest cases | Small standalone module per OQ-2; flat value kept config-driven (commit `42e5729`) |
| 2026-06-17 | UI styling: CSS Modules, not Tailwind (resolves the §2 TBD) | Scoped plain CSS with no utility-class vocabulary or extra build dependency; keeps the "own your code" spirit of the custom-SVG tiles; scoping prevents class clashes as modules 2.2–2.5 grow |
| 2026-06-17 | Module 2.0: React app scaffolded with Vite at the repo root; engine imported as `@mahjong/engine` via a Vite alias + tsconfig path to `engine/src` (no engine build step) | Engine stays a pure-TS source package importable by both the app and (later) the Node server; Vite resolves the engine's internal `.js` specifiers to their `.ts` sources |
| 2026-06-17 | Board is a pure presentational component driven by a `GameState` prop; adapts to 3 or 4 players (drops the opposite seat for 3); local seat shown at the bottom | Keeps rendering decoupled from game logic; a fixed sample `GameState` drives it until the interactive modules wire the live engine |
| 2026-06-17 | Module 2.0 complete: board layout with seat / discard / wall regions and placeholders for the action bar (2.4) and score panel (2.5); typecheck + `vite build` green | Commit `b31c071` |
| 2026-06-17 | Hand tile order is a view-only concern (`useHandOrder`): the player drags to rearrange their own hand and the engine is never reordered | Tile order has no bearing on the rules; keeps the engine pure and lets the arrangement survive draws/discards via reconciliation. Drag is custom pointer events (mouse + touch, no dependency), per the lean-on-deps ethos — first slice of Module 2.2 (commit `8379f47`) |
| 2026-06-17 | Wall draw direction: tiles leave the wall clockwise while turns pass anticlockwise; the UI portrays clockwise depletion | Confirmed by research (Mahjong Wiki HK Old Style; sloperama MJ FAQ): two directions run at once — players take turns anticlockwise, tiles are drawn from the wall clockwise. Clarifies the §1 "wall built clockwise" note |
| 2026-06-17 | Wall shown as a two-high ring of face-down stacks framing the discards, bound to the live count; odd remainder drawn as a single, distinctly shaded bottom tile | Makes every single draw visibly reduce the wall, not just every second one; perimeter measured via ResizeObserver. Part of Module 2.3 |
| 2026-06-17 | Wall shown as one continuous wall drawn from BOTH ends: normal tiles off the live end (recedes tile-by-tile from the most-clockwise point, nothing shifts), loose (kong/flower) tiles off the other end. No separate dead-wall tray and no "dead"/"loose" labels; each end is anchored at the end it is not drawn from | Matches how the table works — loose tiles are just the far end of the same wall, nothing special about them. Supersedes the earlier "dead wall + loose tray" framing. (The engine still draws replacements from `wall.dead` without replenishing from the live wall — see OQ-14) |
| 2026-06-17 | Added a `deadWall` config switch (Module 1.3 `GameConfig`, optional, default false). False = the family rule (no 14-tile reserve; loose tiles come from the far end of the live wall; play until the wall is exhausted). True = the traditional reserve. `buildWall` branches on it; `drawReplacement` falls back to the wall's far end when there is no reserve | Resolves OQ-14. The family doesn't use a reserve; the switch keeps the traditional style available, with the family rule as the default. 64 vitest cases pass (incl. new no-reserve cases). Engine commit `afdaa57` |
| 2026-06-17 | Engine privately tracks discard provenance (a `discardLog`: seat, tile, moveIndex, claimedBy) while the player-facing pool stays unordered and authorless | The intelligence module (Phase 4) and the AI need to know who discarded what and when; a human tracks the same from memory, less reliably. Refines the internal effect of the 2026-06-13 "no per-player tracking" note — that still governs what players see, not internal state |
| 2026-06-17 | The discard log lives on the Module 1.3 `GameState` and is populated by the Module 1.4 turn engine (append on `DISCARD`, mark on claim) | The state model owns the data; the turn engine is the only place state advances, so it is where each discard / claim is recorded. Built and tested: 6 new vitest cases; full engine suite (game-state + turn-engine + discard-log) green at 72 tests. Commit `7018f4a` |
| 2026-06-17 | Phase 2 fleshed into modules: server scaffold (3.1), lobby/session (3.2), authoritative per-seat state sync (3.3), reconnection (3.4), optional WebRTC voice (3.5) | Replaces the one-line placeholder now the architecture is agreed; per-seat filtering keeps opponents' concealed tiles and the discard log server-side |
| 2026-06-17 | Voice chat via WebRTC peer-to-peer mesh (signalling over Socket.io, STUN + fallback TURN), optional; preferred over an external FaceTime window | Keeps voice in the same app and tied to the session; open-source, no per-seat licensing; optional so it never blocks the core game |
| 2026-06-17 | Added Phase 4 — Intelligence (opponent modelling) from public info only (exposed melds, claims, discard log); displayable live during the Phase 1 test build; distinct from the Phase 3 AI player | Reads only what a human could; cannot see concealed tiles. Modules 5.1 (provenance plumbing), 5.2 (inference engine, approach TBD — OQ-15), 5.3 (live debug display) |
| 2026-06-17 | Planned deliverable: a player-facing rules write-up + a diff against standard HK rules, once Phase 1 is playable | Doubles as new-player briefing and a check that the house rules have not strayed too far |
| 2026-06-17 | Made `engine/src` type-clean under the strict tsconfig (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`): asserted array access in meld-validator after length guards, switched wall draws to index+slice (and the shuffle swap to a temp var), and fixed claim-window's exhaustiveness guard to assign `decision.type` (the discriminant narrows to `never`, the object does not). Behaviour unchanged | These were pre-existing errors on `main`, surfaced while building the discard log. Production code now passes `tsc --noEmit` clean. Commit `971707c` |
| 2026-06-17 | Test files type-checked under a dedicated `engine/tsconfig.test.json` (extends the base, relaxes only `noUncheckedIndexedAccess` + enables `skipLibCheck`); production code stays fully strict. `npm run typecheck` now runs both projects. Fixed a latent branded-`TileId` cast in `claim-window.test.ts` (`chowTiles` was cast to `[string, string]`) | Index access on known tile fixtures is noise in test code; relaxing only that one flag keeps the rest of the test type-checking as strict as production. Whole engine now tsc-clean (src + tests); full suite green at 302 vitest cases. Commit `b766f03` |
| 2026-06-17 | Module 2.3 declared complete — the scatter grid and both-ends wall depletion already satisfied the module goals; the "polished detailing" note in the status was a placeholder with no outstanding work | No additional commits required |
| 2026-06-17 | Module 2.4 complete: ActionBar shows claim buttons (Mah Jong / Kong / Pung / Chow / Pass) for the first pending seat during CLAIM_WINDOW; Win / Pass only during ROBBING_KONG. App.tsx auto-passes a seat only when it has no legal action; otherwise ActionBar handles the decision. `chowOptions()` helper derives tile-ID pairs locally since `canChow` returns boolean only. Commit `13d82cf` |
| 2026-06-17 | Module 2.2 complete: live engine wired to the UI for the first time. App.tsx holds a live `GameState`; functional `setState` auto-advances DRAWING/CHECK_BONUS/CLAIM_WINDOW/ROBBING_KONG (phase-guarded, safe under StrictMode). Discard interaction: first tap selects a tile (lifted via `translateY(-10px)`, green border from the existing `Tile.selected` prop); second tap calls `onDiscard`. Tap vs drag distinguished by `|dx| < 5 px`. Selection clears on tile-set change. CLAIM_WINDOW/ROBBING_KONG auto-pass until Module 2.4. HAND_OVER banner with New hand button | Board rotates so the current player is always shown at the bottom; `onDiscard` threaded from App → Board → SeatPanel → PlayerHand, active only during DISCARDING phase. Commit `86b0fed` |
| 2026-06-17 | Knitting and Crocheting allow repeated numbers: the same number may appear in more than one pair (Knitting) or set (Crocheting). The "once from each suit" wording described each tile in a pair, not uniqueness across pairs | Family rule clarification |
| 2026-06-17 | Concealed kong must be declared and placed on the table face-down (four tiles turned face-down); the player may not keep all four tiles hidden in hand. Concealed kongs cannot be robbed — only added kongs open the Robbing the Kong window | Standard HK rule |
| 2026-06-17 | Fishing concept dropped entirely: Original Call doubling removed; no fishing score variants | Too complicated for the family game |
| 2026-06-17 | Knitting reclassified from Limit to ½ limit (500 points) | Consistent with Crocheting and the half-limit tier |
| 2026-06-17 | Buried Treasure redefined: any fully concealed hand (all melds self-drawn, any tile composition, winning tile may be a discard) → Limit (1,000 points). Previous narrow definition (one suit only) retired | The defining feature is concealment, not suit purity |
| 2026-06-17 | Purity redefined as a clean hand (one suit) with no Winds or Dragons — stricter than the general clean-hand doubling (×1, which permits W/D). Doubling value open (OQ-16). Previous Purity (×3, all-concealed, one suit, no W/D, no chows) retired; its concealment aspect is now Buried Treasure | Aligns with the family understanding of "purity" as suit cleanliness, not hand concealment |
| 2026-06-17 | OQ-16 resolved: Purity carries ×3 (three doublings, i.e. ×8 multiplier) | Family rule |
| 2026-06-17 | Module 1.8 scoring fixes: Buried Treasure detector updated to any fully concealed hand (any composition); Purity detector updated to any one-suit no-W/D hand (chows now earn the ×3 Purity doubling); three test expectations updated | Buried Treasure's defining feature is concealment; Purity is about suit cleanliness. Commit `278d2a8` |
| 2026-06-17 | `HandResult` extended with `winningTile`, `winSource`, `isLastWallTile`, `robbedKong`; `GameState` gains `lastDrawSource` | Score panel needs provenance fields to show a meaningful breakdown; turn engine populates them at every HAND_OVER transition. Commit `278d2a8` |
| 2026-06-17 | Module 2.5 complete: `ScorePanel` overlay at HAND_OVER shows hand breakdown, bonus tiles, and running totals; App.tsx computes and accumulates scores at each HAND_OVER | Phase 1 pass-and-play now fully playable end-to-end. Commit `278d2a8` |

---

## 6. Working Conventions

### GitHub
- Repository: `addiep/mahjong` (private)
- **All completed code must be pushed to GitHub immediately after each module is done.**
- Push directly to `main` unless work is experimental.
- Commit messages: `Module X.Y — Short description` + bullet summary.
- `DESIGN.md` lives in the repo root; Claude reads it at session start and pushes updates as decisions are made.

### Type-checking & tests
- Engine tests run with **vitest** (`npm test` inside `engine/`).
- The engine type-checks as two projects (`npm run typecheck` runs both):
  - `tsconfig.json` — production source, fully strict (`noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`), excludes `src/**/__tests__`.
  - `tsconfig.test.json` — the test files; extends the base but relaxes only
    `noUncheckedIndexedAccess` (index access on known fixtures is noise in test code) and
    enables `skipLibCheck`. Everything else stays as strict as production.
- Both the source and the tests are tsc-clean as of commit `b766f03`.
