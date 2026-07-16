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

## Google-Kalender anbinden (nur lesen, ca. 15 Min.)

Die App zeigt einen gemeinsamen Google-Kalender automatisch mit an.
Eingetragen wird weiterhin in Google (Handy, PC, Sprachassistent) –
Whānau liest mit.

**Schritt 1 – Familienkalender anlegen:**
Google Kalender (PC) → links neben „Weitere Kalender" auf ＋ →
„Neuen Kalender einrichten" → Name „Familie" → Erstellen.
Dann: Einstellungen des Kalenders → „Für bestimmte Personen freigeben"
→ Jenny mit „Änderungen vornehmen" einladen. Ab jetzt tragt ihr
Familientermine in diesen Kalender ein.

**Schritt 2 – Private iCal-Adresse holen:**
Einstellungen des Familienkalenders → ganz unten
„Privatadresse im iCal-Format" → URL kopieren
(endet auf `basic.ics`). ⚠️ Diese URL nicht öffentlich teilen –
wer sie hat, kann die Termine lesen.

**Schritt 3 – Mini-Proxy auf Cloudflare (wegen Browser-CORS):**
Google erlaubt den Abruf nicht direkt aus dem Browser, deshalb ein
10-Zeilen-Worker. dash.cloudflare.com → Workers & Pages →
„Create Worker" → Code ersetzen durch:

```js
export default {
  async fetch(req) {
    const ziel = new URL(req.url).searchParams.get("url");
    if (!ziel || !ziel.startsWith("https://calendar.google.com/")) {
      return new Response("Nur Google-Kalender erlaubt", { status: 400 });
    }
    const r = await fetch(ziel, { cf: { cacheTtl: 300 } });
    return new Response(await r.text(), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/calendar; charset=utf-8"
      }
    });
  }
};
```

→ Deploy. Deine Worker-URL sieht dann so aus:
`https://DEIN-WORKER.DEIN-NAME.workers.dev`

**Schritt 4 – In der App eintragen:**
Mehr → Familie & Einstellungen → „Google-Kalender" → dort diese
kombinierte URL einfügen und speichern:

```
https://DEIN-WORKER.DEIN-NAME.workers.dev/?url=HIER-DIE-ICS-URL
```

(Die ICS-URL am besten vorher einmal durch einen URL-Encoder schicken
oder direkt so einfügen – der Worker kommt mit beidem klar, solange
keine &-Zeichen in der ICS-URL stecken; Googles Privatadressen haben keine.)

Die App lädt die Termine bei jedem Start und per ↻-Knopf im
Kalender-Tab (nächste 60 Tage, inkl. wöchentlicher Serien).
Google-Termine tragen ein 🌐 und sind in der App bewusst nicht löschbar.


---

## Teil 3: Als App aufs Handy (2 Min. pro Gerät)

**Android (Chrome):** App-URL öffnen → Drei-Punkte-Menü → „App installieren"
bzw. „Zum Startbildschirm hinzufügen".

**iPhone (Safari):** App-URL öffnen → Teilen-Symbol → „Zum Home-Bildschirm".

Danach: eigenes Icon (grüne Koru-Spirale), öffnet im Vollbild ohne
Browserleiste, App-Shell funktioniert auch offline (Daten-Sync braucht Internet).

---

## Teil 4: Erste Schritte in der App

1. Anmelden mit deiner E-Mail/Passwort (Jenny mit ihrer) – „Angemeldet
   bleiben" ist vorausgewählt, danach fragt die App nicht mehr.
   Beim ersten Start wählt jeder einmal „Wer nutzt die App auf diesem
   Gerät?" – damit stimmen Begrüßung und Zettel-Absender.
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

## Kinder-Tablets: Amazon Fire im Kids-Bereich

Die Kinder bleiben im Amazon-Kids-Profil – dafür gibt es zwei Wege.
Die App ist darauf vorbereitet: Das Firebase-SDK wird von eurer eigenen
GitHub-Seite mitgeliefert (nicht mehr von Google-Servern), damit die
Freigabeliste kurz bleibt.

### Weg A: Website im Kids-Profil freigeben (zuerst probieren)

Amazon erlaubt Eltern, einzelne Websites für Kinderprofile freizugeben –
sie erscheinen dann als Kachel beim Kind.

1. **Vorbereitung auf dem Tablet (im Elternprofil):** App-URL öffnen,
   anmelden, unter *Mehr → Familie → Dieses Gerät* das Kind auswählen
   und den **Kiosk-Modus** auf „An" stellen. Die App startet ab jetzt
   direkt im Kinderbereich; raus geht es nur mit eurer PIN.
2. **Freigeben:** Eltern-Dashboard (parents.amazon.com oder auf dem
   Tablet: Einstellungen → Kindersicherung → Kinderprofil →
   *Inhalte hinzufügen → Web*) → folgende Adressen freigeben:
   - `https://DEIN-NAME.github.io` (die App selbst, inkl. SDK)
   - `https://identitytoolkit.googleapis.com` (Anmeldung)
   - `https://securetoken.googleapis.com` (Sitzung verlängern)
   - `https://DEIN-PROJEKT-default-rtdb.europe-west1.firebasedatabase.app` (Daten-Sync)
   - optional `https://fonts.googleapis.com` und `https://fonts.gstatic.com`
     (nur Schrift – ohne sie läuft die App mit Systemschrift weiter)
3. Im Kids-Profil die Web-Kachel antippen → Kinderbereich öffnet sich.

⚠️ Ehrlicher Hinweis: Wie streng Amazons Kids-Browser Hintergrund-
Verbindungen filtert, ändert sich mit Updates und lässt sich nur am
Gerät testen. Wenn die App lädt, aber „Keine Verbindung" zeigt, blockt
der Browser die Sync-Domains – dann Weg B.

### Weg B: Als App verpacken und ins Kinderprofil legen (robust)

Ins Amazon-Kids-Profil lassen sich auch **selbst installierte Apps**
aufnehmen – das umgeht den Web-Filter komplett:

1. Auf **pwabuilder.com** die App-URL eingeben → *Package for Stores →
   Android* → Paket herunterladen (APK).
2. APK aufs Tablet (z. B. per USB oder Download-Link) und im
   Elternprofil installieren (*Einstellungen → Sicherheit → Apps aus
   unbekannten Quellen* für den Dateimanager erlauben).
3. *Einstellungen → Kindersicherung → Kinderprofil → Inhalte
   hinzufügen → Apps* → die Whānau-App fürs Kind freigeben.
4. Die App erscheint mit Koru-Icon im Kids-Bereich; dank Kiosk-Modus
   landet das Kind direkt bei seinen Aufgaben und Sternen.

Hinweis zu Weg B: Das PWABuilder-Paket öffnet die Web-App auf
Fire-Tablets über den Silk-Browser-Unterbau; einmal im Elternprofil
anmelden und Kiosk aktivieren, danach läuft es fürs Kind.


---

## Was die App kann (Überblick)

| Bereich | Funktionen |
|---|---|
| **Heute** | Begrüßung, Termine, Essen, fällige To-dos & Routinen, Packliste für morgen, Zettel, Countdowns, Wochenbilanz |
| **Termine** | Eigener Kalender (einmalig/wöchentlich, mehrere Teilnehmer), Google-Kalender-Anzeige (🌐, nur lesen), Stundenplan pro Kind, Ferienübersicht |
| **Listen** | Einkaufsliste mit automatischer Themen-Sortierung in Supermarkt-Laufreihenfolge, To-dos mit Zuständigkeit, Routinen mit Wochen-Rotation, thematische Packlisten mit Vorlagen (Schwimmbad, Camping, Flugreise …) und Zurücksetzen-Funktion |
| **Essen** | Wochenplan mit Wochen-Navigation (auch nächste Woche vorplanbar), „Offene Tage füllen"/„Woche neu würfeln" für die ganze angezeigte Woche, Wochentags-Traditionen (Sa = Pizza, Fr alle zwei Wochen Grillvorschlag), Frische-Logik rund um den einstellbaren Einkaufstag (🌿-Gerichte nur bis 2 Tage danach), Tag antippen → Rezept-Ansicht mit Zutaten & Zubereitungstipp, Familien-Kochbuch mit 50 Starter-Gerichten (inkl. Grillgerichten), smarte Vorschläge (lange nicht gekocht, werktags nur Schnelles, ab 3 Fleisch/Fisch-Tagen vegetarisch), Zutaten → Einkaufsliste per Klick |
| **Kinderbereich** | Verspielter Vollbild-Modus, große Aufgabenkarten mit Stern-Animation, Sternekonto mit Fortschrittsbalken & Belohnungsziel, Countdowns; Ausgang PIN-geschützt |
| **Mehr** | Zettelkasten, Countdowns, Wochenend-Ideen (Sonne/Regen), Geschenke-Merkliste, Gesundheits-Log, Notfall & Infos mit Vorlage (Notruf, Ärzte, Kleider-/Schuhgrößen – antippen zum Ausfüllen), Datensicherung (Export/Import als JSON) |
| **Taschengeld** | Wochen-Erinnerer: Kind hakt „Ich hab's bekommen!" ab (mit Münzregen), Reset zum Wochenstart; Betrag pro Kind im Elternbereich (0 € = ausgeblendet); verpasste Wochen summieren sich und erscheinen auf dem Eltern-Dashboard, per Knopf als ausgezahlt markierbar |
| **Kinder-Tablets** | Kiosk-Modus pro Gerät (Start direkt im Kinderbereich, Ausgang nur per PIN), Firebase-SDK lokal ausgeliefert für Amazon-Kids-Freigabe |
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
