# PAPER Online Multiplayer (Paper.io Klon)

Minimalistisches Online-**Paper.io** komplett in React, TypeScript & HTML5 Canvas (schwarzer Hintergrund, ruhige Typografie, klare Spielerfarben) — für **bis zu 8 Spieler** und **bis zu 30 KI-Bots** (insgesamt bis zu 38 Teilnehmer gleichzeitig in einer Arena), **komplett ohne externen Spielserver**.

Der Spieler, der einen Room erstellt (**Host**), simuliert das Spiel autoritativ mit **30 Hz** direkt im Browser. Mitspieler verbinden sich per **WebRTC DataChannel (PeerJS)** über den Room-Code oder Invite-Link, senden Steuerungseingaben verzögerungsfrei und rendern Positionen per **60+ FPS Client-Interpolation**.

## Features
- **Bis zu 8 menschliche Spieler** via WebRTC P2P + **0 bis 30 KI-Bots**
- **3 Spielmodi**:
  - **Zeitmodus · 3 Min** (Respawn nach 2,5 s, höchster Flächenanteil gewinnt)
  - **Zeitmodus · 5 Min** (Längere Arena-Runde mit Respawn)
  - **Knockout** (Battle Royale ohne Respawn — letzter Überlebender oder 99,5 % Fläche gewinnt)
- **Runde Arena & flüssige Maus-Steuerung**:
  - Kreisförmiges Spielfeld (`Radius 76 Zellen`) inkl. runder Live-Minimap
  - Stufenlose 360°-Steuerung per Mauszeiger oder Touch-Position
- **Responsives 30-Hz-Multiplayer & 60-FPS-Rendering**:
  - Direkter Input-Kanal ohne ACK-Wartezeit
  - RLE-komprimierte Start-Synchronisation & kompakte Delta-Cell-Diffs pro Tick
  - Flüssige Sub-Cell-Extrapolation, Live-Leaderboard, Kill-Feed & Spectator-Modus

## Lokal starten

```bash
npm install
npm run dev
```

Öffne `http://localhost:5176`.

## Tests & Typecheck

```bash
npm test
npm run typecheck
npm run build
```

