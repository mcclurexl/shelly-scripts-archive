// ============================================================
// Master-Skript: Alle Skripte auf mehreren Geräten stoppen. Für Jalousien.
// ungetestet. 20.10.26. IPs der Jalousie-Aktoren einfügen.
// ============================================================

// Geräte-Liste mit IP und Script-ID konfigurieren
var devices = [
  { ip: "192.168.178.220", scriptId: 1, name: "Jalousie ArbZ NW" },
  { ip: "192.168.178.221", scriptId: 1, name: "Jalousie ..." },
  { ip: "192.168.1178.221", scriptId: 1, name: "Jalousie ..." }
  // etc.
];

var index = 0;

// Funktion: Nächstes Gerät verarbeiten
function stopNextScript() {
  if (index >= devices.length) {
    print("Alle Skripte gestoppt.");
    return;
  }

  var device = devices[index];
  var url = "http://" + device.ip + "/rpc/Script.Stop";
  var body = JSON.stringify({ id: device.scriptId });

  print("Stoppe Skript auf: " + device.name);

  HTTPServer.post(url, body, function(res, err) {
    if (err !== null) {
      print("Fehler bei " + device.name + ": " + err);
    } else {
      print("Gestoppt: " + device.name + " -> " + res.body);
    }
    index = index + 1;
    stopNextScript(); // Nächstes Gerät
  });
}
// Start
stopNextScript();
