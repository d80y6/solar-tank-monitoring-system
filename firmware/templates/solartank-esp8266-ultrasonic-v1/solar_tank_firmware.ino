/*
  SolarTank ESP8266 Ultrasonic Firmware Template

  This file is used as the firmware package template when a device request
  is approved. Device, endpoint, location, tank, and hardware pin values are read
  from device_config.h and hardware_profile.h, which the server generates automatically.

  Before uploading, fill in WiFi via the SOLARTANK_WIFI_SSID and
  SOLARTANK_WIFI_PASSWORD definitions below, or send the serial WIFI/PASS
  commands for a temporary test while the board has not restarted.
*/

#include "device_config.h"
#include "hardware_profile.h"

#if !defined(ESP8266)
  #error "This template targets the ESP8266 board per the hardware profile."
#endif

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <WiFiUdp.h>
#include <ArduinoOTA.h>
#include <ESP8266WebServer.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>
#include <time.h>
#include <math.h>

#ifndef SOLARTANK_WIFI_SSID
  #define SOLARTANK_WIFI_SSID ""
#endif

#ifndef SOLARTANK_WIFI_PASSWORD
  #define SOLARTANK_WIFI_PASSWORD ""
#endif

#ifndef SOLARTANK_OTA_PASSWORD
  #define SOLARTANK_OTA_PASSWORD ""
#endif

#ifndef SOLARTANK_SITE_LATITUDE
  #define SOLARTANK_SITE_LATITUDE 0
#endif

#ifndef SOLARTANK_SITE_LONGITUDE
  #define SOLARTANK_SITE_LONGITUDE 0
#endif

#ifndef SOLARTANK_REGIONAL_LABEL
  #define SOLARTANK_REGIONAL_LABEL "TREG 5"
#endif

#ifndef SOLARTANK_WILAYAH_LABEL
  #define SOLARTANK_WILAYAH_LABEL "TIF 3"
#endif

/* ===================== Network and API ===================== */
String wifiSsid = SOLARTANK_WIFI_SSID;
String wifiPass = SOLARTANK_WIFI_PASSWORD;
String apiUrl = SOLARTANK_API_BASE_URL;

String deviceId = SOLARTANK_DEVICE_CODE;
String apiKey = SOLARTANK_DEVICE_KEY;

/* ===================== Provisioning/site config ===================== */
String siteCode = SOLARTANK_SITE_CODE;
String siteName = SOLARTANK_SITE_NAME;
String areaLabel = SOLARTANK_AREA_LABEL;
String regionalLabel = SOLARTANK_REGIONAL_LABEL;
String wilayahLabel = SOLARTANK_WILAYAH_LABEL;
String deviceLabel = SOLARTANK_DEVICE_LABEL;
const unsigned long EXPECTED_REPORT_INTERVAL_SEC =
  SOLARTANK_REPORT_INTERVAL_MS >= 1000 ? SOLARTANK_REPORT_INTERVAL_MS / 1000 : 1;

const float LAT_FIXED = SOLARTANK_SITE_LATITUDE;
const float LNG_FIXED = SOLARTANK_SITE_LONGITUDE;

/* ===================== Tank config from generated package ===================== */
String tankShape = SOLARTANK_TANK_SHAPE;

const float TANK_LENGTH_CM = SOLARTANK_TANK_LENGTH_CM;
const float TANK_WIDTH_CM = SOLARTANK_TANK_WIDTH_CM;
const float TANK_HEIGHT_CM = SOLARTANK_TANK_HEIGHT_CM;
const float TANK_DIAMETER_CM = SOLARTANK_TANK_DIAMETER_CM;

const float SENSOR_MOUNT_HEIGHT_CM = SOLARTANK_SENSOR_MOUNT_HEIGHT_CM;
const float TANK_CAPACITY_LITER = SOLARTANK_TANK_CAPACITY_LITER;
const float SENSOR_TOP_OFFSET_CM = SENSOR_MOUNT_HEIGHT_CM;

const float LOW_LEVEL_PERCENT = SOLARTANK_LOW_LEVEL_PERCENT;
const float CRITICAL_LEVEL_PERCENT = SOLARTANK_CRITICAL_LEVEL_PERCENT;
const float CONSUMPTION_LITER_PER_HOUR = SOLARTANK_CONSUMPTION_LITER_PER_HOUR;

/* ===================== Device behavior ===================== */
const unsigned long POST_EVERY_MS = SOLARTANK_REPORT_INTERVAL_MS;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000UL;
const unsigned long HTTP_TIMEOUT_MS = 15000UL;
const uint8_t POST_RETRY_COUNT = 3;
const unsigned long POST_RETRY_DELAY_MS = 1200UL;
const uint8_t ULTRA_SAMPLES = 5;
const uint8_t ULTRA_MIN_VALID_SAMPLES = 1;
const unsigned long ULTRA_TIMEOUT_US = 30000UL;
const float ULTRA_MIN_RAW_CM = 2.0f;
const float ULTRA_MAX_EXTRA_CM = 25.0f;

/* ===================== Runtime state ===================== */
ESP8266WebServer server(80);

String deviceIdActive;
String mdnsHostName;
float distanceRawCm = NAN;
float distanceCm = NAN;
float fuelHeightCm = 0.0f;
float volumeLiter = 0.0f;
float volumeMinus10Liter = 0.0f;
float capacityLiter = TANK_CAPACITY_LITER;
int fillPercent = 0;
unsigned long lastPostMs = 0;

uint8_t lastUltraValidSamples = 0;
uint8_t lastUltraTimeoutSamples = 0;
uint8_t lastUltraOutOfRangeSamples = 0;

/* ===================== Helpers ===================== */
String makeDeviceId() {
  char buf[20];
  snprintf(buf, sizeof(buf), "dev-%06X", ESP.getChipId());
  return String(buf);
}

String makeHostName() {
  char buf[24];
  snprintf(buf, sizeof(buf), "solartank-%06X", ESP.getChipId());
  return String(buf);
}

String buildIngestUrl(String baseUrl) {
  baseUrl.trim();

  if (baseUrl.length() == 0) {
    return "/api/ingest";
  }

  while (baseUrl.endsWith("/")) {
    baseUrl.remove(baseUrl.length() - 1);
  }

  if (baseUrl.endsWith("/api/ingest")) {
    return baseUrl;
  }

  return baseUrl + "/api/ingest";
}

String maskSecret(String value) {
  value.trim();
  if (value.length() <= 4) return "****";
  return value.substring(0, 2) + "****" + value.substring(value.length() - 2);
}

void printConfig() {
  Serial.println("Current config:");
  Serial.print("  WiFi SSID: ");
  Serial.println(wifiSsid.length() > 0 ? wifiSsid : "(not set)");
  Serial.print("  WiFi password: ");
  Serial.println(maskSecret(wifiPass));
  Serial.print("  API URL: ");
  Serial.println(apiUrl);
  Serial.print("  Device ID: ");
  Serial.println(deviceIdActive);
  Serial.print("  Device key: ");
  Serial.println(maskSecret(apiKey));
  Serial.print("  Site: ");
  Serial.print(siteCode);
  Serial.print(" / ");
  Serial.println(siteName);
  Serial.print("  GPS: ");
  Serial.print(LAT_FIXED, 7);
  Serial.print(", ");
  Serial.println(LNG_FIXED, 7);
  Serial.print("  Tank: ");
  Serial.print(tankShape);
  Serial.print(" ");
  Serial.print(TANK_CAPACITY_LITER, 0);
  Serial.println(" L");
  Serial.println("Commands:");
  Serial.println("  SHOW");
  Serial.println("  WIFI <ssid>        (runtime only)");
  Serial.println("  PASS <password>    (runtime only)");
  Serial.println("  API <base-url-or-/api/ingest>");
  Serial.println("  DEVICE <id>");
  Serial.println("  KEY <device-key>");
}

void applySerialCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  int firstSpace = line.indexOf(' ');
  String command = firstSpace >= 0 ? line.substring(0, firstSpace) : line;
  String value = firstSpace >= 0 ? line.substring(firstSpace + 1) : "";
  command.toUpperCase();
  value.trim();

  if (command == "SHOW") {
    printConfig();
  } else if (command == "WIFI" && value.length() > 0) {
    wifiSsid = value;
    WiFi.disconnect();
    Serial.println("WiFi SSID updated for current runtime.");
  } else if (command == "PASS" && value.length() > 0) {
    wifiPass = value;
    WiFi.disconnect();
    Serial.println("WiFi password updated for current runtime.");
  } else if (command == "API" && value.length() > 0) {
    apiUrl = buildIngestUrl(value);
    Serial.println("API URL updated.");
  } else if (command == "DEVICE" && value.length() > 0) {
    deviceId = value;
    deviceIdActive = deviceId;
    Serial.println("Device ID updated.");
  } else if (command == "KEY" && value.length() > 0) {
    apiKey = value;
    Serial.println("Device key updated.");
  } else {
    Serial.println("Unknown command. Type SHOW for options.");
  }
}

void readSerialCommands() {
  while (Serial.available()) {
    applySerialCommand(Serial.readStringUntil('\n'));
  }
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  if (wifiSsid.length() == 0) {
    Serial.println("WiFi SSID is not set. Edit SOLARTANK_WIFI_SSID or send the WIFI <ssid> command.");
    return;
  }

  WiFi.disconnect();
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

  unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    yield();
  }
}

float readBatteryVoltage() {
  return 3.70f;
}

float maxFuelHeightCm() {
  return tankShape == "horizontal-cylinder" ? TANK_DIAMETER_CM : TANK_HEIGHT_CM;
}

float maxRawDistanceCm() {
  return SENSOR_TOP_OFFSET_CM + maxFuelHeightCm() + ULTRA_MAX_EXTRA_CM;
}

bool readDistanceRawMedianCm(float &outCm) {
  const uint8_t NMAX = 9;
  uint8_t sampleCount = ULTRA_SAMPLES;
  if (sampleCount < 3) sampleCount = 3;
  if ((sampleCount % 2) == 0) sampleCount += 1;
  if (sampleCount > NMAX) sampleCount = NMAX;

  float samples[NMAX];
  uint8_t validCount = 0;
  lastUltraValidSamples = 0;
  lastUltraTimeoutSamples = 0;
  lastUltraOutOfRangeSamples = 0;

  for (uint8_t i = 0; i < sampleCount; i++) {
    digitalWrite(SOLARTANK_TRIGGER_PIN, LOW);
    delayMicroseconds(3);
    digitalWrite(SOLARTANK_TRIGGER_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(SOLARTANK_TRIGGER_PIN, LOW);

    unsigned long durationUs = pulseIn(SOLARTANK_ECHO_PIN, HIGH, ULTRA_TIMEOUT_US);
    if (durationUs == 0) {
      lastUltraTimeoutSamples++;
      delay(30);
      continue;
    }

    float cm = (durationUs / 2.0f) / 29.1f;
    if (cm < ULTRA_MIN_RAW_CM || cm > maxRawDistanceCm()) {
      lastUltraOutOfRangeSamples++;
      delay(30);
      continue;
    }

    samples[validCount++] = cm;
    delay(30);
  }

  lastUltraValidSamples = validCount;

  if (validCount < ULTRA_MIN_VALID_SAMPLES) {
    return false;
  }

  for (uint8_t i = 1; i < validCount; i++) {
    float key = samples[i];
    int8_t j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  outCm = samples[validCount / 2];
  return true;
}

float calculateVolumeLiter(float heightCm) {
  if (tankShape == "horizontal-cylinder") {
    float radiusCm = TANK_DIAMETER_CM / 2.0f;
    float h = constrain(heightCm, 0.0f, TANK_DIAMETER_CM);

    if (h <= 0.0f) return 0.0f;
    if (h >= TANK_DIAMETER_CM) {
      return (PI * radiusCm * radiusCm * TANK_LENGTH_CM) / 1000.0f;
    }

    float areaCm2 =
      radiusCm * radiusCm * acos((radiusCm - h) / radiusCm) -
      (radiusCm - h) * sqrt(max(0.0f, 2.0f * radiusCm * h - h * h));
    return (areaCm2 * TANK_LENGTH_CM) / 1000.0f;
  }

  return (TANK_LENGTH_CM * TANK_WIDTH_CM * heightCm) / 1000.0f;
}

bool updateMeasurement() {
  float rawCm = NAN;
  if (!readDistanceRawMedianCm(rawCm)) {
    Serial.print("Sensor invalid: valid=");
    Serial.print(lastUltraValidSamples);
    Serial.print("/");
    Serial.print(ULTRA_SAMPLES);
    Serial.print(" timeout=");
    Serial.print(lastUltraTimeoutSamples);
    Serial.print(" out_of_range=");
    Serial.print(lastUltraOutOfRangeSamples);
    Serial.print(" max_raw=");
    Serial.print(maxRawDistanceCm(), 1);
    Serial.println(" cm");
    return false;
  }

  distanceRawCm = rawCm;
  const float maxFuelHeight = maxFuelHeightCm();

  distanceCm = rawCm - SENSOR_TOP_OFFSET_CM;
  if (distanceCm < 0.0f) distanceCm = 0.0f;
  if (distanceCm > maxFuelHeight) distanceCm = maxFuelHeight;

  fuelHeightCm = maxFuelHeight - distanceCm;
  if (fuelHeightCm < 0.0f) fuelHeightCm = 0.0f;
  if (fuelHeightCm > maxFuelHeight) fuelHeightCm = maxFuelHeight;

  capacityLiter = TANK_CAPACITY_LITER;
  volumeLiter = roundf(calculateVolumeLiter(fuelHeightCm) * 100.0f) / 100.0f;
  if (volumeLiter < 0.0f) volumeLiter = 0.0f;
  if (volumeLiter > capacityLiter) volumeLiter = capacityLiter;

  volumeMinus10Liter = volumeLiter - 10.0f;
  if (volumeMinus10Liter < 0.0f) volumeMinus10Liter = 0.0f;

  fillPercent = capacityLiter > 0.0f
    ? (int)roundf((volumeLiter / capacityLiter) * 100.0f)
    : 0;
  if (fillPercent < 0) fillPercent = 0;
  if (fillPercent > 100) fillPercent = 100;

  Serial.print("Sensor OK: raw=");
  Serial.print(distanceRawCm, 1);
  Serial.print(" cm, distance=");
  Serial.print(distanceCm, 1);
  Serial.print(" cm, H=");
  Serial.print(fuelHeightCm, 1);
  Serial.print(" cm, volume=");
  Serial.print(volumeLiter, 1);
  Serial.print(" L, fill=");
  Serial.print(fillPercent);
  Serial.println("%");

  return true;
}

String buildPayload(float battVoltage) {
  String payload = "{";
  payload += "\"device\":\"" + deviceIdActive + "\",";
  payload += "\"device_id\":\"" + deviceIdActive + "\",";
  payload += "\"device_label\":\"" + deviceLabel + "\",";
  payload += "\"expected_report_interval_sec\":" + String(EXPECTED_REPORT_INTERVAL_SEC) + ",";
  payload += "\"ts\":" + String((uint32_t)time(nullptr)) + ",";
  payload += "\"site_code\":\"" + siteCode + "\",";
  payload += "\"site_name\":\"" + siteName + "\",";
  payload += "\"area_label\":\"" + areaLabel + "\",";
  payload += "\"regional_label\":\"" + regionalLabel + "\",";
  payload += "\"wilayah_label\":\"" + wilayahLabel + "\",";
  payload += "\"lat\":" + String(LAT_FIXED, 7) + ",";
  payload += "\"lng\":" + String(LNG_FIXED, 7) + ",";
  payload += "\"tank_shape\":\"" + tankShape + "\",";
  payload += "\"tank_type\":\"" + tankShape + "\",";
  payload += "\"capacity_liter\":" + String(TANK_CAPACITY_LITER, 2) + ",";
  payload += "\"length_cm\":" + String(TANK_LENGTH_CM, 2) + ",";

  if (tankShape == "horizontal-cylinder") {
    payload += "\"diameter_cm\":" + String(TANK_DIAMETER_CM, 2) + ",";
  } else {
    payload += "\"width_cm\":" + String(TANK_WIDTH_CM, 2) + ",";
    payload += "\"height_cm\":" + String(TANK_HEIGHT_CM, 2) + ",";
  }

  payload += "\"sensor_mount_height_cm\":" + String(SENSOR_MOUNT_HEIGHT_CM, 2) + ",";
  payload += "\"low_level_percent\":" + String(LOW_LEVEL_PERCENT, 2) + ",";
  payload += "\"critical_level_percent\":" + String(CRITICAL_LEVEL_PERCENT, 2) + ",";
  payload += "\"consumption_liter_per_hour\":" + String(CONSUMPTION_LITER_PER_HOUR, 2) + ",";
  payload += "\"distance_cm\":" + String(distanceCm, 1) + ",";
  payload += "\"distance\":" + String(distanceCm, 1) + ",";
  payload += "\"dist_cm\":" + String(distanceCm, 1) + ",";
  payload += "\"dist\":" + String(distanceCm, 1) + ",";
  payload += "\"h_cm\":" + String(fuelHeightCm, 2) + ",";
  payload += "\"local_H_cm\":" + String(fuelHeightCm, 2) + ",";
  payload += "\"volume\":" + String(volumeLiter, 2) + ",";
  payload += "\"percent\":" + String(fillPercent) + ",";
  payload += "\"voltage\":" + String(battVoltage, 2) + ",";
  payload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  payload += "\"site\":{";
  payload += "\"code\":\"" + siteCode + "\",";
  payload += "\"name\":\"" + siteName + "\",";
  payload += "\"area_label\":\"" + areaLabel + "\",";
  payload += "\"regional_label\":\"" + regionalLabel + "\",";
  payload += "\"wilayah_label\":\"" + wilayahLabel + "\",";
  payload += "\"lat\":" + String(LAT_FIXED, 7) + ",";
  payload += "\"lng\":" + String(LNG_FIXED, 7);
  payload += "},";
  payload += "\"tank\":{";
  payload += "\"shape\":\"" + tankShape + "\",";
  payload += "\"type\":\"" + tankShape + "\",";
  payload += "\"capacity_liter\":" + String(TANK_CAPACITY_LITER, 2) + ",";
  payload += "\"length_cm\":" + String(TANK_LENGTH_CM, 2) + ",";

  if (tankShape == "horizontal-cylinder") {
    payload += "\"diameter_cm\":" + String(TANK_DIAMETER_CM, 2) + ",";
  } else {
    payload += "\"width_cm\":" + String(TANK_WIDTH_CM, 2) + ",";
    payload += "\"height_cm\":" + String(TANK_HEIGHT_CM, 2) + ",";
  }

  payload += "\"sensor_mount_height_cm\":" + String(SENSOR_MOUNT_HEIGHT_CM, 2);
  payload += "},";
  payload += "\"raw\":{";
  payload += "\"device\":\"" + deviceIdActive + "\",";
  payload += "\"device_id\":\"" + deviceIdActive + "\",";
  payload += "\"device_label\":\"" + deviceLabel + "\",";
  payload += "\"site_code\":\"" + siteCode + "\",";
  payload += "\"distance_raw_cm\":" + String(distanceRawCm, 1) + ",";
  payload += "\"distance_cm\":" + String(distanceCm, 1) + ",";
  payload += "\"local_H_cm\":" + String(fuelHeightCm, 2) + ",";
  payload += "\"H_cm\":" + String(fuelHeightCm, 2) + ",";
  payload += "\"local_volume_l\":" + String(volumeLiter, 2) + ",";
  payload += "\"volume\":" + String(volumeLiter, 2) + ",";
  payload += "\"local_percent\":" + String(fillPercent) + ",";
  payload += "\"percent\":" + String(fillPercent) + ",";
  payload += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"ultra_valid_samples\":" + String(lastUltraValidSamples) + ",";
  payload += "\"ultra_timeout_samples\":" + String(lastUltraTimeoutSamples) + ",";
  payload += "\"ultra_out_of_range_samples\":" + String(lastUltraOutOfRangeSamples) + ",";
  payload += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
  payload += "}}";
  return payload;
}

template <typename ClientType>
bool postTelemetryWithClient(ClientType &client, const String &payload) {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);

  if (!http.begin(client, apiUrl.c_str())) {
    Serial.println("HTTP begin failed.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", deviceIdActive);
  http.addHeader("X-Api-Key", apiKey);
  http.addHeader("X-Device-Key", apiKey);

  int code = http.POST(payload);
  Serial.print("POST ");
  Serial.print(apiUrl);
  Serial.print(" -> ");
  Serial.println(code);

  if (code > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(http.errorToString(code));
  }

  http.end();
  return code == 200 || code == 201;
}

bool postTelemetry() {
  ensureWifi();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("POST skipped: WiFi not connected.");
    return false;
  }

  String payload = buildPayload(readBatteryVoltage());
  Serial.print("Payload summary: device=");
  Serial.print(deviceIdActive);
  Serial.print(", distance_cm=");
  Serial.print(distanceCm, 1);
  Serial.print(", volume=");
  Serial.print(volumeLiter, 1);
  Serial.println(" L");

  if (apiUrl.startsWith("https://")) {
    BearSSL::WiFiClientSecure client;
    client.setInsecure();
    client.setBufferSizes(512, 512);
    client.setTimeout(HTTP_TIMEOUT_MS);
    return postTelemetryWithClient(client, payload);
  }

  WiFiClient client;
  return postTelemetryWithClient(client, payload);
}

bool postTelemetryWithRetry() {
  for (uint8_t attempt = 1; attempt <= POST_RETRY_COUNT; attempt++) {
    if (postTelemetry()) return true;

    Serial.print("POST retry ");
    Serial.print(attempt);
    Serial.print("/");
    Serial.println(POST_RETRY_COUNT);

    delay(POST_RETRY_DELAY_MS * attempt);
  }

  return false;
}

/* ===================== Local web UI ===================== */
const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SolarTank Device</title>
<style>
body{font-family:system-ui,Arial;margin:20px;line-height:1.45}
.card{max-width:720px;margin:auto;padding:16px;border:1px solid #ddd;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.tile{border:1px solid #eee;border-radius:10px;padding:12px;text-align:center}
.val{font-size:26px;font-weight:700}.label{color:#666}
footer{margin-top:10px;color:#888;font-size:12px}
</style></head><body>
<div class="card"><h1>SolarTank Device</h1><div class="grid">
<div class="tile"><div class="val" id="device">-</div><div class="label">Device</div></div>
<div class="tile"><div class="val" id="H">-</div><div class="label">Fuel height cm</div></div>
<div class="tile"><div class="val" id="dist">-</div><div class="label">Empty space cm</div></div>
<div class="tile"><div class="val" id="vol">-</div><div class="label">Volume L</div></div>
<div class="tile"><div class="val" id="pct">-</div><div class="label">Fill percent</div></div>
<div class="tile"><div class="val" id="ip">-</div><div class="label">IP</div></div>
</div><footer>JSON: /api</footer></div>
<script>
const fmt=(n,d=2)=>typeof n==='number'?n.toFixed(d):n;
async function refresh(){
  try{
    const r=await fetch('/api'); const j=await r.json();
    device.textContent=j.device;
    H.textContent=fmt(j.H_cm,2);
    dist.textContent=fmt(j.distance_cm,2);
    vol.textContent=fmt(j.volume,2);
    pct.textContent=j.percent;
    ip.textContent=j.ip;
  }catch(e){}
}
refresh(); setInterval(refresh,1000);
</script></body></html>
)HTML";

void handleIndex() {
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleAPI() {
  String json = "{";
  json += "\"device\":\"" + deviceIdActive + "\",";
  json += "\"site_code\":\"" + siteCode + "\",";
  json += "\"H_cm\":" + String(fuelHeightCm, 2) + ",";
  json += "\"distance_cm\":" + String(distanceCm, 2) + ",";
  json += "\"distance_raw_cm\":" + String(distanceRawCm, 2) + ",";
  json += "\"volume\":" + String(volumeLiter, 2) + ",";
  json += "\"volume_minus10_L\":" + String(volumeMinus10Liter, 2) + ",";
  json += "\"volume_full_L\":" + String(capacityLiter, 0) + ",";
  json += "\"percent\":" + String(fillPercent) + ",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"lat\":" + String(LAT_FIXED, 7) + ",";
  json += "\"lng\":" + String(LNG_FIXED, 7);
  json += "}";
  server.send(200, "application/json", json);
}

/* ===================== Arduino lifecycle ===================== */
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(SOLARTANK_TRIGGER_PIN, OUTPUT);
  pinMode(SOLARTANK_ECHO_PIN, INPUT);
  digitalWrite(SOLARTANK_TRIGGER_PIN, LOW);

  apiUrl = buildIngestUrl(String(SOLARTANK_API_BASE_URL));
  deviceIdActive = deviceId.length() > 0 ? deviceId : makeDeviceId();
  mdnsHostName = makeHostName();

  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  ensureWifi();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi not connected yet. Device will retry before POST.");
  }

  configTime(0, 0, "pool.ntp.org", "time.google.com");
  unsigned long ntpStartMs = millis();
  while (time(nullptr) < 8 * 3600 * 2 && millis() - ntpStartMs < 5000UL) {
    delay(250);
    yield();
  }

  ArduinoOTA.setHostname(mdnsHostName.c_str());
  if (strlen(SOLARTANK_OTA_PASSWORD) > 0) {
    ArduinoOTA.setPassword(SOLARTANK_OTA_PASSWORD);
  }
  ArduinoOTA.begin();

  if (MDNS.begin(mdnsHostName.c_str())) {
    MDNS.addService("http", "tcp", 80);
  }

  server.on("/", handleIndex);
  server.on("/api", handleAPI);
  server.begin();

  printConfig();
  Serial.println("HTTP local server started.");
}

void loop() {
  ArduinoOTA.handle();
  server.handleClient();
  MDNS.update();
  readSerialCommands();

  bool hasMeasurement = updateMeasurement();

  unsigned long nowMs = millis();
  if (hasMeasurement && nowMs - lastPostMs >= POST_EVERY_MS) {
    lastPostMs = nowMs;
    bool ok = postTelemetryWithRetry();
    Serial.println(ok ? "POST OK" : "POST FAIL");
  }

  delay(250);
}
