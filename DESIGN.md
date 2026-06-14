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
- Status: **complete** — commit `60684e4`

#### Module 1.2 — Wall Builder
- Status: **complete** — commit `f40e1a6`

#### Module 1.3 — Game State Model
- Status: **complete** — commit `7f799e3`; extended in `d59a21` (claimWindow field)

#### Module 1.4 — Turn Engine (State Machine)
- Pure `dispatch(state, action): GameState` function — the only way to advance state.
- Drives DRAWING → CHECK_BONUS → DISCARDING → CLAIM_WINDOW → HAND_OVER.
- Tile count invariant: `14 + kongCount` total tiles at discard time.
- Bonus tile loop processed one tile at a time (distinct snapshots for UI animation).
- OQ-3 placeholder: closest-clockwise wins on simultaneous win claims.
- Win validation deferred to Module 1.7; claims currently accepted unconditionally.
- Status: **complete** — commit `d59a21`

#### Module 1.4b — Game Runner
- `PlayerController` interface: `getDiscardAction` + `getClaimDecision`.
- `GameRunner` drives one hand; auto-dispatches non-decision actions; gathers claim
  decisions concurrently then applies serially.
- Status: **complete** — commit `9de3f8a`

#### Module 1.5 — Claim Window Logic
- Validate incoming pung/kong/chow/win claims using Module 1.6.
- Enforce chow-from-left rule and claim priority.
- Provide `canChow(hand, discard)` helper.
- Resolve OQ-3 (simultaneous wins) properly.
- Status: **not started**

#### Module 1.6 — Meld Validator
- Pure predicate functions: `isPair`, `isPung`, `isKong`, `isChow`, `identifyMeld`.
- `MeldKind` type: `'pair' | 'pung' | 'kong' | 'chow'` (no open/concealed distinction —
  that is a gameplay concern, not a structural one).
- Chow validation is order-agnostic; honours can never form chows.
- Complete melds only; no partial-meld awareness.
- Standalone — not yet wired into the turn engine (will happen via Module 1.5).
- Status: **complete** — commit `9c22e5a`

#### Module 1.7 — Hand Evaluator (Win Detector)
- Given a player's 14 tiles (concealed + claimable/drawable tile), determines:
  - Can this hand win in standard form (4 melds + 1 pair)?
  - Does it match any special limit hand?
- Algorithmically the trickiest module — must try all valid decompositions (a hand
  can sometimes be read multiple ways). Builds on Module 1.6.
- Must enforce `dirtyWinAllowed`: if `false`, reject standard 4+1 wins where melds
  span more than one suit. Special hands bypass this check entirely.
- Status: **not started**

#### Module 1.8 — Scoring Engine
- Calculates score for a winning hand (base points + doublings + bonuses).
- Config-driven: points table in a JSON/TS config file.
- Requires OQ-1 (scoring table) to be resolved before building.
- Status: **not started**

#### Module 1.9 — Flower / Season Scoring
- Bonus tile scoring at end of hand.
- Requires OQ-2 (bonus values) to be resolved.
- Status: **not started**

#### Module 2.0 — UI: Board Layout
- Status: **not started**

#### Module 2.1 — UI: Tile Component
- Status: **not started**

#### Module 2.2 — UI: Player Hand
- Status: **not started**

#### Module 2.3 — UI: Discard Pool
- Status: **not started**

#### Module 2.4 — UI: Action Bar
- Status: **not started**

#### Module 2.5 — UI: Score Panel
- Status: **not started**

---

### Phase 2 — Online Multiplayer (future)

> Details to be fleshed out when Phase 1 is complete.

---

### Phase 3 — AI Players (future)

Rule-based heuristic AI. The `PlayerController` interface (Module 1.4b) is the
integration point — the AI implements it and lives in `engine/src/ai/`. No engine
changes needed for Phase 3.

---

## 4. Open Questions

| # | Question | Where it blocks us |
|---|---|---|
| OQ-1 | Full scoring table: base points per meld, which conditions double | Module 1.8 |
| OQ-2 | Flower/Season bonus values (own flower vs other) | Module 1.9 |
| OQ-3 | Simultaneous win claims: how to resolve? | Module 1.5 (placeholder in 1.4: closest clockwise) |
| ~~OQ-4~~ | ~~Any additional special hands?~~ | Resolved |
| ~~OQ-5~~ | ~~Minimum points to declare a win?~~ | Resolved — no minimum |
| OQ-6 | Tile visuals: real imagery, Unicode, or custom SVG? | Module 2.1 |
| ~~OQ-7~~ | ~~Crocheting: what is the pair allowed to be?~~ | Resolved — any same-numbered pair |
| ~~OQ-8~~ | ~~Keep All Pungs, All Kongs, Heavenly Hand, Earthly Hand?~~ | Resolved — all kept |
| ~~OQ-9~~ | ~~All Honours: include 1s and 9s?~~ | Resolved — yes |
| ~~OQ-10~~ | ~~Ruby and Emerald: precise tile lists?~~ | Resolved — confirm at Module 1.7 |

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
| 2026-06-12 | All Honours includes 1s and 9s | Matches reference page and family understanding |
| 2026-06-12 | Ruby and Emerald kept; exact tile list to confirm at Module 1.7 | Extremely rare in practice |
| 2026-06-13 | `dirtyWinAllowed` defaults to `false` | Dirty hands too easy; special hands unaffected |
| 2026-06-13 | Single communal discard pool; no per-player tracking | No fish-back rule; discard authorship never recorded |
| 2026-06-13 | Each player has `name: string` on `PlayerState` | Required for display in pass-and-play and online modes |
| 2026-06-14 | Turn engine (1.4) is a pure state machine; Game Runner (1.4b) handles wiring | Keeps engine testable in isolation |
| 2026-06-14 | `PlayerController` interface lives in Game Runner, not the engine | Engine doesn't need to know who is making decisions |
| 2026-06-14 | Bonus tile loop one tile at a time via CHECK_BONUS phase | Each replacement draw is a distinct snapshot for UI animation |
| 2026-06-14 | Tile count invariant: `14 + kongCount` total tiles at discard time | Handles East initial deal and kong replacements correctly |
| 2026-06-14 | OQ-3 placeholder: closest clockwise wins on simultaneous win claims | Simple and deterministic; proper resolution deferred to Module 1.5 |
| 2026-06-14 | AI strategy module implements `PlayerController`; lives in `engine/src/ai/` | No engine changes needed for Phase 3 |
| 2026-06-14 | Module 1.6 exposes complete-meld predicates only; no partial melds, no canChow | Partial melds deferred to AI (Phase 3); canChow deferred to Module 1.5 |
| 2026-06-14 | MeldKind (`pair/pung/kong/chow`) distinct from MeldType (open/concealed kong) | Open vs concealed is a gameplay concern, not a structural one |

---

## 6. Working Conventions

### GitHub
- Repository: `addiep/mahjong` (private)
- **All completed code must be pushed to GitHub immediately after each module is done.**
- Push directly to `main` unless work is experimental.
- Commit messages: `Module X.Y — Short description` + bullet summary.
- `DESIGN.md` lives in the repo root; Claude reads it at session start and pushes updates as decisions are made.
