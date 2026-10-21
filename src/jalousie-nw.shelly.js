// =====================================================================
// Jalousie-Steuerung: Shelly 2PM Gen4 + Ecowitt WS90 (Wetterdaten per HTTP vom Hub)
// Prioritäten: 1. Sturm/Regen -> offen  2. Frost -> Stillstand  3. Nacht (Zeit)
//              4. Dämmerung (Helligkeit)  5. Sonnenschutz  6. offen
// Position: 100 = ganz offen, 0 = ganz geschlossen (Kalibrierung nötig!)
// NEU4: Zeitsteuerung per Modus, manuelle Bedienung sperrt Gegenbewegung,
//       Beschattung mit Zeitfenster + Saison, Kippen an/aus
// noch zu klären:
// +	Gruppen für Häuserseiten erstellen
// -	verschiedene Skripte für unterschiedliche Geräte (Häuserseiten) oder ein Skript mit Angabe des Gerätenamens, bzw. Zugehörigkeit zur Hausseite
// +	Unterscheidung zwischen Jalousie und Stoff (ohne Tilt)? -> TILT_ENABLED
// -	alle Skripte der Jalousieaktoren auf einmal deaktivieren über Master-Gerät möglich?
// =====================================================================

// ===== SCHNELLAUSWAHL (pro Gerät anpassen) =====
// Zeitsteuerung: "aus" | "an" (Mo-So) | "mo-fr" | "wochenende"
let TIME_MODE = "an";
// Beschattung: true = nach dem Schließen Lamellen kippen, false = nur schließen (z.B. Stoff)
let TILT_ENABLED = false; //NW (Hangseite) nur Stoff

let CFG = {
  COVER_ID: 0,

  // --- Wetterdaten vom Hub ---
  HUB_IP: "192.168.178.219",   // statische IP des Shelly-Bluetooth-Hub
  HUB_SCRIPT_ID: 1,            // ID des Skripts auf dem Hub
  HUB_ENDPOINT: "weather-hub", // Name des Endpunkts (HTTPServer.registerEndpoint)
  WX_INTERVAL_S: 30,           // Abfrageintervall zum Hub in Sekunden
  WX_MAX_FAILS: 3,             // Fehlversuche in Folge -> Wetterdaten ungültig

  // Schlüsselnamen im JSON des Hub. "" = Sensor nicht verwenden
  KEY_LUX: "lux",     // Helligkeit in lux
  KEY_WIND: "wind",   // Windgeschwindigkeit in m/s
  KEY_GUST: "gust",   // Windböe in m/s
  KEY_RAIN: "rain",   // Regen (true/1 = es regnet)
  KEY_TEMP: "temp",   // Außentemperatur in °C

  LUX_SCALE: 1,       // klx statt lx: 1000

  // --- Zeitsteuerung (Ortszeit des Shelly) ---
  WD_OPEN_MIN: 8 * 60 + 30,  // Mo-Fr: morgens öffnen ab 08:30
  WD_CLOSE_MIN: 21 * 60,     // Mo-Fr: abends schließen ab 21:00
  WE_OPEN_MIN: 8 * 60 + 30,  // Sa/So: morgens öffnen ab 08:30
  WE_CLOSE_MIN: 22 * 60,     // Sa/So: abends schließen ab 22:00

  // --- Sonnenschutz nach Helligkeit ---
  SHADE_ON: 40000,       // ab dieser Helligkeit (lx) beschatten
  SHADE_OFF: 25000,      // unter diesem Wert wieder öffnen
  SHADE_ON_MIN: 5,       // Bedingung muss so viele Minuten anhalten (Wolken)
  SHADE_OFF_MIN: 15,
  SHADE_FROM_MIN: 10 * 60,   // Beschattung nur ab dieser Uhrzeit (10 * 60 ist 10:00h)
  SHADE_TO_MIN: 18 * 60,     // ... bis zu dieser Uhrzeit
  SHADE_SEASON_FROM_M: 5,    // Saison von (Monat/Tag): 01.05.
  SHADE_SEASON_FROM_D: 1,
  SHADE_SEASON_TO_M: 9,      // Saison bis (Monat/Tag): 30.09.
  SHADE_SEASON_TO_D: 30,     // außerhalb der Saison wird nie beschattet
  SHADE_TILT_S: 1.5,     // Lamellen kippen: kurze Öffnungsfahrt in Sekunden (nur wenn TILT_ENABLED)
  SHADE_POS: 0,          // Position bei Beschattung ohne Kippen (0 = ganz zu)

  // --- Dämmerung: nach Helligkeit schließen (0 = deaktiviert) ---
  DARK_ON: 300,          // darunter = dunkel (lx)
  DARK_OFF: 800,         // darüber = wieder hell
  DARK_MIN: 10,
  DARK_AFTER_MIN: 15 * 60, // bei aktiver Zeitsteuerung: erst nach 15:00 Uhr

  // --- Wetterschutz ---
  WIND_ON: 8,            // m/s (Wind oder Böe) -> Sturm
  WIND_OFF: 5,           // m/s -> Sturm vorbei, wenn so lange darunter:
  WIND_HOLD_MIN: 10,
  RAIN_MODE: "binary",   // "binary" = Ja/Nein, "total" = Zähler steigt, "rate" = Wert > 0
  RAIN_HOLD_MIN: 15,     // so lange nach dem letzten Regen offen bleiben
  OPEN_ON_NO_WIND_DATA: true, // true = bei Ausfall von Windsensor/Hub öffnen
  // --- Frostschutz: bei Frost fährt die Automatik nicht mehr ---
  FROST_ON: 4,           // °C: bei dieser Temperatur oder darunter -> Frost
  FROST_OFF: 6,          // °C: Frost vorbei, wenn so lange mindestens diese Temperatur:
  FROST_HOLD_MIN: 10,
  FROST_BLOCKS_WEATHER: true, // true = auch Sturm-/Regenschutz fährt bei Frost nicht
  FROST_ON_NO_TEMP_DATA: false, // true = bei Ausfall von Temperatursensor/Hub sperren

  MANUAL_GRACE_MS: 5000, // Bewegung kürzer nach Skriptbefehl gilt nicht als manuell
  STALE_S: 600,          // Sensorwerte älter als 10 Min. gelten als ungültig

  POLL_S: 20,
  DEBUG: true
};

let COVER_KEY = "cover:" + JSON.stringify(CFG.COVER_ID);

let st = {
  storm: false,
  rain: false,
  rainHold: 0,
  lastRain: null,
  shade: false,
  dark: false,
  locked: false,
  frost: false,
  frostLocked: false,
  applied: null,     // zuletzt angewendeter Sollzustand
  hold: null,        // manuelle Sperre: "open" = kein autom. Schließen, "closed" = kein autom. Öffnen
  period: null,      // "day" / "night" laut Zeiten
  cmdMs: -100000,    // Zeitpunkt des letzten Skript-Fahrbefehls
  pendingTilt: false,
  cnt: {}
};

let wx = {
  data: null,      // zuletzt empfangenes JSON, null = keine gültigen Daten
  fetchedTs: 0,
  fails: 0,
  ready: false     // true nach dem ersten Abrufversuch
};

if (TIME_MODE !== "aus" && TIME_MODE !== "an" && TIME_MODE !== "mo-fr" && TIME_MODE !== "wochenende") {
  print("Ungueltiger TIME_MODE:", TIME_MODE, "-> Zeitsteuerung aus");
}

// ---------------------------------------------------------------------
// Wetterdaten vom Hub holen (ein Request pro Abfrage)
// ---------------------------------------------------------------------
function wxPoll() {
  let url = "http://" + CFG.HUB_IP + "/script/" + JSON.stringify(CFG.HUB_SCRIPT_ID) + "/" + CFG.HUB_ENDPOINT;
  Shelly.call("HTTP.GET", { url: url, timeout: 5 }, function (res, ec) {
    if (ec === 0 && res && res.code === 200) {
      let d = JSON.parse(res.body);  // mJS: kein try/catch, bei Fehler null
      if (d) {
        wx.data = d;
        let sys = Shelly.getComponentStatus("sys");
        wx.fetchedTs = (sys && sys.unixtime) ? sys.unixtime : 0;
        wx.fails = 0;
      } else {
        wx.fails++;
      }
    } else {
      wx.fails++;
      if (CFG.DEBUG) print("Hub nicht erreichbar:", ec, res ? res.code : "-");
    }
    if (wx.fails >= CFG.WX_MAX_FAILS) wx.data = null;
    wx.ready = true;
  });
}

// Messwert aus den Hub-Daten. null = nicht vorhanden oder veraltet
function getVal(key, ignoreStale) {
  if (key === "" || key === null || key === undefined) return null;
  if (wx.data === null) return null;
  let v = wx.data[key];
  if (v === null || v === undefined) return null;
  if (!ignoreStale) {
    let a = wx.data[key + "_age"];
    if (a === null || a === undefined) return null;
    let sys = Shelly.getComponentStatus("sys");
    let extra = 0;
    if (sys && sys.unixtime && wx.fetchedTs) extra = sys.unixtime - wx.fetchedTs;
    if (a + extra > CFG.STALE_S) return null;
  }
  return v;
}

function held(name, cond, secs) {
  if (!cond) { st.cnt[name] = 0; return false; }
  st.cnt[name] = (st.cnt[name] || 0) + CFG.POLL_S;
  if (st.cnt[name] >= secs) { st.cnt[name] = 0; return true; }
  return false;
}

// Monat*100+Tag (z.B. 501 = 1. Mai) aus Tagen seit 1970-01-01
function monthDay(days) {
  let z = days + 719468;
  let era = Math.floor(z / 146097);
  let doe = z - era * 146097;
  let yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  let doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  let mp = Math.floor((5 * doy + 2) / 153);
  let d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  let m = mp < 10 ? mp + 3 : mp - 9;
  return m * 100 + d;
}

function inSeason(md) {
  let from = CFG.SHADE_SEASON_FROM_M * 100 + CFG.SHADE_SEASON_FROM_D;
  let to = CFG.SHADE_SEASON_TO_M * 100 + CFG.SHADE_SEASON_TO_D;
  if (from <= to) return md >= from && md <= to;
  return md >= from || md <= to;  // Saison über den Jahreswechsel
}

// Fahrbefehl des Skripts (merkt sich den Zeitpunkt, um ihn von Handbedienung zu unterscheiden)
function cmd(method, params) {
  st.cmdMs = Shelly.getUptimeMs();
  Shelly.call(method, params);
}

function moveTo(pos) {
  st.pendingTilt = false;
  if (pos === 100) {
    cmd("Cover.Open", { id: CFG.COVER_ID });
  } else if (pos === 0) {
    cmd("Cover.Close", { id: CFG.COVER_ID });
  } else {
    cmd("Cover.GoToPosition", { id: CFG.COVER_ID, pos: pos });
  }
}

// Nur fahren, wenn nötig (für die Sperre bei Sturm/Regen)
function ensure(pos) {
  let c = Shelly.getComponentStatus(COVER_KEY);
  if (!c) return;
  if (c.state === "calibrating") return;
  if (pos === 100 && (c.state === "open" || c.state === "opening")) return;
  if (pos === 0 && (c.state === "closed" || c.state === "closing")) return;
  moveTo(pos);
}

// Sonnenschutz: schließen und (wenn TILT_ENABLED) Lamellen kippen, sonst feste Position
function shadeTilt() {
  if (!TILT_ENABLED || CFG.SHADE_TILT_S <= 0) {
    moveTo(CFG.SHADE_POS);
    return;
  }
  let c = Shelly.getComponentStatus(COVER_KEY);
  if (c && c.state === "closed") {
    cmd("Cover.Open", { id: CFG.COVER_ID, duration: CFG.SHADE_TILT_S });
  } else {
    moveTo(0);
    st.pendingTilt = true; // Kippen, sobald die Jalousie ganz geschlossen ist
  }
}

Shelly.addStatusHandler(function (e) {
  if (e.component !== COVER_KEY || !e.delta) return;
  let s = e.delta.state;

  // Handbedienung erkennen: Fahrt ohne vorherigen Skriptbefehl
  if ((s === "opening" || s === "closing") && !st.locked &&
      Shelly.getUptimeMs() - st.cmdMs > CFG.MANUAL_GRACE_MS) {
    st.hold = (s === "opening") ? "open" : "closed";
    st.pendingTilt = false;
    print("Manuelle Bedienung -> Sperre:", st.hold);
  }

  // Kippen nach dem Schließen
  if (st.pendingTilt && s === "closed") {
    st.pendingTilt = false;
    Timer.set(1000, false, function () {
      cmd("Cover.Open", { id: CFG.COVER_ID, duration: CFG.SHADE_TILT_S });
    });
  }
});

// Sperre durch Handbedienung: "open" blockiert automatisches Schließen/Beschatten,
// "closed" blockiert automatisches Öffnen/Beschatten
function blocked(act) {
  if (st.hold === "closed") return act === "day" || act === "open" || act === "shade";
  if (st.hold === "open") return act === "night" || act === "dark" || act === "shade";
  return false;
}

function tick() {
  if (!wx.ready) return; // erst nach dem ersten Abrufversuch beim Hub auswerten

  let sys = Shelly.getComponentStatus("sys");
  if (!sys || !sys.time) return; // Uhrzeit noch nicht synchronisiert
  let nowMin = parseInt(sys.time.slice(0, 2), 10) * 60 + parseInt(sys.time.slice(3, 5), 10);

  // Wochentag (0 = Sonntag ... 6 = Samstag) und Datum aus Unixzeit + lokalem Zeitversatz
  let utcMin = Math.floor(sys.unixtime / 60) % 1440;
  let off = nowMin - utcMin;
  if (off > 720) off -= 1440;
  if (off < -720) off += 1440;
  let days = Math.floor((sys.unixtime + off * 60) / 86400);
  let wday = (days + 4) % 7;
  let md = monthDay(days);
  let weekend = (wday === 0 || wday === 6);
  let openMin = weekend ? CFG.WE_OPEN_MIN : CFG.WD_OPEN_MIN;
  let closeMin = weekend ? CFG.WE_CLOSE_MIN : CFG.WD_CLOSE_MIN;
  let isNight = (nowMin < openMin || nowMin >= closeMin);

  // Zeitsteuerung heute aktiv?
  let timeActive = false;
  if (TIME_MODE === "an") timeActive = true;
  else if (TIME_MODE === "mo-fr") timeActive = !weekend;
  else if (TIME_MODE === "wochenende") timeActive = weekend;

  // Öffnungs-/Schließzeitpunkt erreicht: passende manuelle Sperre aufheben
  let period = isNight ? "night" : "day";
  if (st.period !== null && st.period !== period) {
    if ((period === "day" && st.hold === "closed") || (period === "night" && st.hold === "open")) {
      print("Zeitpunkt erreicht -> Sperre aufgehoben:", st.hold);
      st.hold = null;
      st.applied = null;
    }
  }
  st.period = period;

  // ---------- Wind ----------
  let w = getVal(CFG.KEY_WIND);
  let g = getVal(CFG.KEY_GUST);
  let wind = null;
  if (w !== null) wind = w;
  if (g !== null && (wind === null || g > wind)) wind = g;

  if (wind !== null) {
    if (!st.storm) {
      if (wind >= CFG.WIND_ON) st.storm = true;
    } else {
      if (held("stormOff", wind < CFG.WIND_OFF, CFG.WIND_HOLD_MIN * 60)) st.storm = false;
    }
  } else if (CFG.OPEN_ON_NO_WIND_DATA) {
    st.storm = true;
  }

  // ---------- Regen ----------
  // Ja/Nein-Sensor meldet sich evtl. nur bei Änderung -> Alterscheck überspringen
  let r = getVal(CFG.KEY_RAIN, CFG.RAIN_MODE === "binary");
  let raining = false;
  if (r !== null) {
    if (CFG.RAIN_MODE === "total") {
      if (st.lastRain !== null && r > st.lastRain) raining = true;
      st.lastRain = r;
    } else if (CFG.RAIN_MODE === "binary") {
      raining = (r === true || r === 1);
    } else {
      raining = r > 0;
    }
  }
  if (raining) st.rainHold = CFG.RAIN_HOLD_MIN * 60;
  else if (st.rainHold > 0) st.rainHold -= CFG.POLL_S;
  st.rain = st.rainHold > 0;

  // ---------- Frost ----------
  let temp = getVal(CFG.KEY_TEMP);
  if (temp !== null) {
    if (!st.frost) {
      if (temp <= CFG.FROST_ON) st.frost = true;
    } else {
      if (held("frostOff", temp >= CFG.FROST_OFF, CFG.FROST_HOLD_MIN * 60)) st.frost = false;
    }
  } else if (CFG.FROST_ON_NO_TEMP_DATA) {
    st.frost = true;
  }

  // ---------- Helligkeit ----------
  let lux = getVal(CFG.KEY_LUX);
  if (lux !== null) {
    lux = lux * CFG.LUX_SCALE;
    if (!st.shade) {
      if (held("shadeOn", lux >= CFG.SHADE_ON, CFG.SHADE_ON_MIN * 60)) st.shade = true;
    } else {
      if (held("shadeOff", lux <= CFG.SHADE_OFF, CFG.SHADE_OFF_MIN * 60)) st.shade = false;
    }
    if (CFG.DARK_ON > 0) {
      if (!st.dark) {
        if (held("darkOn", lux <= CFG.DARK_ON, CFG.DARK_MIN * 60)) st.dark = true;
      } else {
        if (held("darkOff", lux >= CFG.DARK_OFF, CFG.DARK_MIN * 60)) st.dark = false;
      }
    }
  }

  if (CFG.DEBUG) {
    print("t=" + sys.time, "md=", md, "zeit=", timeActive, period, "hold=", st.hold,
          "wind=", wind, "rain=", r, "lux=", lux, "temp=", temp,
          "frost=", st.frost, "storm=", st.storm, "rainHold=", st.rain,
          "shade=", st.shade, "dark=", st.dark);
  }

  // ---------- Frostschutz: keine Automatik, Jalousie bleibt stehen ----------
  if (st.frost) {
    if (!st.frostLocked) {
      st.frostLocked = true;
      st.pendingTilt = false;
      print("Frostschutz aktiv -> keine Automatik");
    }
    if (CFG.FROST_BLOCKS_WEATHER || !(st.storm || st.rain)) return;
  } else if (st.frostLocked) {
    st.frostLocked = false;
    st.applied = null; // nach dem Frost wieder Zeit/Helligkeit anwenden
    print("Frostschutz beendet");
  }

  // ---------- Wetterschutz hat Vorrang ----------
  if (st.storm || st.rain) {
    if (!st.locked) {
      st.locked = true;
      print("Wetterschutz aktiv -> oeffnen");
    }
    st.pendingTilt = false;
    ensure(100); // bleibt offen, auch bei manuellem Schliessen
    return;
  }
  if (st.locked) {
    st.locked = false;
    st.applied = null; // danach wieder Zeit/Helligkeit anwenden
    print("Wetterschutz beendet");
  }

  // ---------- Normalbetrieb ----------
  // Dämmerung: bei aktiver Zeitsteuerung erst nach DARK_AFTER_MIN, sonst rein nach Helligkeit
  let darkNow = CFG.DARK_ON > 0 && st.dark && (!timeActive || nowMin >= CFG.DARK_AFTER_MIN);
  // Beschattung: nur in der Saison und im Zeitfenster
  let shadeNow = st.shade && inSeason(md) && nowMin >= CFG.SHADE_FROM_MIN && nowMin < CFG.SHADE_TO_MIN;

  let want;
  if (timeActive && isNight) want = "night";
  else if (darkNow) want = "dark";
  else if (shadeNow) want = "shade";
  else if (timeActive) want = "day";
  else want = "none"; // keine Zeitsteuerung, nichts Besonderes

  if (want !== st.applied) {
    let prev = st.applied;
    st.applied = want;
    let act = want;
    // Ende von Beschattung/Dämmerung ohne Zeitsteuerung: wieder öffnen
    if (want === "none") act = (prev === "shade" || prev === "dark") ? "open" : null;
    if (act === null) return;
    print("Sollzustand: " + act);
    if (blocked(act)) {
      print("durch manuelle Bedienung gesperrt (" + st.hold + ")");
      return;
    }
    if (act === "shade") shadeTilt();
    else if (act === "night" || act === "dark") moveTo(0);
    else moveTo(100);
  }
}

// Start: Hub-Abfrage mit zufälligem Versatz (1-21 s), damit nicht alle Geräte
// gleichzeitig auf den Hub zugreifen. Danach periodisch.
Timer.set(1000 + Math.floor(Math.random() * 20000), false, function () {
  wxPoll();
  Timer.set(CFG.WX_INTERVAL_S * 1000, true, wxPoll);
});

// Steuerlogik im festen Raster, wertet erst nach dem ersten Hub-Abruf aus
Timer.set(CFG.POLL_S * 1000, true, tick);
