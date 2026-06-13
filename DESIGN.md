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

### Claiming Discards
- **Pung, Kong, or winning tile:** any player may claim, regardless of seat position.
- **Chow:** only the player immediately to the left of the discarder may claim.
- **Priority:** winning claim beats all others; pung/kong beats chow.

### Bonus Tiles (Flowers & Seasons)
- If a player draws a Flower or Season, they set it aside (it scores at the end) and draw a replacement tile from the back of the wall (the "dead wall").
- This replacement draw can itself be a bonus tile, triggering another replacement.

### Knitting & Crocheting
Two additional special hands, enabled or disabled as a single binary switch set before
the game begins. If the switch is off, neither hand is legal and neither appears in the
hand evaluator.

- **Knitting:** seven pairs of matching numbers across exactly two suits. No Winds or
  Dragons. (14 tiles: 7 pairs.)
- **Crocheting (triple knitting):** four sets of three — one tile of the same number
  from each of the three suits — plus one pair of same-numbered tiles. (14 tiles: 4×3 + 2.)

Both hands score as special/limit hands when enabled.

### Dirty Wins
A binary switch, set before the game begins, controls whether a player may declare
Mahjong with a dirty hand (melds spanning more than one suit). Default is **off** —
clean hands only (all melds and the pair from a single suit; Winds and Dragons are
permitted as honours in any clean hand). When the switch is off, special hands are
unaffected — their own definitions govern whether they are clean or dirty.

### Discard Visibility
All discards go into a single communal pool. There is no record of who discarded which
tile, and a player may discard a tile and later win by claiming the same kind of tile
from the pool (no "fish back" rule).

- **Default:** the communal discard pool is face-up. All players can see every tile
  that has been discarded. This is strategically important (e.g. knowing a tile is
  "safe" because all four copies are already out).
- **Optional hard mode:** the pool is face-down. No player can see any historical
  discards. The tile just played is visible during the claim window so players can
  decide whether to claim it, but once the window closes it joins the face-down pool.
  This is a configurable game option set before the hand begins, not a mid-game toggle.

### Winning Hand
Standard structure: four melds (pung, kong, or chow) + one pair.
Special limit hands are an exception (see below).

### Turn Sequence
1. Player draws a tile (or claims a discard).
2. If a bonus tile is drawn, set aside and draw replacement.
3. Player may declare a concealed kong (draws replacement from dead wall).
4. Player discards one tile.
5. Claim window opens for other players (priority: win > pung/kong > chow).
6. If no claim, turn passes left.

### Scoring System
- Points-based with doublings (fan system). No chip or money payments.
- A running points tally is kept per player across hands.
- **Winning on a discard:** earns additional points (discard bonus — exact value TBD).
- **Self-draw (winning by drawing your own tile):** earns a further bonus on top.
- Seats rotate after every hand regardless of outcome (no dealer bonus for winning).
- No fixed game length — play until the players decide to stop.

### Special / Limit Hands
These override normal scoring. Hands in the first group require all tiles to be drawn
from the wall — the only exception is the final winning tile, which may be claimed from
a discard.

**First group (wall-draw rule applies):**

| Hand | Score | Description |
|---|---|---|
| Buried Treasure | Limit | Concealed pungs/kongs of one suit only + one pair. Winds and Dragons permitted. |
| Pairs — Clean | Limit | Seven pairs using one suit only. Winds and Dragons permitted. |
| Pairs — Dirty | ½ limit | Seven pairs across any mix of suits. Winds and Dragons permitted. |
| All Pairs Honours | ½ limit | Seven pairs composed only of 1s, 9s, Winds, and Dragons. |
| Knitting | Limit | Seven pairs of matching numbers across exactly two suits. No Winds or Dragons. |
| Crocheting (Triple Knitting) | ½ limit | Four sets of three same-numbered tiles across all three suits + one pair of same numbers. |
| Flying Angel (Wriggling Snake) | Limit | 1 through 9 of any one suit + one tile of each Wind + one pair from any of those tiles. |
| Windy Chow | Limit | One chow in each suit + one of each Wind + one pair of any Wind. |
| 13 Unique Wonders | Limit | One of each Dragon (3 tiles) + one of each Wind (4 tiles) + 1 and 9 of each suit (6 tiles) + any one of those tiles paired. |

**Second group (no wall-draw restriction):**

| Hand | Score | Description |
|---|---|---|
| Purity | Limit | Pungs/kongs (open or concealed) of one suit only + one pair. No Winds, Dragons, or chows. |
| All Honours | Limit | Pungs/kongs of Winds, Dragons, 1s, and 9s only. |
| Ruby | ½ limit | Pungs/kongs in Circles, but only numbers whose tiles contain red circles + must include a pung/kong of the Red Dragon. Extremely rare in practice. |
| Emerald | ½ limit | Pungs/kongs in Bamboo, but only numbers whose tiles are entirely green + must include a pung/kong of the Green Dragon. Extremely rare in practice. |
| All Pungs | Limit | Four pungs (or kongs) + one pair, no chows. Any tiles. |
| All Kongs | Limit | Four kongs + one pair. |
| Heavenly Hand | Limit | Dealer wins on the initial deal before any discard is made. |
| Earthly Hand | Limit | Non-dealer wins on their very first draw from the wall. |

### Scoring Table
> **Not yet established.** We need to go through the base-point values for each meld type
> (e.g. concealed pung of terminals, melded pung of simples, etc.) and which conditions
> trigger doublings (seat wind, prevailing wind, dragons, all-concealed, etc.).
> This will be done when we build the scoring engine module.

---

## 2. Tech Stack

### Frontend
- **React** with **TypeScript**
- Rationale: complex game state benefits from TS type safety; React's component model maps naturally onto tiles, hands, and board regions.
- Styling: TBD (CSS Modules or Tailwind — decide when we start the UI).

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
- TypeScript types for every tile: suit, value, category (suited / honour / bonus).
- Unique tile IDs (used throughout the engine to track individual tiles).
- Utility functions: `isSuited()`, `isHonour()`, `isBonus()`, `isTerminal()`, `tileEquals()`, etc.
- Status: **complete** — pushed to `addiep/mahjong` main, commit `60684e4`

#### Module 1.2 — Wall Builder
- Builds the full 144-tile set and shuffles it.
- Deals initial hands: 13 tiles to each player, 14 to the dealer (East).
- Separates the dead wall (last 14 tiles) for kong/bonus replacements.
- Status: **complete** — pushed to `addiep/mahjong` main, commit `f40e1a6`

#### Module 1.3 — Game State Model
- Central TypeScript types describing the entire game state at any moment:
  - Each player's hand (concealed tiles, declared melds, bonus tiles set aside)
  - The wall (remaining tiles, position pointer)
  - The communal discard pool (single ordered list; no record of who discarded what)
  - Current turn, current phase (draw / discard / claim-window)
  - Prevailing wind, seat winds
  - Scores
  - Game configuration (e.g. `discardsVisible: boolean`, `knittingEnabled: boolean`, `dirtyWinAllowed: boolean`)
- This is the single source of truth — all other modules read from or write to this.
- Status: **not started**

#### Module 1.4 — Turn Engine (State Machine)
- Drives the game through its phases:
  `DEAL → DRAW → CHECK_BONUS → DISCARD → CLAIM_WINDOW → (back to DRAW or CLAIM)`
- Handles: bonus tile replacement loop, concealed kong declaration mid-turn,
  exhausted wall (draw game).
- Exposes a `dispatch(action)` function — the only way to advance state.
- Status: **not started**

#### Module 1.5 — Claim Window Logic
- After a discard, opens a brief window for claims.
- Resolves simultaneous claims by priority: win > pung/kong > chow.
- Enforces the chow-from-left rule.
- Handles the case where multiple players want to win on the same discard
  (need to decide: first claimant wins, or specific priority? — **open question**).
- Status: **not started**

#### Module 1.6 — Meld Validator
- Given a set of tiles, validates whether they form a legal meld:
  - Pung: three identical tiles.
  - Kong: four identical tiles.
  - Chow: three consecutive suited tiles.
  - Pair: two identical tiles.
- Used by both the claim window and the hand evaluator.
- Status: **not started**

#### Module 1.7 — Hand Evaluator (Win Detector)
- Given a player's 14 tiles (concealed + drawable/claimable tile), determines:
  - Can this hand win in standard form (4 melds + 1 pair)?
  - Does it match any special limit hand?
- This is algorithmically the trickiest module — needs to try all valid decompositions
  (a hand can sometimes be read multiple ways).
- Must enforce `dirtyWinAllowed`: if `false`, reject a standard 4+1 win where melds
  span more than one suit. Special hands bypass this check entirely — their own
  definitions determine whether they are clean or dirty.
- Status: **not started**

#### Module 1.8 — Scoring Engine
- Calculates the score for a winning hand:
  1. Base points: sum points for each meld (type × concealed/melded × terminal-or-not).
  2. Apply doublings: each qualifying condition doubles the running total.
  3. Apply bonuses: self-draw bonus, discard bonus, flower/season bonus.
  4. If a special limit hand, return fixed limit score instead.
- Requires the scoring table to be filled in (**open question — see Section 1**).
- Config-driven: the points table lives in a JSON/TS config file, not hardcoded.
- Status: **not started**

#### Module 1.9 — Flower / Season Scoring
- At end of hand, each flower/season a player has set aside scores points.
- Common rule: your own flower/season (matching your seat) scores more.
- **Open question:** confirm the exact bonus values.
- Status: **not started**

#### Module 2.0 — UI: Board Layout
- Top-level React component laying out the four player areas, the central discard zone,
  and the wall indicator.
- For pass-and-play: all four hands visible. For online (Phase 2): only current player's
  hand face-up.
- Status: **not started**

#### Module 2.1 — UI: Tile Component
- Renders a single tile, face-up or face-down.
- States: default / selected / highlighted (e.g. claimable) / disabled.
- Uses real Mah Jong tile imagery or Unicode characters (decision TBD).
- Status: **not started**

#### Module 2.2 — UI: Player Hand
- Renders a player's concealed tiles + their declared melds + their bonus tiles.
- Handles tile selection (click to select before discarding).
- Status: **not started**

#### Module 2.3 — UI: Discard Pool
- Renders the single communal discard pool in order.
- Highlights the most recent discard during the claim window.
- Respects the `discardsVisible` game config flag: face-up (default) or face-down.
  When face-down, only the most recently discarded tile is shown (during the claim
  window); all prior discards are hidden from everyone.
- Status: **not started**

#### Module 2.4 — UI: Action Bar
- Shows the available actions for the current player at each phase:
  - Claim window: **Pung / Chow / Kong / Win / Pass**
  - Post-draw: **Discard / Declare Kong**
- Buttons are only shown when the action is actually legal (engine-driven).
- Status: **not started**

#### Module 2.5 — UI: Score Panel
- Displays the running points tally for each player.
- Shows a breakdown after each winning hand (meld-by-meld scoring, doublings applied).
- Status: **not started**

---

### Phase 2 — Online Multiplayer (future)

> Details to be fleshed out when Phase 1 is complete. High-level plan:

- Node.js + Socket.io server hosts game rooms.
- Room created with a short join code; up to 4 players connect.
- Server runs the same engine from `engine/` in authoritative mode.
- Clients send actions (`DISCARD`, `CLAIM_PUNG`, `PASS`, etc.); server validates, updates
  state, and broadcasts sanitised state (hidden tiles redacted) to all players.
- Each client only sees their own hand face-up.
- Handle disconnects gracefully (pause timer, allow rejoin).

---

### Phase 3 — AI Players (future)

> To be detailed once Phase 2 is stable. High-level plan:

The goal is to allow 1 human player to play against 2 or 3 AI opponents, so the game
is playable solo without waiting for others online.

**Approach: rule-based heuristic AI (not machine learning)**

A learning-based approach (neural networks, reinforcement learning) would produce
stronger play but is vastly more complex to build and maintain. For a family game,
a well-tuned heuristic AI is entirely sufficient and has the added advantage of being
explainable and adjustable — we can tune aggression, risk tolerance, and discard
strategy without retraining a model.

**Key AI decisions to implement per turn:**

- *What to discard?* Evaluate the hand, score potential winning shapes, discard the
  tile that least disrupts the most promising paths. Prefer to break isolated tiles
  over breaking partial melds.
- *Claim or pass?* Decide whether to claim a discard for a pung/chow based on how
  much it advances the hand versus how much it reveals (declared melds are visible
  to all).
- *When to declare a kong?* Weigh the replacement draw opportunity against revealing
  information.
- *Defensive play?* In later stages of the wall, consider whether a discard is
  "safe" (already discarded by others, unlikely to complete an opponent's hand).

**Difficulty levels:**

Consider offering at least two levels:
- *Easy:* AI plays greedily towards the fastest win, ignores defence.
- *Hard:* AI incorporates basic defensive discard logic and reads the table.

**Architecture note:**

The AI module will be a separate player-controller that conforms to the same
`dispatch(action)` interface as a human player. The engine itself does not need
to change — the AI simply decides which action to dispatch on its turn, the same
way a human clicking a button would. This separation must be preserved from the start.

---

## 4. Open Questions

| # | Question | Where it blocks us |
|---|---|---|
| OQ-1 | Full scoring table: base points per meld, which conditions double | Module 1.8 |
| OQ-2 | Flower/Season bonus values (own flower vs other) | Module 1.9 |
| OQ-3 | Simultaneous win claims: how to resolve? | Module 1.5 |
| ~~OQ-4~~ | ~~Any additional special hands beyond the six listed?~~ | Resolved — full list added from source page |
| ~~OQ-5~~ | ~~Minimum points required to declare a win?~~ | Resolved — see decisions log |
| OQ-6 | Tile visuals: real imagery, Unicode, or custom SVG? | Module 2.1 |
| ~~OQ-7~~ | ~~Crocheting: what is the pair allowed to be?~~ | Resolved — any pair of same-numbered tiles |
| ~~OQ-8~~ | ~~Do we keep All Pungs, All Kongs, Heavenly Hand, Earthly Hand?~~ | Resolved — all kept |
| ~~OQ-9~~ | ~~All Honours: Winds and Dragons only, or include 1s and 9s?~~ | Resolved — includes 1s and 9s |
| ~~OQ-10~~ | ~~Ruby and Emerald: precise tile lists?~~ | Resolved — kept as-is; noted as extremely rare in practice; exact tile composition to confirm when building Module 1.7 |

---

## 5. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-12 | Engine written as pure TS, shared between client and server | Avoids duplicating logic; keeps rules testable independently of UI |
| 2026-06-12 | Phase 1 targets pass-and-play (no server) | Lets us validate rules before adding network complexity |
| 2026-06-12 | Scoring config in a JSON/TS file, not hardcoded | Easy to adjust once scoring table is confirmed |
| 2026-06-12 | No minimum points required to declare a win | In practice four melds always yield enough points; the rule adds complexity for no benefit |
| 2026-06-12 | Discards face-up by default; face-down is an optional config flag | Face-up is standard play; face-down is a hard mode variant. Config flag kept in game state so the engine and UI both respect it |
| 2026-06-12 | Knitting & crocheting controlled by a single `knittingEnabled` flag | They come as a pair — no reason to allow one without the other. Decided before the game starts, not mid-game |
| 2026-06-12 | Kept All Pungs, All Kongs, Heavenly Hand, Earthly Hand | Family plays with these even though they don't appear on the reference page |
| 2026-06-12 | All Honours includes 1s and 9s, not just Winds and Dragons | Matches reference page and family understanding |
| 2026-06-12 | Ruby and Emerald kept but noted as extremely rare | No one has ever seen them made in practice; exact tile list to confirm at Module 1.7 |
| 2026-06-13 | `dirtyWinAllowed` defaults to `false`; clean hands only unless explicitly enabled | Dirty hands are significantly easier to achieve, so allowing them by default would undermine the game. Special hands are unaffected. |
| 2026-06-13 | Single communal discard pool; no per-player tracking | A player may discard a tile and later win by claiming the same kind from the pool. No fish-back rule. Discard authorship is never recorded. |

---

## 6. Working Conventions

### GitHub
- Repository: `addiep/mahjong` (private)
- **All completed code must be pushed to GitHub immediately after each module is done.**
  Do not wait to be asked. Push as part of finishing the module, not as a separate step.
- Push directly to `main` unless the work is experimental or a branch is explicitly requested.
- Commit messages follow the pattern: `Module X.Y — Short description` plus a brief
  bullet summary of what was added.
- This design document (`DESIGN.md`) lives in the repository root and is maintained there.
  Claude reads it from GitHub at the start of each session and pushes updates as decisions are made.
