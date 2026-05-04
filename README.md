# A&A Global 1940 — Frontline Companion

> **Norsk** | [English below](#english)

---

## Hva er Axis & Allies Global 1940?

Axis & Allies Global 1940 2nd Edition er et stort strategibrettspill der spillerne kontrollerer nasjoner fra 2. verdenskrig. Aksemaktene (Germany, Italy, Japan) kjemper mot de Allierte (Soviet, USA, UK Europe, UK Pacific, ANZAC, China, France) om kontroll over seiersbyer over hele verden. Spillet spilles over runder der hver nasjon kjøper enheter, beveger styrker, gjennomfører kamper og krever inn inntekter basert på territorier de kontrollerer.

## Hva er Frontline Companion?

Frontline Companion er en nettleserbasert hjelpapp for Axis & Allies Global 1940. Den erstatter blyant og papir og holder styr på:

- **Territories & IPC** — hvem som kontrollerer hva, og inntekter per runde
- **Kjøp & reparasjoner** — handlekurv for enheter, verifisering mot IPC-beholdning
- **Strategisk bombing** — manuel innfylling av AA-treff, overlevende fly og skade; HP-bar for fabrikker
- **Rakettangrep** — sporer rakettskader på industrianlegg
- **Kampsimulator** — kombattantlister, forventede treff, manuell registrering av resultater
- **Forskning & utvikling** — terning-basert FoU og teknologioppfølging per nasjon
- **Mål & objektiver** — automatisk evaluering av nasjonale mål
- **Seiersbyer** — visuell oversikt over hvem som kontrollerer hvilke VC-er
- **Historikk** — logg over inntekter og nøkkelhendelser per runde
- **Tospråklig** — norsk/engelsk byttes med EN/NO-knapp i headeren

Designet for nettbrett og PC. Ingen installasjon, ingen pålogging — åpne `data/index.html` i nettleseren og spill.

## Kom i gang

```bash
# Åpne direkte i nettleseren (ingen bygg nødvendig):
data/index.html

# For sky-lagring, start Python-serveren:
cd data
python saves-api.py        # port 8765 som standard
python saves-api.py 9000   # egendefinert port
```

## Teknologistack

- **Frontend**: Vanilla HTML5 / CSS3 / ES6+ JavaScript — ingen npm, ingen bundler
- **Backend**: Python 3 stdlib HTTP-server — ingen tredjepartsbiblioteker
- **Spilldata**: `data/data.js` — statiske JS-konstanter
- **i18n**: `data/i18n.js` — tospråklig UI-tabell + `window.t()` hjelper

## Vibe-koding

Dette prosjektet er utviklet 100 % med AI-assistert koding. Forbedringer og pull requests er velkomne.

---

<a name="english"></a>

## What is Axis & Allies Global 1940?

Axis & Allies Global 1940 2nd Edition is a large-scale strategic board game where players command nations from World War II. The Axis powers (Germany, Italy, Japan) battle the Allies (Soviet, USA, UK Europe, UK Pacific, ANZAC, China, France) for control of victory cities across the globe. Each round, nations buy units, move forces, fight battles, and collect income based on territories they control.

## What is Frontline Companion?

Frontline Companion is a browser-based companion app for Axis & Allies Global 1940. It replaces pencil and paper and keeps track of:

- **Territories & IPC** — who controls what, and income per round
- **Purchases & repairs** — unit shopping cart with IPC balance verification
- **Strategic bombing** — manual entry of AA hits, surviving planes, and damage dealt; HP bar for facilities
- **Rocket attacks** — tracks rocket damage on industrial complexes
- **Battle simulator** — combatant lists, expected hits, manual result entry
- **Research & development** — dice-based R&D and technology tracking per nation
- **Goals & objectives** — automatic evaluation of national objectives
- **Victory cities** — visual overview of VC control by side
- **History** — income and key event log per round
- **Bilingual** — Norwegian/English toggled with the EN/NO button in the header

Designed for tablets and PCs. No installation, no login — open `data/index.html` in a browser and play.

## Quick Start

```bash
# Open directly in browser (no build step needed):
data/index.html

# For cloud saves, start the Python server:
cd data
python saves-api.py        # default port 8765
python saves-api.py 9000   # custom port
```

## Tech Stack

- **Frontend**: Vanilla HTML5 / CSS3 / ES6+ JavaScript — no npm, no bundler
- **Backend**: Python 3 stdlib HTTP server — no third-party libraries
- **Game data**: `data/data.js` — static JS constants
- **i18n**: `data/i18n.js` — bilingual UI string table + `window.t()` helper

## Vibe-Coding

This project was developed 100% with AI-assisted coding. Improvements and pull requests are welcome.
