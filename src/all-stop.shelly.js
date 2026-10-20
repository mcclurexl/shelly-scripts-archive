// ============================================================
// Master-Skript: Alle Skripte auf mehreren Geräten stoppen. Für Jalousien.
// ungetestet. 20.10.26. IPs der Jalousie-Aktoren einfügen.
// ============================================================

// Geräte-Liste mit IP und Script-ID konfigurieren
var devices = [
  { ip: "192.168.1.101", scriptId: 1, name: "Name1" },
  { ip: "192.168.1.102", scriptId: 2, name: "Name2" },
  { ip: "192.168.1.103", scriptId: 3, name: "Name3" }
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

  HTTP.post(url, body, function(res, err) {
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
