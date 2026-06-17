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

### Knitting & Crocheting
Two additional special hands, enabled or disabled as a single binary switch set before
the game begins. If the switch is off, neither hand is legal and neither appears in the
hand evaluator.

- **Knitting:** seven pairs across exactly two suits, where each pair is the same number
  taken once from each suit (e.g. bamboo-3 + characters-3). The two suits' per-value
  counts therefore match. No Winds or Dragons. (14 tiles: 7 cross-suit pairs.)
- **Crocheting (triple knitting):** four sets of three — one tile of the same number
  from each of the three suits — plus one pair of two tiles sharing a number (any suits).
  (14 tiles: 4×3 + 2.)

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
3. Player may declare a concealed kong, or add a drawn tile to an exposed pung to form a kong (draws replacement from dead wall).
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
- Original Call (declared fishing after the player's very first discard)

#### Additional doublings for the winning player only

- Clean hand (all melds and pair in one suit; Winds and Dragons permitted): ×1
- All concealed: ×1
- Winning with a loose tile, last tile of the wall, last discard, original call, or Robbing the Kong: ×1
- Purity (concealed pungs/kongs of one suit, no Winds/Dragons, no chows): ×3 *(unorthodox — most rulesets treat this as a limit hand)*
- Winds and Dragons only (all melds are Winds or Dragons): ×3
- Heads & Tails (all melds are 1s and 9s): ×3

#### Special hand scores
- All Pairs Honours: 500 points (200 when fishing)
- Buried Treasure: 1,000 points (400 when fishing)
- Limit hands: agreed maximum payout, set before play begins

### Special / Limit Hands
These override normal scoring. Hands in the first group require all tiles to be drawn
from the wall — the only exception is the final winning tile, which may be claimed from
a discard.

**First group (wall-draw rule applies):**

| Hand | Score | Description |
|---|---|---|
| Buried Treasure | 1,000 pts | Concealed pungs/kongs of one suit only + one pair. Winds and Dragons permitted. |
| Heavenly Twins | Limit | Seven pairs, all one suit. No Winds or Dragons. |
| Clean Pairs | ½ limit | Seven pairs of one suit, Winds and Dragons permitted. |
| Honour Pairs | Limit | Seven pairs composed only of Winds and Dragons (no 1s or 9s). |
| All Pairs Honours | 500 pts | Seven pairs composed only of 1s, 9s, Winds, and Dragons. |
| Knitting | Limit | Seven cross-suit pairs across exactly two suits (each pair = same number, one from each suit). No Winds or Dragons. |
| Crocheting (Triple Knitting) | ½ limit | Four sets of three same-numbered tiles across all three suits + one pair of two tiles sharing a number (any suits). |
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
- Status: **complete** — commit `f40e1a6`

#### Module 1.3 — Game State Model
- Status: **complete** — commit `7f799e3`; extended in `d59a21` (claimWindow) and `f9cb525` (robbingKong + ROBBING_KONG phase)

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
- Status: **complete** — commits `d59a21`, `dd8d003` (claim-window), `f9cb525` (added kong + Robbing the Kong).

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
  across two suits; the Crocheting pair is any two tiles sharing a number. Gated by
  `knittingEnabled` (off by default).
- Status: **complete** — commits `3b9c7da`, `5a615db` (26 vitest cases passing). Wired into
  Module 1.4's Robbing the Kong validation in `f9cb525`.

#### Module 1.8 — Scoring Engine
- Public entry point `scoreWinningHand(input, scoringConfig?)` returns a `ScoreResult`
  (total, special-hand name, base points, doublings, and a per-line breakdown).
- Uses the shared `decomposeStandard` helper to enumerate every valid reading of the hand,
  scores each, and keeps the highest-paying one (the player is entitled to their best score).
- Config-driven: the points table lives in `scoring-config.ts` (`DEFAULT_SCORING_CONFIG`),
  not hardcoded in the logic.
- Doublings are expressed as a *count* of ×2 multipliers, so a "×3" rule (Purity, Winds &
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
- Status: **complete** — commits `14fe9fb` (config + index), `7be1898` (engine + 18 vitest cases).

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
- The local seat's concealed hand is interactive: tiles can be dragged to
  rearrange (group pungs/runs, as with real tiles) and a one-tap Sort orders
  them by suit then number. Drag is custom (pointer events; mouse + touch, no
  library); reordering is view-only via `useHandOrder`, which reconciles the
  arrangement when the engine's `concealed` array changes — the engine is never
  touched, since tile order has no rules meaning.
- Still to come under 2.2: tile selection and the discard interaction (wired
  with the live turn engine).
- Status: **in progress** — drag-reorder + sort done (commit `8379f47`)

#### Module 2.3 — UI: Discard Pool + Wall
- Discards scatter across the central table without overlapping: the area is a
  measured grid of non-overlapping cells, each discard dropped into a spread,
  shuffled cell with a small jitter and tilt, stable across renders.
- The wall (undrawn tiles) frames the discards as a square ring of face-down
  stacks two tiles high (`Wall.tsx`). It is drawn clockwise (HK mahjong: turns
  pass anticlockwise but tiles leave the wall clockwise — see Decisions Log),
  the next-to-draw stack is highlighted with a ↻ marker, and the ring is bound
  to the live-wall count so it recedes as tiles are drawn. The two stack layers
  carry distinct shades and an odd remainder renders as a single bottom tile, so
  every individual draw is visible.
- The dead wall (reserved kong / flower replacements) and the two loose tiles
  are shown as a tray at the top, bound to `wall.dead.length`; the loose pair is
  kept topped up to two from the reserve.
- Status: **in progress** — discard scatter + wall + dead wall / loose tiles done
  (commits `04f2ccc`, `82111ce`, `03a9179`). Polished discard-pool detailing is
  the remaining 2.3 work.

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
| ~~OQ-11~~ | ~~Purity: limit hand or ×3 doubling?~~ | Resolved — ×3 doubling (unorthodox family rule) |
| ~~OQ-12~~ | ~~Robbing the Kong: claim-window interaction when an exposed pung is promoted to a kong~~ | Resolved & implemented (commit `f9cb525`) — added kong only; robbed by a player completing their win on that tile; concealed kongs safe |
| ~~OQ-13~~ | ~~Knitting / Crocheting: exact tile structure~~ | Resolved — Knitting = seven cross-suit number pairs across two suits; Crocheting pair = any two tiles sharing a number |
| OQ-14 | Should the dead wall be replenished from the live wall to stay at 14 (traditional rule), or simply deplete as the engine currently does? | UI shows loose tiles topping up from the reserve; engine does not replenish. Possible future engine change (Module 1.2 / 1.4) |

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
| 2026-06-16 | OQ-13a resolved: Knitting = seven cross-suit pairs across two suits (same number from each suit; per-value counts match) | Family rule; `isKnitting` updated in commit `5a615db` (26 vitest cases) |
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
| 2026-06-17 | Dead wall + two loose tiles shown as a tray, bound to `wall.dead.length`; loose pair topped up to two from the reserve | Portrays kong/flower replacements. NOTE: the engine takes replacements from the reserved 14-tile dead wall (which depletes) and does NOT replenish it from the live wall to keep it at 14 (the traditional rule) — flagged as a possible future engine change (Module 1.2 / 1.4), see OQ-14 |

---

## 6. Working Conventions

### GitHub
- Repository: `addiep/mahjong` (private)
- **All completed code must be pushed to GitHub immediately after each module is done.**
- Push directly to `main` unless work is experimental.
- Commit messages: `Module X.Y — Short description` + bullet summary.
- `DESIGN.md` lives in the repo root; Claude reads it at session start and pushes updates as decisions are made.
