// Skript zur Vergüngstellung eines JSON-Endpunkts auf dem BT-Hub zum Abruf der Wetterdaten für andere Geräte
let SENSORS = { temp: 0x45, wind: 0x44, gust: 0x44, rain: 0x20, lux: 0x05 };  // IDs angepasst aus https://shelly-api-docs.shelly.cloud/docs-ble/Devices/BLU_ZB/wstation/#bthome-sensor-data-objects

HTTP.registerEndpoint("weather", function (req, res) {
  let now = Shelly.getComponentStatus("sys").unixtime;
  let keys = Object.keys(SENSORS);
  let out = { ts: now };
  for (let i = 0; i < keys.length; i++) {
    let st = Shelly.getComponentStatus("bthomesensor:" + SENSORS[keys[i]]);
    if (st && st.value !== null && st.value !== undefined) {
      out[keys[i]] = st.value;
      out[keys[i] + "_age"] = now - st.last_updated_ts;  // Alter in Sekunden
    } else {
      out[keys[i]] = null;
    }
  }
  res.code = 200;
  res.headers = [["Content-Type", "application/json"]];
  res.body = JSON.stringify(out);
  res.send();
}, null);
