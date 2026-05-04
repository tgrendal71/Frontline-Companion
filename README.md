# Frontline Companion
### Digital spillhjelper for Axis & Allies Global 1940

> **Norsk** | [English below](#english)

---

Frontline Companion er et hobbyprojekt laget for å gjøre det lettere å spille lange partier av Axis & Allies Global 1940. Isteden for å holde styr på alt med blyant, papir og kalkulator kan spillerne bruke denne appen — på nettbrett, laptop eller PC — mens brettet ligger fremme på bordet.

## Funksjoner

| Modul | Beskrivelse |
|---|---|
| 🗺️ Territorier | Hvem kontrollerer hva, IPC-inntekt og hurtigoverdragelse |
| 💰 Kjøp & reparasjon | Handlekurv med live IPC-saldo, fabrikkreparering |
| 💣 Strategisk bombing | Manuell AA-treff, overlevende fly og skade; HP-bar per fabrikk |
| 🚀 Rakettangrep | Sporting av rakettskader på industrianlegg |
| ⚔️ Kampsimulator | Forventede treff, manuell innregistrering av tap |
| 🔬 Forskning & utvikling | Terningbasert FoU og teknologioversikt per nasjon |
| 🎯 Nasjonale mål | Automatisk evaluering av bonusmål |
| 🏆 Seiersbyer | Visuell aksje/alliert-oversikt med seiersindikator |
| 📜 Historikk | Inntektslogg, kjøp, bombing og territorieendringer per runde |
| 🌐 Tospråklig | Norsk/engelsk — byttes med NO/EN-knappen i headeren |

## Slik bruker du appen

Appen følger spillets egne faser. For hver nasjon sin tur:

1. **Fase 0 – Forskning** — Kjøp FoU-terninger og registrer eventuelle gjennombrudd
2. **Fase 1 – Kjøp** — Velg enheter fra katalogen, appen trekker fra IPC-beholdningen automatisk. Reparer skadede fabrikker her
3. **Fase 2–3 – Bevegelse & kamp** — Bruk kampsimulator for å beregne forventede treff, registrer resultater manuelt etter terningkast
4. **Bombing** — Åpne bombardement-seksjonen under nasjonen din, velg mål og fasilitetstype, fyll inn AA-treff og skade
5. **Fase 6 – Inntekt** — Trykk "Samle inn inntekt" for å avslutte nasjonen sin runde. Alle mål evalueres automatisk
6. **Neste runde** — Når alle nasjoner er ferdige nullstilles fasene automatisk og nytt runde starter

Lagre spillet underveis via **Oppsett → Lagre** (krever Python-serveren, se oppsett nedenfor).

## Hurtigstart — lokalt

Ingen installasjon nødvendig. Åpne filen direkte i nettleseren:

```
data/index.html
```

Det er alt. Fungerer i alle moderne nettlesere, inkludert mobil og nettbrett.

## Oppsett med lagring (lokalt nettverk)

For å aktivere lagring av spilltilstand trenger du Python 3 (følger med de fleste systemer).

```bash
cd data
python3 saves-api.py          # starter på port 8765
python3 saves-api.py 9000     # egendefinert port
```

Åpne deretter `data/index.html` i nettleseren. I **Oppsett**-fanen setter du server-URL til `http://localhost:8765`.

---

## Oppsett på Raspberry Pi

Raspberry Pi er ideell hvis du vil ha appen tilgjengelig for alle spillere på bordet via deres egne nettbrett eller telefoner — uten internett.

### Forutsetninger

- Raspberry Pi (hvilken som helst modell med Wi-Fi, f.eks. Pi 3B+ eller Pi 4)
- Raspberry Pi OS (Lite eller Desktop)
- Python 3 (ferdiginstallert på Pi OS)
- Git (ferdiginstallert på Pi OS)

### 1. Last ned appen

```bash
git clone https://github.com/tgrendal71/Frontline-Companion.git
cd Frontline-Companion
```

### 2. Start serverne

Du trenger to prosesser: én for selve appfilene og én for lagring.

```bash
# Terminal 1 — statiske filer (port 8080)
cd data
python3 -m http.server 8080

# Terminal 2 — lagring (port 8765)
cd data
python3 saves-api.py
```

### 3. Finn Pi-ens IP-adresse

```bash
hostname -I
# Eksempel: 192.168.1.42
```

### 4. Koble til fra nettbrett eller PC

Åpne nettleseren på en hvilken som helst enhet på samme nettverk og gå til:

```
http://192.168.1.42:8080
```

I **Oppsett**-fanen setter du server-URL til `http://192.168.1.42:8765` for å aktivere lagring.

### 5. Autostart ved oppstart (valgfritt)

Opprett en systemd-service slik at appen starter automatisk når Pi-en slås på:

```bash
sudo nano /etc/systemd/system/frontline.service
```

Lim inn følgende (juster stien til mappen din):

```ini
[Unit]
Description=Frontline Companion
After=network.target

[Service]
WorkingDirectory=/home/pi/Frontline-Companion/data
ExecStart=/bin/bash -c 'python3 -m http.server 8080 & python3 saves-api.py'
Restart=on-failure
User=pi

[Install]
WantedBy=multi-user.target
```

Aktiver og start tjenesten:

```bash
sudo systemctl enable frontline
sudo systemctl start frontline
```

Sjekk status:

```bash
sudo systemctl status frontline
```

Pi-en er nå klar og appen er tilgjengelig på nettverket hver gang Pi-en er påslått.

---

## Om prosjektet — vibe-koding

Dette prosjektet er bygget 100 % gjennom **vibe-koding** — en arbeidsmetode der man beskriver ønsket funksjonalitet i naturlig språk og lar en AI (Claude) skrive og forbedre koden. Jeg sitter ikke og skriver linjene selv; jeg setter retning, tester resultater og gir tilbakemeldinger.

Det betyr:
- Koden skrives av AI, idéene og designvalgene er mine
- Feil og mangler rettes i dialog med AI, ikke ved å google Stack Overflow
- Appen har vokst fra et enkelt konsept til et fullverdig verktøy uten at jeg kan kalle meg en tradisjonell programmerer

Vibe-koding er ikke jusk — det er et verktøy, akkurat som kalkulator ikke er juks i matematikk. Prosjektet er et eksempel på hva en vanlig person med et klart mål kan bygge med AI som samarbeidspartner.

Pull requests og forbedringer er velkomne!

## Teknologistack

- **Frontend**: Vanilla HTML5 / CSS3 / ES6+ — ingen npm, ingen bundler, ingen rammeverk
- **Backend**: Python 3 stdlib — ingen tredjepartsbiblioteker nødvendig
- **Spilldata**: `data/data.js` — statiske JS-konstanter
- **Flerspråklig**: `data/i18n.js` — norsk/engelsk UI-tabell med `window.t()` hjelper

---

<a name="english"></a>

# Frontline Companion
### Digital companion app for Axis & Allies Global 1940

> [Norsk ovenfor](#top) | **English**

---

Frontline Companion is a hobby project built to make long sessions of Axis & Allies Global 1940 easier to manage. Instead of tracking everything with pencil, paper, and a calculator, players can use this app — on a tablet, laptop, or PC — while the board is laid out on the table.

## Features

| Module | Description |
|---|---|
| 🗺️ Territories | Who controls what, IPC income, and quick transfer |
| 💰 Purchases & repairs | Shopping cart with live IPC balance, factory repair |
| 💣 Strategic bombing | Manual AA hits, surviving planes, and damage; HP bar per facility |
| 🚀 Rocket attacks | Tracks rocket damage on industrial complexes |
| ⚔️ Battle simulator | Expected hits, manual casualty entry |
| 🔬 Research & development | Dice-based R&D and technology tracking per nation |
| 🎯 National objectives | Automatic evaluation of bonus objectives |
| 🏆 Victory cities | Visual Axis/Allied overview with win indicator |
| 📜 History | Income log, purchases, bombing, and territory changes per round |
| 🌐 Bilingual | Norwegian/English — toggled with the NO/EN button in the header |

## How to use the app

The app follows the game's own phases. For each nation's turn:

1. **Phase 0 – Research** — Buy R&D dice and record any breakthroughs
2. **Phase 1 – Purchase** — Select units from the catalogue; the app deducts IPC automatically. Repair damaged facilities here
3. **Phases 2–3 – Movement & combat** — Use the battle simulator to calculate expected hits, then record results manually after rolling
4. **Bombing** — Open the bombing section under your nation, choose target and facility type, enter AA hits and damage dealt
5. **Phase 6 – Collect income** — Click "Collect income" to end the nation's turn. All objectives are evaluated automatically
6. **Next round** — When all nations are done, phases reset automatically and a new round begins

Save your game via **Settings → Save** (requires the Python server, see setup below).

## Quick start — local

No installation needed. Open the file directly in your browser:

```
data/index.html
```

That's it. Works in all modern browsers, including mobile and tablet.

## Setup with saving (local network)

To enable game-state saving you need Python 3 (included with most systems).

```bash
cd data
python3 saves-api.py          # starts on port 8765
python3 saves-api.py 9000     # custom port
```

Then open `data/index.html` in the browser. In the **Settings** tab, set the server URL to `http://localhost:8765`.

---

## Raspberry Pi setup

A Raspberry Pi is ideal if you want the app available to all players at the table via their own tablets or phones — no internet required.

### Prerequisites

- Raspberry Pi (any Wi-Fi model, e.g. Pi 3B+ or Pi 4)
- Raspberry Pi OS (Lite or Desktop)
- Python 3 (pre-installed on Pi OS)
- Git (pre-installed on Pi OS)

### 1. Download the app

```bash
git clone https://github.com/tgrendal71/Frontline-Companion.git
cd Frontline-Companion
```

### 2. Start the servers

You need two processes: one for the app files and one for saving.

```bash
# Terminal 1 — static files (port 8080)
cd data
python3 -m http.server 8080

# Terminal 2 — save API (port 8765)
cd data
python3 saves-api.py
```

### 3. Find the Pi's IP address

```bash
hostname -I
# Example: 192.168.1.42
```

### 4. Connect from a tablet or PC

Open the browser on any device on the same network and go to:

```
http://192.168.1.42:8080
```

In the **Settings** tab, set the server URL to `http://192.168.1.42:8765` to enable saving.

### 5. Auto-start on boot (optional)

Create a systemd service so the app starts automatically when the Pi powers on:

```bash
sudo nano /etc/systemd/system/frontline.service
```

Paste the following (adjust the path to your folder):

```ini
[Unit]
Description=Frontline Companion
After=network.target

[Service]
WorkingDirectory=/home/pi/Frontline-Companion/data
ExecStart=/bin/bash -c 'python3 -m http.server 8080 & python3 saves-api.py'
Restart=on-failure
User=pi

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable frontline
sudo systemctl start frontline
```

Check status:

```bash
sudo systemctl status frontline
```

The Pi is now ready and the app is available on the network whenever the Pi is powered on.

---

## About the project — vibe-coding

This project was built 100% through **vibe-coding** — a way of working where you describe what you want in plain language and let an AI (Claude) write and improve the code. I don't write the lines myself; I set the direction, test the results, and give feedback.

This means:
- The code is written by AI, the ideas and design choices are mine
- Bugs and missing features are fixed in conversation with the AI, not by googling Stack Overflow
- The app grew from a simple concept into a fully featured tool without me being a traditional programmer

Vibe-coding isn't cheating — it's a tool, just like a calculator isn't cheating in maths. This project is an example of what an ordinary person with a clear goal can build with AI as a collaborator.

Pull requests and improvements are welcome!

## Tech stack

- **Frontend**: Vanilla HTML5 / CSS3 / ES6+ — no npm, no bundler, no framework
- **Backend**: Python 3 stdlib — no third-party libraries required
- **Game data**: `data/data.js` — static JS constants
- **i18n**: `data/i18n.js` — Norwegian/English UI string table with `window.t()` helper
