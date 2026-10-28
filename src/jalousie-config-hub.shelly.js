// =====================================================================
// Zentrale Jalousie-Konfiguration (läuft als eigenes Skript auf dem weather-hub)
// Die Jalousie-Geräte rufen ihre Werte per IP ab:
//   http://<Hub-IP>/script/<ID dieses Skripts>/jalcfg?ip=<Geräte-IP>
// Änderungen: unten DEFAULT bzw. DEVICES anpassen, Skript speichern und neu starten.
// Die Geräte übernehmen die neuen Werte beim nächsten Abruf (Start + alle paar Stunden).
// =====================================================================

// Standardwerte für alle Geräte
let DEFAULT = {
  mode: "an",          // Zeitsteuerung: "aus" | "an" (Mo-So) | "mo-fr" | "wochenende"
  wdOpen: "06:30",     // Mo-Fr öffnen
  wdClose: "21:00",    // Mo-Fr schließen
  weOpen: "08:30",     // Sa/So öffnen
  weClose: "22:00",    // Sa/So schließen

  darkOn: 300,         // Dämmerung: darunter (lx) = dunkel -> schließen; 0 = Dämmerungsautomatik aus
  darkOff: 800,        // darüber (lx) = wieder hell
  darkAfter: "15:00",  // bei aktiver Zeitsteuerung gilt die Dämmerung erst ab dieser Uhrzeit

  shadeOn: 40000,      // Beschattung: ab dieser Helligkeit (lx) zu
  shadeOff: 25000,     // unter diesem Wert (lx) wieder auf
  shadeFrom: "07:00",  // Beschattungsautomatik gilt von ...
  shadeTo: "17:00",    // ... bis
  shadeEnd: "keep",    // nach Ende des Zeitraums: "open" = öffnen, "keep" = Zustand belassen
  seasonFrom: "04-01", // Saison für Beschattung von (MM-TT)
  seasonTo: "09-30",   // ... bis (MM-TT); außerhalb nie beschatten

  tilt: true           // true = nach dem Schließen (Beschattung) kippen, false = nicht kippen (z.B. bei Stoff oder Schlafzimmer)
};

// Abweichungen je Gerät (Schlüssel = feste IP). Nur eintragen, was vom Standard abweicht.
// "name" dient nur der Übersicht und wird nicht übertragen.
let DEVICES = {
  "192.168.178.220": { name: "Flur EG NO" },
  "192.168.178.221": { name: "WohnZ NO", mode: "mo-fr", shadeOn: 30000, shadeEnd: "keep" },
  "192.168.178.222": { name: "WohnZ SO-li" }
  "192.168.178.223": { name: "WohnZ SO-mi" }
  "192.168.178.224": { name: "WohnZ SO-re" }
  "192.168.178.225": { name: "WohnZ SW" }
  "192.168.178.226": { name: "Flur EG SW", darkOn: 0 }
  "192.168.178.227": { name: "Küche", darkOn: 0 }
  "192.168.178.228": { name: "ArbZ NW", tilt: false, darkOn: 0 }
  "192.168.178.229": { name: "ArbZ NO", darkOn: 0 }
  "192.168.178.230": { name: "Flur OG NO", darkOn: 0 }
  "192.168.178.231": { name: "SchlafZ NO", tilt: false }
  "192.168.178.232": { name: "SchlafZ SO", tilt: false }
  "192.168.178.233": { name: "Bad", tilt: false, darkOn: 0 }
  "192.168.178.234": { name: "Flur OG SW", darkOn: 0 }
  "192.168.178.235": { name: "GastZ SW", darkOn: 0 }
  "192.168.178.236": { name: "GastZ NW", tilt: false, darkOn: 0 }
  "192.168.178.237": { name: "SpielZ NW-u", tilt: false, darkOn: 0 }
  "192.168.178.238": { name: "SpielZ NO", darkOn: 0 }
  "192.168.178.239": { name: "KindZ NO" }
  "192.168.178.240": { name: "KindZ SO-li", tilt: false }
  "192.168.178.241": { name: "KindZ SO-re", tilt: false }
  "192.168.178.242": { name: "Kind SW" }
  "192.168.178.243": { name: "SpielZ SW", darkOn: 0 }
  "192.168.178.244": { name: "SpielZ NW-o", tilt: false, darkOn: 0 }
};

// ---------------------------------------------------------------------

// "HH:MM" -> Minuten seit Mitternacht, sonst null
function toMin(s) {
  if (typeof s !== "string" || s.length !== 5 || s.slice(2, 3) !== ":") return null;
  let h = parseInt(s.slice(0, 2), 10);
  let m = parseInt(s.slice(3, 5), 10);
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
  return h * 60 + m;
}

// "MM-TT" -> Monat und Tag, sonst null
function toMD(s) {
  if (typeof s !== "string" || s.length !== 5 || s.slice(2, 3) !== "-") return null;
  let m = parseInt(s.slice(0, 2), 10);
  let d = parseInt(s.slice(3, 5), 10);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return { m: m, d: d };
}

// Wert für Gerät: Geräte-Abweichung, sonst Standard
function val(dev, k) {
  if (dev !== undefined && dev !== null && dev[k] !== undefined) return dev[k];
  return DEFAULT[k];
}

// Ungültige Werte werden weggelassen, das Gerät behält dann seinen bisherigen Wert
function put(o, k, v) {
  if (v !== null && v !== undefined) o[k] = v;
}

function num(v) {
  return (typeof v === "number") ? v : null;
}

function build(dev) {
  let a = {};
  let m = val(dev, "mode");
  put(a, "TIME_MODE", (m === "aus" || m === "an" || m === "mo-fr" || m === "wochenende") ? m : null);
  put(a, "WD_OPEN_MIN", toMin(val(dev, "wdOpen")));
  put(a, "WD_CLOSE_MIN", toMin(val(dev, "wdClose")));
  put(a, "WE_OPEN_MIN", toMin(val(dev, "weOpen")));
  put(a, "WE_CLOSE_MIN", toMin(val(dev, "weClose")));

  let b = {};
  put(b, "DARK_ON", num(val(dev, "darkOn")));
  put(b, "DARK_OFF", num(val(dev, "darkOff")));
  put(b, "DARK_AFTER_MIN", toMin(val(dev, "darkAfter")));
  put(b, "SHADE_ON", num(val(dev, "shadeOn")));
  put(b, "SHADE_OFF", num(val(dev, "shadeOff")));
  put(b, "SHADE_FROM_MIN", toMin(val(dev, "shadeFrom")));
  put(b, "SHADE_TO_MIN", toMin(val(dev, "shadeTo")));
  let e = val(dev, "shadeEnd");
  put(b, "SHADE_END", (e === "open" || e === "keep") ? e : null);

  let c = {};
  let sf = toMD(val(dev, "seasonFrom"));
  let st = toMD(val(dev, "seasonTo"));
  if (sf !== null) { c.SHADE_SEASON_FROM_M = sf.m; c.SHADE_SEASON_FROM_D = sf.d; }
  if (st !== null) { c.SHADE_SEASON_TO_M = st.m; c.SHADE_SEASON_TO_D = st.d; }
  let t = val(dev, "tilt");
  put(c, "TILT_ENABLED", (t === true || t === false) ? t : null);

  return { a: a, b: b, c: c };
}

HTTPServer.registerEndpoint("jalcfg", function (req, res) {
  let q = req.query || "";
  let ip = "";
  let p = q.indexOf("ip=");
  if (p >= 0) {
    ip = q.slice(p + 3);
    let amp = ip.indexOf("&");
    if (amp >= 0) ip = ip.slice(0, amp);
  }
  let dev = DEVICES[ip];
  let out = build(dev);
  out.known = (dev !== undefined);
  if (!out.known) print("IP nicht in DEVICES, Standardwerte fuer:", ip);
  res.code = 200;
  res.headers = [["Content-Type", "application/json"]];
  res.body = JSON.stringify(out);
  res.send();
}, null);
