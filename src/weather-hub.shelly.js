// Skript zur Vergüngstellung eines JSON-Endpunkts auf dem BT-Hub zum Abruf der Wetterdaten für andere Geräte
let SENSORS = { 
  lux: 201, 
  rain: 202,
  wind: 203,
  gust: 204,
  temp: 211
};

HTTPServer.registerEndpoint("weather", function (req, res) {
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
