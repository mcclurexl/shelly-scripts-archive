// =====================================================================
// Jalousie-Steuerung: Shelly 2PM Gen4 + Ecowitt WS90 (per Bluetooth/BTHome)
// Prioritäten: 1. Sturm/Niederschlag -> offen  2. Nacht (Zeit)
//              3. Dämmerung (Helligkeit) 4. Sonnenschutz (Helligkeit) 5. offen
// Position: 100 = ganz offen, 0 = ganz geschlossen (Kalibrierung nötig!)
// NEU: mit Wochentag. WD=Weekday , WE=Weekend
// NEU2: mit Jalousiekippung bei Sonneneinstrahlung und bei Wind und Wetter fährt die Jalousie beim Schließen sofort wieder auf
// NEU3: Wetterdaten kommen NICHT mehr aus einem lokalen BTHome-Sensor, sondern per HTTP vom
//       Shelly-Bluetooth-Hub (Skript mit HTTPServer.registerEndpoint("weather", ...)).
//       Der Hub liefert ein JSON mit den Schlüsseln temp, wind, gust, rain, lux
//       (jeweils plus <schlüssel>_age = Alter in Sekunden). Die bthomesensor-IDs (2xx)
//       werden nur noch im Hub-Skript eingetragen, hier stehen nur die Schlüsselnamen (KEY_*).
// noch zu klären: 
// +	Gruppen für Häuserseiten erstellen 
// -	verschiedene Skripte für unterschiedliche Geräte (Häuserseiten) oder ein Skript mit Angabe des Gerätenamens, bzw. Zugehörigkeit zur Hausseite
// -	Unterscheidung zwischen Jalousie und Stoff (ohne Tilt)?
// -	alle Skripte der Jalousieaktoren auf einmal deaktivieren möglich? Über Master-Gerät, wenn ja wie?
// 		-	Deaktivierung des Skripts vorübergehend oder dauerhaft?
// -	Zeitsteuerung für Helligkeitsmodus?
// +	Daten vom WS90 (Hub): http://<IP-des-Hub>/rpc/Shelly.GetStatus bzw. /rpc/Shelly.GetComponents?dynamic_only=true
//      und dort die bthomesensor-Komponenten (2xx) den Messwerten zuordnen. Die Nummern kommen ins Hub-Skript (SENSORS).
// =====================================================================

let CFG = {
  COVER_ID: 0,

  // --- Wetterdaten vom Hub ---
  HUB_IP: "192.168.178.185",   // IP des Shelly-Bluetooth-Hub
  HUB_SCRIPT_ID: 1,            // ID des Skripts auf dem Hub, das den Endpunkt bereitstellt
  HUB_ENDPOINT: "weather",     // Name des Endpunkts (HTTPServer.registerEndpoint)
  WX_INTERVAL_S: 30,           // Abfrageintervall zum Hub in Sekunden
  WX_MAX_FAILS: 3,             // so viele Fehlversuche in Folge -> Wetterdaten gelten als nicht vorhanden

  // Schlüsselnamen im JSON des Hub. "" = Sensor nicht verwenden
  KEY_LUX: "lux",     // Helligkeit, Illumination in lux
  KEY_WIND: "wind",   // Windgeschwindigkeit in m/s
  KEY_GUST: "gust",   // Windböe in m/s
  KEY_RAIN: "rain",   // Niederschlag, rain status. Wird hier nur als "True" oder "1" behandelt (es regnet). Alle anderen Werte: es regnet nicht.
  KEY_TEMP: "temp",   // Außentemperatur in °C

  LUX_SCALE: 1,          // Falls der Wert in klx statt lx kommt: 1000; sollte in lx kommen

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
  RAIN_MODE: "binary",   // "binary" = nur Ja/Nein (true/1 = Regen), "total" = Regenmenge
                         // steigt (Zähler), "rate" = Wert > 0
  RAIN_HOLD_MIN: 15,     // so lange nach dem letzten Regen offen bleiben
  OPEN_ON_NO_WIND_DATA: false, // true = bei Ausfall des Windsensors (oder des Hub) sicherheitshalber öffnen
  // --- Frostschutz: bei Frost fährt die Automatik nicht mehr ---
  FROST_ON: 4,           // °C: bei dieser Temperatur oder darunter -> Frost
  FROST_OFF: 6,          // °C: Frost vorbei, wenn so lange mindestens diese Temperatur:
  FROST_HOLD_MIN: 10,
  FROST_BLOCKS_WEATHER: true, // true = auch Sturm-/Regenschutz fährt bei Frost nicht
  FROST_ON_NO_TEMP_DATA: false, // true = bei Ausfall des Temperatursensors (oder des Hub) Automatik sperren

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
  frost: false,
  frostLocked: false,
  applied: null,
  pendingTilt: false,
  cnt: {}
};

// Zustand der Wetterdaten vom Hub
let wx = {
  data: null,      // zuletzt empfangenes JSON, null = keine gültigen Daten
  fetchedTs: 0,    // Unixzeit des letzten erfolgreichen Abrufs
  fails: 0,
  ready: false     // true nach dem ersten Abrufversuch (Erfolg oder Fehler)
};

// ---------------------------------------------------------------------
// Wetterdaten vom Hub holen (ein einziger Request pro Abfrage)
// ---------------------------------------------------------------------
function wxPoll() {
  let url = "http://" + CFG.HUB_IP + "/script/" + JSON.stringify(CFG.HUB_SCRIPT_ID) + "/" + CFG.HUB_ENDPOINT;
  Shelly.call("HTTP.GET", { url: url, timeout: 5 }, function (res, ec) {
    if (ec === 0 && res && res.code === 200) {
      let d = JSON.parse(res.body);  // mJS kennt kein try/catch, bei Fehler kommt null
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

// Liest einen Messwert aus den Hub-Daten. null = nicht vorhanden oder veraltet
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
  if (!wx.ready) return; // erst nach dem ersten Abrufversuch beim Hub auswerten

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
    print("t=" + sys.time, "wday=", wday, "hub=", wx.data !== null, "wind=", wind, "rain=", r, "lux=", lux,
          "temp=", temp, "frost=", st.frost, "storm=", st.storm, "rainHold=", st.rain,
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

// Start: Hub-Abfrage mit zufälligem Versatz (1-21 s), damit nicht alle 20 Geräte
// gleichzeitig auf den Hub zugreifen. Danach periodisch.
Timer.set(1000 + Math.floor(Math.random() * 20000), false, function () {
  wxPoll();
  Timer.set(CFG.WX_INTERVAL_S * 1000, true, wxPoll);
});

// Steuerlogik läuft weiter im festen Raster, wertet aber erst nach dem ersten Hub-Abruf aus
Timer.set(CFG.POLL_S * 1000, true, tick);
