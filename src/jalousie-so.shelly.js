// =====================================================================
// Jalousie-Steuerung: Shelly 2PM Gen4 + Ecowitt WS90 (per Bluetooth/BTHome)
// Prioritäten: 1. Sturm/Niederschlag -> offen  2. Nacht (Zeit)
//              3. Dämmerung (Helligkeit) 4. Sonnenschutz (Helligkeit) 5. offen
// Position: 100 = ganz offen, 0 = ganz geschlossen (Kalibrierung nötig!)
// NEU: mit Wochentag. WD=Weekday , WE=Weekend
// NEU2: mit Jalousiekippung bei Sonneneinstrahlung und bei Wind und Wetter fährt die Jalousie beim Schließen sofort wieder auf
// noch zu klären: 
// -	Gruppen für Häuserseiten erstellen. 
// -	verschiedene Skripte für unterschiedliche Geräte (Häuserseiten) oder ein Skript mit Angabe des Gerätenamens, bzw. Zugehörigkeit zur Hausseite
// -	Deaktivierung des Skripts vorübergehend oder dauerhaft?
// -	Unterscheidung zwischen Jalousie und Stoff (ohne Tilt)?
// -	alle Skripte der Jalousieaktoren aufeinmal deaktivieren möglich? Über Master-Gerät, wenn ja wie?
// =====================================================================

let CFG = {
  COVER_ID: 0,

  // IDs der BTHome-Sensoren des WS90 (Platzhalter! Siehe Anleitung, Schritt 3)
  // -1 = Sensor nicht verwenden
  ID_LUX: 200,   // Helligkeit
  ID_WIND: 201,  // Windgeschwindigkeit
  ID_GUST: 202,  // Windböe
  ID_RAIN: 203,  // Niederschlag

  LUX_SCALE: 1,          // Falls der Wert in klx statt lx kommt: 1000

  // --- Zeitsteuerung (Ortszeit des Shelly) ---
  WD_OPEN_MIN: 6 * 60 + 30,  // Mo-Fr: morgens öffnen ab 06:30
  WD_CLOSE_MIN: 21 * 60,     // Mo-Fr: abends schließen ab 21:00
  WE_OPEN_MIN: 8 * 60 + 30,  // Sa/So: morgens öffnen ab 08:30
  WE_CLOSE_MIN: 22 * 60,     // Sa/So: abends schließen ab 22:00

  // --- Sonnenschutz nach Helligkeit ---
  SHADE_ON: 40000,       // ab dieser Helligkeit (lx) beschatten
  SHADE_OFF: 25000,      // unter diesem Wert wieder öffnen
  SHADE_ON_MIN: 5,       // Bedingung muss so viele Minuten anhalten (Wolken)
  SHADE_OFF_MIN: 15,
  SHADE_TILT_S: 1.5,     // >0: bei Sonne ganz schließen, dann Lamellen durch kurze
						 // Öffnungsfahrt (Sekunden) kippen. 0 = Kippen aus, dann:
  SHADE_POS: 30,         // Position bei Beschattung (nur wenn SHADE_TILT_S = 0)

  // --- Dämmerung: abends nach Helligkeit schließen (0 = deaktiviert) ---
  DARK_ON: 300,          // darunter = dunkel (lx)
  DARK_OFF: 800,         // darüber = wieder hell
  DARK_MIN: 10,
  DARK_AFTER_MIN: 15 * 60, // Dämmerungslogik gilt nur nach 15:00 Uhr

  // --- Wetterschutz ---
  WIND_ON: 8,            // m/s (Wind oder Böe) -> Sturm
  WIND_OFF: 5,           // m/s -> Sturm vorbei, wenn so lange darunter:
  WIND_HOLD_MIN: 10,
  RAIN_MODE: "total",    // "total" = Regenmenge steigt (Zähler), "rate" = Wert > 0
  RAIN_HOLD_MIN: 15,     // so lange nach dem letzten Regen offen bleiben
  OPEN_ON_NO_WIND_DATA: false, // true = bei Ausfall des Windsensors sicherheitshalber öffnen
  STALE_S: 600,          // Sensorwerte älter als 10 Min. gelten als ungültig

  POLL_S: 20,
  DEBUG: true
};

let st = {
  storm: false,
  rain: false,
  rainHold: 0,
  lastRain: null,
  shade: false,
  dark: false,
  locked: false,
  applied: null,
  pendingTilt: false,
  cnt: {}
};

function held(name, cond, secs) {
  if (!cond) { st.cnt[name] = 0; return false; }
  st.cnt[name] = (st.cnt[name] || 0) + CFG.POLL_S;
  if (st.cnt[name] >= secs) { st.cnt[name] = 0; return true; }
  return false;
}

function getVal(id) {
  if (id < 0) return null;
  let s = Shelly.getComponentStatus("bthomesensor:" + JSON.stringify(id));
  if (s === null || s === undefined) return null;
  if (s.value === null || s.value === undefined) return null;
  let sys = Shelly.getComponentStatus("sys");
  if (s.last_updated_ts && sys && sys.unixtime) {
    if (sys.unixtime - s.last_updated_ts > CFG.STALE_S) return null;
  }
  return s.value;
}

function moveTo(pos) {
  st.pendingTilt = false;
  if (pos === 100) {
    Shelly.call("Cover.Open", { id: CFG.COVER_ID });
  } else if (pos === 0) {
    Shelly.call("Cover.Close", { id: CFG.COVER_ID });
  } else {
    Shelly.call("Cover.GoToPosition", { id: CFG.COVER_ID, pos: pos });
  }
}

// Nur fahren, wenn nötig (für die Sperre bei Sturm/Regen)
function ensure(pos) {
  let c = Shelly.getComponentStatus("cover:" + JSON.stringify(CFG.COVER_ID));
  if (!c) return;
  if (c.state === "calibrating") return;
  if (pos === 100 && (c.state === "open" || c.state === "opening")) return;
  if (pos === 0 && (c.state === "closed" || c.state === "closing")) return;
  moveTo(pos);
}

// Sonnenschutz: ganz schließen und Lamellen kippen (oder feste Position)
function shadeTilt() {
  if (CFG.SHADE_TILT_S <= 0) {
    moveTo(CFG.SHADE_POS);
    return;
  }
  let c = Shelly.getComponentStatus("cover:" + JSON.stringify(CFG.COVER_ID));
  if (c && c.state === "closed") {
    Shelly.call("Cover.Open", { id: CFG.COVER_ID, duration: CFG.SHADE_TILT_S });
  } else {
    moveTo(0);
    st.pendingTilt = true; // Kippen, sobald die Jalousie ganz geschlossen ist
  }
}

Shelly.addStatusHandler(function (e) {
  if (!st.pendingTilt) return;
  if (e.component !== "cover:" + JSON.stringify(CFG.COVER_ID)) return;
  if (e.delta && e.delta.state === "closed") {
    st.pendingTilt = false;
    Timer.set(1000, false, function () {
      Shelly.call("Cover.Open", { id: CFG.COVER_ID, duration: CFG.SHADE_TILT_S });
    });
  }
});

function tick() {
  let sys = Shelly.getComponentStatus("sys");
  if (!sys || !sys.time) return; // Uhrzeit noch nicht synchronisiert
  let nowMin = parseInt(sys.time.slice(0, 2), 10) * 60 + parseInt(sys.time.slice(3, 5), 10);

  // Wochentag (0 = Sonntag ... 6 = Samstag) aus Unixzeit + lokalem Zeitversatz
  let utcMin = Math.floor(sys.unixtime / 60) % 1440;
  let off = nowMin - utcMin;
  if (off > 720) off -= 1440;
  if (off < -720) off += 1440;
  let days = Math.floor((sys.unixtime + off * 60) / 86400);
  let wday = (days + 4) % 7;
  let weekend = (wday === 0 || wday === 6);
  let openMin = weekend ? CFG.WE_OPEN_MIN : CFG.WD_OPEN_MIN;
  let closeMin = weekend ? CFG.WE_CLOSE_MIN : CFG.WD_CLOSE_MIN;

  // ---------- Wind ----------
  let w = getVal(CFG.ID_WIND);
  let g = getVal(CFG.ID_GUST);
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
  let r = getVal(CFG.ID_RAIN);
  let raining = false;
  if (r !== null) {
    if (CFG.RAIN_MODE === "total") {
      if (st.lastRain !== null && r > st.lastRain) raining = true;
      st.lastRain = r;
    } else {
      raining = r > 0;
    }
  }
  if (raining) st.rainHold = CFG.RAIN_HOLD_MIN * 60;
  else if (st.rainHold > 0) st.rainHold -= CFG.POLL_S;
  st.rain = st.rainHold > 0;

  // ---------- Helligkeit ----------
  let lux = getVal(CFG.ID_LUX);
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
    print("t=" + sys.time, "wday=", wday, "wind=", wind, "rain=", r, "lux=", lux,
          "storm=", st.storm, "rainHold=", st.rain, "shade=", st.shade, "dark=", st.dark);
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

  // ---------- Normalbetrieb: Zeit + Helligkeit ----------
  let want;
  if (nowMin < openMin || nowMin >= closeMin) want = 0;
  else if (CFG.DARK_ON > 0 && st.dark && nowMin >= CFG.DARK_AFTER_MIN) want = 0;
  else if (st.shade) want = "shade";
  else want = 100;

  if (want !== st.applied) {
    st.applied = want;
    print("Sollzustand: " + JSON.stringify(want));
    if (want === "shade") shadeTilt();
    else moveTo(want);
  }
}

Timer.set(CFG.POLL_S * 1000, true, tick);
tick();
