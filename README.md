# A&A Global 1940 — Frontline Companion

## Prosjektbeskrivelse
Webbasert spilltracker for Axis & Allies Global 1940. Single-page app (SPA)
bygget med vanilla HTML, CSS og JavaScript – ingen rammeverk, ingen bundler.
Python-backend (`saves-api.py`) gir server-lagring via enkelt HTTP-API.

## Teknologistack
- **Frontend**: Vanilla HTML5 / CSS3 / ES6+ JavaScript (ingen npm, ingen bundler)
- **Backend**: Python 3 stdlib HTTP-server, ingen tredjepartsbiblioteker
- **Data**: Statiske JS-filer (`data.js`) – alt spilldata er hardkodet her
- **Kilddata**: CSV-filer i `src/` brukes som *kilde* til manuell oppdatering av `data.js`

## Filstruktur
```
data/          ← Selve appen (HTML, CSS, JS, Python-server)
src/           ← Kildemateriale (CSV-data, bilder, mockups)
doc/           ← Dokumentasjon
.github/       ← Copilot-instruksjoner
```

## Kjøre lokalt
Åpne `data/index.html` direkte i nettleseren (ingen bygg nødvendig).

For sky-lagring, start Python-serveren:
```bash
cd data
python saves-api.py        # kjører på port 8765 som standard
python saves-api.py 9000   # egendefinert port
```

## Kode­stil
- Funksjonell stil – unngå klasser der rene funksjoner holder
- `'use strict'` øverst i alle JS-filer
- Kommentarer og variabelnavn på engelsk; UI-tekst på norsk
- Ingen eksterne avhengigheter uten eksplisitt samtykke
