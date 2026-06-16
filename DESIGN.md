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
| Knitting | Limit | Seven pairs of matching numbers across exactly two suits. No Winds or Dragons. |
| Crocheting (Triple Knitting) | ½ limit | Four sets of three same-numbered tiles across all three suits + one pair of same numbers. |
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
- Win validation deferred to Module 1.7; claims currently accepted unconditionally.
- Known gap: no action yet for the *added kong* (promoting an exposed pung to an open
  kong with a drawn tile). `DECLARE_CONCEALED_KONG` only handles four matching tiles in
  the concealed hand. Implementing the added kong also requires a Robbing the Kong claim
  window (the added tile may complete another player's hand). Tracked as OQ-12.
- Status: **complete** — commit `d59a21`; updated in `dd8d003` (wired claim-window). Added-kong action outstanding (OQ-12).

#### Module 1.4b — Game Runner
- `PlayerController` interface: `getDiscardAction` + `getClaimDecision`.
- `GameRunner` drives one hand; auto-dispatches non-decision actions; gathers claim
  decisions concurrently then applies serially.
- Status: **complete** — commit `9de3f8a`

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
- Knitting/Crocheting use a documented first-cut interpretation pending OQ-13; the default
  game (knitting off) is unaffected.
- Status: **complete** — commit `3b9c7da` (25 vitest cases passing).

#### Module 1.8 — Scoring Engine
- Calculates score for a winning hand (base points + doublings + bonuses).
- Uses the shared decomposition helper to enumerate every valid reading of the hand and
  scores the highest-paying one (the player is entitled to their best score).
- Config-driven: points table in a JSON/TS config file.
- Scoring table now established (see §1 Scoring System above).
- Status: **not started**

#### Module 1.9 — Flower / Season Scoring
- Bonus tile scoring at end of hand: flat 4 points per flower or season.
- No own-flower distinction and no own-flower doubling (OQ-2 resolved).
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
| ~~OQ-1~~ | ~~Full scoring table: base points per meld, which conditions double~~ | Resolved — see Scoring System in §1 |
| ~~OQ-2~~ | ~~Flower/Season bonus values (own flower vs other)~~ | Resolved — flat 4 pts each; no own/other distinction; no own-flower doubling |
| ~~OQ-3~~ | ~~Simultaneous win claims: how to resolve?~~ | Resolved — closest in turn order (smallest positive seat-index offset from discarder) |
| ~~OQ-4~~ | ~~Any additional special hands?~~ | Resolved |
| ~~OQ-5~~ | ~~Minimum points to declare a win?~~ | Resolved — no minimum |
| OQ-6 | Tile visuals: real imagery, Unicode, or custom SVG? | Module 2.1 |
| ~~OQ-7~~ | ~~Crocheting: what is the pair allowed to be?~~ | Resolved — any same-numbered pair |
| ~~OQ-8~~ | ~~Keep All Pungs, All Kongs, Heavenly Hand, Earthly Hand?~~ | Resolved — all kept |
| ~~OQ-9~~ | ~~All Honours: include 1s and 9s?~~ | Resolved — yes |
| ~~OQ-10~~ | ~~Ruby and Emerald: precise tile lists?~~ | Resolved — both hands removed |
| ~~OQ-11~~ | ~~Purity: limit hand or ×3 doubling?~~ | Resolved — ×3 doubling (unorthodox family rule) |
| OQ-12 | Robbing the Kong: claim-window interaction when an exposed pung is promoted to a kong | Module 1.4 added-kong action |
| OQ-13 | Knitting / Crocheting: exact tile structure ("matching numbers across two suits"; what the crocheting pair may be). Module 1.7 ships a first-cut interpretation gated behind `knittingEnabled` | Module 1.7 special-hand detection |

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
| 2026-06-16 | Added kong (promoting an exposed pung) and Robbing the Kong not yet implemented in the turn engine; logged as a gap (OQ-12) | The `open_kong` type anticipates it, but no action exists and `DECLARE_CONCEALED_KONG` needs all four tiles in hand |
| 2026-06-16 | Circumstance hands detected by the hand evaluator via a provenance context object, not by the turn engine alone | Keeps all hand-identification in one module for the scorer; supersedes the 2026-06-14 framing |
| 2026-06-16 | Hand evaluator's public result is binary (winning hand or not); enumerating readings to maximise score is the scorer's job | Win detection is all the engine and AI need; the decomposition search is a shared helper both modules call. Supersedes the earlier "returns all decompositions" note |
| 2026-06-16 | Module 1.7 complete: binary `isWinningHand` + shared `decomposeStandard`; All Pungs (no-chow) bypass keeps mixed-suit limit hands valid with dirtyWin off; 25 vitest cases | Trickiest module; built and tested in isolation per conventions |
| 2026-06-16 | Knitting/Crocheting given a first-cut interpretation behind `knittingEnabled`; exact rule deferred to OQ-13 | Family definitions are ambiguous; the default game (knitting off) is unaffected |

---

## 6. Working Conventions

### GitHub
- Repository: `addiep/mahjong` (private)
- **All completed code must be pushed to GitHub immediately after each module is done.**
- Push directly to `main` unless work is experimental.
- Commit messages: `Module X.Y — Short description` + bullet summary.
- `DESIGN.md` lives in the repo root; Claude reads it at session start and pushes updates as decisions are made.
