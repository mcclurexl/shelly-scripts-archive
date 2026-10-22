// =====================================================================
// Solarpumpenregler-Freigabe: Shelly 1PM Mini Gen4
// Steckdose EIN, wenn Außentemperatur < TEMP_LOW (15 °C) ODER > TEMP_HIGH (25 °C)
// Dazwischen: AUS. Temperatur kommt per HTTP vom Shelly-Bluetooth-Hub
// (gleicher Endpunkt wie bei der Jalousiesteuerung).
// =====================================================================

let CFG = {
  SWITCH_ID: 0,

  // --- Außentemperatur vom Hub ---
  HUB_IP: "192.168.178.219",   // statische IP des Shelly-Bluetooth-Hub
  HUB_SCRIPT_ID: 1,            // ID des Skripts auf dem Hub
  HUB_ENDPOINT: "weather-hub", // Name des Endpunkts
  KEY_TEMP: "temp",            // Schlüssel der Außentemperatur im JSON
  POLL_S: 60,                  // Abfrage- und Prüfintervall in Sekunden
  STALE_S: 600,                // Messwert älter als 10 Min. = ungültig
  MAX_FAILS: 3,                // so viele Fehlversuche in Folge -> keine Daten

  // --- Schaltschwellen ---
  TEMP_LOW: 15,    // darunter: EIN
  TEMP_HIGH: 25,   // darüber: EIN
  HYST: 0.5,       // Hysterese in K beim Wechsel zurück nach AUS (0 = keine)
                   // AUS erst bei >= TEMP_LOW + HYST und <= TEMP_HIGH - HYST

  // Verhalten ohne gültige Temperatur (Hub/Sensor ausgefallen):
  // "keep" = Zustand beibehalten, "on" = einschalten, "off" = ausschalten
  NO_DATA: "keep",

  DEBUG: true
};

let wx = { temp: null, age: 0, fetchedTs: 0, fails: 0 };

// Aktuelle Außentemperatur oder null (nicht vorhanden / veraltet)
function getTemp() {
  if (wx.temp === null || wx.temp === undefined) return null;
  let sys = Shelly.getComponentStatus("sys");
  let extra = 0;
  if (sys && sys.unixtime && wx.fetchedTs) extra = sys.unixtime - wx.fetchedTs;
  if (wx.age + extra > CFG.STALE_S) return null;
  return wx.temp;
}

// true = EIN, false = AUS, null = Zustand beibehalten (Hysteresebereich)
function decide(t) {
  if (t < CFG.TEMP_LOW || t > CFG.TEMP_HIGH) return true;
  if (t >= CFG.TEMP_LOW + CFG.HYST && t <= CFG.TEMP_HIGH - CFG.HYST) return false;
  return null;
}

// Nur schalten, wenn sich der Zustand ändert (schont das Relais)
function setOutput(on) {
  let sw = Shelly.getComponentStatus("switch:" + JSON.stringify(CFG.SWITCH_ID));
  if (!sw) return;
  if (sw.output === on) return;
  print("Schalte", on ? "EIN" : "AUS");
  Shelly.call("Switch.Set", { id: CFG.SWITCH_ID, on: on });
}

function evaluate() {
  let t = getTemp();
  let want = null;
  if (t === null) {
    if (CFG.NO_DATA === "on") want = true;
    else if (CFG.NO_DATA === "off") want = false;
  } else {
    want = decide(t);
  }
  if (CFG.DEBUG) print("temp=", t, "soll=", want);
  if (want !== null) setOutput(want);
}

function poll() {
  let url = "http://" + CFG.HUB_IP + "/script/" + JSON.stringify(CFG.HUB_SCRIPT_ID) + "/" + CFG.HUB_ENDPOINT;
  Shelly.call("HTTP.GET", { url: url, timeout: 5 }, function (res, ec) {
    let ok = false;
    if (ec === 0 && res && res.code === 200) {
      let d = JSON.parse(res.body);  // mJS: kein try/catch, bei Fehler null
      if (d) {
        let v = d[CFG.KEY_TEMP];
        let a = d[CFG.KEY_TEMP + "_age"];
        if (v !== null && v !== undefined && a !== null && a !== undefined) {
          let sys = Shelly.getComponentStatus("sys");
          wx.temp = v;
          wx.age = a;
          wx.fetchedTs = (sys && sys.unixtime) ? sys.unixtime : 0;
          wx.fails = 0;
          ok = true;
        }
      }
    }
    if (!ok) {
      wx.fails++;
      if (CFG.DEBUG) print("Hub/Temperatur nicht verfuegbar:", ec, res ? res.code : "-");
      if (wx.fails >= CFG.MAX_FAILS) wx.temp = null;
    }
    evaluate();
  });
}

Timer.set(CFG.POLL_S * 1000, true, poll);
poll();
