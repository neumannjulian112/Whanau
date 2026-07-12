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
  kinderaufgaben: [], sterne: {}, zettel: [], countdowns: [],
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
      });
    } else {
      $("login").classList.add("open");
    }
  });
}
function doLogin() {
  $("lg-err").textContent = "";
  firebase.auth().signInWithEmailAndPassword($("lg-mail").value.trim(), $("lg-pass").value)
    .catch(e => { $("lg-err").textContent = "Anmeldung fehlgeschlagen – E-Mail/Passwort prüfen."; });
}
function doLogout() { if (confirm("Abmelden?")) firebase.auth().signOut(); }
function save(...keys) { keys.forEach(k => db.ref("daten/" + k).set(S[k])); }

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

/* ---------- Wiederkehrende Logik ---------- */
function termineAm(datumStr) {
  const w = wtag(datumStr);
  return S.termine.filter(t =>
    t.datum === datumStr || (t.wdh === "woechentlich" && wtag(t.datum) === w && t.datum <= datumStr)
  ).sort((a, b) => (a.zeit || "99") < (b.zeit || "99") ? -1 : 1);
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
    <div class="kia">${gruss()}${meinName ? ", " + esc(meinName.charAt(0).toUpperCase() + meinName.slice(1)) : ""}!</div>
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

  if (kinder().length)
    out += `<button class="kidsentry" onclick="openKids()"><span class="em">🥝</span>
      <span><span class="big">Kinderbereich</span><br><span class="s">Aufgaben &amp; Sterne für ${esc(kinder().map(k => k.name).join(" & "))}</span></span>
      <span class="arrow">→</span></button>`;

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

  // Packliste morgen
  const pk = S.packlisten.filter(p => p.wochentag === wtag(m));
  if (pk.length) {
    out += `<div class="card"><h2>🎒 Morgen einpacken (${fmt(m)})</h2>` +
      pk.map(p => `<div class="row"><div class="grow"><div class="t">${esc(p.was)}</div></div>${p.kindId ? avatarHtml(p.kindId) : ""}</div>`).join("") + `</div>`;
  }

  // Zettel für mich (ungelesen/offen)
  const zt = S.zettel.filter(z => !z.erledigt);
  if (zt.length) {
    out += `<div class="card"><h2>📮 Zettelkasten<span class="cnt">${zt.length}</span></h2>` +
      zt.slice(0, 3).map(z => `<div class="row"><div class="grow"><div class="t">${esc(z.text)}</div><div class="s">von ${esc(z.von || "?")}</div></div>
      <button aria-label="Abhaken" class="check" onclick="zettelToggle('${z.id}')"></button></div>`).join("") + `</div>`;
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
  out += `<div class="card"><h2>📅 Nächste 14 Tage</h2>`;
  let any = false;
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const ds = dstr(d), ts = termineAm(ds);
    if (!ts.length) continue; any = true;
    out += `<div class="weekrow ${i === 0 ? "today" : ""}"><div class="day"><div class="wd">${WD[d.getDay()]}</div><div class="dt">${d.getDate()}.${d.getMonth() + 1}.</div></div><div class="grow">`;
    out += ts.map(t => `<div class="row"><div class="grow"><div class="t">${esc(t.titel)}</div>
      <div class="s">${t.zeit ? t.zeit + " Uhr" : "ganztägig"}${t.ort ? " · " + esc(t.ort) : ""}${t.wdh === "woechentlich" ? " · 🔁 wöchentlich" : ""}</div></div>
      ${(t.mitglieder || []).map(id => avatarHtml(id)).join("")}
      <button class="del" aria-label="Löschen" onclick="terminDel('${t.id}')">✕</button></div>`).join("");
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
  const kats = [...new Set(offen.map(e => e.kategorie || "Sonstiges"))].sort();
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
    <select id="ek-kat" style="max-width:130px"><option>Lebensmittel</option><option>Drogerie</option><option>Getränke</option><option>Haushalt</option><option>Sonstiges</option></select>
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
function einkaufAdd() {
  const n = $("ek-name").value.trim(); if (!n) return;
  S.einkauf.push({ id: uid(), name: n, kategorie: $("ek-kat").value, erledigt: false });
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
  S.einkauf.push({ id: uid(), name: schoen, kategorie: "Lebensmittel", erledigt: false });
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

function rPacklisten() {
  let out = `<div class="card"><h2>🎒 Packlisten<span class="cnt">wochentags-fest</span></h2>
    <div class="hint" style="margin:-4px 0 10px">Was muss an welchem Tag mit? Erscheint am Vorabend unter „Heute".</div>`;
  SCHULTAGE.forEach(t => {
    const items = S.packlisten.filter(p => p.wochentag === t);
    out += `<div class="weekrow"><div class="day"><div class="wd">${t}</div></div><div class="grow">`;
    out += items.length ? items.map(p => `<div class="row"><div class="grow"><div class="t">${esc(p.was)}</div></div>
      ${p.kindId ? avatarHtml(p.kindId) : ""}<button class="del" aria-label="Löschen" onclick="packDel('${p.id}')">✕</button></div>`).join("") : `<div class="empty">–</div>`;
    out += `</div></div>`;
  });
  out += `<div class="formgrid"><input id="pk-was" class="full" placeholder="z. B. Schwimmtasche">
    <select id="pk-tag">${SCHULTAGE.map(t => `<option>${t}</option>`).join("")}</select>
    <select id="pk-kind"><option value="">Für wen?</option>${kinder().map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select>
    <button class="btn full" onclick="packAdd()">Hinzufügen</button></div></div>`;
  return out;
}
function packAdd() {
  const w = $("pk-was").value.trim(); if (!w) return toast("Was fehlt?");
  S.packlisten.push({ id: uid(), was: w, wochentag: $("pk-tag").value, kindId: $("pk-kind").value });
  save("packlisten"); toast("Gespeichert");
}
function packDel(id) { S.packlisten = S.packlisten.filter(x => x.id !== id); save("packlisten"); }

/* ============================================================
   TAB: ESSEN (Wochenplan + Kochbuch)
   ============================================================ */
function rEssen() {
  let out = segHtml("essen", [["woche", "Wochenplan"], ["kochbuch", "📖 Kochbuch"]]);
  if (sub.essen === "kochbuch") return out + rKochbuch();

  const start = wochenStart(new Date());
  out += `<div class="card"><h2>🍽️ Essensplan · KW ${isoWoche(new Date())}</h2>`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dstr(d), plan = S.essensplan[ds] || {};
    const dish = S.kochbuch.find(x => x.id === plan.dishId);
    out += `<div class="weekrow ${ds === heute() ? "today" : ""}"><div class="day"><div class="wd">${WD[d.getDay()]}</div><div class="dt">${d.getDate()}.${d.getMonth() + 1}.</div></div>
      <div class="grow"><div class="addform" style="margin:0">
        <select onchange="essenSet('${ds}',this.value)" style="flex:1">
          <option value="">${plan.text ? esc(plan.text) : "– wählen –"}</option>
          ${S.kochbuch.map(k => `<option value="${k.id}" ${plan.dishId === k.id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}
          <option value="__frei">✏️ Freitext…</option>
        </select>
        ${dish && dish.zutaten && dish.zutaten.length ? `<button class="btn small ghost" title="Zutaten auf Einkaufsliste" onclick="zutatenAufListe('${dish.id}')">🛒</button>` : ""}
        ${(plan.text || plan.dishId) ? `<button class="del" aria-label="Löschen" title="Eintrag entfernen" onclick="essenClear('${ds}')">✕</button>` : ""}
      </div></div></div>`;
  }
  out += `<div class="hint">🛒 überträgt die Zutaten des Gerichts auf die Einkaufsliste.</div></div>`;

  // Smart-Vorschläge für offene Tage
  const offeneTage = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = dstr(d);
    if (ds >= heute() && !(S.essensplan[ds] && (S.essensplan[ds].text || S.essensplan[ds].dishId))) offeneTage.push(ds);
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
      S.einkauf.push({ id: uid(), name: z, kategorie: "Lebensmittel", erledigt: false }); n++;
    }
  });
  save("einkauf"); toast(n + " Zutaten auf der Einkaufsliste");
}
/* ----- Starter-Kochbuch: 40 ausgewogene Familiengerichte -----
   art: veggie/fleisch/fisch · zeit: schnell (≤30 Min) / wochenende
   Basics (Salz, Pfeffer, Öl, Gewürze) werden als vorhanden angenommen. */
const STARTER_KOCHBUCH = [
  // Italienisch / Mediterran
  { name: "Spaghetti Bolognese", art: "fleisch", zeit: "schnell", kueche: "ital", zutaten: ["Spaghetti", "Rinderhack", "Passierte Tomaten", "Zwiebel", "Karotten", "Parmesan"] },
  { name: "Penne mit Tomaten-Sahne & verstecktem Gemüse", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Penne", "Passierte Tomaten", "Sahne", "Zucchini", "Karotten", "Parmesan"] },
  { name: "Gnocchi-Pfanne mit Zucchini & Cherrytomaten", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Gnocchi", "Zucchini", "Cherrytomaten", "Knoblauch", "Mozzarella", "Basilikum"] },
  { name: "Pizza selbst belegt", art: "veggie", zeit: "wochenende", kueche: "ital", zutaten: ["Mehl", "Hefe", "Passierte Tomaten", "Mozzarella", "Paprika", "Mais", "Schinken (optional)"] },
  { name: "Tagliatelle mit Lachs & Spinat", art: "fisch", zeit: "schnell", kueche: "ital", zutaten: ["Tagliatelle", "Lachsfilet", "Blattspinat", "Sahne", "Zitrone", "Knoblauch"] },
  { name: "Minestrone mit Parmesan", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Suppennudeln", "Karotten", "Zucchini", "Sellerie", "Weiße Bohnen", "Gehackte Tomaten", "Parmesan"] },
  { name: "Zitronen-Hähnchen mit Reis", art: "fleisch", zeit: "schnell", kueche: "ital", zutaten: ["Hähnchenbrust", "Reis", "Zitrone", "Butter", "Brokkoli"] },
  { name: "Ofengemüse mit Halloumi", art: "veggie", zeit: "wochenende", kueche: "ital", zutaten: ["Kartoffeln", "Paprika", "Zucchini", "Rote Zwiebeln", "Halloumi", "Kräuterquark"] },
  { name: "Erbsen-Risotto", art: "veggie", zeit: "schnell", kueche: "ital", zutaten: ["Risottoreis", "Erbsen (TK)", "Zwiebel", "Gemüsebrühe", "Parmesan", "Butter"] },
  { name: "Caprese-Hähnchen aus dem Ofen", art: "fleisch", zeit: "wochenende", kueche: "ital", zutaten: ["Hähnchenbrust", "Tomaten", "Mozzarella", "Basilikum", "Ciabatta", "Salat"] },
  { name: "Thunfisch-Tomaten-Pasta", art: "fisch", zeit: "schnell", kueche: "ital", zutaten: ["Fusilli", "Thunfisch (Dose)", "Gehackte Tomaten", "Zwiebel", "Mais", "Parmesan"] },
  // Deutsch-klassisch
  { name: "Kartoffelpuffer mit Apfelmus", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Kartoffeln", "Eier", "Mehl", "Zwiebel", "Apfelmus"] },
  { name: "Linsensuppe mit Würstchen", art: "fleisch", zeit: "wochenende", kueche: "deutsch", zutaten: ["Tellerlinsen", "Kartoffeln", "Karotten", "Lauch", "Würstchen", "Essig"] },
  { name: "Käsespätzle mit Salat", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Spätzle", "Bergkäse gerieben", "Zwiebeln", "Kopfsalat", "Schnittlauch"] },
  { name: "Frikadellen mit Püree & Erbsen", art: "fleisch", zeit: "schnell", kueche: "deutsch", zutaten: ["Gemischtes Hack", "Brötchen (alt)", "Ei", "Zwiebel", "Kartoffeln", "Milch", "Erbsen (TK)"] },
  { name: "Pfannkuchen süß & herzhaft", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Mehl", "Eier", "Milch", "Apfelmus", "Käse", "Schinken (optional)"] },
  { name: "Kartoffelsuppe", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Kartoffeln", "Karotten", "Lauch", "Gemüsebrühe", "Sahne", "Brot"] },
  { name: "Fischstäbchen mit Püree & Gurkensalat", art: "fisch", zeit: "schnell", kueche: "deutsch", zutaten: ["Fischstäbchen", "Kartoffeln", "Milch", "Butter", "Salatgurke", "Joghurt", "Dill"] },
  { name: "Schnitzel mit Kartoffelsalat", art: "fleisch", zeit: "wochenende", kueche: "deutsch", zutaten: ["Schweineschnitzel", "Paniermehl", "Eier", "Kartoffeln", "Gurke", "Brühe", "Senf"] },
  { name: "Nudelauflauf mit Schinken & Brokkoli", art: "fleisch", zeit: "wochenende", kueche: "deutsch", zutaten: ["Fusilli", "Kochschinken", "Brokkoli", "Sahne", "Eier", "Käse gerieben"] },
  { name: "Milchreis mit warmen Kirschen", art: "veggie", zeit: "schnell", kueche: "deutsch", zutaten: ["Milchreis", "Milch", "Sauerkirschen (Glas)", "Zimt", "Zucker"] },
  { name: "Ofenkartoffeln mit Kräuterquark & Rohkost", art: "veggie", zeit: "wochenende", kueche: "deutsch", zutaten: ["Große Kartoffeln", "Quark", "Schnittlauch", "Karotten", "Paprika", "Gurke"] },
  { name: "Flammkuchen", art: "fleisch", zeit: "schnell", kueche: "deutsch", zutaten: ["Flammkuchenteig", "Schmand", "Speckwürfel", "Zwiebeln", "Feldsalat"] },
  // Asiatisch (mild & kindertauglich)
  { name: "Gebratener Reis mit Ei & Gemüse", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Reis", "Eier", "Erbsen (TK)", "Karotten", "Frühlingszwiebeln", "Sojasoße"] },
  { name: "Hähnchen-Teriyaki mit Reis & Brokkoli", art: "fleisch", zeit: "schnell", kueche: "asia", zutaten: ["Hähnchenbrust", "Teriyakisoße", "Reis", "Brokkoli", "Sesam"] },
  { name: "Mildes Gemüse-Kokos-Curry", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Kokosmilch", "Currypaste mild", "Kartoffeln", "Karotten", "Zuckerschoten", "Reis"] },
  { name: "Bratnudeln mit Gemüse", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Mie-Nudeln", "Paprika", "Karotten", "Zucchini", "Sojasoße", "Eier"] },
  { name: "Lachs-Teriyaki mit Reis", art: "fisch", zeit: "schnell", kueche: "asia", zutaten: ["Lachsfilet", "Teriyakisoße", "Reis", "Gurke", "Sesam"] },
  { name: "Sommerrollen zum Selberrollen", art: "veggie", zeit: "wochenende", kueche: "asia", zutaten: ["Reispapier", "Reisnudeln", "Karotten", "Gurke", "Salat", "Minze", "Erdnusssoße"] },
  { name: "Mildes Butter Chicken", art: "fleisch", zeit: "wochenende", kueche: "asia", zutaten: ["Hähnchenbrust", "Passierte Tomaten", "Sahne", "Butter", "Garam Masala", "Reis", "Naan"] },
  { name: "Schnelle Nudelsuppe mit Ei & Mais", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Mie-Nudeln", "Gemüsebrühe", "Eier", "Mais", "Frühlingszwiebeln", "Sojasoße"] },
  { name: "Rotes Linsen-Dal (mild) mit Reis", art: "veggie", zeit: "schnell", kueche: "asia", zutaten: ["Rote Linsen", "Kokosmilch", "Gehackte Tomaten", "Zwiebel", "Curry mild", "Reis"] },
  // Orientalisch / Levante
  { name: "Falafel-Wraps mit Joghurtsoße", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Falafel", "Wraps", "Joghurt", "Gurke", "Tomaten", "Salat"] },
  { name: "Couscous-Salat mit Feta", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Couscous", "Gurke", "Tomaten", "Feta", "Minze", "Zitrone"] },
  { name: "Hähnchen-Schawarma-Pfanne mit Fladenbrot", art: "fleisch", zeit: "schnell", kueche: "orient", zutaten: ["Hähnchenbrust", "Schawarma-Gewürz", "Fladenbrot", "Joghurt", "Gurke", "Tomaten"] },
  { name: "Shakshuka mit Fladenbrot", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Eier", "Gehackte Tomaten", "Paprika", "Zwiebel", "Feta", "Fladenbrot"] },
  { name: "Ofen-Köfte mit Bulgur & Joghurt-Dip", art: "fleisch", zeit: "wochenende", kueche: "orient", zutaten: ["Rinderhack", "Petersilie", "Zwiebel", "Bulgur", "Joghurt", "Gurke"] },
  { name: "Hummus-Teller mit warmem Fladenbrot", art: "veggie", zeit: "schnell", kueche: "orient", zutaten: ["Kichererbsen", "Tahini", "Zitrone", "Fladenbrot", "Karotten", "Gurke", "Paprika"] },
  // Schnelle Allrounder
  { name: "Hähnchen-Wraps mit Salat", art: "fleisch", zeit: "schnell", kueche: "orient", zutaten: ["Wraps", "Hähnchenbrust", "Salat", "Tomaten", "Mais", "Joghurt-Dressing"] },
  { name: "Backofen-Fisch mit Zitronenkartoffeln", art: "fisch", zeit: "wochenende", kueche: "ital", zutaten: ["Weißfischfilet", "Kartoffeln", "Zitrone", "Cherrytomaten", "Oliven (optional)"] }
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
function vorschlagFuer(ds) {
  const w = wtag(ds), istWE = (w === "Sa" || w === "So");
  const startDs = dstr(wochenStart(new Date(ds + "T12:00:00")));
  const vielFleisch = fleischTageInWoche(startDs) >= 3;
  let kand = S.kochbuch.filter(k => istWE || (k.zeit || "schnell") === "schnell");
  if (vielFleisch) { const veg = kand.filter(k => k.art === "veggie"); if (veg.length) kand = veg; }
  if (!kand.length) kand = S.kochbuch.slice();
  // Bereits diese Woche geplante ausschließen
  const geplant = new Set();
  for (let i = 0; i < 7; i++) { const d = new Date(startDs + "T12:00:00"); d.setDate(d.getDate() + i); const p = S.essensplan[dstr(d)]; if (p && p.dishId) geplant.add(p.dishId); }
  const frei = kand.filter(k => !geplant.has(k.id)); if (frei.length) kand = frei;
  kand.sort((a, b) => letztesMal(a.id) < letztesMal(b.id) ? -1 : 1); // am längsten her zuerst
  if (!kand.length) return null;
  return kand[(vorschlagOffset[ds] || 0) % kand.length];
}
function vorschlagWeiter(ds) { vorschlagOffset[ds] = (vorschlagOffset[ds] || 0) + 1; render(); }
function vorschlagNehmen(ds, dishId) { S.essensplan[ds] = { dishId }; save("essensplan"); toast("Übernommen"); }

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
      </div></div></div>`;
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
  S.zettel.push({ id: uid(), text: t, von: meinName, datum: heute(), erledigt: false });
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
function rNotfall() {
  let out = `<div class="card"><h2>📇 Notfall & Infos</h2>
  <div class="hint" style="margin:-4px 0 8px">Kinderarzt, Schule, Kleidergrößen – alles Wichtige an einem Ort.</div>`;
  out += S.notfall.map(n => `<div class="row"><div class="grow"><div class="t">${esc(n.titel)}</div><div class="s">${esc(n.wert)}</div></div>
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
  out += `<div class="card"><h2>🔒 Eltern-PIN</h2>
    <div class="hint" style="margin:-4px 0 8px">Schützt den Ausgang aus dem Kinderbereich. Standard: 2468</div>
    <div class="addform"><input id="pin-neu" type="number" placeholder="Neue 4-stellige PIN">
    <button class="btn" onclick="pinSave()">Ändern</button></div></div>`;
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
