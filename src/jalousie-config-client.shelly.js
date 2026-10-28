// =====================================================================
// Konfig-Client für die Jalousie-Geräte (eigenes Skript, neben dem Jalousie-Skript)
// Holt die zentrale Konfiguration vom Hub anhand der eigenen IP-Adresse
// und legt sie lokal im KVS ab (Schlüssel jal_a, jal_b, jal_c).
// Abruf: kurz nach dem Start, danach alle SYNC_H Stunden (3 x pro Tag).
// Fehlgeschlagene Abrufe werden alle RETRY_S Sekunden wiederholt.
// Das Jalousie-Skript liest die Werte aus dem KVS; ohne Hub arbeiten beide
// mit den zuletzt gespeicherten Werten weiter.
// =====================================================================

let SYNC = {
  HUB_IP: "192.168.178.219",  // statische IP des Hub
  HUB_SCRIPT_ID: 2,           // ID des Zentralkonfig-Skripts auf dem Hub
  HUB_ENDPOINT: "jalcfg",
  SYNC_H: 8,                  // Abrufintervall in Stunden
  RETRY_S: 300,               // Wiederholung nach Fehler (Sekunden)
  START_DELAY_MAX_S: 60       // zufälliger Start-Versatz, damit nicht alle Geräte gleichzeitig abrufen
};

let saved = ["", "", ""];
let names = ["a", "b", "c"];

// Eigene IP-Adresse (WLAN, sonst Ethernet), null wenn noch nicht verbunden
function ownIp() {
  let w = Shelly.getComponentStatus("wifi");
  if (w && w.sta_ip) return w.sta_ip;
  let e = Shelly.getComponentStatus("eth");
  if (e && e.ip) return e.ip;
  return null;
}

// Nur schreiben, wenn sich der Abschnitt geändert hat (schont den Flash-Speicher)
function save(i, sec) {
  let str = JSON.stringify(sec);
  if (str.length > 250) {
    print("Abschnitt zu lang fuer KVS:", names[i], str.length);
    return;
  }
  if (str === saved[i]) return;
  saved[i] = str;
  Shelly.call("KVS.Set", { key: "jal_" + names[i], value: str });
}

function fetchCfg() {
  let ip = ownIp();
  if (ip === null) {
    Timer.set(SYNC.RETRY_S * 1000, false, fetchCfg);
    return;
  }
  let url = "http://" + SYNC.HUB_IP + "/script/" + JSON.stringify(SYNC.HUB_SCRIPT_ID) +
            "/" + SYNC.HUB_ENDPOINT + "?ip=" + ip;
  Shelly.call("HTTP.GET", { url: url, timeout: 5 }, function (res, ec) {
    let ok = false;
    if (ec === 0 && res && res.code === 200) {
      let d = JSON.parse(res.body);  // mJS: kein try/catch, bei Fehler null
      if (d && d.a && d.b && d.c) {
        save(0, d.a);
        save(1, d.b);
        save(2, d.c);
        ok = true;
        print("Konfig gespeichert fuer", ip, d.known ? "" : "(IP nicht im Hub eingetragen -> Standardwerte)");
      }
    }
    if (!ok) print("Konfig-Abruf fehlgeschlagen:", ec, res ? res.code : "-");
    Timer.set((ok ? SYNC.SYNC_H * 3600 : SYNC.RETRY_S) * 1000, false, fetchCfg);
  });
}

Timer.set(1000 + Math.floor(Math.random() * SYNC.START_DELAY_MAX_S * 1000), false, fetchCfg);
