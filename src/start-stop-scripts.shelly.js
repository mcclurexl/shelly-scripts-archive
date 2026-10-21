// =====================================================================
// Master-Skript: Skripte auf mehreren Shelly-Geräten per IP steuern
// Aktionen:
//   "start"         = Skript starten (Autostart bleibt unverändert)
//   "stop"          = Skript stoppen (Autostart bleibt unverändert)
//   "autostart_on"  = nur Autostart einschalten (Skript wird NICHT gestartet/gestoppt)
//   "autostart_off" = nur Autostart ausschalten (Skript wird NICHT gestartet/gestoppt)
//   "enable"        = Autostart einschalten + Skript starten
//   "disable"       = Skript stoppen + Autostart ausschalten
// Aufruf im Browser/per curl:
//   http://<IP-Master>/script/<Skript-ID>/scripts?action=stop
// Oder aus eigenem Code:  setScripts("stop");
// Oder per Knopfdruck in der Shelly-App über virtuelle Buttons (siehe BUTTONS unten)
  // vier buttons unter Komponenten->virtuelle Komponenten->Button erstellen. IDs müssen 200-203 sein (s.u.). Buttons zu einer Gruppe hinzufügen
// ACHTUNG: Das Master-Skript nicht auf das eigene Skript wirken lassen
//          (Master-IP nicht in DEVICES eintragen oder andere Skript-ID verwenden).
// =====================================================================

let DEVICES = [
  { ip: "192.168.178.220" },
  { ip: "192.168.178.102" },
  { ip: "192.168.178.103", id: 2 }   // abweichende Skript-ID für dieses Gerät
];
let DEFAULT_ID = 1;   // Skript-ID, wenn bei einem Gerät keine id angegeben ist
let TIMEOUT_S = 5;

// Virtuelle Buttons des Master-Geräts -> Aktion.
// Die Buttons legst du als virtuelle Komponenten (Typ "Button") am Master-Gerät an.
// Der erste bekommt die Nummer 200, der nächste 201 usw. (siehe Komponenten des Geräts).
let BUTTONS = {
  "button:200": "stop",     // z.B. "Alle Jalousie-Skripte stoppen"
  "button:201": "start",    // "Alle Jalousie-Skripte starten"
  "button:202": "autostart_off",  // "Autostart aus" (Skript läuft/steht weiter wie bisher)
  "button:203": "autostart_on"    // "Autostart an"  (Skript läuft/steht weiter wie bisher)
};

let jobs = [];
let jobIdx = 0;        // nächster Auftrag (mJS kennt shift() nicht)
let running = false;
let failMap = {};
let failCount = 0;
let failList = "";
let doneCb = null;

// Einzelne RPC-Schritte je Aktion: [Methode, Parameter]
function stepsFor(action, id) {
  if (action === "start") return [["Script.Start", { id: id }]];
  if (action === "stop") return [["Script.Stop", { id: id }]];
  if (action === "autostart_on") return [["Script.SetConfig", { id: id, config: { enable: true } }]];
  if (action === "autostart_off") return [["Script.SetConfig", { id: id, config: { enable: false } }]];
  if (action === "enable") {
    return [["Script.SetConfig", { id: id, config: { enable: true } }],
            ["Script.Start", { id: id }]];
  }
  if (action === "disable") {
    return [["Script.Stop", { id: id }],
            ["Script.SetConfig", { id: id, config: { enable: false } }]];
  }
  return null;
}

// Aufträge nacheinander abarbeiten (Shelly erlaubt nur wenige parallele HTTP-Aufrufe)
function pump() {
  if (jobIdx >= jobs.length) {
    running = false;
    print("Fertig:", DEVICES.length - failCount, "von", DEVICES.length, "Geraeten ok",
          failCount > 0 ? ("-> Fehler bei: " + failList) : "");
    if (doneCb) {
      let cb = doneCb;
      doneCb = null;
      cb(failList);
    }
    return;
  }
  let j = jobs[jobIdx];
  jobIdx++;
  Shelly.call("HTTP.POST", {
    url: "http://" + j.ip + "/rpc",
    body: JSON.stringify({ id: 1, method: j.method, params: j.params }),
    content_type: "application/json",
    timeout: TIMEOUT_S
  }, function (res, ec) {
    let ok = (ec === 0 && res && res.code === 200);
    if (ok) {
      let b = JSON.parse(res.body);
      if (!b || b.error) ok = false;   // Antwort fehlerhaft oder RPC-Fehler
    }
    if (!ok) {
      if (!failMap[j.ip]) {
        failMap[j.ip] = true;
        failCount++;
        failList += (failList === "" ? "" : ", ") + j.ip;
      }
      print("Fehler:", j.ip, j.method, ec, res ? res.code : "-");
    }
    pump();
  });
}

// Hauptfunktion. cb (optional) wird am Ende mit einem Text der fehlgeschlagenen IPs aufgerufen ("" = alle ok).
// Rückgabe: true = gestartet, false = Aktion ungültig oder es läuft schon ein Durchlauf
function setScripts(action, cb) {
  if (running) {
    print("Es laeuft bereits ein Durchlauf");
    return false;
  }
  if (stepsFor(action, 0) === null) {
    print("Ungueltige Aktion:", action);
    return false;
  }
  jobs = [];
  jobIdx = 0;
  failMap = {};
  failCount = 0;
  failList = "";
  for (let i = 0; i < DEVICES.length; i++) {
    let d = DEVICES[i];
    let id = (d.id !== undefined) ? d.id : DEFAULT_ID;
    let steps = stepsFor(action, id);
    for (let k = 0; k < steps.length; k++) {
      jobs.push({ ip: d.ip, method: steps[k][0], params: steps[k][1] });
    }
  }
  running = true;
  doneCb = cb || null;
  print("Aktion", action, "auf", DEVICES.length, "Geraeten");
  pump();
  return true;
}

// HTTP-Endpunkt: /script/<ID>/scripts?action=stop
HTTPServer.registerEndpoint("scripts", function (req, res) {
  let q = req.query || "";
  let action = "";
  let p = q.indexOf("action=");
  if (p >= 0) {
    action = q.slice(p + 7);
    let amp = action.indexOf("&");
    if (amp >= 0) action = action.slice(0, amp);
  }
  let started = setScripts(action);
  res.code = started ? 200 : 400;
  res.headers = [["Content-Type", "application/json"]];
  res.body = JSON.stringify({ action: action, started: started });
  res.send();
}, null);

// Tastendruck auf einen virtuellen Button (auch aus der Shelly-App) -> Aktion ausführen
Shelly.addEventHandler(function (ev) {
  if (!ev || !ev.info || ev.info.event !== "single_push") return;
  let action = BUTTONS[ev.component];
  if (action === undefined) return;
  print("Button", ev.component, "->", action);
  setScripts(action);
});
