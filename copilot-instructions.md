# Frontline Companion — Copilot Instructions

## Prosjekt
Webbasert spilltracker for **Axis & Allies Global 1940**.
Brukeren jobber med vibkoding: du skal ta initiativ, foreslå løsninger proaktivt
og implementere endringer direkte uten unødige spørsmål.

## Teknologistack
- **Ingen bundler, ingen npm** — ren HTML/CSS/vanilla JS (ES6+)
- Python 3 stdlib-server (`data/saves-api.py`) for sky-lagring
- Alt spilldata bor i `data/data.js` som statiske JS-konstanter
- Kilddata (CSV) ligger i `src/` og brukes manuelt til å oppdatere `data.js`
- 

## Filstruktur
| Mappe | Innhold |
|-------|---------|
| `data/` | Appen: `index.html`, `style.css`, `app.js`, `data.js`, `saves-api.py` |
| `src/` | Kilddata: CSV-filer, bilder, mockups |
| `doc/` | Domene-dokumentasjon |

## Kodestil
- `'use strict'` øverst i alle JS-filer
- Funksjonell stil — unngå klasser der enkle funksjoner holder
- Variabler og kommentarer: **engelsk**
- All UI-tekst: **norsk** og **engelsk** versjon (f.eks. `const UI_TEXT = { en: {...}, no: {...} }`)
- Konsistent innrykk: 2 mellomrom
- Unngå å legge til biblioteker eller byggsteg uten eksplisitt avtale

## Spilldomene
- Nasjoner: `germany`, `italy`, `japan`, `soviet`, `usa`, `china`, `uk_europe`, `uk_pacific`, `anzac`, `france`
- Aksemakter: Germany, Italy, Japan (`AXIS_SET`)
- Allierte: resten (`ALLIED_SET`)
- Seiersbetingelser: Axis vinner ved ≥13 seiersbyer (VC); Allierte vinner ved å holde Axis under 13
- Spillfaser følger `PHASES`-arrayen i `data.js` (fase 0–6 + underfaser)

## Viktige mønstre
- Territoriekontroll: alltid via `getController(territoryId)` — ikke direkte fra `state.territories`
- State er ett globalt objekt; bruk `defaultState()` som mal
- `purchaseCart` og `repairTokens` er session-only, ikke persistert
- Objektiv-regler: `OBJECTIVE_RULES[objId]()` returnerer `true/false`

## Hva du alltid skal gjøre
- Svar på norsk med mindre brukeren skriver på engelsk
- Implementer endringer direkte, ikke bare foreslå dem
- Valider mot eksisterende `NATIONS`, `TERRITORIES` og `UNITS`-data i `data.js` før du legger til logikk
- Kjør opp mot eksisterende kodekonvensjoner i `app.js` og `style.css`
- Bruk navnestandarden for nasjons-ID-er (lowercase: `germany`, ikke `Germany`)
- Logg alle endringer i `CHANGELOG.md` med dato og beskrivelse
- Skriv alle prompts i markdown-format for klarhet i loggen PROMPTS.md
- Det skal alltid være en norsk og en engelsk versjon av alle UI-tekster

