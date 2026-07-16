/* ============================================================
   Whānau – Familienplaner  |  app.js
   Eltern-Ansicht (clean) + Kindermodus (verspielt)
   Sync über Firebase Realtime Database
   ============================================================ */

"use strict";

/* ---------- Hilfsfunktionen ---------- */
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LANG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const SCHULTAGE = ["Mo", "Di", "Mi", "Do", "Fr"];
const FARBEN = ["#17695B", "#2A6FA8", "#B0642D", "#7A4E9E", "#C24E6A", "#3E8244", "#946A15", "#4E6E81"];

function dstr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function heute() { return dstr(new Date()); }
function morgen() { const d = new Date(); d.setDate(d.getDate() + 1); return dstr(d); }
function wtag(datumStr) { return WD[new Date(datumStr + "T12:00:00").getDay()]; }
function fmt(datumStr) { const d = new Date(datumStr + "T12:00:00"); return WD[d.getDay()] + ", " + d.getDate() + ". " + MON[d.getMonth()].slice(0, 3) + "."; }
function fmtLang(d) { return WD_LANG[d.getDay()] + ", " + d.getDate() + ". " + MON[d.getMonth()]; }
function wochenStart(d) { const x = new Date(d); const t = (x.getDay() + 6) % 7; x.setDate(x.getDate() - t); return x; }
function isoWoche(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const t = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - t + 3); const j = new Date(Date.UTC(x.getUTCFullYear(), 0, 4)); return 1 + Math.round(((x - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); }
function tageBis(datumStr) { const a = new Date(heute() + "T00:00:00"), b = new Date(datumStr + "T00:00:00"); return Math.round((b - a) / 864e5); }
function vib(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} }
let sheetCb = null;
function sheetInput(titel, placeholder, startwert, cb) {
  sheetCb = cb;
  $("sheet").innerHTML = `<h3>${esc(titel)}</h3>
    <input id="sheet-val" class="sheetinput" placeholder="${esc(placeholder)}" value="${esc(startwert || "")}"
      onkeydown="if(event.key==='Enter')sheetOk()">
    <div style="display:flex;gap:8px"><button class="btn ghost" style="flex:1" onclick="sheetClose()">Abbrechen</button>
    <button class="btn" style="flex:1" onclick="sheetOk()">Speichern</button></div>`;
  $("modal").classList.add("open");
  setTimeout(() => { const el = $("sheet-val"); if (el) el.focus(); }, 50);
}
function sheetOk() { const v = $("sheet-val") ? $("sheet-val").value.trim() : ""; sheetClose(); if (sheetCb) sheetCb(v); }
function sheetClose() { $("modal").classList.remove("open"); }
function pinPruefen(wert) { return wert === (S.einstellungen.pin || "2468"); }
function pinSheet(cb) {
  sheetCb = null;
  $("sheet").innerHTML = `<h3>🔒 Eltern-PIN</h3>
    <input id="pin-val" class="pininput" type="password" inputmode="numeric" maxlength="4" placeholder="••••"
      oninput="if(this.value.length===4)pinBestaetigen(this.value)">
    <button class="btn ghost" style="width:100%" onclick="sheetClose()">Abbrechen</button>`;
  $("modal").classList.add("open");
  window.__pinCb = cb;
  setTimeout(() => { const el = $("pin-val"); if (el) el.focus(); }, 50);
}
function pinBestaetigen(wert) {
  if (pinPruefen(wert)) { sheetClose(); if (window.__pinCb) window.__pinCb(); }
  else { const el = $("pin-val"); if (el) { el.value = ""; el.placeholder = "falsch"; } toast("Falsche PIN"); vib(60); }
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._x); t._x = setTimeout(() => t.classList.remove("show"), 2200); }

/* ---------- Zustand ---------- */
const LEER = {
  mitglieder: [], termine: [], stundenplan: {}, todos: [], routinen: [],
  einkauf: [], einkaufHistorie: {}, kochbuch: [], essensplan: {}, packlisten: [],
  kinderaufgaben: [], sterne: {}, taschengeld: {}, zettel: [], countdowns: [],
  ideen: [], geschenke: [], gesundheit: [], notfall: [],
  einstellungen: { pin: "2468" }
};
let S = JSON.parse(JSON.stringify(LEER));
let db = null, meinName = "", geladen = false, verbunden = true;
let tab = "heute";
const sub = { termine: "kalender", listen: "einkauf", essen: "woche", mehr: null };
let kidsKind = null;

function erwachsene() { return S.mitglieder.filter(m => m.rolle === "erwachsen"); }
function kinder() { return S.mitglieder.filter(m => m.rolle === "kind"); }
function mitglied(id) { return S.mitglieder.find(m => m.id === id); }
function mName(id) { const m = mitglied(id); return m ? m.name : "—"; }
function avatarHtml(id, size) {
  const m = mitglied(id); if (!m) return "";
  return `<span class="avatar" style="background:${m.farbe}${size ? `;width:${size}px;height:${size}px;font-size:${size * .48}px` : ""}">${esc(m.name[0] || "?")}</span>`;
}

/* ---------- Firebase ---------- */
function starte() {
  if (typeof FIREBASE_CONFIG === "undefined" || FIREBASE_CONFIG.apiKey === "HIER_EINTRAGEN") {
    $("loginform").style.display = "none";
    $("setupwarn").style.display = "block";
    return;
  }
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.database();
  try { firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {}); } catch (e) {}
  firebase.auth().onAuthStateChanged(user => {
    if (user) {
      meinName = (user.email || "").split("@")[0];
      $("login").classList.remove("open");
      db.ref(".info/connected").on("value", s => {
        verbunden = s.val() === true;
        const el = $("offline"); if (el) el.classList.toggle("show", !verbunden && geladen);
      });
      db.ref("daten").on("value", snap => {
        geladen = true;
        const v = snap.val() || {};
        S = Object.assign(JSON.parse(JSON.stringify(LEER)), v);
        // Arrays absichern (Firebase löscht leere Arrays)
        for (const k of ["mitglieder","termine","todos","routinen","einkauf","kochbuch","packlisten","kinderaufgaben","zettel","countdowns","ideen","geschenke","gesundheit","notfall"]) {
          if (!Array.isArray(S[k])) S[k] = S[k] ? Object.values(S[k]) : [];
        }
        render();
        if (!window.__gcalGeladen && S.einstellungen && S.einstellungen.icsUrl) {
          window.__gcalGeladen = true; ladeGcal(false);
        }
        if (!window.__kioskGestartet && kioskAktiv() && kinder().length) {
          window.__kioskGestartet = true;
          const ich = mitglied(ichId());
          kidsKind = (ich && ich.rolle === "kind") ? ich.id : (kinder().length === 1 ? kinder()[0].id : null);
          $("kids").classList.add("open"); renderKids();
        } else if (!window.__ichGefragt && S.mitglieder.length && !mitglied(ichId())) {
          window.__ichGefragt = true; ichFragen();
        }
      });
    } else {
      // Auto-Login mit gemerkten Zugangsdaten (einmaliger Versuch)
      const cred = gespeicherteCred();
      if (cred && !window.__autoLoginVersucht) {
        window.__autoLoginVersucht = true;
        firebase.auth().signInWithEmailAndPassword(cred.m, cred.p)
          .catch(() => { credLoeschen(); $("login").classList.add("open"); });
      } else {
        $("login").classList.add("open");
      }
    }
  });
}
function gespeicherteCred() {
  try { const raw = localStorage.getItem("whanau-cred"); return raw ? JSON.parse(atob(raw)) : null; } catch (e) { return null; }
}
function credMerken(m, p) { try { localStorage.setItem("whanau-cred", btoa(JSON.stringify({ m, p }))); } catch (e) {} }
function credLoeschen() { try { localStorage.removeItem("whanau-cred"); } catch (e) {} }
function doLogin() {
  $("lg-err").textContent = "";
  const m = $("lg-mail").value.trim(), p = $("lg-pass").value;
  firebase.auth().signInWithEmailAndPassword(m, p)
    .then(() => { const box = $("lg-merken"); if (!box || box.checked) credMerken(m, p); else credLoeschen(); })
    .catch(e => { $("lg-err").textContent = "Anmeldung fehlgeschlagen – E-Mail/Passwort prüfen."; });
}
function doLogout() { if (confirm("Abmelden?")) { credLoeschen(); firebase.auth().signOut(); } }
function save(...keys) {
  // Werte VOR dem Schreiben einfrieren: der value-Listener feuert bei lokalen
  // Writes synchron und ersetzt S – sonst ginge der zweite Schlüssel verloren.
  const werte = keys.map(k => S[k]);
  keys.forEach((k, i) => db.ref("daten/" + k).set(werte[i]));
}

/* ---------- Navigation ---------- */
const TABS = [
  { id: "heute", label: "Heute", icon: "☀️" },
  { id: "termine", label: "Termine", icon: "📅" },
  { id: "listen", label: "Listen", icon: "✅" },
  { id: "essen", label: "Essen", icon: "🍽️" },
  { id: "mehr", label: "Mehr", icon: "⋯" }
];
function render() {
  $("headsub").textContent = fmtLang(new Date());
  $("tabs").innerHTML = TABS.map(t =>
    `<button class="${tab === t.id ? "on" : ""}" onclick="geheZu('${t.id}')"><span class="i">${t.icon}</span>${t.label}</button>`).join("");
  const R = { heute: rHeute, termine: rTermine, listen: rListen, essen: rEssen, mehr: rMehr };
  $("main").innerHTML = (!geladen && db)
    ? `<div class="loader"><div class="k"></div>Lade eure Familiendaten…</div>`
    : R[tab]();
  if ($("kids").classList.contains("open")) renderKids();
}
function geheZu(t) { tab = t; if (t === "mehr") sub.mehr = null; render(); window.scrollTo(0, 0); }
function setSub(bereich, wert) { sub[bereich] = wert; render(); }
function segHtml(bereich, optionen) {
  return `<div class="seg">` + optionen.map(o =>
    `<button class="${sub[bereich] === o[0] ? "on" : ""}" onclick="setSub('${bereich}','${o[0]}')">${o[1]}</button>`).join("") + `</div>`;
}

/* ---------- Google-Kalender (ICS, nur lesen) ---------- */
let gcal = { events: [], status: "aus", am: null };
function icsEntfalten(text) {
  // Zeilen entfalten (Fortsetzungszeilen beginnen mit Leerzeichen/Tab)
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}
function icsDatum(wert, params) {
  // 20260712 oder 20260712T140000(Z)
  const m = wert.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?/);
  if (!m) return null;
  if (!m[4]) return { datum: m[1] + "-" + m[2] + "-" + m[3], zeit: "", ganztags: true };
  if (m[7] === "Z") {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return { datum: dstr(d), zeit: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), ganztags: false };
  }
  return { datum: m[1] + "-" + m[2] + "-" + m[3], zeit: m[4] + ":" + m[5], ganztags: false };
}
function parseICS(text, vonDs, bisDs) {
  const events = [];
  const bloecke = icsEntfalten(text).split("BEGIN:VEVENT").slice(1);
  const RRTAGE = { MO: "Mo", TU: "Di", WE: "Mi", TH: "Do", FR: "Fr", SA: "Sa", SU: "So" };
  for (const b of bloecke) {
    const teil = b.split("END:VEVENT")[0];
    const feld = name => {
      const m = teil.match(new RegExp("^" + name + "(;[^:]*)?:(.*)$", "m"));
      return m ? { wert: m[2].trim(), params: m[1] || "" } : null;
    };
    const st = feld("DTSTART"); if (!st) continue;
    const start = icsDatum(st.wert, st.params); if (!start) continue;
    const sum = feld("SUMMARY"), loc = feld("LOCATION"), rr = feld("RRULE");
    const titel = (sum ? sum.wert : "Termin").replace(/\\,/g, ",").replace(/\\n/g, " ");
    const ort = loc ? loc.wert.replace(/\\,/g, ",") : "";
    // Ausnahmen (gelöschte Einzeltermine einer Serie)
    const exdates = new Set();
    for (const m of teil.matchAll(/^EXDATE[^:]*:(.*)$/gm))
      m[1].split(",").forEach(x => { const d = icsDatum(x.trim()); if (d) exdates.add(d.datum); });
    const basis = { titel, ort, zeit: start.zeit, gcal: true };
    if (!rr) {
      if (start.datum >= vonDs && start.datum <= bisDs && !exdates.has(start.datum)) events.push(Object.assign({ datum: start.datum }, basis));
      continue;
    }
    // Einfache Serien: DAILY, WEEKLY (BYDAY), MONTHLY (Monatstag), YEARLY
    const regeln = {}; rr.wert.split(";").forEach(p => { const [k, v] = p.split("="); regeln[k] = v; });
    const freq = regeln.FREQ, intervall = +(regeln.INTERVAL || 1);
    const until = regeln.UNTIL ? icsDatum(regeln.UNTIL).datum : null;
    const byday = regeln.BYDAY ? regeln.BYDAY.split(",").map(t => RRTAGE[t.replace(/^[-\d]+/, "")]).filter(Boolean) : null;
    const startD = new Date(start.datum + "T12:00:00");
    let zaehler = 0;
    const d = new Date(vonDs + "T12:00:00");
    const ende = new Date(bisDs + "T12:00:00");
    for (; d <= ende && zaehler < 400; d.setDate(d.getDate() + 1), zaehler++) {
      const ds = dstr(d);
      if (ds < start.datum || (until && ds > until) || exdates.has(ds)) continue;
      const tage = Math.round((d - startD) / 864e5);
      let passt = false;
      if (freq === "DAILY") passt = tage % intervall === 0;
      else if (freq === "WEEKLY") {
        const wo = Math.floor(tage / 7);
        const tagOk = byday ? byday.includes(WD[d.getDay()]) : d.getDay() === startD.getDay();
        passt = tagOk && (byday ? Math.floor((d - wochenStart(startD)) / 6048e5) % intervall === 0 : wo % intervall === 0);
      }
      else if (freq === "MONTHLY") passt = d.getDate() === startD.getDate();
      else if (freq === "YEARLY") passt = d.getDate() === startD.getDate() && d.getMonth() === startD.getMonth();
      if (passt) events.push(Object.assign({ datum: ds }, basis));
    }
  }
  return events;
}
function ladeGcal(zeigeToast) {
  const url = (S.einstellungen && S.einstellungen.icsUrl || "").trim();
  if (!url) { gcal = { events: [], status: "aus", am: null }; return; }
  gcal.status = "lädt";
  const von = heute();
  const bisD = new Date(); bisD.setDate(bisD.getDate() + 60);
  fetch(url).then(r => { if (!r.ok) throw 0; return r.text(); }).then(text => {
    gcal.events = parseICS(text, von, dstr(bisD));
    gcal.status = "ok"; gcal.am = new Date();
    if (zeigeToast) toast(gcal.events.length + " Google-Termine geladen");
    render();
  }).catch(() => {
    gcal.status = "fehler";
    if (zeigeToast) toast("Kalender-Abruf fehlgeschlagen – URL prüfen");
    render();
  });
}
function einkaufstagSpeichern() {
  if (!S.einstellungen) S.einstellungen = {};
  S.einstellungen.einkaufstag = $("ek-tag").value;
  save("einstellungen"); toast("Einkaufstag: " + $("ek-tag").value);
}
function gcalUrlSpeichern() {
  if (!S.einstellungen) S.einstellungen = {};
  S.einstellungen.icsUrl = $("gcal-url").value.trim();
  save("einstellungen"); ladeGcal(true);
}

/* ---------- Wiederkehrende Logik ---------- */
function termineAm(datumStr) {
  const w = wtag(datumStr);
  const eigene = S.termine.filter(t =>
    t.datum === datumStr || (t.wdh === "woechentlich" && wtag(t.datum) === w && t.datum <= datumStr));
  const google = gcal.events.filter(e => e.datum === datumStr);
  return eigene.concat(google).sort((a, b) => (a.zeit || "99") < (b.zeit || "99") ? -1 : 1);
}
function routinenAm(datumStr) {
  const w = wtag(datumStr);
  return S.routinen.filter(r => (r.tage || []).includes(w));
}
function routineZustaendig(r) {
  if (r.zustaendig !== "rotation") return r.zustaendig;
  const grp = erwachsene(); if (!grp.length) return null;
  const idx = (isoWoche(new Date()) + S.routinen.indexOf(r)) % grp.length;
  return grp[idx].id;
}
function kidAufgabenAm(kindId, datumStr) {
  const w = wtag(datumStr);
  return S.kinderaufgaben.filter(a => a.kindId === kindId && (!a.tage || !a.tage.length || a.tage.includes(w)));
}

/* ============================================================
   TAB: HEUTE
   ============================================================ */
function ichId() { try { return localStorage.getItem("whanau-ich"); } catch (e) { return null; } }
function ichName() {
  const m = mitglied(ichId());
  if (m) return m.name;
  return meinName ? meinName.charAt(0).toUpperCase() + meinName.slice(1) : "";
}
function kioskAktiv() {
  try { return localStorage.getItem("whanau-kiosk") === "1" || new URLSearchParams(location.search).get("kiosk") === "1"; } catch (e) { return false; }
}
function kioskSetzen(an) {
  try { an ? localStorage.setItem("whanau-kiosk", "1") : localStorage.removeItem("whanau-kiosk"); } catch (e) {}
  render(); toast(an ? "Kiosk-Modus aktiv – App startet ab jetzt im Kinderbereich" : "Kiosk-Modus aus");
  if (an) openKids();
}
function ichSetzen(id) {
  try { localStorage.setItem("whanau-ich", id); } catch (e) {}
  sheetClose(); render(); toast("Hallo " + mName(id) + "!");
}
function ichFragen() {
  if (!S.mitglieder.length) return;
  const sortiert = [...erwachsene(), ...kinder()];
  $("sheet").innerHTML = `<h3>👋 Wer nutzt die App auf diesem Gerät?</h3>
    <div class="hint" style="margin:-6px 0 12px">Damit Begrüßung und Zettel deinen richtigen Namen tragen. Änderbar unter Mehr → Familie.</div>` +
    sortiert.map(m => `<button class="row" style="width:100%;text-align:left" onclick="ichSetzen('${m.id}')">
      ${avatarHtml(m.id, 34)}<div class="grow"><div class="t">${esc(m.name)}</div></div>›</button>`).join("");
  $("modal").classList.add("open");
}
function gruss() {
  const st = new Date().getHours();
  if (st < 10) return "Mōrena";          // Guten Morgen (Māori)
  if (st >= 21) return "Pō mārie";       // Gute Nacht
  return "Kia ora";
}
function naechsterGeburtstag(geb) {
  if (!geb) return null;
  const jetzt = new Date(heute() + "T00:00:00");
  const g = new Date(geb + "T00:00:00");
  let n = new Date(jetzt.getFullYear(), g.getMonth(), g.getDate());
  if (n < jetzt) n = new Date(jetzt.getFullYear() + 1, g.getMonth(), g.getDate());
  return { datum: dstr(n), inTagen: Math.round((n - jetzt) / 864e5) };
}
function rHeute() {
  const h = heute(), m = morgen();
  let out = `<div class="hero">
    <svg class="fern" viewBox="0 0 100 100"><path d="M50 95 C50 60 50 40 50 10 M50 80 C35 75 25 62 26 50 M50 80 C65 75 75 62 74 50 M50 62 C38 58 31 48 32 39 M50 62 C62 58 69 48 68 39 M50 45 C41 42 36 34 37 27 M50 45 C59 42 64 34 63 27" stroke="#17695B" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>
    <div class="kia">${gruss()}${ichName() ? ", " + esc(ichName()) : ""}!</div>
    <div class="datum">${fmtLang(new Date())}</div></div>`;

  // Onboarding für den allerersten Start
  if (!S.mitglieder.length)
    out += `<div class="card"><h2>🥝 Willkommen bei Whānau!</h2>
      <div class="empty" style="margin-bottom:10px">Legt als Erstes eure Familie an – danach füllen sich Dashboard, Kinderbereich und Zuständigkeiten von selbst.</div>
      <button class="btn" style="width:100%" onclick="tab='mehr';sub.mehr='familie';render()">Familie anlegen →</button></div>`;

  // Geburtstage heute & Ferienbanner
  S.mitglieder.forEach(mm => {
    if (mm.geb && mm.geb.slice(5) === h.slice(5))
      out += `<div class="banner">🎂 ${esc(mm.name)} hat heute Geburtstag! 🎉</div>`;
  });
  const ferienJetzt = S.termine.filter(t => t.kategorie === "ferien" && t.datum <= h && (t.bis || t.datum) >= h);
  ferienJetzt.forEach(f => { out += `<div class="banner gruen">🏖️ ${esc(f.titel)}</div>`; });



  const cds = S.countdowns.filter(c => tageBis(c.datum) >= 0).map(c => ({ emoji: c.emoji || "🎉", tage: tageBis(c.datum), titel: c.titel }));
  S.mitglieder.forEach(mm => {
    const ng = naechsterGeburtstag(mm.geb);
    if (ng && ng.inTagen > 0 && ng.inTagen <= 21) cds.push({ emoji: "🎂", tage: ng.inTagen, titel: mm.name + "s Geburtstag" });
  });
  cds.sort((a, b) => a.tage - b.tage);
  if (cds.length)
    out += `<div class="cdrow">` + cds.map(c => `<div class="cdcard"><div class="e">${esc(c.emoji)}</div><div class="n">${c.tage}</div><div class="l">Tage bis<br>${esc(c.titel)}</div></div>`).join("") + `</div>`;

  // Termine heute
  const th = termineAm(h);
  out += `<div class="card"><h2>📅 Termine heute<span class="cnt">${th.length}</span></h2>`;
  out += th.length ? th.map(t => `<div class="row"><div class="grow"><div class="t">${esc(t.titel)}</div>
    <div class="s">${t.zeit ? t.zeit + " Uhr" : "ganztägig"}${t.ort ? " · " + esc(t.ort) : ""}</div></div>
    ${(t.mitglieder || []).map(id => avatarHtml(id)).join("")}</div>`).join("")
    : `<div class="empty">Keine Termine – freier Tag! 🌿</div>`;
  out += `</div>`;

  // Essen heute
  const eh = S.essensplan[h];
  out += `<div class="card"><h2>🍽️ Essen heute</h2>`;
  if (eh && (eh.text || eh.dishId)) {
    const d = S.kochbuch.find(x => x.id === eh.dishId);
    out += `<div class="row"><div class="grow"><div class="t">${esc(eh.text || (d && d.name) || "")}</div></div>
      <button class="btn small ghost" onclick="geheZu('essen')">Plan</button></div>`;
  } else out += `<div class="empty">Noch nichts geplant. <button class="btn small ghost" onclick="geheZu('essen')">Jetzt planen</button></div>`;
  out += `</div>`;

  // Aufgaben heute: To-dos fällig/überfällig + Routinen
  const offen = S.todos.filter(t => !t.erledigt && t.faellig && t.faellig <= h);
  const rts = routinenAm(h);
  out += `<div class="card"><h2>✅ Heute dran<span class="cnt">${offen.length + rts.filter(r => !(r.done || {})[h]).length} offen</span></h2>`;
  if (!offen.length && !rts.length) out += `<div class="empty">Alles erledigt.</div>`;
  out += offen.map(t => `<div class="row"><button aria-label="Abhaken" class="check" onclick="todoToggle('${t.id}')"></button>
    <div class="grow"><div class="t">${esc(t.titel)}</div>${t.faellig < h ? `<div class="s" style="color:var(--coral)">überfällig seit ${fmt(t.faellig)}</div>` : ""}</div>
    ${t.zustaendig ? avatarHtml(t.zustaendig) : ""}</div>`).join("");
  out += rts.map(r => {
    const done = (r.done || {})[h], z = routineZustaendig(r);
    return `<div class="row ${done ? "done" : ""}"><button aria-label="Abhaken" class="check ${done ? "on" : ""}" onclick="routineToggle('${r.id}')">${done ? "✓" : ""}</button>
      <div class="grow"><div class="t">${esc(r.titel)}</div><div class="s">Routine${r.zustaendig === "rotation" ? " · Rotation" : ""}</div></div>
      ${z ? avatarHtml(z) : ""}</div>`;
  }).join("");
  out += `</div>`;

  // Zettel für mich (ungelesen/offen)
  const zt = S.zettel.filter(z => !z.erledigt);
  if (zt.length) {
    out += `<div class="card"><h2>📮 Zettelkasten<span class="cnt">${zt.length}</span></h2>` +
      zt.slice(0, 3).map(z => `<div class="row"><div class="grow"><div class="t">${esc(z.text)}</div><div class="s">von ${esc(z.von || "?")}</div></div>
      <button aria-label="Abhaken" class="check" onclick="zettelToggle('${z.id}')"></button></div>`).join("") + `</div>`;
  }

  // Offenes Taschengeld
  const tgOffen = kinder().map(k => ({ k, summe: tgAusstehend(k.id), wochen: tgOffeneWochen(k.id).length })).filter(x => x.summe > 0);
  if (tgOffen.length) {
    out += `<div class="card"><h2>💰 Taschengeld offen</h2>` +
      tgOffen.map(x => `<div class="row"><div class="grow"><div class="t">${esc(x.k.name)}: ${euro(x.summe)}</div>
        <div class="s">${x.wochen} ${x.wochen === 1 ? "Woche" : "Wochen"} nicht abgeholt</div></div>${avatarHtml(x.k.id)}</div>`).join("") + `</div>`;
  }

  // Wochenbilanz
  const ws = dstr(wochenStart(new Date()));
  const bilanz = erwachsene().map(e => {
    let n = S.todos.filter(t => t.erledigt && t.zustaendig === e.id && t.erledigtAm >= ws).length;
    S.routinen.forEach(r => Object.entries(r.done || {}).forEach(([d, who]) => { if (d >= ws && who === e.id) n++; }));
    return { e, n };
  });
  if (bilanz.length)
    out += `<div class="card"><h2>⚖️ Wochenbilanz</h2><div class="row" style="border:none;gap:14px">` +
      bilanz.map(b => `<span class="chip">${avatarHtml(b.e.id)}&nbsp;${esc(b.e.name)}: <strong>&nbsp;${b.n}</strong></span>`).join("") +
      `</div><div class="hint">Erledigte Aufgaben & Routinen seit Montag.</div></div>`;

  if (kinder().length)
    out += `<button class="kidsentry" onclick="openKids()"><span class="em">🥝</span>
      <span><span class="big">Kinderbereich</span><br><span class="s">Aufgaben &amp; Sterne für ${esc(kinder().map(k => k.name).join(" & "))}</span></span>
      <span class="arrow">→</span></button>`;

  return out;
}

/* ============================================================
   TAB: TERMINE (Kalender + Stundenplan)
   ============================================================ */
function rTermine() {
  let out = segHtml("termine", [["kalender", "Kalender"], ["stundenplan", "Stundenplan"], ["ferien", "Ferien"]]);
  if (sub.termine === "stundenplan") return out + rStundenplan();
  if (sub.termine === "ferien") return out + rFerien();

  // 14-Tage-Vorschau
  const gcalInfo = gcal.status === "ok" ? `🌐 ${gcal.events.length} Google-Termine` : gcal.status === "fehler" ? "🌐 Abruf fehlgeschlagen" : gcal.status === "lädt" ? "🌐 lädt…" : "";
  out += `<div class="card"><h2>📅 Nächste 14 Tage${gcalInfo ? `<span class="cnt">${gcalInfo} <button class="btn small ghost" onclick="ladeGcal(true)">↻</button></span>` : ""}</h2>`;
  let any = false;
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const ds = dstr(d), ts = termineAm(ds);
    if (!ts.length) continue; any = true;
    out += `<div class="weekrow ${i === 0 ? "today" : ""}"><div class="day"><div class="wd">${WD[d.getDay()]}</div><div class="dt">${d.getDate()}.${d.getMonth() + 1}.</div></div><div class="grow">`;
    out += ts.map(t => `<div class="row"><div class="grow"><div class="t">${esc(t.titel)}</div>
      <div class="s">${t.zeit ? t.zeit + " Uhr" : "ganztägig"}${t.ort ? " · " + esc(t.ort) : ""}${t.wdh === "woechentlich" ? " · 🔁 wöchentlich" : ""}${t.gcal ? " · 🌐 Google" : ""}</div></div>
      ${(t.mitglieder || []).map(id => avatarHtml(id)).join("")}
      ${t.gcal ? "" : `<button class="del" aria-label="Löschen" onclick="terminDel('${t.id}')">✕</button>`}</div>`).join("");
    out += `</div></div>`;
  }
  if (!any) out += `<div class="empty">Keine Termine in den nächsten zwei Wochen.</div>`;
  out += `</div>`;

  // Neuer Termin
  out += `<div class="card"><h2>＋ Neuer Termin</h2><div class="formgrid">
    <input id="tm-titel" class="full" placeholder="Titel (z. B. Kinderturnen)">
    <input id="tm-datum" type="date" value="${heute()}">
    <input id="tm-zeit" type="time">
    <input id="tm-ort" placeholder="Ort (optional)">
    <select id="tm-wdh"><option value="nie">einmalig</option><option value="woechentlich">jede Woche</option></select>
    <div class="full" id="tm-wer">${S.mitglieder.map(mm => `<label style="margin-right:12px;font-size:13.5px"><input type="checkbox" value="${mm.id}" style="width:auto"> ${esc(mm.name)}</label>`).join("") || '<span class="hint">Mitglieder unter Mehr → Familie anlegen</span>'}</div>
    <button class="btn full" onclick="terminAdd()">Termin speichern</button></div>
    <div class="hint">Tipp: Wichtige Google-Kalender-Termine hier zusätzlich eintragen – die App ist eure gemeinsame Familiensicht.</div></div>`;
  return out;
}
function terminAdd() {
  const titel = $("tm-titel").value.trim(); if (!titel) return toast("Titel fehlt");
  const wer = [...document.querySelectorAll("#tm-wer input:checked")].map(c => c.value);
  S.termine.push({ id: uid(), titel, datum: $("tm-datum").value, zeit: $("tm-zeit").value, ort: $("tm-ort").value.trim(), wdh: $("tm-wdh").value, mitglieder: wer });
  save("termine"); toast("Termin gespeichert");
}
function terminDel(id) {
  const t = S.termine.find(x => x.id === id);
  const frage = t && t.wdh === "woechentlich" ? "Diese Terminserie komplett löschen?" : "Termin löschen?";
  if (!confirm(frage)) return; S.termine = S.termine.filter(t => t.id !== id); save("termine"); }

function rStundenplan() {
  if (!kinder().length) return `<div class="card"><div class="empty">Lege zuerst unter <strong>Mehr → Familie</strong> die Kinder an.</div></div>`;
  let out = "";
  kinder().forEach(k => {
    const sp = S.stundenplan[k.id] || {};
    out += `<div class="card"><h2>${avatarHtml(k.id)} Stundenplan ${esc(k.name)}</h2><div class="stundengrid">`;
    SCHULTAGE.forEach(t => {
      out += `<div class="weekrow"><div class="day"><div class="wd">${t}</div></div><div class="grow">
        <textarea data-kind="${k.id}" data-tag="${t}" placeholder="Fächer, eine pro Zeile…" onchange="spSave(this)">${esc((sp[t] || []).join("\n"))}</textarea></div></div>`;
    });
    out += `</div></div>`;
  });
  return out;
}
function spSave(el) {
  const k = el.dataset.kind, t = el.dataset.tag;
  if (!S.stundenplan[k]) S.stundenplan[k] = {};
  S.stundenplan[k][t] = el.value.split("\n").map(x => x.trim()).filter(Boolean);
  save("stundenplan"); toast("Stundenplan gespeichert");
}

function rFerien() {
  const list = [...S.termine.filter(t => t.kategorie === "ferien")].sort((a, b) => a.datum < b.datum ? -1 : 1);
  let out = `<div class="card"><h2>🏖️ Ferien & Brückentage</h2>`;
  out += list.length ? list.map(f => `<div class="row"><div class="grow"><div class="t">${esc(f.titel)}</div>
    <div class="s">${fmt(f.datum)}${f.bis ? " – " + fmt(f.bis) : ""} ${tageBis(f.datum) >= 0 ? `· in ${tageBis(f.datum)} Tagen` : ""}</div></div>
    <button class="del" aria-label="Löschen" onclick="terminDel('${f.id}')">✕</button></div>`).join("") : `<div class="empty">Noch keine Ferien eingetragen – z. B. die hessischen Schulferien.</div>`;
  out += `<div class="formgrid"><input id="fe-titel" class="full" placeholder="z. B. Herbstferien Hessen">
    <input id="fe-von" type="date"><input id="fe-bis" type="date">
    <button class="btn full" onclick="ferienAdd()">Eintragen</button></div></div>`;
  return out;
}
function ferienAdd() {
  const titel = $("fe-titel").value.trim(); if (!titel || !$("fe-von").value) return toast("Titel/Datum fehlt");
  S.termine.push({ id: uid(), titel, datum: $("fe-von").value, bis: $("fe-bis").value || "", kategorie: "ferien", wdh: "nie" });
  save("termine"); toast("Gespeichert");
}

/* ============================================================
   TAB: LISTEN (Einkauf, To-dos, Packlisten)
   ============================================================ */
function rListen() {
  let out = segHtml("listen", [["einkauf", "🛒 Einkauf"], ["todos", "To-dos"], ["pack", "🎒 Packen"]]);
  if (sub.listen === "todos") return out + rTodos();
  if (sub.listen === "pack") return out + rPacklisten();

  const offen = S.einkauf.filter(e => !e.erledigt), fertig = S.einkauf.filter(e => e.erledigt);
  const kats = KAT_ORDER.filter(k => offen.some(e => (e.kategorie || "Sonstiges") === k))
    .concat([...new Set(offen.map(e => e.kategorie || "Sonstiges"))].filter(k => !KAT_ORDER.includes(k)));
  out += `<div class="card"><h2>🛒 Einkaufsliste<span class="cnt">${offen.length} offen</span></h2>`;
  if (!offen.length) out += `<div class="empty">Alles eingekauft. 🧺</div>`;
  kats.forEach(k => {
    out += `<div class="hint" style="margin:8px 0 2px;font-weight:600">${esc(k)}</div>`;
    out += offen.filter(e => (e.kategorie || "Sonstiges") === k).map(e =>
      `<div class="row"><button aria-label="Abhaken" class="check" onclick="einkaufToggle('${e.id}')"></button>
       <div class="grow"><div class="t">${esc(e.name)}</div></div>
       <button class="del" aria-label="Löschen" onclick="einkaufDel('${e.id}')">✕</button></div>`).join("");
  });
  out += `<div class="addform"><input id="ek-name" placeholder="Was fehlt?" onkeydown="if(event.key==='Enter')einkaufAdd()">
    <select id="ek-kat" style="max-width:120px"><option value="auto">🪄 Auto</option>${KAT_ORDER.map(k => `<option>${k}</option>`).join("")}</select>
    <button class="btn" onclick="einkaufAdd()">＋</button></div>`;
  const chips = schnellArtikel();
  if (chips.length) out += `<div class="hint" style="margin-top:10px">Schnell hinzufügen (kauft ihr oft):</div>
    <div class="chiprow">${chips.map(n => `<button onclick="schnellAdd('${esc(n).replace(/'/g, "\\'")}')">+ ${esc(n.charAt(0).toUpperCase() + n.slice(1))}</button>`).join("")}</div>`;
  if (fertig.length) {
    out += `<div class="donesec">` + fertig.map(e =>
      `<div class="row done"><button class="check on" aria-label="Zurückholen" onclick="einkaufToggle('${e.id}')">✓</button>
       <div class="grow"><div class="t">${esc(e.name)}</div></div></div>`).join("");
    out += `<div class="hint" style="margin-top:8px"><button class="btn small ghost" onclick="einkaufLeeren()">🧹 ${fertig.length} erledigte entfernen</button></div></div>`;
  }
  out += `</div>`;
  return out;
}
/* Kategorien in Supermarkt-Laufreihenfolge + Stichwort-Erkennung */
const KAT_ORDER = ["Obst & Gemüse", "Brot & Backwaren", "Kühlregal", "Fleisch & Fisch", "Vorräte", "Tiefkühl", "Getränke", "Drogerie", "Haushalt", "Sonstiges"];
const KAT_WORTE = {
  "Obst & Gemüse": ["apfel","äpfel","banane","birne","trauben","erdbeer","beeren","zitrone","limette","orange","mandarine","melone","kiwi","tomate","cherrytomaten","gurke","salatgurke","salat","kopfsalat","feldsalat","rucola","karotte","möhre","zwiebel","frühlingszwiebel","kartoffel","süßkartoffel","paprika","zucchini","brokkoli","blumenkohl","spinat","blattspinat","lauch","sellerie","knoblauch","ingwer","pilze","champignon","avocado","zuckerschoten","kürbis","radieschen","kohlrabi","basilikum","petersilie","schnittlauch","minze","dill","kräuter","obst","gemüse","rohkost"],
  "Brot & Backwaren": ["brot","brötchen","baguette","ciabatta","fladenbrot","toast","wraps","naan","croissant","brezel","zwieback"],
  "Kühlregal": ["milch","butter","margarine","joghurt","quark","skyr","sahne","schmand","crème","creme fraiche","käse","mozzarella","parmesan","feta","halloumi","bergkäse","frischkäse","eier","gnocchi","spätzle","flammkuchenteig","pizzateig","teig","hefe","falafel","hummus","tortellini","aufschnitt","pudding"],
  "Fleisch & Fisch": ["hähnchen","hühnchen","pute","hack","rinderhack","schnitzel","würstchen","wurst","schinken","kochschinken","speck","salami","steak","gulasch","lachs","lachsfilet","fisch","weißfisch","garnelen","forelle","köfte"],
  "Vorräte": ["nudeln","spaghetti","penne","fusilli","tagliatelle","suppennudeln","mie","reisnudeln","reispapier","reis","milchreis","risotto","couscous","bulgur","quinoa","linsen","bohnen","kichererbsen","erbsen (glas)","mehl","zucker","paniermehl","haferflocken","müsli","passierte tomaten","gehackte tomaten","tomatenmark","kokosmilch","öl","olivenöl","essig","senf","ketchup","mayo","sojasoße","teriyaki","currypaste","curry","brühe","gemüsebrühe","gewürz","garam","schawarma","zimt","vanille","tahini","erdnuss","sesam","nüsse","mandeln","honig","marmelade","nutella","apfelmus","mais","oliven","sauerkirschen","thunfisch","konserve","dose","kapern","backpulver","chips","kekse","schokolade"],
  "Tiefkühl": ["tk","tiefkühl","fischstäbchen","pommes","tk-pizza","eis ","eiscreme","erbsen (tk)"],
  "Getränke": ["wasser","mineralwasser","sprudel","saft","apfelsaft","orangensaft","cola","limo","limonade","eistee","bier","wein","sekt","kaffee","espresso","tee","kakao","hafermilch","mandelmilch"],
  "Drogerie": ["shampoo","duschgel","seife","zahnpasta","zahnbürste","deo","creme","sonnencreme","windeln","feuchttücher","taschentücher","wattestäbchen","pflaster","binden","tampons","rasier"],
  "Haushalt": ["spülmittel","spülmaschinentabs","waschmittel","weichspüler","müllbeutel","müllsäcke","küchenrolle","toilettenpapier","klopapier","alufolie","frischhaltefolie","backpapier","schwamm","lappen","batterien","glühbirne","kerzen"]
};
const KAT_SUCHE = Object.entries(KAT_WORTE)
  .flatMap(([kat, worte]) => worte.map(w => [w, kat]))
  .sort((x, y) => y[0].length - x[0].length); // längste Treffer zuerst (kokosmilch vor milch)
function autoKategorie(name) {
  const n = " " + name.toLowerCase() + " ";
  for (const [wort, kat] of KAT_SUCHE) if (n.includes(wort)) return kat;
  return "Sonstiges";
}
function einkaufAdd() {
  const n = $("ek-name").value.trim(); if (!n) return;
  const wahl = $("ek-kat") ? $("ek-kat").value : "auto";
  S.einkauf.push({ id: uid(), name: n, kategorie: wahl === "auto" ? autoKategorie(n) : wahl, erledigt: false });
  save("einkauf");
}
function einkaufToggle(id) {
  const e = S.einkauf.find(x => x.id === id); if (!e) return;
  e.erledigt = !e.erledigt; vib();
  if (e.erledigt) {
    const key = e.name.trim().toLowerCase();
    S.einkaufHistorie[key] = (S.einkaufHistorie[key] || 0) + 1;
    save("einkauf", "einkaufHistorie");
  } else save("einkauf");
}
function schnellArtikel() {
  const offenNamen = new Set(S.einkauf.filter(e => !e.erledigt).map(e => e.name.trim().toLowerCase()));
  return Object.entries(S.einkaufHistorie || {})
    .filter(([n, c]) => c >= 2 && !offenNamen.has(n))
    .sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n]) => n);
}
function schnellAdd(name) {
  const schoen = name.charAt(0).toUpperCase() + name.slice(1);
  S.einkauf.push({ id: uid(), name: schoen, kategorie: autoKategorie(schoen), erledigt: false });
  save("einkauf"); vib();
}
function einkaufDel(id) { S.einkauf = S.einkauf.filter(x => x.id !== id); save("einkauf"); }
function einkaufLeeren() { S.einkauf = S.einkauf.filter(x => !x.erledigt); save("einkauf"); }

function rTodos() {
  const offen = S.todos.filter(t => !t.erledigt).sort((a, b) => (a.faellig || "9999") < (b.faellig || "9999") ? -1 : 1);
  let out = `<div class="card"><h2>✅ To-dos<span class="cnt">${offen.length} offen</span></h2>`;
  if (!offen.length) out += `<div class="empty">Nichts offen.</div>`;
  out += offen.map(t => `<div class="row"><button aria-label="Abhaken" class="check" onclick="todoToggle('${t.id}')"></button>
    <div class="grow"><div class="t">${esc(t.titel)}</div>
    <div class="s">${t.faellig ? (t.faellig < heute() ? `<span style="color:var(--coral)">fällig ${fmt(t.faellig)}</span>` : "fällig " + fmt(t.faellig)) : "ohne Datum"}</div></div>
    ${t.zustaendig ? avatarHtml(t.zustaendig) : ""}<button class="del" aria-label="Löschen" onclick="todoDel('${t.id}')">✕</button></div>`).join("");
  out += `<div class="formgrid"><input id="td-titel" class="full" placeholder="Neues To-do…">
    <input id="td-datum" type="date"><select id="td-wer"><option value="">Zuständig?</option>${erwachsene().map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select>
    <button class="btn full" onclick="todoAdd()">To-do anlegen</button></div></div>`;

  // Routinen
  out += `<div class="card"><h2>🔁 Routinen<span class="cnt">${S.routinen.length}</span></h2>
    <div class="hint" style="margin:-4px 0 8px">Wiederkehrende Aufgaben – erscheinen automatisch unter „Heute". Rotation wechselt wöchentlich zwischen euch.</div>`;
  out += S.routinen.map(r => {
    const z = routineZustaendig(r);
    return `<div class="row"><div class="grow"><div class="t">${esc(r.titel)}</div>
      <div class="s">${(r.tage || []).join(", ")}${r.zustaendig === "rotation" ? " · 🔄 Rotation, diese Woche:" : " ·"} ${z ? esc(mName(z)) : ""}</div></div>
      <button class="del" aria-label="Löschen" onclick="routineDel('${r.id}')">✕</button></div>`;
  }).join("");
  out += `<div class="formgrid"><input id="rt-titel" class="full" placeholder="z. B. Müll rausbringen">
    <div class="full" id="rt-tage">${SCHULTAGE.concat(["Sa", "So"]).map(t => `<label style="margin-right:10px;font-size:13px"><input type="checkbox" value="${t}" style="width:auto"> ${t}</label>`).join("")}</div>
    <select id="rt-wer" class="full"><option value="rotation">🔄 Rotation (Erwachsene)</option>${S.mitglieder.map(mm => `<option value="${mm.id}">${esc(mm.name)}</option>`).join("")}</select>
    <button class="btn full" onclick="routineAdd()">Routine anlegen</button></div></div>`;
  return out;
}
function todoAdd() {
  const t = $("td-titel").value.trim(); if (!t) return toast("Titel fehlt");
  S.todos.push({ id: uid(), titel: t, faellig: $("td-datum").value, zustaendig: $("td-wer").value, erledigt: false });
  save("todos"); toast("To-do angelegt");
}
function todoToggle(id) {
  const t = S.todos.find(x => x.id === id); if (!t) return;
  t.erledigt = !t.erledigt; t.erledigtAm = t.erledigt ? heute() : null; vib(); save("todos");
}
function todoDel(id) { S.todos = S.todos.filter(x => x.id !== id); save("todos"); }
function routineAdd() {
  const t = $("rt-titel").value.trim(); if (!t) return toast("Titel fehlt");
  const tage = [...document.querySelectorAll("#rt-tage input:checked")].map(c => c.value);
  if (!tage.length) return toast("Mindestens einen Tag wählen");
  S.routinen.push({ id: uid(), titel: t, tage, zustaendig: $("rt-wer").value, done: {} });
  save("routinen"); toast("Routine angelegt");
}
function routineToggle(id) {
  const r = S.routinen.find(x => x.id === id); if (!r) return;
  const h = heute(); if (!r.done) r.done = {};
  if (r.done[h]) delete r.done[h]; else r.done[h] = routineZustaendig(r) || true;
  vib();
  save("routinen");
}
function routineDel(id) { if (!confirm("Routine löschen?")) return; S.routinen = S.routinen.filter(x => x.id !== id); save("routinen"); }

const PACK_VORLAGEN = [
  { titel: "Schwimmbad", emoji: "🏊", items: ["Badehose / Badeanzug", "Handtücher", "Schwimmbrille", "Schwimmflügel / Schwimmnudel", "Duschgel & Bürste", "Wechselkleidung", "Snacks & Trinkflaschen", "Eintritt / Geldkarte"] },
  { titel: "Badesee", emoji: "🏞️", items: ["Badesachen", "Handtücher", "Sonnencreme", "Sonnenschirm / UV-Zelt", "Picknickdecke", "Kühltasche mit Snacks & Getränken", "Sandspielzeug", "Luftmatratze / SUP", "Wechselkleidung", "Mülltüte"] },
  { titel: "Camping", emoji: "⛺", items: ["Zelt / Dachzelt", "Schlafsäcke", "Isomatten", "Campingstühle & Tisch", "Kocher & Gas", "Töpfe & Geschirr", "Kühlbox", "Stirnlampen", "Powerbank", "Mückenspray", "Erste-Hilfe-Set", "Regenjacken", "Spiele & Karten"] },
  { titel: "Flugreise", emoji: "✈️", items: ["Ausweise / Reisepässe", "Buchungsunterlagen", "Snacks fürs Handgepäck", "Kinderkopfhörer", "Tablet geladen + Filme offline", "Wechselkleidung im Handgepäck", "Reiseapotheke", "Ladekabel & Adapter", "Kuscheltiere", "Leere Trinkflaschen", "Sonnencreme"] },
  { titel: "Wandertag", emoji: "🥾", items: ["Wanderschuhe", "Rucksack", "Trinkflaschen", "Brotzeit", "Regenjacken", "Sonnenhut & Sonnencreme", "Erste-Hilfe-Set", "Zeckenzange", "Route offline geladen"] },
  { titel: "Übernachtung bei Opa", emoji: "🛏️", items: ["Schlafanzug", "Zahnbürste", "Wechselkleidung", "Kuscheltier", "Lieblingsbuch", "Medikamente (falls nötig)"] }
];
let aktivePackliste = null;
function packMigrieren() {
  // Alte wochentagsbasierte Einträge in eine Liste retten
  const alte = S.packlisten.filter(p => p.wochentag);
  if (!alte.length) return;
  const rest = S.packlisten.filter(p => !p.wochentag);
  rest.push({ id: uid(), titel: "Schulwoche (alt)", emoji: "🎒", items: alte.map(p => ({ id: uid(), was: (p.wochentag + ": " + p.was), done: false })) });
  S.packlisten = rest; save("packlisten");
}
function rPacklisten() {
  packMigrieren();
  const liste = S.packlisten.find(l => l.id === aktivePackliste);
  if (liste) return rPacklisteDetail(liste);
  let out = `<div class="card"><h2>🎒 Packlisten<span class="cnt">${S.packlisten.length}</span></h2>
    <div class="hint" style="margin:-4px 0 10px">Themenlisten zum Abhaken – Schwimmbad, Camping, Flugreise … Haken lassen sich fürs nächste Mal zurücksetzen.</div>`;
  out += S.packlisten.map(l => {
    const items = l.items || [], fertig = items.filter(i => i.done).length;
    return `<div class="row"><button class="grow" style="text-align:left" onclick="aktivePackliste='${l.id}';render()">
      <div class="t">${esc(l.emoji || "🎒")} ${esc(l.titel)}</div>
      <div class="s">${fertig} von ${items.length} gepackt</div></button>
      <span style="color:var(--muted)">›</span></div>`;
  }).join("") || `<div class="empty">Noch keine Listen – Vorlage antippen oder eigene anlegen.</div>`;
  const offen = PACK_VORLAGEN.filter(v => !S.packlisten.some(l => l.titel === v.titel));
  if (offen.length) out += `<div class="hint" style="margin-top:10px">Vorlagen:</div>
    <div class="chiprow">${offen.map(v => `<button onclick="packVorlage('${esc(v.titel)}')">${v.emoji} ${esc(v.titel)}</button>`).join("")}</div>`;
  out += `<div class="addform"><input id="pl-titel" placeholder="Eigene Liste (z. B. Skiurlaub)" onkeydown="if(event.key==='Enter')packListeAdd()">
    <button class="btn" onclick="packListeAdd()">＋</button></div></div>`;
  return out;
}
function rPacklisteDetail(l) {
  const items = l.items || [];
  let out = `<button class="btn small ghost" style="margin-bottom:12px" onclick="aktivePackliste=null;render()">‹ Alle Listen</button>`;
  out += `<div class="card"><h2>${esc(l.emoji || "🎒")} ${esc(l.titel)}<span class="cnt">${items.filter(i => i.done).length}/${items.length}</span></h2>`;
  out += items.map(i => `<div class="row ${i.done ? "done" : ""}">
    <button aria-label="Abhaken" class="check ${i.done ? "on" : ""}" onclick="packItemToggle('${l.id}','${i.id}')">${i.done ? "✓" : ""}</button>
    <div class="grow"><div class="t">${esc(i.was)}</div></div>
    <button class="del" aria-label="Löschen" onclick="packItemDel('${l.id}','${i.id}')">✕</button></div>`).join("") || `<div class="empty">Liste ist leer.</div>`;
  out += `<div class="addform"><input id="pi-was" placeholder="Was muss mit?" onkeydown="if(event.key==='Enter')packItemAdd('${l.id}')">
    <button class="btn" onclick="packItemAdd('${l.id}')">＋</button></div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn small ghost" style="flex:1" onclick="packReset('${l.id}')">↩️ Haken zurücksetzen</button>
      <button class="btn small coral" onclick="packListeDel('${l.id}')">Liste löschen</button>
    </div></div>`;
  return out;
}
function packVorlage(titel) {
  const v = PACK_VORLAGEN.find(x => x.titel === titel); if (!v) return;
  const l = { id: uid(), titel: v.titel, emoji: v.emoji, items: v.items.map(w => ({ id: uid(), was: w, done: false })) };
  S.packlisten.push(l); save("packlisten"); aktivePackliste = l.id; render();
}
function packListeAdd() {
  const t = $("pl-titel").value.trim(); if (!t) return toast("Name fehlt");
  const l = { id: uid(), titel: t, emoji: "🎒", items: [] };
  S.packlisten.push(l); save("packlisten"); aktivePackliste = l.id; render();
}
function packListeDel(id) {
  if (!confirm("Liste komplett löschen?")) return;
  S.packlisten = S.packlisten.filter(l => l.id !== id); aktivePackliste = null; save("packlisten");
}
function packItemAdd(listeId) {
  const w = $("pi-was").value.trim(); if (!w) return;
  const l = S.packlisten.find(x => x.id === listeId); if (!l) return;
  if (!l.items) l.items = [];
  l.items.push({ id: uid(), was: w, done: false }); save("packlisten");
}
function packReset(listeId) {
  const l = S.packlisten.find(x => x.id === listeId); if (!l) return;
  (l.items || []).forEach(i => i.done = false); save("packlisten"); toast("Bereit fürs nächste Mal");
}
function packItemToggle(listeId, itemId) {
  const l = S.packlisten.find(x => x.id === listeId); if (!l) return;
  const i = (l.items || []).find(x => x.id === itemId); if (!i) return;
  i.done = !i.done; vib(); save("packlisten");
}
function packItemDel(listeId, itemId) {
  const l = S.packlisten.find(x => x.id === listeId); if (!l) return;
  l.items = (l.items || []).filter(x => x.id !== itemId); save("packlisten");
}

/* ============================================================
   TAB: ESSEN (Wochenplan + Kochbuch)
   ============================================================ */
function rEssen() {
  let out = segHtml("essen", [["woche", "Wochenplan"], ["kochbuch", "📖 Kochbuch"]]);
  if (sub.essen === "kochbuch") return out + rKochbuch();

  const start = essenWochenStart();
  const kw = isoWoche(new Date(dstr(start) + "T12:00:00"));
  const wochenLabel = essenWoche === 0 ? "Diese Woche" : essenWoche === 1 ? "Nächste Woche" : "KW " + kw;
  out += `<div class="card"><h2>🍽️ Essensplan
      <span class="cnt" style="display:flex;align-items:center;gap:4px">
        <button class="btn small ghost" ${essenWoche <= 0 ? "disabled style='opacity:.35'" : ""} onclick="essenWoche--;render()">‹</button>
        ${wochenLabel} · KW ${kw}
        <button class="btn small ghost" onclick="essenWoche++;render()">›</button>
      </span></h2>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn ghost small" style="flex:1" onclick="wocheFuellen(false)">✨ Offene Tage füllen</button>
      <button class="btn ghost small" style="flex:1" onclick="wocheFuellen(true)">🎲 Woche neu würfeln</button>
    </div>`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dstr(d), plan = S.essensplan[ds] || {};
    const dish = S.kochbuch.find(x => x.id === plan.dishId);
    out += `<div class="weekrow ${ds === heute() ? "today" : ""}"><div class="day"><div class="wd">${WD[d.getDay()]}</div><div class="dt">${d.getDate()}.${d.getMonth() + 1}.</div></div>
      <div class="grow">`;
    if (dish) {
      out += `<div class="row" style="padding:4px 0;border:none">
        <button class="grow" style="text-align:left" onclick="dishSheet('${dish.id}','${ds}')">
          <div class="t">${esc(dish.name)} <span style="color:var(--muted);font-weight:400">›</span></div>
          <div class="s">${ART_ICON[dish.art] || ""} ${dish.zeit === "wochenende" ? "🕐" : "⚡"}${dish.grill ? " 🔥" : ""}${dish.frisch ? " 🌿 frisch" : ""} · antippen für Rezept</div>
        </button>
        <button class="del" aria-label="Löschen" title="Eintrag entfernen" onclick="essenClear('${ds}')">✕</button></div>`;
    } else if (plan.text) {
      out += `<div class="row" style="padding:4px 0;border:none">
        <button class="grow" style="text-align:left" onclick="essenSet('${ds}','__frei')"><div class="t">${esc(plan.text)}</div><div class="s">✏️ antippen zum Ändern</div></button>
        <button class="del" aria-label="Löschen" onclick="essenClear('${ds}')">✕</button></div>`;
    } else {
      out += `<select onchange="essenSet('${ds}',this.value)" style="width:100%">
          <option value="">– wählen –</option>
          ${S.kochbuch.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}
          <option value="__frei">✏️ Freitext…</option>
        </select>`;
    }
    out += `</div></div>`;
  }
  out += `<div class="hint">Einkaufstag ist ${einkaufstag()} (änderbar unter Mehr → Familie): 🌿 Frisches wird nur kurz danach vorgeschlagen. Sa = 🍕 Pizza, Fr = alle zwei Wochen 🔥 Grillvorschlag.</div></div>`;

  // Smart-Vorschläge für offene Tage der angezeigten Woche
  const offeneTage = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dstr(d);
    if (!(S.essensplan[ds] && (S.essensplan[ds].text || S.essensplan[ds].dishId))) offeneTage.push(ds);
  }
  if (S.kochbuch.length >= 3 && offeneTage.length) {
    out += `<div class="card"><h2>💡 Vorschläge für offene Tage</h2>
      <div class="hint" style="margin:-4px 0 6px">Bevorzugt: lange nicht gekocht, werktags nur Schnelles, ab 3 Fleisch/Fisch-Tagen automatisch vegetarisch.</div>`;
    offeneTage.forEach(ds => {
      const v = vorschlagFuer(ds); if (!v) return;
      out += `<div class="row"><div class="day" style="flex:none;width:38px;text-align:center">
        <div style="font-family:Sora;font-weight:700;font-size:13px">${wtag(ds)}</div></div>
        <div class="grow"><div class="t">${esc(v.name)}</div>
        <div class="s">${ART_ICON[v.art] || ""} ${v.art === "veggie" ? "vegetarisch" : v.art} · ${v.zeit === "wochenende" ? "mehr Zeit" : "≤ 30 Min"}${letztesMal(v.id) ? " · zuletzt " + fmt(letztesMal(v.id)) : " · noch nie gekocht"}</div></div>
        <button class="btn small ghost" onclick="vorschlagWeiter('${ds}')">🔄</button>
        <button class="btn small" onclick="vorschlagNehmen('${ds}','${v.id}')">✓</button></div>`;
    });
    out += `</div>`;
  }
  return out;
}
function essenClear(ds) { delete S.essensplan[ds]; save("essensplan"); }
function essenSet(ds, val) {
  if (val === "__frei") {
    const alt = (S.essensplan[ds] && S.essensplan[ds].text) || "";
    sheetInput("Was gibt es am " + fmt(ds) + "?", "z. B. Reste, Grillen bei Oma…", alt, txt => {
      if (txt) { S.essensplan[ds] = { text: txt }; save("essensplan"); } else render();
    });
    return;
  }
  if (val) S.essensplan[ds] = { dishId: val };
  else delete S.essensplan[ds];
  save("essensplan");
}
function zutatenAufListe(dishId) {
  const d = S.kochbuch.find(x => x.id === dishId); if (!d) return;
  let n = 0;
  (d.zutaten || []).forEach(z => {
    if (!S.einkauf.some(e => !e.erledigt && e.name.toLowerCase() === z.toLowerCase())) {
      S.einkauf.push({ id: uid(), name: z, kategorie: autoKategorie(z), erledigt: false }); n++;
    }
  });
  save("einkauf"); toast(n + " Zutaten auf der Einkaufsliste");
}
/* ----- Starter-Kochbuch: 40 ausgewogene Familiengerichte -----
   art: veggie/fleisch/fisch · zeit: schnell (≤30 Min) / wochenende
   Basics (Salz, Pfeffer, Öl, Gewürze) werden als vorhanden angenommen. */
const STARTER_KOCHBUCH = [
  // Italienisch / Mediterran
  { name: "Spaghetti Bolognese", tipp: "Zwiebel und geriebene Karotte anbraten, Hack krümelig braten, Passata dazu, 15 Min köcheln – fertig mit Parmesan.", art: "fleisch", zeit: "schnell", kueche: "ital", zutaten: ["Spaghetti", "Rinderhack", "Passierte Tomaten", "Zwiebel", "Karotten", "Parmesan"] },
  { name: "Penne mit Tomaten-Sahne & verstecktem Gemüse", tipp: "Zucchini und Karotten fein reiben und in der Soße mitkochen – die Kinder merken nichts.", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Penne", "Passierte Tomaten", "Sahne", "Zucchini", "Karotten", "Parmesan"] },
  { name: "Gnocchi-Pfanne mit Zucchini & Cherrytomaten", tipp: "Gnocchi direkt in der Pfanne goldbraun braten (nicht kochen!), Gemüse dazu, Mozzarella zum Schluss.", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Gnocchi", "Zucchini", "Cherrytomaten", "Knoblauch", "Mozzarella", "Basilikum"] },
  { name: "Pizza selbst belegt", tipp: "Teig 1 Std gehen lassen; jeder belegt seine Hälfte selbst – Ofen auf Maximum, Pizza aufs heiße Blech.", art: "veggie", zeit: "wochenende", kueche: "ital", zutaten: ["Mehl", "Hefe", "Passierte Tomaten", "Mozzarella", "Paprika", "Mais", "Schinken (optional)"] },
  { name: "Tagliatelle mit Lachs & Spinat", frisch: true, tipp: "Lachs würfeln, kurz anbraten, rausnehmen. Spinat in Sahne zusammenfallen lassen, Lachs zurück, Zitrone drüber.", art: "fisch", zeit: "schnell", kueche: "ital", zutaten: ["Tagliatelle", "Lachsfilet", "Blattspinat", "Sahne", "Zitrone", "Knoblauch"] },
  { name: "Minestrone mit Parmesan", tipp: "Alles Gemüse klein würfeln, mit Tomaten und Brühe 20 Min köcheln, Nudeln die letzten 8 Min mitkochen.", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Suppennudeln", "Karotten", "Zucchini", "Sellerie", "Weiße Bohnen", "Gehackte Tomaten", "Parmesan"] },
  { name: "Zitronen-Hähnchen mit Reis", tipp: "Hähnchen in Streifen braten, mit Zitronensaft und Butter ablöschen – die Soße über den Reis.", art: "fleisch", zeit: "schnell", kueche: "ital", zutaten: ["Hähnchenbrust", "Reis", "Zitrone", "Butter", "Brokkoli"] },
  { name: "Ofengemüse mit Halloumi", tipp: "Alles in grobe Stücke, mit Öl mischen, 25 Min bei 200 °C – Halloumi die letzten 10 Min obendrauf.", art: "veggie", zeit: "wochenende", kueche: "ital", zutaten: ["Kartoffeln", "Paprika", "Zucchini", "Rote Zwiebeln", "Halloumi", "Kräuterquark"] },
  { name: "Erbsen-Risotto", tipp: "Reis glasig dünsten, Brühe kellenweise zugeben und rühren, Erbsen und Parmesan zum Schluss.", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Risottoreis", "Erbsen (TK)", "Zwiebel", "Gemüsebrühe", "Parmesan", "Butter"] },
  { name: "Caprese-Hähnchen aus dem Ofen", tipp: "Hähnchenbrust einschneiden, Tomate und Mozzarella hineinstecken, 25 Min bei 180 °C.", art: "fleisch", zeit: "wochenende", kueche: "ital", zutaten: ["Hähnchenbrust", "Tomaten", "Mozzarella", "Basilikum", "Ciabatta", "Salat"] },
  { name: "Thunfisch-Tomaten-Pasta", tipp: "Zwiebel andünsten, Tomaten und abgetropften Thunfisch dazu, 10 Min köcheln – Mais macht es kindertauglich.", art: "fisch", zeit: "schnell", kueche: "ital", zutaten: ["Fusilli", "Thunfisch (Dose)", "Gehackte Tomaten", "Zwiebel", "Mais", "Parmesan"] },
  // Deutsch-klassisch
  { name: "Kartoffelpuffer mit Apfelmus", tipp: "Kartoffeln reiben und gut ausdrücken (wichtig!), mit Ei und Mehl mischen, portionsweise knusprig braten.", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Kartoffeln", "Eier", "Mehl", "Zwiebel", "Apfelmus"] },
  { name: "Linsensuppe mit Würstchen", tipp: "Linsen mit Gemüse und Brühe 40 Min köcheln, Würstchen die letzten 10 Min, Schuss Essig zum Schluss.", art: "fleisch", zeit: "wochenende", kueche: "deutsch", zutaten: ["Tellerlinsen", "Kartoffeln", "Karotten", "Lauch", "Würstchen", "Essig"] },
  { name: "Käsespätzle mit Salat", tipp: "Spätzle mit Käse schichten und im Ofen schmelzen, Röstzwiebeln drüber – Salat als frischer Ausgleich.", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Spätzle", "Bergkäse gerieben", "Zwiebeln", "Kopfsalat", "Schnittlauch"] },
  { name: "Frikadellen mit Püree & Erbsen", tipp: "Eingeweichtes Brötchen, Hack, Ei, Zwiebel verkneten, flache Klopse langsam braten – innen saftig.", art: "fleisch", zeit: "schnell", kueche: "deutsch", zutaten: ["Gemischtes Hack", "Brötchen (alt)", "Ei", "Zwiebel", "Kartoffeln", "Milch", "Erbsen (TK)"] },
  { name: "Pfannkuchen süß & herzhaft", tipp: "1 Tasse Mehl, 1 Tasse Milch, 2 Eier – dünn ausbacken; erst herzhaft mit Käse, dann süß mit Apfelmus.", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Mehl", "Eier", "Milch", "Apfelmus", "Käse", "Schinken (optional)"] },
  { name: "Kartoffelsuppe", tipp: "Alles weich kochen, pürieren, Sahne dazu – mit Brotwürfeln aus der Pfanne servieren.", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Kartoffeln", "Karotten", "Lauch", "Gemüsebrühe", "Sahne", "Brot"] },
  { name: "Fischstäbchen mit Püree & Gurkensalat", tipp: "Fischstäbchen im Ofen knuspriger als in der Pfanne; Gurkensalat mit Joghurt-Dill-Dressing.", art: "fisch", zeit: "schnell", kueche: "deutsch", zutaten: ["Fischstäbchen", "Kartoffeln", "Milch", "Butter", "Salatgurke", "Joghurt", "Dill"] },
  { name: "Schnitzel mit Kartoffelsalat", tipp: "Schnitzel dünn klopfen, panieren, in reichlich Butterschmalz schwimmend goldbraun braten.", art: "fleisch", zeit: "wochenende", kueche: "deutsch", zutaten: ["Schweineschnitzel", "Paniermehl", "Eier", "Kartoffeln", "Gurke", "Brühe", "Senf"] },
  { name: "Nudelauflauf mit Schinken & Brokkoli", tipp: "Nudeln 2 Min kürzer kochen, alles mischen, Sahne-Ei-Guss drüber, 20 Min bei 180 °C überbacken.", art: "fleisch", zeit: "wochenende", kueche: "deutsch", zutaten: ["Fusilli", "Kochschinken", "Brokkoli", "Sahne", "Eier", "Käse gerieben"] },
  { name: "Milchreis mit warmen Kirschen", tipp: "Milchreis bei kleinster Hitze 30 Min ziehen lassen (oft rühren), Kirschen mit Saft kurz erwärmen.", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Milchreis", "Milch", "Sauerkirschen (Glas)", "Zimt", "Zucker"] },
  { name: "Ofenkartoffeln mit Kräuterquark & Rohkost", tipp: "Große Kartoffeln 45–60 Min bei 200 °C backen – kaum Arbeit, der Ofen macht alles.", art: "veggie", zeit: "wochenende", kueche: "deutsch", zutaten: ["Große Kartoffeln", "Quark", "Schnittlauch", "Karotten", "Paprika", "Gurke"] },
  { name: "Flammkuchen", tipp: "Teig hauchdünn ausrollen, Schmand dünn verstreichen, 12 Min bei 230 °C – Kinderhälfte ohne Zwiebeln.", art: "fleisch", zeit: "schnell", kueche: "deutsch", zutaten: ["Flammkuchenteig", "Schmand", "Speckwürfel", "Zwiebeln", "Feldsalat"] },
  // Asiatisch (mild & kindertauglich)
  { name: "Gebratener Reis mit Ei & Gemüse", tipp: "Am besten mit Reis vom Vortag; Ei zuerst stocken lassen, dann alles zusammen scharf braten.", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Reis", "Eier", "Erbsen (TK)", "Karotten", "Frühlingszwiebeln", "Sojasoße"] },
  { name: "Hähnchen-Teriyaki mit Reis & Brokkoli", tipp: "Hähnchen braten, Teriyakisoße einköcheln bis sie glänzt, Sesam drüber – Brokkoli nur bissfest dämpfen.", art: "fleisch", zeit: "schnell", kueche: "asia", zutaten: ["Hähnchenbrust", "Teriyakisoße", "Reis", "Brokkoli", "Sesam"] },
  { name: "Mildes Gemüse-Kokos-Curry", tipp: "Currypaste kurz anrösten, mit Kokosmilch ablöschen, Gemüse 15 Min mitköcheln – Schärfe kommt bei Bedarf am Tisch dazu.", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Kokosmilch", "Currypaste mild", "Kartoffeln", "Karotten", "Zuckerschoten", "Reis"] },
  { name: "Bratnudeln mit Gemüse", tipp: "Nudeln kochen, abschrecken, dann mit Gemüsestreifen in heißer Pfanne braten – Sojasoße erst zum Schluss.", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Mie-Nudeln", "Paprika", "Karotten", "Zucchini", "Sojasoße", "Eier"] },
  { name: "Lachs-Teriyaki mit Reis", frisch: true, tipp: "Lachs auf der Hautseite braten, Soße erst in der letzten Minute dazu, sonst brennt sie an.", art: "fisch", zeit: "schnell", kueche: "asia", zutaten: ["Lachsfilet", "Teriyakisoße", "Reis", "Gurke", "Sesam"] },
  { name: "Sommerrollen zum Selberrollen", tipp: "Alles in Streifen schneiden und Schüsseln auf den Tisch – jeder rollt selbst, Kinder lieben es.", art: "veggie", zeit: "wochenende", kueche: "asia", zutaten: ["Reispapier", "Reisnudeln", "Karotten", "Gurke", "Salat", "Minze", "Erdnusssoße"] },
  { name: "Mildes Butter Chicken", tipp: "Hähnchen in Joghurt marinieren (gern schon morgens), Soße aus Tomaten, Butter und Sahne sanft köcheln.", art: "fleisch", zeit: "wochenende", kueche: "asia", zutaten: ["Hähnchenbrust", "Passierte Tomaten", "Sahne", "Butter", "Garam Masala", "Reis", "Naan"] },
  { name: "Schnelle Nudelsuppe mit Ei & Mais", tipp: "Brühe aufkochen, Nudeln 4 Min, Mais dazu, Ei verquirlt einrühren – in 10 Minuten auf dem Tisch.", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Mie-Nudeln", "Gemüsebrühe", "Eier", "Mais", "Frühlingszwiebeln", "Sojasoße"] },
  { name: "Rotes Linsen-Dal (mild) mit Reis", tipp: "Linsen mit Tomaten und Kokosmilch 15 Min köcheln – sie zerfallen von selbst zur cremigen Soße.", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Rote Linsen", "Kokosmilch", "Gehackte Tomaten", "Zwiebel", "Curry mild", "Reis"] },
  // Orientalisch / Levante
  { name: "Falafel-Wraps mit Joghurtsoße", tipp: "Falafel nach Packung erwärmen, Joghurt mit geriebener Gurke mischen, jeder wickelt selbst.", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Falafel", "Wraps", "Joghurt", "Gurke", "Tomaten", "Salat"] },
  { name: "Couscous-Salat mit Feta", tipp: "Couscous nur mit heißer Brühe übergießen und 5 Min quellen lassen – kein Kochen nötig.", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Couscous", "Gurke", "Tomaten", "Feta", "Minze", "Zitrone"] },
  { name: "Hähnchen-Schawarma-Pfanne mit Fladenbrot", tipp: "Hähnchenstreifen mit Gewürz kräftig anbraten, ins warme Fladenbrot mit Joghurtsoße.", art: "fleisch", zeit: "schnell", kueche: "orient", zutaten: ["Hähnchenbrust", "Schawarma-Gewürz", "Fladenbrot", "Joghurt", "Gurke", "Tomaten"] },
  { name: "Shakshuka mit Fladenbrot", tipp: "Paprika und Zwiebel weich dünsten, Tomaten einköcheln, Mulden formen, Eier hineinschlagen, Deckel drauf.", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Eier", "Gehackte Tomaten", "Paprika", "Zwiebel", "Feta", "Fladenbrot"] },
  { name: "Ofen-Köfte mit Bulgur & Joghurt-Dip", tipp: "Hack mit viel Petersilie würzen, längliche Röllchen formen, 20 Min bei 200 °C – spritzt nicht, geht nebenbei.", art: "fleisch", zeit: "wochenende", kueche: "orient", zutaten: ["Rinderhack", "Petersilie", "Zwiebel", "Bulgur", "Joghurt", "Gurke"] },
  { name: "Hummus-Teller mit warmem Fladenbrot", tipp: "Kichererbsen mit Tahini, Zitrone und Eiswürfel cremig mixen – Gemüsesticks zum Dippen.", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Kichererbsen", "Tahini", "Zitrone", "Fladenbrot", "Karotten", "Gurke", "Paprika"] },
  // Schnelle Allrounder
  { name: "Hähnchen-Wraps mit Salat", tipp: "Hähnchen würzig braten, alles in Schüsseln auf den Tisch – Wrap-Buffet, jeder baut seinen eigenen.", art: "fleisch", zeit: "schnell", kueche: "orient", zutaten: ["Wraps", "Hähnchenbrust", "Salat", "Tomaten", "Mais", "Joghurt-Dressing"] },
  { name: "Backofen-Fisch mit Zitronenkartoffeln", frisch: true, tipp: "Kartoffelscheiben 25 Min vorbacken, Fisch mit Zitrone obendrauf, weitere 15 Min – ein Blech, wenig Abwasch.", art: "fisch", zeit: "wochenende", kueche: "ital", zutaten: ["Weißfischfilet", "Kartoffeln", "Zitrone", "Cherrytomaten", "Oliven (optional)"] },
  // Grillgerichte (für Freitage) & weitere Familienklassiker
  { name: "Grillabend: Würstchen & Folienkartoffeln", art: "fleisch", zeit: "schnell", kueche: "deutsch", grill: true, tipp: "Kartoffeln in Folie zuerst auf den Grill (40 Min Randzone), Würstchen zum Schluss – Kräuterquark dazu.", zutaten: ["Bratwürste", "Große Kartoffeln", "Kräuterquark", "Salatgurke", "Ketchup & Senf"] },
  { name: "Grillteller mit Halloumi & Gemüsespießen", art: "veggie", zeit: "schnell", kueche: "orient", grill: true, tipp: "Gemüse und Halloumi abwechselnd aufspießen, mit Öl bepinseln – Halloumi wird auf dem Grill goldbraun statt zu schmelzen.", zutaten: ["Halloumi", "Paprika", "Zucchini", "Champignons", "Ciabatta", "Tzatziki"] },
  { name: "Gegrillte Hähnchenspieße mit Fladenbrot", art: "fleisch", zeit: "schnell", kueche: "orient", grill: true, tipp: "Hähnchen schon morgens in Joghurt und Paprikapulver marinieren – bleibt auf dem Grill saftig.", zutaten: ["Hähnchenbrust", "Joghurt", "Paprikapulver", "Fladenbrot", "Tomaten", "Gurke"] },
  { name: "Ofen-Frittata mit Kartoffeln & Gemüse", art: "veggie", zeit: "schnell", kueche: "ital", tipp: "Reste-Retter: gekochte Kartoffeln und Gemüse in eine Form, verquirlte Eier mit Käse drüber, 20 Min bei 180 °C.", zutaten: ["Eier", "Kartoffeln (gekocht)", "Paprika", "Zucchini", "Käse gerieben", "Milch"] },
  { name: "Spinat-Ricotta-Cannelloni", art: "veggie", zeit: "wochenende", kueche: "ital", tipp: "Füllung mit Spritzbeutel oder Gefrierbeutel (Ecke abschneiden) einfüllen – geht doppelt so schnell.", zutaten: ["Cannelloni", "Ricotta", "Blattspinat", "Passierte Tomaten", "Mozzarella", "Parmesan"] },
  { name: "Kürbissuppe mit Brot", art: "veggie", zeit: "schnell", kueche: "deutsch", tipp: "Hokkaido muss nicht geschält werden – würfeln, weich kochen, mit Kokosmilch pürieren.", zutaten: ["Hokkaido-Kürbis", "Kartoffeln", "Kokosmilch", "Gemüsebrühe", "Brot", "Kürbiskerne"] },
  { name: "Zürcher Geschnetzeltes mit Reis", art: "fleisch", zeit: "schnell", kueche: "deutsch", frisch: true, tipp: "Fleisch portionsweise scharf anbraten und rausnehmen – erst die Sahnesoße binden, dann zurückgeben.", zutaten: ["Schweinefilet", "Champignons", "Sahne", "Zwiebel", "Reis", "Petersilie"] },
  { name: "Fischstäbchen-Burger", art: "fisch", zeit: "schnell", kueche: "deutsch", tipp: "Fischstäbchen extra knusprig backen, mit Remoulade und Salat ins Brötchen – Kinderhit mit Tiefkühl-Basis.", zutaten: ["Fischstäbchen", "Burgerbrötchen", "Remoulade", "Salat", "Tomaten", "Gurke"] },
  { name: "Garnelen-Pasta mit Zitrone", art: "fisch", zeit: "schnell", kueche: "ital", frisch: true, tipp: "Garnelen nur 2–3 Minuten braten, sonst werden sie gummiartig – Zitronenabrieb erst am Ende.", zutaten: ["Spaghetti", "Garnelen", "Knoblauch", "Zitrone", "Cherrytomaten", "Petersilie"] },
  { name: "Gemüse-Quesadillas", art: "veggie", zeit: "schnell", kueche: "orient", tipp: "Wraps mit Käse und Gemüse belegen, zuklappen, in der trockenen Pfanne beidseitig knusprig braten, in Ecken schneiden.", zutaten: ["Wraps", "Käse gerieben", "Paprika", "Mais", "Frühlingszwiebeln", "Joghurt-Dip"] }
];
const ART_ICON = { veggie: "🥦", fleisch: "🍗", fisch: "🐟" };
const KUECHE_LBL = { ital: "Mediterran", deutsch: "Klassisch", asia: "Asiatisch", orient: "Levante" };

function starterImport() {
  let n = 0;
  STARTER_KOCHBUCH.forEach(r => {
    if (!S.kochbuch.some(k => k.name.toLowerCase() === r.name.toLowerCase())) {
      S.kochbuch.push(Object.assign({ id: uid() }, r)); n++;
    }
  });
  save("kochbuch"); toast(n + " Gerichte importiert");
}

/* ----- Vorschlagslogik: lange nicht gekocht + Wochentag + Balance ----- */
function letztesMal(dishId) {
  let max = "";
  Object.entries(S.essensplan).forEach(([d, p]) => { if (p && p.dishId === dishId && d <= heute() && d > max) max = d; });
  return max; // "" = noch nie
}
function fleischTageInWoche(startDs) {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDs + "T12:00:00"); d.setDate(d.getDate() + i);
    const p = S.essensplan[dstr(d)];
    if (p && p.dishId) { const dish = S.kochbuch.find(k => k.id === p.dishId); if (dish && dish.art !== "veggie") n++; }
  }
  return n;
}
let vorschlagOffset = {};
function einkaufstag() { return (S.einstellungen && S.einstellungen.einkaufstag) || "Di"; }
function tageSeitEinkauf(ds) {
  const tagIdx = WD.indexOf(wtag(ds)), ekIdx = WD.indexOf(einkaufstag());
  return (tagIdx - ekIdx + 7) % 7;
}
function vorschlagFuer(ds) {
  const w = wtag(ds), istWE = (w === "Sa" || w === "So");
  const startDs = dstr(wochenStart(new Date(ds + "T12:00:00")));
  const vielFleisch = fleischTageInWoche(startDs) >= 3;
  let kand = S.kochbuch.filter(k => istWE || (k.zeit || "schnell") === "schnell");
  // Frische-Regel: Gerichte mit sehr frischen Zutaten nur bis 2 Tage nach dem Einkaufstag
  const frischOk = tageSeitEinkauf(ds) <= 2;
  if (!frischOk) { const halt = kand.filter(k => !k.frisch); if (halt.length) kand = halt; }
  if (vielFleisch) { const veg = kand.filter(k => k.art === "veggie"); if (veg.length) kand = veg; }
  if (!kand.length) kand = S.kochbuch.slice();
  // Bereits diese Woche geplante ausschließen
  const geplant = new Set();
  for (let i = 0; i < 7; i++) { const d = new Date(startDs + "T12:00:00"); d.setDate(d.getDate() + i); const p = S.essensplan[dstr(d)]; if (p && p.dishId) geplant.add(p.dishId); }
  const frei = kand.filter(k => !geplant.has(k.id)); if (frei.length) kand = frei;
  kand.sort((a, b) => letztesMal(a.id) < letztesMal(b.id) ? -1 : 1); // am längsten her zuerst
  // Wochentags-Traditionen: Samstag = Pizza, Freitag in geraden Wochen = Grillen
  if (w === "Sa") {
    const pizza = S.kochbuch.find(k => /pizza/i.test(k.name));
    if (pizza) kand = [pizza, ...kand.filter(k => k.id !== pizza.id)];
  } else if (w === "Fr" && isoWoche(new Date(ds + "T12:00:00")) % 2 === 0) {
    const grill = kand.filter(k => k.grill), rest = kand.filter(k => !k.grill);
    if (grill.length) kand = [...grill, ...rest];
  }
  if (!kand.length) return null;
  return kand[(vorschlagOffset[ds] || 0) % kand.length];
}
function vorschlagWeiter(ds) { vorschlagOffset[ds] = (vorschlagOffset[ds] || 0) + 1; render(); }
function vorschlagNehmen(ds, dishId) { S.essensplan[ds] = { dishId }; save("essensplan"); toast("Übernommen"); }
let essenWoche = 0; // 0 = aktuelle Woche, 1 = nächste Woche …
function essenWochenStart() {
  const s = wochenStart(new Date()); s.setDate(s.getDate() + essenWoche * 7); return s;
}
function wocheFuellen(alles) {
  const start = essenWochenStart();
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dstr(d);
    const belegt = S.essensplan[ds] && (S.essensplan[ds].text || S.essensplan[ds].dishId);
    if (belegt && !alles) continue;
    if (alles && belegt) { vorschlagOffset[ds] = (vorschlagOffset[ds] || 0) + 1; delete S.essensplan[ds]; }
    const v = vorschlagFuer(ds);
    if (v) { S.essensplan[ds] = { dishId: v.id }; n++; }
  }
  save("essensplan"); toast(n ? n + " Tage geplant 🎲" : "Nichts zu füllen");
}
function dishSheet(dishId, ds) {
  const d = S.kochbuch.find(x => x.id === dishId); if (!d) return;
  const tipp = d.tipp || (STARTER_KOCHBUCH.find(r => r.name.toLowerCase() === d.name.toLowerCase()) || {}).tipp || "";
  $("sheet").innerHTML = `<h3>${esc(d.name)}</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:-6px 0 12px">
      <span class="chip">${ART_ICON[d.art] || "🥦"} ${d.art === "veggie" ? "vegetarisch" : d.art || "vegetarisch"}</span>
      <span class="chip">${d.zeit === "wochenende" ? "🕐 mehr Zeit" : "⚡ ≤ 30 Min"}</span>
      ${d.kueche ? `<span class="chip">${KUECHE_LBL[d.kueche] || esc(d.kueche)}</span>` : ""}
    </div>
    ${(d.zutaten || []).length ? `<div class="hint" style="font-weight:600;margin-bottom:4px">Zutaten:</div>
      ${(d.zutaten || []).map(z => `<div class="row" style="padding:6px 0"><div class="grow">${esc(z)}</div></div>`).join("")}` : ""}
    ${tipp ? `<div class="hint" style="margin-top:10px;line-height:1.5">👨‍🍳 ${esc(tipp)}</div>` : ""}
    <div style="display:flex;gap:8px;margin-top:16px">
      ${(d.zutaten || []).length ? `<button class="btn ghost" style="flex:1" onclick="zutatenAufListe('${d.id}');sheetClose()">🛒 Auf Einkaufsliste</button>` : ""}
      ${ds ? `<button class="btn ghost" style="flex:1" onclick="essenClear('${ds}');sheetClose()">Aus Plan entfernen</button>` : ""}
    </div>
    <button class="btn" style="width:100%;margin-top:8px" onclick="sheetClose()">Schließen</button>`;
  $("modal").classList.add("open");
}

function rKochbuch() {
  const fehlend = STARTER_KOCHBUCH.filter(r => !S.kochbuch.some(k => k.name.toLowerCase() === r.name.toLowerCase())).length;
  let out = `<div class="card"><h2>📖 Familien-Kochbuch<span class="cnt">${S.kochbuch.length} Gerichte</span></h2>`;
  if (!S.kochbuch.length) out += `<div class="empty">Sammelt hier eure Lieblingsgerichte – sie erscheinen dann als Auswahl und Vorschlag im Wochenplan.</div>`;
  if (fehlend) out += `<button class="btn ghost" style="width:100%;margin-bottom:10px" onclick="starterImport()">🥝 ${fehlend} Starter-Gerichte importieren (ausgewogen, kindertauglich)</button>`;
  const gruppen = ["veggie", "fleisch", "fisch"];
  gruppen.forEach(g => {
    const items = S.kochbuch.filter(k => (k.art || "veggie") === g);
    if (!items.length) return;
    out += `<div class="hint" style="margin:8px 0 2px;font-weight:600">${ART_ICON[g]} ${g === "veggie" ? "Vegetarisch" : g === "fleisch" ? "Fleisch" : "Fisch"} (${items.length})</div>`;
    out += items.map(k => `<div class="row"><div class="grow"><div class="t">${esc(k.name)}</div>
      <div class="s">${k.zeit === "wochenende" ? "🕐 mehr Zeit" : "⚡ ≤ 30 Min"}${k.kueche ? " · " + (KUECHE_LBL[k.kueche] || esc(k.kueche)) : ""}${(k.zutaten || []).length ? " · " + (k.zutaten || []).join(", ") : ""}</div></div>
      <button class="del" aria-label="Löschen" onclick="dishDel('${k.id}')">✕</button></div>`).join("");
  });
  out += `<div class="formgrid" style="margin-top:12px"><input id="kb-name" class="full" placeholder="Eigenes Gericht (z. B. Omas Gulasch)">
    <input id="kb-zutaten" class="full" placeholder="Zutaten, mit Komma getrennt (optional)">
    <select id="kb-art"><option value="veggie">🥦 Vegetarisch</option><option value="fleisch">🍗 Fleisch</option><option value="fisch">🐟 Fisch</option></select>
    <select id="kb-zeit"><option value="schnell">⚡ ≤ 30 Min</option><option value="wochenende">🕐 mehr Zeit</option></select>
    <button class="btn full" onclick="dishAdd()">Ins Kochbuch</button></div>
    <div class="hint">Basics wie Salz, Öl und Gewürze stehen nicht in den Zutatenlisten – sie gelten als vorhanden.</div></div>`;
  return out;
}
function dishAdd() {
  const n = $("kb-name").value.trim(); if (!n) return toast("Name fehlt");
  S.kochbuch.push({ id: uid(), name: n, zutaten: $("kb-zutaten").value.split(",").map(x => x.trim()).filter(Boolean), art: $("kb-art").value, zeit: $("kb-zeit").value });
  save("kochbuch"); toast("Gespeichert");
}
function dishDel(id) { if (!confirm("Gericht löschen?")) return; S.kochbuch = S.kochbuch.filter(x => x.id !== id); save("kochbuch"); }

/* ============================================================
   TAB: MEHR
   ============================================================ */
const MEHR = [
  { id: "sterne", icon: "⭐", label: "Kinder-Aufgaben & Sterne" },
  { id: "zettel", icon: "📮", label: "Zettelkasten" },
  { id: "countdowns", icon: "⏳", label: "Countdowns" },
  { id: "ideen", icon: "🌦️", label: "Wochenend-Ideen" },
  { id: "geschenke", icon: "🎁", label: "Geschenke-Merkliste" },
  { id: "gesundheit", icon: "🩺", label: "Gesundheits-Log" },
  { id: "notfall", icon: "📇", label: "Notfall & Infos" },
  { id: "familie", icon: "👨‍👩‍👧‍👧", label: "Familie & Einstellungen" }
];
function rMehr() {
  if (!sub.mehr) {
    return `<div class="card">` + MEHR.map(m =>
      `<div class="row" onclick="setSub('mehr','${m.id}')" style="cursor:pointer">
        <span style="font-size:19px">${m.icon}</span><div class="grow"><div class="t">${m.label}</div></div><span style="color:var(--muted)">›</span></div>`).join("") + `</div>`;
  }
  const zurueck = `<button class="btn small ghost" style="margin-bottom:12px" onclick="setSub('mehr',null)">‹ Zurück</button>`;
  const R = { sterne: rSterne, zettel: rZettel, countdowns: rCountdowns, ideen: rIdeen, geschenke: rGeschenke, gesundheit: rGesundheit, notfall: rNotfall, familie: rFamilie };
  return zurueck + R[sub.mehr]();
}

/* ----- Kinder-Aufgaben & Sterne (Elternpflege) ----- */
function rSterne() {
  if (!kinder().length) return `<div class="card"><div class="empty">Lege zuerst unter <strong>Familie & Einstellungen</strong> die Kinder an.</div></div>`;
  let out = "";
  kinder().forEach(k => {
    const konto = S.sterne[k.id] || { stand: 0, ziel: 20, belohnung: "" };
    const aufg = S.kinderaufgaben.filter(a => a.kindId === k.id);
    out += `<div class="card"><h2>${avatarHtml(k.id)} ${esc(k.name)}<span class="cnt">⭐ ${konto.stand}</span></h2>`;
    out += aufg.map(a => `<div class="row"><span style="font-size:19px">${esc(a.emoji || "⭐")}</span>
      <div class="grow"><div class="t">${esc(a.titel)}</div><div class="s">${(a.tage && a.tage.length) ? a.tage.join(", ") : "täglich"} · ${a.sterne}⭐</div></div>
      <button class="del" aria-label="Löschen" onclick="kidAufgabeDel('${a.id}')">✕</button></div>`).join("");
    out += `<div class="formgrid">
      <input id="ka-titel-${k.id}" class="full" placeholder="Aufgabe (z. B. Zimmer aufräumen)">
      <input id="ka-emoji-${k.id}" placeholder="Emoji" value="🛏️" maxlength="4">
      <select id="ka-sterne-${k.id}"><option value="1">1 ⭐</option><option value="2">2 ⭐</option><option value="3">3 ⭐</option></select>
      <div class="full" id="ka-tage-${k.id}"><span class="hint" style="margin-right:8px">Tage (leer = täglich):</span>${SCHULTAGE.concat(["Sa","So"]).map(t => `<label style="margin-right:8px;font-size:13px"><input type="checkbox" value="${t}" style="width:auto"> ${t}</label>`).join("")}</div>
      <button class="btn full" onclick="kidAufgabeAdd('${k.id}')">Aufgabe anlegen</button></div>
      <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
      <div class="formgrid" style="margin:0">
        <input id="kz-ziel-${k.id}" type="number" min="1" value="${konto.ziel}" placeholder="Ziel">
        <input id="kz-bel-${k.id}" value="${esc(konto.belohnung || "")}" placeholder="Belohnung (z. B. Eis essen)">
        <button class="btn small ghost" onclick="zielSave('${k.id}')">Ziel speichern</button>
        <button class="btn small coral" onclick="sterneReset('${k.id}')">Belohnung eingelöst – auf 0</button>
      </div></div>
      <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
      <div class="hint" style="font-weight:600;margin-bottom:6px">💰 Taschengeld</div>
      ${(() => {
        const tg = tgVon(k.id) || { betrag: 0 };
        const offen = tgOffeneWochen(k.id);
        const dieseWoche = tg.betrag > 0 ? ((tg.erhalten || {})[tgKey()] ? "✓ diese Woche erhalten" : "diese Woche noch offen") : "";
        return `<div class="addform" style="margin:0">
          <input id="tg-betrag-${k.id}" inputmode="decimal" value="${tg.betrag ? String(tg.betrag).replace(".", ",") : "0"}" style="max-width:90px;text-align:right">
          <span style="align-self:center;color:var(--muted);font-size:13px">€ / Woche</span>
          <button class="btn small" onclick="tgSetzen('${k.id}')">Speichern</button></div>
        ${tg.betrag > 0
          ? `<div class="hint" style="margin-top:8px">${dieseWoche} · Ausstehend: <strong style="color:${offen.length ? "var(--coral)" : "var(--pounamu)"}">${euro(offen.length * tg.betrag)}</strong>${offen.length ? ` (${offen.length} ${offen.length === 1 ? "Woche" : "Wochen"}) <button class="btn small ghost" onclick="tgAuszahlen('${k.id}')">Als ausgezahlt markieren</button>` : ""}</div>`
          : `<div class="hint" style="margin-top:8px">0 € = noch kein Taschengeld – der Bereich wird ${esc(k.name)} nicht angezeigt.</div>`}`;
      })()}
      </div></div>`;
  });
  return out;
}
function kidAufgabeAdd(kindId) {
  const t = $("ka-titel-" + kindId).value.trim(); if (!t) return toast("Titel fehlt");
  const tage = [...document.querySelectorAll("#ka-tage-" + kindId + " input:checked")].map(c => c.value);
  S.kinderaufgaben.push({ id: uid(), kindId, titel: t, emoji: $("ka-emoji-" + kindId).value.trim() || "⭐", sterne: +$("ka-sterne-" + kindId).value, tage, done: {} });
  save("kinderaufgaben"); toast("Aufgabe angelegt");
}
function kidAufgabeDel(id) { S.kinderaufgaben = S.kinderaufgaben.filter(x => x.id !== id); save("kinderaufgaben"); }
function zielSave(kindId) {
  if (!S.sterne[kindId]) S.sterne[kindId] = { stand: 0 };
  S.sterne[kindId].ziel = +$("kz-ziel-" + kindId).value || 20;
  S.sterne[kindId].belohnung = $("kz-bel-" + kindId).value.trim();
  save("sterne"); toast("Ziel gespeichert");
}
function sterneReset(kindId) {
  if (!confirm("Sterne auf 0 setzen (Belohnung eingelöst)?")) return;
  if (!S.sterne[kindId]) S.sterne[kindId] = {};
  S.sterne[kindId].stand = 0; save("sterne");
}

/* ----- Zettelkasten ----- */
function rZettel() {
  const offen = S.zettel.filter(z => !z.erledigt);
  let out = `<div class="card"><h2>📮 Zettelkasten<span class="cnt">${offen.length} offen</span></h2>
    <div class="hint" style="margin:-4px 0 8px">Kurze Notizen an den anderen – „Kita-Beitrag überwiesen?", „Oma anrufen wegen Samstag".</div>`;
  out += S.zettel.slice().reverse().map(z => `<div class="row ${z.erledigt ? "done" : ""}">
    <button aria-label="Abhaken" class="check ${z.erledigt ? "on" : ""}" onclick="zettelToggle('${z.id}')">${z.erledigt ? "✓" : ""}</button>
    <div class="grow"><div class="t">${esc(z.text)}</div><div class="s">von ${esc(z.von || "?")} · ${fmt(z.datum)}</div></div>
    <button class="del" aria-label="Löschen" onclick="zettelDel('${z.id}')">✕</button></div>`).join("");
  out += `<div class="addform"><input id="zt-text" placeholder="Neuer Zettel…" onkeydown="if(event.key==='Enter')zettelAdd()">
    <button class="btn" onclick="zettelAdd()">＋</button></div></div>`;
  return out;
}
function zettelAdd() {
  const t = $("zt-text").value.trim(); if (!t) return;
  S.zettel.push({ id: uid(), text: t, von: ichName(), datum: heute(), erledigt: false });
  save("zettel");
}
function zettelToggle(id) { const z = S.zettel.find(x => x.id === id); if (z) { z.erledigt = !z.erledigt; vib(); save("zettel"); } }
function zettelDel(id) { S.zettel = S.zettel.filter(x => x.id !== id); save("zettel"); }

/* ----- Countdowns ----- */
function rCountdowns() {
  let out = `<div class="card"><h2>⏳ Countdowns</h2>`;
  out += S.countdowns.sort((a, b) => a.datum < b.datum ? -1 : 1).map(c => `<div class="row">
    <span style="font-size:19px">${esc(c.emoji || "🎉")}</span>
    <div class="grow"><div class="t">${esc(c.titel)}</div><div class="s">${fmt(c.datum)} · ${tageBis(c.datum) >= 0 ? "in " + tageBis(c.datum) + " Tagen" : "vorbei"}</div></div>
    <button class="del" aria-label="Löschen" onclick="cdDel('${c.id}')">✕</button></div>`).join("") || `<div class="empty">z. B. „Noch X Tage bis Neuseeland" 🇳🇿</div>`;
  out += `<div class="formgrid"><input id="cd-titel" class="full" placeholder="Worauf freut ihr euch?">
    <input id="cd-datum" type="date"><input id="cd-emoji" placeholder="Emoji" value="🎉" maxlength="4">
    <button class="btn full" onclick="cdAdd()">Countdown starten</button></div></div>`;
  return out;
}
function cdAdd() {
  const t = $("cd-titel").value.trim(); if (!t || !$("cd-datum").value) return toast("Titel/Datum fehlt");
  S.countdowns.push({ id: uid(), titel: t, datum: $("cd-datum").value, emoji: $("cd-emoji").value.trim() || "🎉" });
  save("countdowns"); toast("Countdown läuft");
}
function cdDel(id) { S.countdowns = S.countdowns.filter(x => x.id !== id); save("countdowns"); }

/* ----- Wochenend-Ideen ----- */
function rIdeen() {
  const WICON = { sonne: "☀️", regen: "🌧️", egal: "🌤️" };
  let out = `<div class="card"><h2>🌦️ Wochenend-Ideen<span class="cnt">${S.ideen.length}</span></h2>`;
  out += S.ideen.map(i => `<div class="row"><span style="font-size:19px">${WICON[i.wetter] || "🌤️"}</span>
    <div class="grow"><div class="t">${esc(i.titel)}</div>${i.notiz ? `<div class="s">${esc(i.notiz)}</div>` : ""}</div>
    <button class="del" aria-label="Löschen" onclick="ideeDel('${i.id}')">✕</button></div>`).join("") || `<div class="empty">Ausflugsziele sammeln – nie wieder Sonntagmorgen-Ratlosigkeit.</div>`;
  out += `<div class="formgrid"><input id="id-titel" class="full" placeholder="z. B. Felsenmeer, Abenteuer Alm…">
    <select id="id-wetter"><option value="sonne">☀️ Bei Sonne</option><option value="regen">🌧️ Bei Regen</option><option value="egal">🌤️ Egal</option></select>
    <input id="id-notiz" placeholder="Notiz (optional)">
    <button class="btn full" onclick="ideeAdd()">Idee speichern</button></div></div>`;
  return out;
}
function ideeAdd() {
  const t = $("id-titel").value.trim(); if (!t) return toast("Titel fehlt");
  S.ideen.push({ id: uid(), titel: t, wetter: $("id-wetter").value, notiz: $("id-notiz").value.trim() });
  save("ideen"); toast("Gespeichert");
}
function ideeDel(id) { S.ideen = S.ideen.filter(x => x.id !== id); save("ideen"); }

/* ----- Geschenke ----- */
function rGeschenke() {
  let out = `<div class="card"><h2>🎁 Geschenke-Merkliste</h2>
  <div class="hint" style="margin:-4px 0 8px">Wünsche der Kinder & wer was schenkt – verhindert Doppelkäufe.</div>`;
  out += S.geschenke.map(g => `<div class="row ${g.gekauft ? "done" : ""}">
    <button aria-label="Abhaken" class="check ${g.gekauft ? "on" : ""}" onclick="geschenkToggle('${g.id}')">${g.gekauft ? "✓" : ""}</button>
    <div class="grow"><div class="t">${esc(g.was)}</div><div class="s">für ${esc(g.fuer)}${g.von ? " · schenkt: " + esc(g.von) : ""}</div></div>
    <button class="del" aria-label="Löschen" onclick="geschenkDel('${g.id}')">✕</button></div>`).join("") || `<div class="empty">Noch keine Einträge.</div>`;
  out += `<div class="formgrid"><input id="gs-was" class="full" placeholder="Geschenkidee">
    <input id="gs-fuer" placeholder="Für wen?"><input id="gs-von" placeholder="Schenkt wer? (optional)">
    <button class="btn full" onclick="geschenkAdd()">Merken</button></div></div>`;
  return out;
}
function geschenkAdd() {
  const w = $("gs-was").value.trim(), f = $("gs-fuer").value.trim();
  if (!w || !f) return toast("Was & für wen?");
  S.geschenke.push({ id: uid(), was: w, fuer: f, von: $("gs-von").value.trim(), gekauft: false });
  save("geschenke"); toast("Gemerkt");
}
function geschenkToggle(id) { const g = S.geschenke.find(x => x.id === id); if (g) { g.gekauft = !g.gekauft; save("geschenke"); } }
function geschenkDel(id) { S.geschenke = S.geschenke.filter(x => x.id !== id); save("geschenke"); }

/* ----- Gesundheits-Log ----- */
function rGesundheit() {
  let out = `<div class="card"><h2>🩺 Gesundheits-Log</h2>
  <div class="hint" style="margin:-4px 0 8px">Fieber, Zecke, Impfung, Medikament – beim Kinderarzt Gold wert.</div>`;
  out += S.gesundheit.slice().sort((a, b) => a.datum < b.datum ? 1 : -1).map(g => `<div class="row">
    ${g.kindId ? avatarHtml(g.kindId) : ""}
    <div class="grow"><div class="t">${esc(g.was)}</div><div class="s">${fmt(g.datum)}</div></div>
    <button class="del" aria-label="Löschen" onclick="gesundDel('${g.id}')">✕</button></div>`).join("") || `<div class="empty">Noch keine Einträge.</div>`;
  out += `<div class="formgrid"><input id="ge-was" class="full" placeholder="z. B. 38,9 °C Fieber abends">
    <select id="ge-kind"><option value="">Wer?</option>${S.mitglieder.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select>
    <input id="ge-datum" type="date" value="${heute()}">
    <button class="btn full" onclick="gesundAdd()">Eintragen</button></div></div>`;
  return out;
}
function gesundAdd() {
  const w = $("ge-was").value.trim(); if (!w) return toast("Eintrag fehlt");
  S.gesundheit.push({ id: uid(), was: w, kindId: $("ge-kind").value, datum: $("ge-datum").value });
  save("gesundheit"); toast("Eingetragen");
}
function gesundDel(id) { S.gesundheit = S.gesundheit.filter(x => x.id !== id); save("gesundheit"); }

/* ----- Notfall & Infos ----- */
function notfallVorlage() {
  const k1 = kinder()[0] ? kinder()[0].name : "Kind 1";
  const k2 = kinder()[1] ? kinder()[1].name : "Kind 2";
  const vorlage = [
    ["🚨 Notruf (Feuerwehr/Rettung)", "112"],
    ["👮 Polizei", "110"],
    ["🩺 Ärztlicher Bereitschaftsdienst", "116 117"],
    ["☠️ Giftnotruf (Mainz, für Hessen)", "06131 19240"],
    ["👶 Kinderarzt", "bitte eintragen"],
    ["🦷 Zahnarzt", "bitte eintragen"],
    ["🏫 Schule (Sekretariat)", "bitte eintragen"],
    ["🧒 Kita / Hort", "bitte eintragen"],
    ["🏠 Nachbarn (Notfallkontakt)", "bitte eintragen"],
    ["👵 Oma & Opa", "bitte eintragen"],
    ["💳 Krankenkasse + Versichertennr.", "bitte eintragen"],
    ["👕 Kleidergröße " + k1, "bitte eintragen"],
    ["👟 Schuhgröße " + k1, "bitte eintragen"],
    ["👕 Kleidergröße " + k2, "bitte eintragen"],
    ["👟 Schuhgröße " + k2, "bitte eintragen"]
  ];
  let n = 0;
  vorlage.forEach(([titel, wert]) => {
    if (!S.notfall.some(x => x.titel === titel)) { S.notfall.push({ id: uid(), titel, wert }); n++; }
  });
  save("notfall"); toast(n + " Einträge eingefügt – Werte antippen zum Ausfüllen");
}
function notfallEdit(id) {
  const n = S.notfall.find(x => x.id === id); if (!n) return;
  sheetInput(n.titel, "Nummer / Info", n.wert === "bitte eintragen" ? "" : n.wert, v => {
    if (v) { n.wert = v; save("notfall"); } else render();
  });
}
function rNotfall() {
  let out = `<div class="card"><h2>📇 Notfall & Infos</h2>
  <div class="hint" style="margin:-4px 0 8px">Kinderarzt, Schule, Kleidergrößen – alles Wichtige an einem Ort. Werte antippen zum Bearbeiten.</div>`;
  const fehlt = S.notfall.length < 5;
  if (fehlt) out += `<button class="btn ghost" style="width:100%;margin-bottom:10px" onclick="notfallVorlage()">📋 Vorlage einfügen (Notruf, Ärzte, Größen …)</button>`;
  out += S.notfall.map(n => `<div class="row">
    <button class="grow" style="text-align:left" onclick="notfallEdit('${n.id}')">
      <div class="t">${esc(n.titel)}</div>
      <div class="s" style="${n.wert === "bitte eintragen" ? "color:var(--coral)" : ""}">${esc(n.wert)} ✏️</div></button>
    <button class="del" aria-label="Löschen" onclick="notfallDel('${n.id}')">✕</button></div>`).join("") || `<div class="empty">Noch keine Einträge.</div>`;
  out += `<div class="formgrid"><input id="nf-titel" placeholder="z. B. Kinderarzt Dr. …">
    <input id="nf-wert" placeholder="Nummer / Info">
    <button class="btn full" onclick="notfallAdd()">Speichern</button></div></div>`;
  return out;
}
function notfallAdd() {
  const t = $("nf-titel").value.trim(), w = $("nf-wert").value.trim();
  if (!t || !w) return toast("Beides ausfüllen");
  S.notfall.push({ id: uid(), titel: t, wert: w }); save("notfall"); toast("Gespeichert");
}
function notfallDel(id) { S.notfall = S.notfall.filter(x => x.id !== id); save("notfall"); }

/* ----- Familie & Einstellungen ----- */
function rFamilie() {
  let out = `<div class="card"><h2>👨‍👩‍👧‍👧 Familienmitglieder</h2>`;
  out += S.mitglieder.map(m => `<div class="row">${avatarHtml(m.id)}
    <div class="grow"><div class="t">${esc(m.name)}</div><div class="s">${m.rolle === "kind" ? "Kind" : "Erwachsen"}${m.geb ? " · 🎂 " + fmt(m.geb).slice(4) : ""}</div></div>
    <button class="del" aria-label="Löschen" onclick="mitgliedDel('${m.id}')">✕</button></div>`).join("") || `<div class="empty">Legt euch alle vier an – dann füllt sich die App mit Leben.</div>`;
  out += `<div class="formgrid"><input id="mg-name" placeholder="Name">
    <select id="mg-rolle"><option value="erwachsen">Erwachsen</option><option value="kind">Kind</option></select>
    <input id="mg-geb" type="date" class="full" title="Geburtstag (optional)">
    <button class="btn full" onclick="mitgliedAdd()">Hinzufügen</button></div>
    <div class="hint">Geburtstag ist optional – damit erscheinen 🎂-Countdowns und ein Geburtstagsgruß automatisch auf dem Dashboard.</div></div>`;
  const ich = mitglied(ichId());
  out += `<div class="card"><h2>📱 Dieses Gerät</h2>
    <div class="row"><div class="grow"><div class="t">Angemeldet als: ${ich ? esc(ich.name) : "noch nicht festgelegt"}</div>
    <div class="s">bestimmt Begrüßung & Zettel-Absender auf diesem Handy</div></div>
    <button class="btn small ghost" onclick="ichFragen()">Ändern</button></div>
    <div class="row"><div class="grow"><div class="t">Kinder-Tablet (Kiosk-Modus)</div>
    <div class="s">App startet direkt im Kinderbereich – Ausgang nur mit Eltern-PIN. Für Mias/Lenas Tablets.</div></div>
    <button class="btn small ${kioskAktiv() ? "coral" : "ghost"}" onclick="kioskSetzen(${kioskAktiv() ? "false" : "true"})">${kioskAktiv() ? "Aus" : "An"}</button></div></div>`;
  out += `<div class="card"><h2>🔒 Eltern-PIN</h2>
    <div class="hint" style="margin:-4px 0 8px">Schützt den Ausgang aus dem Kinderbereich. Standard: 2468</div>
    <div class="addform"><input id="pin-neu" type="number" placeholder="Neue 4-stellige PIN">
    <button class="btn" onclick="pinSave()">Ändern</button></div></div>`;
  out += `<div class="card"><h2>🛒 Einkaufstag</h2>
    <div class="hint" style="margin:-4px 0 10px">Steuert die Essens-Vorschläge: Gerichte mit sehr frischen Zutaten (🌿) kommen nur bis zwei Tage nach dem Einkauf.</div>
    <div class="addform"><select id="ek-tag">${["Mo","Di","Mi","Do","Fr","Sa","So"].map(t => `<option ${einkaufstag() === t ? "selected" : ""}>${t}</option>`).join("")}</select>
    <button class="btn" onclick="einkaufstagSpeichern()">Speichern</button></div></div>`;
  out += `<div class="card"><h2>🌐 Google-Kalender (nur lesen)</h2>
    <div class="hint" style="margin:-4px 0 10px">Gemeinsamen Familienkalender in Google anlegen, private iCal-Adresse hier eintragen – die App zeigt die Termine automatisch mit an. Einrichtung: siehe ANLEITUNG, Abschnitt Kalender.</div>
    <div class="addform"><input id="gcal-url" placeholder="https://…/basic.ics bzw. Worker-URL" value="${esc(S.einstellungen.icsUrl || "")}">
    <button class="btn" onclick="gcalUrlSpeichern()">Speichern</button></div>
    ${gcal.am ? `<div class="hint">Zuletzt geladen: ${gcal.am.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr · ${gcal.events.length} Termine (nächste 60 Tage)</div>` : ""}</div>`;
  out += `<div class="card"><h2>💾 Datensicherung</h2>
    <div class="hint" style="margin:-4px 0 10px">Alle Daten als Datei sichern – für den Fall der Fälle, unabhängig von Firebase.</div>
    <div style="display:flex;gap:8px">
      <button class="btn ghost" style="flex:1" onclick="backupExport()">⬇️ Exportieren</button>
      <label class="btn ghost" style="flex:1;text-align:center;cursor:pointer">⬆️ Importieren<input type="file" accept=".json,application/json" style="display:none" onchange="backupImport(event)"></label>
    </div></div>`;
  return out;
}
function backupDaten() {
  return JSON.stringify(Object.assign({ _export: { app: "Whānau", am: new Date().toISOString() } }, S), null, 1);
}
function backupExport() {
  const blob = new Blob([backupDaten()], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "whanau-backup-" + heute() + ".json";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  toast("Sicherung heruntergeladen");
}
function backupEinspielen(d) {
  if (!d || typeof d !== "object" || (!d.mitglieder && !d.einstellungen)) { toast("Datei ungültig"); return false; }
  delete d._export;
  db.ref("daten").set(d); toast("Sicherung eingespielt"); return true;
}
function backupImport(ev) {
  const f = ev.target.files && ev.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (confirm("Aktuelle Daten mit dieser Sicherung überschreiben?")) backupEinspielen(d);
    } catch (e) { toast("Datei ungültig"); }
  };
  r.readAsText(f); ev.target.value = "";
}
function mitgliedAdd() {
  const n = $("mg-name").value.trim(); if (!n) return toast("Name fehlt");
  S.mitglieder.push({ id: uid(), name: n, rolle: $("mg-rolle").value, geb: $("mg-geb") && $("mg-geb").value || "", farbe: FARBEN[S.mitglieder.length % FARBEN.length] });
  save("mitglieder"); toast(n + " ist dabei");
}
function mitgliedDel(id) { if (!confirm("Mitglied entfernen?")) return; S.mitglieder = S.mitglieder.filter(x => x.id !== id); save("mitglieder"); }
function pinSave() {
  const p = $("pin-neu").value.trim(); if (p.length !== 4) return toast("Bitte 4 Ziffern");
  S.einstellungen.pin = p; save("einstellungen"); toast("PIN geändert");
}

/* ============================================================
   KINDERMODUS
   ============================================================ */
function openKids() { kidsKind = kinder().length === 1 ? kinder()[0].id : null; $("kids").classList.add("open"); renderKids(); }
function closeKids() {
  pinSheet(() => { $("kids").classList.remove("open"); kidsKind = null; render(); });
}
function renderKids() {
  const k = $("kids");
  let out = `<div class="khead"><span style="font-size:26px">🥝</span><h1>Kinderbereich</h1>
    <button class="exit" onclick="closeKids()">Eltern 🔒</button></div>`;

  if (!kidsKind) {
    out += `<div class="kidpick">` + kinder().map(kd =>
      `<button onclick="kidsKind='${kd.id}';renderKids()"><div class="av" style="background:${kd.farbe}">${esc(kd.name[0])}</div><div class="nm">${esc(kd.name)}</div></button>`).join("") + `</div>`;
    k.innerHTML = out; return;
  }

  const kind = mitglied(kidsKind);
  const konto = S.sterne[kidsKind] || { stand: 0, ziel: 20, belohnung: "" };
  const h = heute();
  const aufg = kidAufgabenAm(kidsKind, h);
  const pct = Math.min(100, Math.round((konto.stand / (konto.ziel || 20)) * 100));

  out += `<div class="kidhome">
    <div style="text-align:center;margin-bottom:12px">
      ${kinder().length > 1 ? `<button class="btn small ghost" onclick="kidsKind=null;renderKids()">‹ Wechseln</button>` : ""}
      <div style="font-family:Sora;font-size:24px;font-weight:700;margin-top:6px">Hallo ${esc(kind.name)}! 👋</div>
    </div>
    <div class="kiwi-spruch">🥝 ${esc(kiwiSpruch(kidsKind))}</div>
    <div class="starbank">
      <div class="num">⭐ ${konto.stand}</div><div class="lbl">deine Sterne</div>
      ${konto.stand >= (konto.ziel || 20) && konto.belohnung
        ? `<div class="goal" style="font-size:16px">🎉 GESCHAFFT! ${esc(konto.belohnung)} 🎉</div>`
        : konto.belohnung ? `<div class="goal">🎯 Bei ${konto.ziel} ⭐: ${esc(konto.belohnung)} <span style="color:var(--muted);font-weight:400">– noch ${Math.max(0,(konto.ziel||20)-konto.stand)} ⭐</span></div>` : ""}
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;

  // Taschengeld-Karte (nur wenn Betrag > 0)
  const tg = tgVon(kidsKind);
  if (tg && tg.betrag > 0) {
    const key = tgKey();
    const erhalten = (tg.erhalten || {})[key];
    const offen = tgOffeneWochen(kidsKind);
    const rueckstand = offen.filter(k => k !== key);
    out += `<div class="starbank moneycard">
      <div class="lbl">💰 Dein Taschengeld</div>
      <div class="num" style="color:var(--pounamu)">${euro(tg.betrag)}</div>
      <div class="lbl">jede Woche</div>`;
    if (erhalten) {
      out += `<div class="goal" style="margin-top:10px">✓ Für diese Woche bekommen!</div>
        <div class="lbl">Neues Taschengeld gibt's ab Montag 🗓️</div>`;
    } else {
      out += `<button class="kmoney-btn" onclick="tgKidHaken('${kidsKind}', event)">💰 Ich hab's bekommen!</button>`;
    }
    if (rueckstand.length) {
      out += `<div class="lbl" style="margin-top:10px">Mama & Papa haben noch <strong style="color:var(--gold)">${euro(rueckstand.length * tg.betrag)}</strong> für dich (${rueckstand.length} ${rueckstand.length === 1 ? "Woche" : "Wochen"}) 🐷</div>`;
    }
    out += `</div>`;
  }

  const doneN = aufg.filter(x => (x.done || {})[h]).length;
  out += aufg.length ? `<div style="font-family:Sora;font-weight:700;font-size:16px;margin:4px 4px 10px;color:var(--pounamu-deep)">Deine Aufgaben heute <span style="color:var(--gold)">(${doneN} von ${aufg.length})</span>:</div>` : "";
  out += aufg.map(a => {
    const done = (a.done || {})[h];
    return `<button class="ktask ${done ? "done" : ""}" onclick="kidTaskToggle('${a.id}',event)">
      <span class="em">${esc(a.emoji || "⭐")}</span><span class="tt">${esc(a.titel)}</span>
      <span class="st">+${a.sterne}⭐</span><span class="kcheck">${done ? "✓" : ""}</span></button>`;
  }).join("") || `<div class="starbank"><div class="lbl">Heute keine Aufgaben – juhu! 🎈</div></div>`;
  if (aufg.length && doneN === aufg.length)
    out += `<div class="starbank" style="background:var(--gold-soft)"><div style="font-family:Sora;font-size:20px;font-weight:700">🎉 Alles geschafft, ${esc(kind.name)}! 🎉</div><div class="lbl">Du bist heute ein Star ⭐</div></div>`;

  const cds = S.countdowns.filter(c => tageBis(c.datum) >= 0).sort((a, b) => tageBis(a.datum) - tageBis(b.datum));
  if (cds.length) {
    out += `<div style="font-family:Sora;font-weight:700;font-size:16px;margin:14px 4px 10px;color:var(--pounamu-deep)">Bald ist es so weit:</div><div class="kcd">` +
      cds.map(c => `<div class="cdcard"><div class="e" style="font-size:22px">${esc(c.emoji || "🎉")}</div><div class="n">${tageBis(c.datum)}</div><div class="l">Tage bis<br>${esc(c.titel)}</div></div>`).join("") + `</div>`;
  }
  out += `</div>`;
  k.innerHTML = out;
}
/* ---------- Taschengeld ---------- */
function euro(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €"; }
function tgKey(d) { return dstr(wochenStart(d || new Date())); }
function tgVon(kindId) { return (S.taschengeld || {})[kindId] || null; }
function tgOffeneWochen(kindId) {
  const tg = tgVon(kindId);
  if (!tg || !(tg.betrag > 0)) return [];
  const offene = [];
  let d = new Date((tg.startWoche || tgKey()) + "T12:00:00");
  const aktuell = tgKey();
  for (let i = 0; i < 520 && dstr(d) <= aktuell; i++, d.setDate(d.getDate() + 7)) {
    const key = dstr(d);
    if (!(tg.erhalten || {})[key]) offene.push(key);
  }
  return offene;
}
function tgAusstehend(kindId) {
  const tg = tgVon(kindId);
  return tg && tg.betrag > 0 ? tgOffeneWochen(kindId).length * tg.betrag : 0;
}
function tgSetzen(kindId) {
  const roh = $("tg-betrag-" + kindId).value.trim().replace(",", ".");
  const betrag = Math.max(0, parseFloat(roh) || 0);
  if (!S.taschengeld) S.taschengeld = {};
  const tg = S.taschengeld[kindId] || {};
  tg.betrag = betrag;
  if (betrag > 0 && !tg.startWoche) tg.startWoche = tgKey();
  if (!tg.erhalten) tg.erhalten = {};
  S.taschengeld[kindId] = tg;
  save("taschengeld");
  toast(betrag > 0 ? euro(betrag) + " pro Woche für " + mName(kindId) : "Taschengeld für " + mName(kindId) + " pausiert");
}
function tgKidHaken(kindId, ev) {
  const tg = tgVon(kindId); if (!tg || !(tg.betrag > 0)) return;
  const key = tgKey();
  if (!tg.erhalten) tg.erhalten = {};
  if (tg.erhalten[key]) return;
  tg.erhalten[key] = true;
  save("taschengeld"); vib(40);
  // Münzregen
  const cx = ev && ev.clientX || window.innerWidth / 2, cy = ev && ev.clientY || 200;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement("div"); s.className = "burst";
    s.textContent = i % 2 ? "🪙" : "💰";
    s.style.left = (cx - 50 + Math.random() * 100) + "px";
    s.style.top = (cy - 10 + Math.random() * 30) + "px";
    s.style.animationDelay = (i * 55) + "ms";
    document.body.appendChild(s); setTimeout(() => s.remove(), 1400);
  }
  renderKids();
}
function tgAuszahlen(kindId) {
  if (!confirm("Alle offenen Wochen für " + mName(kindId) + " als ausgezahlt markieren?")) return;
  const tg = tgVon(kindId); if (!tg) return;
  if (!tg.erhalten) tg.erhalten = {};
  tgOffeneWochen(kindId).forEach(k => tg.erhalten[k] = true);
  save("taschengeld"); toast("Ausgezahlt ✓");
}

const KIWI_SPRUECHE = [
  "Ka pai! – Gut gemacht!", "Kia kaha! – Du schaffst das!", "Tino pai! – Super!",
  "He rā ātaahua! – Was für ein schöner Tag!", "Ka rawe! – Großartig!", "Haere tonu! – Weiter so!"
];
function kiwiSpruch(kindId) {
  const tagNr = Math.floor(new Date() / 864e5);
  const idx = kinder().findIndex(k => k.id === kindId);
  return KIWI_SPRUECHE[(tagNr + Math.max(0, idx)) % KIWI_SPRUECHE.length];
}
function aufgAlleFertig(kindId) {
  const h = heute(), liste = kidAufgabenAm(kindId, h);
  return liste.length > 0 && liste.every(x => (x.done || {})[h]);
}
function kidTaskToggle(id, ev) {
  const a = S.kinderaufgaben.find(x => x.id === id); if (!a) return;
  const h = heute(); if (!a.done) a.done = {};
  if (!S.sterne[a.kindId]) S.sterne[a.kindId] = { stand: 0, ziel: 20, belohnung: "" };
  if (a.done[h]) { delete a.done[h]; S.sterne[a.kindId].stand = Math.max(0, S.sterne[a.kindId].stand - a.sterne); }
  else {
    a.done[h] = true; S.sterne[a.kindId].stand += a.sterne;
    // Stern-Animation
    for (let i = 0; i < 5; i++) {
      const s = document.createElement("div"); s.className = "burst"; s.textContent = "⭐";
      s.style.left = (ev.clientX - 20 + Math.random() * 40) + "px";
      s.style.top = (ev.clientY - 10 + Math.random() * 20) + "px";
      s.style.animationDelay = (i * 60) + "ms";
      document.body.appendChild(s); setTimeout(() => s.remove(), 1200);
    }
    vib(30);
    // Große Feier, wenn das die letzte Aufgabe des Tages war
    if (aufgAlleFertig(a.kindId)) {
      const em = ["⭐", "🎉", "✨", "🥝"];
      for (let i = 0; i < 14; i++) {
        const s = document.createElement("div"); s.className = "burst";
        s.textContent = em[i % em.length];
        s.style.left = (Math.random() * (window.innerWidth - 40)) + "px";
        s.style.top = (window.innerHeight * (0.3 + Math.random() * 0.5)) + "px";
        s.style.animationDelay = (i * 70) + "ms";
        document.body.appendChild(s); setTimeout(() => s.remove(), 1600);
      }
      vib(80);
    }
  }
  save("kinderaufgaben", "sterne"); renderKids();
}

/* ---------- Service Worker & Start ---------- */
let wartenderSW = null;
function updateJetzt() { if (wartenderSW) wartenderSW.postMessage({ typ: "SKIP_WAITING" }); }
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(reg => {
    reg.addEventListener("updatefound", () => {
      const neu = reg.installing; if (!neu) return;
      neu.addEventListener("statechange", () => {
        if (neu.state === "installed" && navigator.serviceWorker.controller) {
          wartenderSW = neu; const el = $("update"); if (el) el.classList.add("show");
        }
      });
    });
  }).catch(() => {});
  let neugeladen = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!neugeladen) { neugeladen = true; location.reload(); }
  });
}
starte();
render();
