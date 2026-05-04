# Frontline Companion — Claude Instructions

## Project

Browser-based companion app for **Axis & Allies Global 1940 2nd Edition**.
Single-page app (SPA) — vanilla HTML/CSS/ES6+ JS, no framework, no bundler, no npm.

**Vibe-coding project**: implement changes directly, propose solutions proactively, minimize clarifying questions.

---

## Game Domain

- **Nations**: `germany`, `italy`, `japan`, `soviet`, `usa`, `china`, `uk_europe`, `uk_pacific`, `anzac`, `france`
- **Axis** (`AXIS_SET`): Germany, Italy, Japan
- **Allies**: all others
- **Victory condition**: Axis wins by holding ≥13 victory cities (VC); Allies win by keeping Axis below 13
- **Turn phases** follow the `PHASES` array in `data.js` (phases 0–6 plus sub-phases per nation)

---

## Architecture

```
data/index.html      — single HTML shell, no server-side rendering
data/i18n.js         — bilingual string table + window.t() helper  (load FIRST)
data/data.js         — all game constants: NATIONS, TERRITORIES, UNITS, PHASES, etc.
data/app.js          — all app logic: state, rendering, event handlers (~4000 lines)
data/style.css       — all styles (~4000 lines)
data/rules.html      — rules reference page (bilingual toggle)
data/saves-api.py    — optional Python 3 HTTP server for cloud saves (port 8765)
src/                 — source CSVs, images, mockups (not served by the app)
```

Script load order in `index.html` matters: `i18n.js` → `data.js` → `app.js`.

---

## Key State Shape (`defaultState()`)

```js
{
  round: 1,
  lang: 'no',                    // 'no' | 'en'
  currentTurnIndex: 0,
  turnPhases: {},                 // { [tid]: string[] } — completed phases
  nations: {
    [tid]: {
      treasury: number,
      manualAdjust: number,
      warBonds: number,
      convoyLoss: number,
      capturedTreasury: number,
      technologies: string[],
      rdTokens: number,
      objectives: {},
    }
  },
  territories: {
    [tid]: { controller: string, originalOwner: string }
  },
  facilityDamage: { [tid]: number },
  history: [],
  vc: {},
}
```

Critical patterns:
- Territory control: always via `getController(territoryId)` — never read `state.territories[tid]` directly
- `purchaseCart` and `repairTokens` are session-only, not persisted
- Objective rules: `OBJECTIVE_RULES[objId]()` returns `true`/`false`

---

## i18n Conventions

All UI strings are bilingual. **Never hardcode Norwegian or English text in JS template literals.**

### Adding a new string

1. Add the key to **both** `no` and `en` sections of `data/i18n.js`:
   ```js
   // Norwegian section
   'my.key': 'Norsk tekst',
   // English section
   'my.key': 'English text',
   ```
2. Use `t('my.key')` in JS / template literals in `app.js`
3. Use `data-i18n="my.key"` on static HTML elements in `index.html`

### Template variables

```js
t('toast.saved', { name: 'My Game' })   // replaces {name} in the string
```

### Static HTML i18n

`applyStaticI18n()` processes all `[data-i18n]` elements on load and on language switch.
Elements with `data-i18n-attr="title"` get the value written to their `title` attribute instead of `textContent`.

### Language toggle

`toggleLang()` in `app.js`:
- Toggles `state.lang` between `'no'` and `'en'`
- Clears `dataset.built` on nation card grid + battle panels (forces full DOM rebuild)
- Calls `applyStaticI18n()` + `renderAll()`
- Sends `postMessage({lang})` to the rules iframe

### Variable name collision

`window.t()` is the translation helper. Inside functions that use `t` as a local variable (e.g. a territory object), rename the local to `terr` to avoid shadowing.

---

## Code Style

- `'use strict'` at top of every JS file
- Functional style — avoid classes where plain functions suffice
- Variable names and code comments: **English**
- UI text: always via `t('key')` — never hardcoded
- 2-space indentation
- No external dependencies without explicit agreement
- No bundler, no build step

---

## Bombing UI

Strategic bombing missions use manual input — no dice rolling in the app.
Mission state shape: `{ id, terrId, facType, flyType, assigned, aaHits, survivors, damage }`

Key functions:
- `onMissionAAInput(tid, mid, val)` — update AA hits + survivors badge
- `onMissionDamageInput(tid, mid, val)` — update damage + HP bar preview
- `updateMissionFacStatusBar(tid, mid)` — recompute HP bar (committed + pending damage)
- `applyBombing(tid)` — commit all pending mission damage to `state.facilityDamage`

---

## Battle Simulator

No dice rolling. Players enter hits manually.
- `onBattleHitsChange()` — enable/disable apply button
- `applyBattleHits()` — show result panel
- `resetBattle()` — clear all inputs and results

---

## Rules Page

`data/rules.html` — bilingual toggle via `.lang-no` / `.lang-en` CSS classes on `body`.
Listens for `postMessage({lang})` from the parent frame.
