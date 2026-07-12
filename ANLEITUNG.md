# Whānau – Einrichtung Schritt für Schritt

Euer Familienplaner. Läuft komplett unabhängig auf GitHub Pages + Firebase –
kostenlos, ohne Claude, mit Echtzeit-Sync zwischen deinem und Jennys Handy.

Geplanter Zeitaufwand: **ca. 20–25 Minuten**, einmalig.

---

## Teil 1: Firebase einrichten (ca. 10 Min.)

Firebase (von Google) übernimmt Login und Datenspeicherung. Der kostenlose
"Spark"-Tarif reicht für eine Familie um ein Vielfaches.

1. **Projekt anlegen:** https://console.firebase.google.com → „Projekt hinzufügen"
   → Name z. B. `whanau-familie` → Google Analytics **deaktivieren** (nicht nötig) → Erstellen.

2. **Realtime Database anlegen:** Linkes Menü → *Build → Realtime Database* →
   „Datenbank erstellen" → Standort **Belgien (europe-west1)** wählen →
   Start im **gesperrten Modus**.

3. **Datenbank-Regeln setzen:** Reiter „Regeln" → Inhalt ersetzen durch:

   ```json
   {
     "rules": {
       "daten": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
   }
   ```
   → „Veröffentlichen". Damit können nur eingeloggte Familienmitglieder lesen/schreiben.

4. **Login aktivieren:** *Build → Authentication* → „Jetzt starten" →
   Anmeldemethode **E-Mail/Passwort** aktivieren.

5. **Zwei Benutzer anlegen:** Reiter „Users" → „Nutzer hinzufügen":
   - Deine E-Mail + Passwort (z. B. `julian@…`)
   - Jennys E-Mail + Passwort

   💡 Der Teil vor dem @ wird in der App als Anzeigename verwendet
   (z. B. bei Zetteln „von julian").

6. **Web-App registrieren:** Zahnrad oben links → *Projekteinstellungen* →
   ganz unten „Meine Apps" → Web-Symbol `</>` → Spitzname z. B. `whanau` →
   **Kein** Firebase Hosting nötig → Registrieren.

7. **Konfiguration kopieren:** Firebase zeigt dir jetzt einen `firebaseConfig`-Block.
   Öffne die Datei **`firebase-config.js`** und trage die Werte ein:
   `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`.

   ⚠️ Wichtig: `databaseURL` muss dabei sein. Falls sie im Config-Block fehlt,
   findest du sie oben in der Realtime Database
   (Format: `https://DEIN-PROJEKT-default-rtdb.europe-west1.firebasedatabase.app`).

---

## Teil 2: Auf GitHub Pages veröffentlichen (ca. 5 Min.)

Das Prozedere kennst du von der Abnahme-App:

1. Neues Repository anlegen, z. B. `whanau` (privat geht **nicht** mit
   kostenlosem Pages – nimm public; die Daten liegen ohnehin nicht im Repo,
   sondern in Firebase).
2. Alle Dateien aus diesem Ordner hochladen:
   `index.html`, `app.js`, `firebase-config.js`, `manifest.json`, `sw.js`,
   `icon-192.png`, `icon-512.png`
3. Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
4. Nach 1–2 Minuten ist die App erreichbar unter
   `https://DEIN-NAME.github.io/whanau/`

**Hinweis zum API-Key:** Der Firebase-apiKey im Repo ist kein Geheimnis –
er identifiziert nur das Projekt. Die Sicherheit kommt aus den
Datenbank-Regeln (Schritt 1.3) und den Login-Konten.

*Optional härten:* Firebase-Konsole → Authentication → Settings →
„Autorisierte Domains" → nur `DEIN-NAME.github.io` zulassen und
`localhost` entfernen. Zusätzlich: Nutzer-Registrierung ist ohnehin nur
über die Konsole möglich, da die App keine Registrierungsfunktion hat.

---

## Teil 3: Als App aufs Handy (2 Min. pro Gerät)

**Android (Chrome):** App-URL öffnen → Drei-Punkte-Menü → „App installieren"
bzw. „Zum Startbildschirm hinzufügen".

**iPhone (Safari):** App-URL öffnen → Teilen-Symbol → „Zum Home-Bildschirm".

Danach: eigenes Icon (grüne Koru-Spirale), öffnet im Vollbild ohne
Browserleiste, App-Shell funktioniert auch offline (Daten-Sync braucht Internet).

---

## Teil 4: Erste Schritte in der App

1. Anmelden mit deiner E-Mail/Passwort (Jenny mit ihrer).
2. **Mehr → Familie & Einstellungen:** Alle vier Mitglieder anlegen
   (Rolle „Erwachsen" bzw. „Kind"). Erst dann erscheinen Kinderbereich,
   Stundenplan und Zuständigkeiten.
3. **Eltern-PIN ändern** (Standard: 2468) – sie schützt den Ausgang
   aus dem Kinderbereich.
4. **Mehr → Kinder-Aufgaben & Sterne:** Pro Kind Aufgaben mit Emoji und
   Sterne-Wert anlegen, Belohnungsziel setzen (z. B. „20 ⭐ = Eis essen").
5. Kochbuch füllen, erste Routinen anlegen (z. B. „Müll rausbringen",
   Rotation) – der Rest ergibt sich im Alltag.

---

## Was die App kann (Überblick)

| Bereich | Funktionen |
|---|---|
| **Heute** | Begrüßung, Termine, Essen, fällige To-dos & Routinen, Packliste für morgen, Zettel, Countdowns, Wochenbilanz |
| **Termine** | Kalender (einmalig/wöchentlich), Stundenplan pro Kind, Ferienübersicht |
| **Listen** | Einkaufsliste (Kategorien), To-dos mit Zuständigkeit, Routinen mit Wochen-Rotation, Packlisten je Wochentag |
| **Essen** | Wochenplan, Familien-Kochbuch mit 40 Starter-Gerichten (Import-Button), smarte Vorschläge (lange nicht gekocht, werktags nur Schnelles, ab 3 Fleisch/Fisch-Tagen vegetarisch), Zutaten → Einkaufsliste per Klick |
| **Kinderbereich** | Verspielter Vollbild-Modus, große Aufgabenkarten mit Stern-Animation, Sternekonto mit Fortschrittsbalken & Belohnungsziel, Countdowns; Ausgang PIN-geschützt |
| **Mehr** | Zettelkasten, Countdowns, Wochenend-Ideen (Sonne/Regen), Geschenke-Merkliste, Gesundheits-Log, Notfall & Infos, Datensicherung (Export/Import als JSON) |
| **Automatisch** | Zeitbewusste Māori-Begrüßung (Mōrena/Kia ora), Geburtstags-Countdowns & -Banner, Ferien-Banner, Einkaufs-Schnellwahl aus euren häufigsten Artikeln, Offline-Anzeige, Update-Hinweis bei neuer Version, Dark Mode folgt der Systemeinstellung |

## Bekannte Grenzen

- **Kein Google-Kalender-Live-Sync** – Termine werden in der App gepflegt.
- Push-Benachrichtigungen sind (noch) nicht eingebaut.
- Datensicherung: unter „Mehr → Familie & Einstellungen" könnt ihr jederzeit
  ein JSON-Backup exportieren und wieder einspielen – eure Daten gehören euch.
- Offline können Daten gelesen, aber nicht zuverlässig geändert werden.

Für Erweiterungen: einfach die Dateien wieder in einen Claude-Chat laden
und beschreiben, was dazukommen soll.

Haere mai ki tō whare hou – willkommen in eurem neuen Familien-Zuhause! 🥝
