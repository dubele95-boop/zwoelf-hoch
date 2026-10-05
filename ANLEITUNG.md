# Zwölf hoch online stellen

Du brauchst zwei kostenlose Konten: **GitHub** (dort liegt der Code) und **Render** (dort läuft das Spiel). Kosten: keine. Dauer: etwa 15 Minuten.

## 1. Code zu GitHub hochladen

1. Konto anlegen auf https://github.com
2. Oben rechts auf **+** und dann **New repository** klicken.
3. Name: `zwoelf-hoch`. Den Rest so lassen und auf **Create repository** klicken.
4. Auf der neuen Seite den Link **uploading an existing file** anklicken.
5. Die ZIP-Datei entpacken, den Ordner `zwoelf-hoch` öffnen und **alles darin** (die Dateien und den Ordner `public`) ins Browserfenster ziehen.
6. Unten auf **Commit changes** klicken.

## 2. Bei Render starten

1. Auf https://render.com mit **Sign in with GitHub** anmelden.
2. Oben rechts auf **New +** und dann **Web Service** klicken.
3. Das Repository `zwoelf-hoch` auswählen (eventuell erst Zugriff erlauben).
4. Diese Einstellungen prüfen:
   - **Language/Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Auf **Deploy Web Service** klicken und 2 bis 3 Minuten warten.
6. Oben steht dann deine Adresse, z. B. `https://zwoelf-hoch-xyz.onrender.com`. Das ist euer Spiel.

## 3. Spielen

1. Adresse öffnen, Namen eingeben und **Neues Spiel erstellen** klicken.
2. In der Lobby auf **Kopieren** klicken und den Link an deine Freunde schicken (z. B. per WhatsApp).
3. Sie öffnen den Link, tragen ihren Namen ein und klicken **Beitreten**. Ein Konto brauchen sie nicht.
4. Wenn alle da sind: **Spiel starten**.

## Gut zu wissen

- **Erster Aufruf dauert:** Bei Render schläft das kostenlose Spiel nach 15 Minuten ohne Besucher ein. Der erste Aufruf kann dann bis zu einer Minute dauern. Danach läuft es flüssig.
- **Neustart löscht Spiele:** Laufende Partien sind nur im Arbeitsspeicher. Wenn Render den Server neu startet (z. B. nach dem Einschlafen), sind sie weg. Für einen Spieleabend ist das kein Problem.
- **Verbindung verloren?** Einfach die Seite neu laden. Du landest wieder an deinem Platz im Spiel, solange du denselben Browser benutzt.
- **Jemand reagiert nicht mehr?** Der Gastgeber kann oben **Zug überspringen** klicken.

## Auf dem eigenen PC testen (optional)

Wenn Node.js installiert ist (https://nodejs.org): Im Ordner `zwoelf-hoch` ein Terminal öffnen, `npm install` und dann `npm start` eingeben. Danach http://localhost:3000 öffnen. Mit mehreren Browserfenstern (eines davon privat/inkognito) kannst du mehrere Spieler simulieren.
