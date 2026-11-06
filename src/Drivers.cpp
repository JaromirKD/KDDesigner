#include "Drivers.h"
#include <Ethernet.h>
#include <mbed.h>
#include <deque>
#include "Globals.h"
#include "Log.h"
#include "Monitor.h"
#include "Mqtt.h"
#include "Net.h"
#include "Show.h"
#include "State.h"
#include "Triggers.h"
#include "Util.h"
#include "mbedtls/sha1.h"
#include "mbedtls/sha256.h"

using namespace std::chrono_literals;

namespace {

enum Type : uint8_t { Kiss, Knx, Bsign, Digi, Netio, Pharos, TypeCount };
const char* const kTypes[] = {"kissbox", "knx", "brightsign", "digidot", "netio", "pharos"};
const char* const kTypeNames[] = {"Kiss-Box", "KNX", "BrightSign", "DiGidot", "NETIO", "Pharos"};
const uint16_t kDefaultPort[] = {9813, 3671, 80, 80, 80, 80};
const uint16_t kKnxLocalPort = 3672;   // our end of the KNX tunnel
const size_t kMaxBody = 12 * 1024;     // HTTP replies are cut here (status JSON fits easily)
const size_t kMaxPoints = 200;    // a Pharos project can have many timelines, scenes and groups

int typeOf(const String& s) {
  for (int i = 0; i < TypeCount; i++) if (s.equalsIgnoreCase(kTypes[i])) return i;
  return -1;
}

struct Point { String key, name, value, dpt; };
struct Trig { int num; String name, type; };   // a Pharos trigger (fired with "pharos <dev> trigger <num>")
struct BsState { uint8_t zone; String name, file; };   // a BrightSign presentation state (kdlink plugin)
const size_t kMaxBsStates = 80, kMaxActivity = 30;
struct Drv {
  int id = 0;
  Type type = Netio;
  String name, user, pass, slots;
  IPAddress ip;
  uint16_t port = 80, udpPort = 0;
  std::vector<Point> points;
  std::vector<std::pair<String, String>> info;    // shown on the Monitoring page
  std::vector<std::pair<String, String>> links;   // point key -> variable
  std::vector<std::pair<String, uint32_t>> scenes;  // DiGidot scene name -> unique id
  std::vector<Trig> triggers;                       // Pharos
  int outputs = 0;                                  // NETIO: number of outputs of the model (for "output all")
  // live state
  bool online = false, seen = false;
  String last;
  uint32_t nextPoll = 0, lastSeen = 0, lastCheck = 0, history = 0, polls = 0;
  uint8_t checks = 0;
  // Kept by the controller: online since, drop-outs, restarts (device uptime went down).
  uint32_t onlineSince = 0, dropouts = 0, restarts = 0, lastRestart = 0, uptime = 0, lastErrorAt = 0;
  String lastError;
  // protocol state
  String token, nonce;                     // Pharos bearer token, DiGidot nonce
  uint32_t session = 0;                    // DiGidot session id
  bool up = false, connPending = false, statePending = false, pollPending = false;  // KNX tunnel, Kiss-Box poll
  uint8_t channel = 0, seq = 0, tries = 0;
  uint32_t retryAt = 0, aliveAt = 0, sentAt = 0, pollSentAt = 0, ackAt = 0;
  // KNX: one frame at a time; the next goes out once the interface acked this one.
  std::deque<std::vector<uint8_t>> txq;
  bool waitAck = false;
  // KNX: addresses are read when the tunnel opens, then follow the bus (optionally re-read every readEvery s).
  bool readDue = false;
  uint32_t readEvery = 0, lastRead = 0;
  // Live updates instead of polling: Pharos WebSocket, NETIO via our MQTT broker.
  bool push = false;
  uint8_t pushState = 0;          // 0 off, 1 waiting / connecting, 2 live
  String pushNote;
  // BrightSign: the kdlink plugin in the presentation (data/www/brightsign/kdlink.brs) on its own UDP port.
  bool plugin = false;
  uint16_t pluginPort = 5010;
  uint32_t pluginSeen = 0;        // epoch of its last packet
  std::vector<BsState> states;    // every state of every zone (test buttons)
  std::deque<std::pair<uint32_t, String>> activity;   // what the player received: serial, UDP, GPIO, zone changes
};

struct Job { int id; String method, path, body, label; };          // HTTP (method "POLL" = status poll)
struct UJob { int id; std::vector<uint8_t> data; String label; uint32_t at; };  // KNX cEMI frame or Kiss-Box bytes
using VarSets = std::vector<std::pair<String, String>>;

std::vector<Drv> list;
std::deque<Job> jobs;
std::deque<UJob> ujobs;
rtos::Mutex mtx;   // guards everything above; never held during network waits
rtos::Thread httpThread(osPriorityNormal, 10 * 1024, nullptr, "drv-http");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds
rtos::Thread udpThread(osPriorityNormal, 4 * 1024, nullptr, "drv-udp");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds
volatile uint16_t kissPort = 0;            // Kiss-Box listen port (from the first Kiss-Box)

Drv* byId(int id) {
  for (auto& d : list) if (d.id == id) return &d;
  return nullptr;
}
const Point* findPoint(const Drv& d, const String& key) {
  for (auto& p : d.points) if (p.key == key) return &p;
  return nullptr;
}
String kissSlotType(const String& slots, int idx);
// On/off readings go into the device history (a lane each in the Monitoring graph):
// 1 on, 0 off, -1 not an on/off reading (or no value).
int onOff(const Drv& d, const Point& p) {
  const String& k = p.key;
  const String& v = p.value;
  bool bin = false;
  if (d.type == Kiss) {
    int dot = k.indexOf('.');
    String t = d.slots.length() ? kissSlotType(d.slots, k.substring(0, dot).toInt() - 1) : String("out");
    bin = dot > 0 && (t == "out" || t == "in");
  } else if (d.type == Netio) {
    bin = (k.startsWith("out") && isNumber(k.substring(3))) || (k.startsWith("in") && isNumber(k.substring(2)));
  } else if (d.type == Knx) {
    bin = p.dpt.toInt() == 1;
  } else if (d.type == Bsign) {
    bin = k.startsWith("gpio");
  } else if (d.type == Pharos && (k.startsWith("tl") || k.startsWith("sc"))) {
    return !v.length() ? -1 : v == "none" || v == "released" ? 0 : 1;   // running, paused, started... = on
  }
  if (!bin) return -1;
  return v == "1" ? 1 : v == "0" ? 0 : -1;
}
// Stores a value; a linked variable follows it (applied after the lock is released).
void setPoint(Drv& d, const String& key, const String& value, const String& name, VarSets& vars) {
  Point* p = nullptr;
  for (auto& x : d.points) if (x.key == key) p = &x;
  if (!p) {
    if (d.points.size() >= kMaxPoints) return;
    d.points.push_back({key, name, "", ""});
    p = &d.points.back();
  }
  if (name.length()) p->name = name;
  if (p->value == value) return;
  int was = onOff(d, *p);
  p->value = value;
  State::changed();
  int now = onOff(d, *p);
  if (now >= 0 && now != was) Monitor::record(kTypes[d.type], d.name, ("p:" + key + "=" + String(now)).c_str());
  for (auto& l : d.links) if (l.first == key) vars.push_back({l.second, value});
}
void applyVars(const VarSets& vars) {
  for (auto& v : vars) { String msg; Globals::set(v.first, v.second, msg, true); }
}
void setInfo(Drv& d, const String& k, const String& v) {
  for (auto& i : d.info) if (i.first == k) { i.second = v; return; }
  d.info.push_back({k, v});
}
// Records a check; returns true when the online state changed (fires device triggers).
bool markCheck(Drv& d, bool ok, bool isPoll, const String& err) {
  bool was = d.online, first = !d.seen;
  d.online = ok;
  d.seen = true;
  d.lastCheck = epochNow();
  if (ok) d.lastSeen = d.lastCheck;
  if (isPoll) {
    d.history = (d.history << 1) | (ok ? 1 : 0);
    if (d.checks < 32) d.checks++;
  }
  if (ok && !was) {
    d.onlineSince = d.lastCheck;
    LOGI(Sys, "%s %s (%s) online", kTypeNames[d.type], d.name.c_str(), d.ip.toString().c_str());
  }
  if (!ok && (was || first)) LOGW(Sys, "%s %s (%s) offline: %s", kTypeNames[d.type], d.name.c_str(), d.ip.toString().c_str(), err.c_str());
  if (!ok && was) d.dropouts++;
  if (!ok) { d.lastError = err; d.lastErrorAt = d.lastCheck; }
  if (first || ok != was) Monitor::record(kTypes[d.type], d.name, ok ? "online" : "offline");   // first = the graph's baseline
  return !first && ok != was;
}
void deviceEvent(bool changed, Type type, const String& name, bool online) {
  if (changed) Monitor::pushEvent(kTypes[type], name, online);
}

// ---- Hashes and encodings ---------------------------------------------------
String b64(const String& in) {
  static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const uint8_t* s = (const uint8_t*)in.c_str();
  size_t n = in.length();
  String out;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = (uint32_t)s[i] << 16 | (i + 1 < n ? s[i + 1] << 8 : 0) | (i + 2 < n ? s[i + 2] : 0);
    out += T[(v >> 18) & 63];
    out += T[(v >> 12) & 63];
    out += i + 1 < n ? T[(v >> 6) & 63] : '=';
    out += i + 2 < n ? T[v & 63] : '=';
  }
  return out;
}
String sha1hex(const String& s) {
  uint8_t d[20];
  mbedtls_sha1_ret((const unsigned char*)s.c_str(), s.length(), d);
  return toHex(d, 20);
}
String hmacSha256hex(const String& key, const String& msg) {
  uint8_t k[64] = {0}, pad[64], inner[32], out[32];
  if (key.length() > 64) mbedtls_sha256_ret((const unsigned char*)key.c_str(), key.length(), k, 0);
  else memcpy(k, key.c_str(), key.length());
  mbedtls_sha256_context c;
  mbedtls_sha256_init(&c);
  for (int i = 0; i < 64; i++) pad[i] = k[i] ^ 0x36;
  mbedtls_sha256_starts_ret(&c, 0);
  mbedtls_sha256_update_ret(&c, pad, 64);
  mbedtls_sha256_update_ret(&c, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_sha256_finish_ret(&c, inner);
  for (int i = 0; i < 64; i++) pad[i] = k[i] ^ 0x5c;
  mbedtls_sha256_starts_ret(&c, 0);
  mbedtls_sha256_update_ret(&c, pad, 64);
  mbedtls_sha256_update_ret(&c, inner, 32);
  mbedtls_sha256_finish_ret(&c, out);
  mbedtls_sha256_free(&c);
  return toHex(out, 32);
}

// ---- HTTP client -------------------------------------------------------------
struct HttpRes { int status = 0; String body, auth; };

// One request. HTTP/1.0, so the reply is never chunked and ends when the server closes.
// The body is cut at maxBody (lists like Pharos triggers ask for more).
bool httpCall(const IPAddress& ip, uint16_t port, const String& method, const String& path, const String& headers,
              const String& body, const char* ctype, HttpRes& res, String& err, size_t maxBody = kMaxBody) {
  res = HttpRes();
  EthernetClient c;
  c.setSocketTimeout(3000);
  if (!c.connect(ip, port)) { err = "no connection"; return false; }
  String req = method + " " + path + " HTTP/1.0\r\nHost: " + ip.toString() + "\r\nUser-Agent: KD-Designer\r\n" + headers;
  if (body.length() || method == "POST" || method == "PUT")
    req += String("Content-Type: ") + ctype + "\r\nContent-Length: " + String((unsigned)body.length()) + "\r\n";
  req += "\r\n";
  c.write((const uint8_t*)req.c_str(), req.length());
  if (body.length()) c.write((const uint8_t*)body.c_str(), body.length());
  String line;
  bool inBody = false;
  long want = -1;
  uint32_t t0 = millis();
  while (millis() - t0 < 5000) {
    int a = c.available();
    if (a <= 0) {
      if (!c.connected()) break;
      rtos::ThisThread::sleep_for(5ms);
      continue;
    }
    if (inBody) {
      uint8_t buf[256];
      int n = c.read(buf, min(a, (int)sizeof buf));
      for (int i = 0; i < n && res.body.length() < maxBody; i++) res.body += (char)buf[i];
      if (want >= 0 && (long)res.body.length() >= min(want, (long)maxBody)) break;
      continue;
    }
    char ch = c.read();
    if (ch == '\r') continue;
    if (ch != '\n') { if (line.length() < 512) line += ch; continue; }
    if (!res.status) {
      if (line.startsWith("HTTP/")) res.status = line.substring(line.indexOf(' ') + 1).toInt();
    } else if (!line.length()) {
      inBody = true;
      if (want == 0) break;
    } else {
      String l = line;
      l.toLowerCase();
      if (l.startsWith("content-length:")) want = line.substring(15).toInt();
      else if (l.startsWith("www-authenticate:")) res.auth = line.substring(17);
    }
    line = "";
  }
  c.stop();
  if (!res.status) { err = "no HTTP response"; return false; }
  return true;
}

// Value of key="..." (or key=token) in a WWW-Authenticate header.
String authField(const String& h, const char* key) {
  String k = String(key) + "=";
  int at = h.indexOf(k);
  if (at < 0) return "";
  at += k.length();
  if (h[at] == '"') { int end = h.indexOf('"', at + 1); return h.substring(at + 1, end < 0 ? h.length() : end); }
  int end = h.indexOf(',', at);
  String v = h.substring(at, end < 0 ? h.length() : end);
  v.trim();
  return v;
}
String digestHeader(const String& www, const String& method, const String& uri, const String& user, const String& pass) {
  String realm = authField(www, "realm"), nonce = authField(www, "nonce"), qop = authField(www, "qop"), opaque = authField(www, "opaque");
  String ha1 = md5hex(user + ":" + realm + ":" + pass), ha2 = md5hex(method + ":" + uri);
  String cnonce = String((unsigned long)random(0x7fffffff), HEX), nc = "00000001";
  bool auth = qop.indexOf("auth") >= 0;
  String resp = auth ? md5hex(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2) : md5hex(ha1 + ":" + nonce + ":" + ha2);
  String h = "Authorization: Digest username=\"" + user + "\", realm=\"" + realm + "\", nonce=\"" + nonce + "\", uri=\"" + uri + "\", response=\"" + resp + "\"";
  if (auth) h += ", qop=auth, nc=" + nc + ", cnonce=\"" + cnonce + "\"";
  if (opaque.length()) h += ", opaque=\"" + opaque + "\"";
  return h + "\r\n";
}

// What the HTTP thread needs of a device, copied so the lock isn't held while waiting.
struct Conn {
  int id;
  Type type;
  String name, user, pass, token, nonce;
  IPAddress ip;
  uint16_t port;
  uint32_t session;
};
Conn connOf(const Drv& d) { return {d.id, d.type, d.name, d.user, d.pass, d.token, d.nonce, d.ip, d.port, d.session}; }

String pharosToken(const String& body) {
  int at = body.indexOf("\"token\"");
  if (at < 0) return "";
  int q1 = body.indexOf('"', body.indexOf(':', at) + 1), q2 = body.indexOf('"', q1 + 1);
  return q1 > 0 && q2 > q1 ? body.substring(q1 + 1, q2) : String("");
}
bool pharosLogin(Conn& c, String& err) {
  JsonDocument d;
  d["username"] = c.user;
  d["password"] = c.pass;
  String body;
  serializeJson(d, body);
  HttpRes r;
  if (!httpCall(c.ip, c.port, "POST", "/authenticate", "", body, "application/json", r, err)) return false;
  c.token = r.status == 200 ? pharosToken(r.body) : String("");
  if (!c.token.length()) { err = "login failed (check user and password)"; return false; }
  return true;
}

// A request with the device's own authentication: NETIO basic, BrightSign digest, Pharos token.
bool request(Conn& c, const String& method, const String& path, const String& body, HttpRes& r, String& err, size_t maxBody = kMaxBody) {
  String hdr;
  if (c.type == Netio && c.user.length()) hdr = "Authorization: Basic " + b64(c.user + ":" + c.pass) + "\r\n";
  if (c.type == Pharos && c.user.length()) {
    if (!c.token.length() && !pharosLogin(c, err)) return err != "no connection" && err != "no HTTP response" ? (r.status = 401, true) : false;
    hdr = "Authorization: Bearer " + c.token + "\r\n";
  }
  auto call = [&]() { return httpCall(c.ip, c.port, method, path, hdr, body, "application/json", r, err, maxBody); };
  if (!call()) return false;
  if (r.status == 401 && c.type == Bsign && r.auth.indexOf("Digest") >= 0) {
    hdr = digestHeader(r.auth, method, path, c.user.length() ? c.user : String("admin"), c.pass);
    if (!call()) return false;
  }
  if (r.status == 401 && c.type == Pharos && c.user.length()) {   // token expired (5 min idle)
    c.token = "";
    if (!pharosLogin(c, err)) return true;
    hdr = "Authorization: Bearer " + c.token + "\r\n";
    if (!call()) return false;
  }
  // Every Pharos reply carries a fresh token (each is valid for 5 minutes).
  if (c.type == Pharos) { String t = pharosToken(r.body); if (t.length()) c.token = t; }
  return true;
}

// DiGidot C4: body = <sha1 hex><json>[<hmac-sha256 hex>], see the C4 API v2 document.
bool digiRaw(Conn& c, JsonDocument& req, bool sign, HttpRes& r, String& err) {
  req["mac_address"] = "00:00:00:00:00:00";
  if (sign) {
    JsonObject a = req["auth"].to<JsonObject>();
    a["nonce"] = c.nonce;
    a["user"] = c.user;
    a["session_id"] = c.session;
  } else {
    req["session_id"] = c.session;
  }
  String msg;
  serializeJson(req, msg);
  if (sign && c.pass.length()) msg += hmacSha256hex(sha1hex(c.pass), msg);
  msg = sha1hex(msg) + msg;
  if (!httpCall(c.ip, c.port, "POST", "/ajax.json", "", msg, "application/x-www-form-urlencoded", r, err)) return false;
  // Every reply hands out the nonce for the next request.
  JsonDocument f, d;
  f["nonce"] = true;
  if (!deserializeJson(d, r.body, DeserializationOption::Filter(f)) && d["nonce"].is<const char*>()) c.nonce = d["nonce"].as<const char*>();
  return true;
}
bool digi(Conn& c, const String& json, HttpRes& r, String& err) {
  JsonDocument req;
  if (deserializeJson(req, json) || !req.is<JsonObject>()) { err = "not a JSON object"; return false; }
  if (c.user.length() && !c.nonce.length()) {
    JsonDocument n;
    n["action"] = "authenticate";
    n["subaction"] = "nonce";
    if (!digiRaw(c, n, false, r, err)) return false;
    JsonDocument chk;
    chk["action"] = "authenticate";
    chk["subaction"] = "check";
    if (!digiRaw(c, chk, true, r, err)) return false;
  }
  if (!digiRaw(c, req, c.user.length() > 0, r, err)) return false;
  if (r.body.indexOf("\"ok\"") < 0 && r.body.indexOf("auth") >= 0) c.nonce = "";   // log in again next time
  return true;
}

// ---- Status polls (HTTP devices) ---------------------------------------------
struct Update {
  std::vector<Point> points;
  std::vector<std::pair<String, String>> info;
  std::vector<std::pair<String, uint32_t>> scenes;
  bool newScenes = false;
  long uptime = -1;      // device uptime in seconds, when its API reports it
  std::vector<Trig> triggers;   // Pharos trigger list
  bool newTriggers = false;
};

// netio.json (poll) and the MQTT-flex ${INOUT_STATUS} payload have the same layout.
void parseNetio(JsonDocument& d, Update& u);
void pollNetio(Conn& c, Update& u, String& err, bool& ok) {
  HttpRes r;
  ok = request(c, "GET", "/netio.json", "", r, err);
  if (!ok) return;
  if (r.status != 200) { err = "HTTP " + String(r.status) + (r.status == 401 ? " (user/password)" : r.status == 404 ? " (JSON API not enabled)" : ""); return; }
  JsonDocument d;
  if (deserializeJson(d, r.body)) { err = "bad netio.json"; return; }
  parseNetio(d, u);
}
void parseNetio(JsonDocument& d, Update& u) {
  JsonObject a = d["Agent"];
  if (a) {
    u.info.push_back({"Model", String(a["Model"] | "") + " " + (a["DeviceName"] | "")});
    u.info.push_back({"Firmware", a["Version"] | ""});
    u.info.push_back({"Serial", a["SerialNumber"] | (a["MAC"] | "")});
    if (a["Uptime"].is<uint32_t>()) u.uptime = a["Uptime"].as<uint32_t>();
    if (a["Time"].is<const char*>()) u.info.push_back({"Device clock", a["Time"].as<const char*>()});
  }
  JsonObject g = d["GlobalMeasure"];
  if (g["Voltage"].is<float>()) u.info.push_back({"Mains", String(g["Voltage"].as<float>(), 1) + " V · " + String(g["Frequency"] | 0.0f, 2) + " Hz"});
  if (g["TotalLoad"].is<float>()) u.info.push_back({"Total load", String(g["TotalLoad"].as<float>(), 0) + " W"});
  for (JsonObject o : d["Outputs"].as<JsonArray>()) {
    String id = String(o["ID"] | 0), name = o["Name"] | "";
    if (!name.length()) name = "Output " + id;
    u.points.push_back({"out" + id, name, String(o["State"] | 0), ""});
    if (o["Load"].is<float>()) u.points.push_back({"load" + id, name + " load (W)", String(o["Load"].as<float>(), 0), ""});
  }
  for (JsonObject o : d["Inputs"].as<JsonArray>()) {
    String id = String(o["ID"] | 0), name = o["Name"] | "";
    if (!name.length()) name = "Input " + id;
    u.points.push_back({"in" + id, name, String(o["State"] | 0), ""});
    float t = o["TemperatureC"] | 999.0f;
    if (t < 998) u.points.push_back({"temp" + id, name + " °C", String(t, 1), ""});
  }
}

void pollBsign(Conn& c, Update& u, String& err, bool& ok) {
  HttpRes r;
  ok = request(c, "GET", "/api/v1/info", "", r, err);
  if (!ok) return;
  if (r.status != 200) { err = "HTTP " + String(r.status) + (r.status == 401 ? " (DWS password)" : ""); return; }
  JsonDocument f, d;
  JsonObject fr = f["data"]["result"].to<JsonObject>();
  for (const char* k : {"model", "serial", "FWVersion", "bootVersion", "upTime", "upTimeSeconds", "connectionType", "family"}) fr[k] = true;
  fr["networking"]["result"]["name"] = true;
  fr["power"]["result"]["source"] = true;
  if (deserializeJson(d, r.body, DeserializationOption::Filter(f))) { err = "bad info reply"; return; }
  JsonObject x = d["data"]["result"];
  u.info.push_back({"Model", x["model"] | ""});
  u.info.push_back({"Serial", x["serial"] | ""});
  u.info.push_back({"Firmware", x["FWVersion"] | ""});
  u.info.push_back({"Boot version", x["bootVersion"] | ""});
  u.info.push_back({"Connection", x["connectionType"] | ""});
  if (x["networking"]["result"]["name"].is<const char*>()) u.info.push_back({"Player name", x["networking"]["result"]["name"].as<const char*>()});
  if (x["upTimeSeconds"].is<uint32_t>()) u.uptime = x["upTimeSeconds"].as<uint32_t>();
  else if (x["upTime"].is<const char*>()) u.info.push_back({"Uptime", x["upTime"].as<const char*>()});
  if (x["power"]["result"]["source"].is<const char*>()) u.info.push_back({"Power", x["power"]["result"]["source"].as<const char*>()});
}

void pollPharos(Conn& c, Update& u, String& err, bool& ok) {
  HttpRes r;
  ok = request(c, "GET", "/api/system", "", r, err);
  if (!ok) return;
  if (r.status != 200) { err = r.status == 401 ? String("login failed (check user and password)") : "HTTP " + String(r.status); return; }
  JsonDocument d;
  if (!deserializeJson(d, r.body)) {
    u.info.push_back({"Model", d["hardware_type"] | ""});
    u.info.push_back({"Firmware", d["firmware_version"] | ""});
    u.info.push_back({"Serial", d["serial_number"] | ""});
    u.info.push_back({"Last boot", d["last_boot_time"] | ""});
    u.info.push_back({"Reset reason", d["reset_reason"] | ""});   // why it last restarted, e.g. "Software Reset"
    u.info.push_back({"Memory", String(d["memory_used"] | "?") + " used of " + (d["memory_total"] | "?")});
    if (d["lua_memory_used"].is<const char*>()) u.info.push_back({"Lua memory", String(d["lua_memory_used"] | "") + " of " + (d["lua_memory_allowed"] | "")});
  }
  if (request(c, "GET", "/api/time", "", r, err) && r.status == 200 && !deserializeJson(d, r.body) && d["uptime"].is<uint32_t>())
    u.uptime = d["uptime"].as<uint32_t>() / 1000;   // milliseconds since boot
  if (request(c, "GET", "/api/project", "", r, err) && r.status == 200 && !deserializeJson(d, r.body)) {
    u.info.push_back({"Project", d["name"] | ""});
    u.info.push_back({"Project file", String(d["filename"] | "") + " (uploaded " + (d["upload_date"] | "?") + ")"});
  }
  if (request(c, "GET", "/api/temperature", "", r, err) && r.status == 200 && !deserializeJson(d, r.body)) {
    String t;
    for (JsonPair kv : d.as<JsonObject>())
      if (kv.value().is<float>()) t += (t.length() ? " · " : "") + String(kv.value().as<float>(), 1) + " °C";
    if (t.length()) u.info.push_back({"Temperature", t});
  }
  if (request(c, "GET", "/api/fan_speed", "", r, err) && r.status == 200 && !deserializeJson(d, r.body) && d["fan_speed"].is<JsonObject>())
    u.info.push_back({"Fans", String(d["fan_speed"]["fan_1"] | 0) + " / " + String(d["fan_speed"]["fan_2"] | 0) + " rpm"});
  // Lists: only the fields we show are kept (filter), the rest of each object is skipped while parsing.
  auto list = [&](const char* path, const char* key, std::function<void(JsonObject)> each) {
    if (!request(c, "GET", path, "", r, err, 48 * 1024) || r.status != 200) return;
    JsonDocument f;
    for (const char* k : {"num", "name", "state", "level", "type"}) f[key][0][k] = true;
    if (!deserializeJson(d, r.body, DeserializationOption::Filter(f)))
      for (JsonObject o : d[key].as<JsonArray>()) each(o);
  };
  String playing;
  list("/api/timeline", "timelines", [&](JsonObject t) {
    String n = String(t["num"] | 0), state = t["state"] | "";
    u.points.push_back({"tl" + n, "Timeline " + n + " " + (t["name"] | ""), state, ""});
    if (state == "running") playing += (playing.length() ? ", " : "") + String(t["name"] | n.c_str());
  });
  u.info.push_back({"Playing", playing.length() ? playing : String("nothing")});
  list("/api/scene", "scenes", [&](JsonObject s) {
    String n = String(s["num"] | 0);
    u.points.push_back({"sc" + n, "Scene " + n + " " + (s["name"] | ""), s["state"] | "", ""});
  });
  list("/api/group", "groups", [&](JsonObject g) {
    String n = String(g["num"] | 0);
    u.points.push_back({"grp" + n, String(g["name"] | ("Group " + n).c_str()) + " (%)", String(g["level"] | 0), ""});
  });
  u.newTriggers = true;
  list("/api/trigger", "triggers", [&](JsonObject t) {
    if (u.triggers.size() < 150) u.triggers.push_back({t["num"] | 0, t["name"] | "", t["type"] | ""});
  });
  err = "";
}

void pollDigi(Conn& c, Update& u, String& err, bool& ok, uint32_t polls, const std::vector<std::pair<String, uint32_t>>& scenes) {
  HttpRes r;
  JsonDocument d;
  // Scene list (5 per page) and device details now and then: they rarely change.
  bool full = scenes.empty() || polls % 10 == 0;
  if (full) {
    u.newScenes = true;
    for (int off = 0; off < 40; off += 5) {
      ok = digi(c, "{\"action\":\"scene_manager\",\"subaction\":\"list\",\"length\":5,\"offset\":" + String(off) + "}", r, err);
      if (!ok || deserializeJson(d, r.body)) break;
      JsonArray l = d["list"];
      for (JsonObject s : l) u.scenes.push_back({s["name"] | "", (uint32_t)strtoul(s["filename"] | "0", nullptr, 16)});
      if (l.size() < 5) break;
    }
    if (!ok) return;
    if (digi(c, "{\"action\":\"settings\",\"subaction\":\"get\"}", r, err) && !deserializeJson(d, r.body))
      u.info.push_back({"Device name", d["settings"]["name"] | ""});
    if (digi(c, "{\"action\":\"license\",\"subaction\":\"get\"}", r, err) && !deserializeJson(d, r.body))
      u.info.push_back({"Serial", d["serial_number"] | ""});
  }
  ok = digi(c, "{\"action\":\"scene_manager\",\"subaction\":\"state\"}", r, err);
  if (!ok) return;
  const auto& names = full ? u.scenes : scenes;
  if (!deserializeJson(d, r.body)) {
    JsonObject s = d["scene"][0];
    String scene = "-";
    if (s) {
      uint32_t uid = s["unique_id"] | 0;
      scene = String(uid);
      for (auto& n : names) if (n.second == uid) scene = n.first;
      u.points.push_back({"speed", "Speed (%)", String(s["speed"] | 100), ""});
      u.points.push_back({"paused", "Paused", (s["paused"] | false) ? "1" : "0", ""});
    }
    u.points.push_back({"scene", "Scene playing", scene, ""});
  }
  if (digi(c, "{\"action\":\"fader\",\"type\":\"master_fader\"}", r, err) && !deserializeJson(d, r.body))
    u.points.push_back({"master", "Master (%)", String((int)lround((d["master_fader"]["value"] | 0) * 100.0 / 65535)), ""});
  if (digi(c, "{\"action\":\"status\",\"get\":[\"performance\"]}", r, err) && !deserializeJson(d, r.body)) {
    JsonObject p = d["performance"];
    if (p) {
      u.info.push_back({"Memory", String(p["memory_used"] | 0) + " of " + String(p["memory_total"] | 0) + " bytes"});
      u.info.push_back({"Frame rates", "Art-Net " + String(p["artnet_fps"] | 0) + " fps · scenes " + String(p["scene_fps"] | 0) + " fps"});
    }
  }
  err = "";
}

String preview(const String& s) {
  String p = s.substring(0, 120);
  p.replace("\r", " ");
  p.replace("\n", " ");
  return p;
}

// Stores a poll result or a pushed status (caller holds mtx).
void applyUpdate(Drv& d, const Update& u, bool ok, VarSets& vars) {
  for (auto& i : u.info) if (i.second.length()) setInfo(d, i.first, i.second);
  for (auto& p : u.points) setPoint(d, p.key, p.value, p.name, vars);
  if (u.newScenes && ok) d.scenes = u.scenes;
  if (u.newTriggers && ok && !u.triggers.empty()) d.triggers = u.triggers;
  if (u.uptime >= 0) {
    // Uptime went down (with a minute's margin for clock jitter): the device restarted -
    // a crash, a power cut or someone rebooting it - even if we never saw it go offline.
    if (d.uptime && (uint32_t)u.uptime + 60 < d.uptime) {
      d.restarts++;
      d.lastRestart = epochNow() - u.uptime;
      LOGW(Sys, "%s %s restarted (uptime %lu s, was %lu s)", kTypeNames[d.type], d.name.c_str(), (unsigned long)u.uptime, (unsigned long)d.uptime);
    }
    d.uptime = u.uptime;
  }
}

// Runs one queued command or a status poll in the HTTP thread.
void execHttp(const Job& job) {
  mtx.lock();
  Drv* dp = byId(job.id);
  if (!dp) { mtx.unlock(); return; }
  Conn c = connOf(*dp);
  uint32_t polls = dp->polls;
  auto scenes = dp->scenes;
  mtx.unlock();

  bool isPoll = job.method == "POLL", ok = false;
  String err, result;
  Update u;
  if (isPoll) {
    if (c.type == Netio) pollNetio(c, u, err, ok);
    else if (c.type == Bsign) pollBsign(c, u, err, ok);
    else if (c.type == Pharos) pollPharos(c, u, err, ok);
    else if (c.type == Digi) pollDigi(c, u, err, ok, polls, scenes);
  } else {
    HttpRes r;
    ok = c.type == Digi ? digi(c, job.body, r, err) : request(c, job.method, job.path, job.body, r, err);
    if (ok) {
      bool good = r.status >= 200 && r.status < 300 && (c.type != Digi || r.body.indexOf("\"ok\"") >= 0);
      result = job.label + " -> ";
      if (c.type != Digi) result += String(r.status) + " ";
      result += preview(r.body);
      if (good) LOGI(Sys, "%s %s: %s", kTypeNames[c.type], c.name.c_str(), result.c_str());
      else LOGW(Sys, "%s %s: %s", kTypeNames[c.type], c.name.c_str(), result.c_str());
    } else {
      result = job.label + " failed: " + err;
      LOGW(Sys, "%s %s: %s", kTypeNames[c.type], c.name.c_str(), result.c_str());
    }
  }

  VarSets vars;
  bool changed = false;
  mtx.lock();
  dp = byId(job.id);
  if (dp) {
    dp->token = c.token;
    dp->nonce = c.nonce;
    // A BrightSign whose DWS can't be reached (off, or https only) is still online while its plugin answers.
    if (isPoll && !ok && dp->plugin && dp->pluginSeen && epochNow() - dp->pluginSeen <= 2 * Monitor::intervalMs() / 1000 + 10) {
      setInfo(*dp, "DWS", err);
      ok = true;
      err = "";
    }
    changed = markCheck(*dp, ok, isPoll, err);
    if (isPoll) {
      dp->polls++;
      applyUpdate(*dp, u, ok, vars);
      if (err.length()) dp->last = err;
    } else {
      dp->last = result;
      dp->nextPoll = millis() + 1500;   // show the effect of the command soon
    }
  }
  mtx.unlock();
  applyVars(vars);
  deviceEvent(changed, c.type, c.name, ok);
}

void runHttp() {
  rtos::ThisThread::sleep_for(4s);   // let the network come up
  for (;;) {
    mtx.lock();
    bool have = !jobs.empty();
    Job job;
    IPAddress helloIp;
    uint16_t helloPort = 0;
    if (have) { job = jobs.front(); jobs.pop_front(); }
    if (!have) {
      uint32_t now = millis();
      for (auto& d : list)
        if (d.type != Kiss && d.type != Knx && (int32_t)(now - d.nextPoll) >= 0) {
          d.nextPoll = now + Monitor::intervalMs();
          job = {d.id, "POLL", "", "", ""};
          have = true;
          if (d.plugin) { helloIp = d.ip; helloPort = d.pluginPort; }
          break;
        }
    }
    mtx.unlock();
    // The plugin answers a hello with everything (and keeps sending changes for 10 minutes).
    // Sent from the trigger port, so its packets come back through Drivers::onUdp.
    if (helloPort) {
      g_engine.lock();
      Triggers::sendRaw(helloIp, helloPort, (const uint8_t*)"kd\thello", 8);
      g_engine.unlock();
    }
    if (have) execHttp(job);
    else rtos::ThisThread::sleep_for(100ms);
  }
}

// ---- KNX (KNXnet/IP tunnelling) -----------------------------------------------
EthernetUDP knxSock, kissSock;
bool knxOpen = false;
uint16_t kissOpen = 0;

uint16_t parseGa(const String& s) {
  int a = s.indexOf('/'), b = s.indexOf('/', a + 1);
  if (a < 0) return isNumber(s) ? (uint16_t)s.toInt() : 0;
  if (b < 0) return (s.toInt() & 0x1f) << 11 | (s.substring(a + 1).toInt() & 0x7ff);
  return (s.toInt() & 0x1f) << 11 | (s.substring(a + 1, b).toInt() & 0x7) << 8 | (s.substring(b + 1).toInt() & 0xff);
}
String gaText(uint16_t ga) { return String(ga >> 11) + "/" + String((ga >> 8) & 7) + "/" + String(ga & 0xff); }

// DPT 9: 16-bit float, 0.01 * mantissa * 2^exponent.
uint16_t toF16(float v) {
  float m = v * 100;
  int e = 0;
  while ((m < -2048 || m > 2047) && e < 15) { m /= 2; e++; }
  int mi = (int)lroundf(m);
  return (mi < 0 ? 0x8000 : 0) | (e << 11) | (mi & 0x7ff);
}
float fromF16(uint16_t raw) {
  int m = raw & 0x7ff;
  if (raw & 0x8000) m -= 2048;
  return 0.01f * m * (1 << ((raw >> 11) & 0xf));
}
bool truthy(const String& v, bool& out) {
  String l = v;
  l.toLowerCase();
  if (l == "on" || l == "1" || l == "true" || l == "yes" || l == "up" || l == "open") { out = true; return true; }
  if (l == "off" || l == "0" || l == "false" || l == "no" || l == "down" || l == "close" || l == "closed") { out = false; return true; }
  return false;
}
// Encodes a value for a datapoint type. small = 6-bit value inside the APCI byte.
bool knxEncode(const String& dpt, const String& v, std::vector<uint8_t>& data, bool& small, String& err) {
  int main = dpt.toInt();
  String sub = dpt.indexOf('.') > 0 ? dpt.substring(dpt.indexOf('.') + 1) : String("");
  small = false;
  data.clear();
  double n = v.toDouble();
  bool b;
  switch (main) {
    case 1: if (!truthy(v, b)) { err = "expected on/off"; return false; } small = true; data.push_back(b); return true;
    case 2: small = true; data.push_back(v.toInt() & 3); return true;
    case 3: {   // dimming / blinds: up|down|stop, or a raw 0-15 step code
      String l = v;
      l.toLowerCase();
      small = true;
      data.push_back(l == "up" || l == "brighter" ? 0x09 : l == "down" || l == "darker" ? 0x01 : l == "stop" ? 0x00 : (v.toInt() & 0x0f));
      return true;
    }
    case 5:
      if (sub == "001" || sub == "1" || sub == "") data.push_back((uint8_t)constrain(lround(n * 255 / 100), 0L, 255L));   // percent
      else if (sub == "003") data.push_back((uint8_t)constrain(lround(n * 255 / 360), 0L, 255L));                    // angle
      else data.push_back((uint8_t)constrain((long)n, 0L, 255L));
      return true;
    case 6: data.push_back((uint8_t)(int8_t)constrain((long)n, -128L, 127L)); return true;
    case 7: { uint16_t x = (uint16_t)constrain((long)n, 0L, 65535L); data = {(uint8_t)(x >> 8), (uint8_t)x}; return true; }
    case 8: { int16_t x = (int16_t)constrain((long)n, -32768L, 32767L); data = {(uint8_t)((uint16_t)x >> 8), (uint8_t)x}; return true; }
    case 9: { uint16_t x = toF16((float)n); data = {(uint8_t)(x >> 8), (uint8_t)x}; return true; }
    case 12: case 13: { uint32_t x = main == 12 ? (uint32_t)n : (uint32_t)(int32_t)n; data = {(uint8_t)(x >> 24), (uint8_t)(x >> 16), (uint8_t)(x >> 8), (uint8_t)x}; return true; }
    case 14: { float f = (float)n; uint32_t x; memcpy(&x, &f, 4); data = {(uint8_t)(x >> 24), (uint8_t)(x >> 16), (uint8_t)(x >> 8), (uint8_t)x}; return true; }
    case 16: for (int i = 0; i < 14; i++) data.push_back(i < (int)v.length() ? (uint8_t)v[i] : 0); return true;
    case 17: case 18: data.push_back((uint8_t)(constrain(v.toInt(), 1L, 64L) - 1)); return true;   // scene 1-64
    case 232: {
      String h = v.startsWith("#") ? v.substring(1) : v;
      if (h.length() != 6) { err = "expected #rrggbb"; return false; }
      uint32_t x = strtoul(h.c_str(), nullptr, 16);
      data = {(uint8_t)(x >> 16), (uint8_t)(x >> 8), (uint8_t)x};
      return true;
    }
  }
  err = "unsupported DPT '" + dpt + "' (use 1, 2, 3, 5, 5.001, 5.010, 6, 7, 8, 9, 12, 13, 14, 16, 17, 18, 232)";
  return false;
}
String knxDecode(const String& dpt, const uint8_t* d, int n, uint8_t small) {
  int main = dpt.toInt();
  String sub = dpt.indexOf('.') > 0 ? dpt.substring(dpt.indexOf('.') + 1) : String("");
  if (n == 0) return main == 1 ? String(small & 1) : String(small);
  uint32_t u = 0;
  for (int i = 0; i < n && i < 4; i++) u = u << 8 | d[i];
  switch (main) {
    case 5: return sub == "001" || sub == "1" || sub == "" ? String((int)lround(d[0] * 100.0 / 255)) : sub == "003" ? String((int)lround(d[0] * 360.0 / 255)) : String(d[0]);
    case 6: return String((int8_t)d[0]);
    case 7: return String((uint16_t)u);
    case 8: return String((int16_t)u);
    case 9: return n >= 2 ? String(fromF16((uint16_t)u), 2) : String("?");
    case 12: return String((unsigned long)u);
    case 13: return String((long)(int32_t)u);
    case 14: { float f; memcpy(&f, &u, 4); return String(f, 3); }
    case 16: { String s; for (int i = 0; i < n && d[i]; i++) s += (char)d[i]; return s; }
    case 17: case 18: return String((d[0] & 0x3f) + 1);
    case 232: { char b[8]; snprintf(b, sizeof b, "#%02x%02x%02x", d[0], n > 1 ? d[1] : 0, n > 2 ? d[2] : 0); return b; }
  }
  return toHex(d, n);
}
// cEMI L_Data.req for a group read or write.
std::vector<uint8_t> knxFrame(uint16_t ga, bool write, const std::vector<uint8_t>& data, bool small) {
  std::vector<uint8_t> f = {0x11, 0x00, 0xBC, 0xE0, 0x00, 0x00, (uint8_t)(ga >> 8), (uint8_t)ga};
  if (!write) { f.insert(f.end(), {0x01, 0x00, 0x00}); return f; }
  if (small) { f.insert(f.end(), {0x01, 0x00, (uint8_t)(0x80 | (data.empty() ? 0 : data[0] & 0x3f))}); return f; }
  f.push_back((uint8_t)(1 + data.size()));
  f.push_back(0x00);
  f.push_back(0x80);
  f.insert(f.end(), data.begin(), data.end());
  return f;
}
void udpSend(EthernetUDP& sock, const Drv& d, const uint8_t* p, size_t n) {
  sock.beginPacket(d.ip, d.port);
  sock.write(p, n);
  sock.endPacket();
}
void knxSend(const Drv& d, const uint8_t* p, size_t n) { udpSend(knxSock, d, p, n); }
// Header + one HPAI (our IP and tunnel port) helper for connect / state / disconnect.
void knxCtrl(const Drv& d, uint16_t service) {
  IPAddress me = Net::localIP();
  uint8_t hpai[8] = {0x08, 0x01, me[0], me[1], me[2], me[3], kKnxLocalPort >> 8, kKnxLocalPort & 0xff};
  uint8_t p[26];
  size_t n = 0;
  p[n++] = 0x06; p[n++] = 0x10; p[n++] = service >> 8; p[n++] = service & 0xff; p[n++] = 0; p[n++] = 0;
  if (service == 0x0205) {   // connect: control + data endpoint, tunnel on the link layer
    memcpy(p + n, hpai, 8); n += 8;
    memcpy(p + n, hpai, 8); n += 8;
    p[n++] = 0x04; p[n++] = 0x04; p[n++] = 0x02; p[n++] = 0x00;
  } else {
    p[n++] = d.channel; p[n++] = 0;
    memcpy(p + n, hpai, 8); n += 8;
  }
  p[5] = n;
  knxSend(d, p, n);
}
// The sequence number only moves on once the interface acked (a repeat keeps it).
void knxTunnel(Drv& d, const std::vector<uint8_t>& cemi) {
  std::vector<uint8_t> p = {0x06, 0x10, 0x04, 0x20, 0, 0, 0x04, d.channel, d.seq, 0x00};
  p.insert(p.end(), cemi.begin(), cemi.end());
  p[4] = p.size() >> 8;
  p[5] = p.size() & 0xff;
  knxSend(d, p.data(), p.size());
}
// Incoming tunnel frames: group writes/responses (others' and our own confirmations).
void knxCemi(Drv& d, const uint8_t* c, int n, VarSets& vars) {
  if (n < 2 || (c[0] != 0x29 && c[0] != 0x2E)) return;
  int at = 2 + c[1];
  if (n < at + 9 || !(c[at + 1] & 0x80)) return;   // group addresses only
  uint16_t ga = c[at + 4] << 8 | c[at + 5];
  int len = c[at + 6];
  int apci = (c[at + 7] & 0x03) << 2 | c[at + 8] >> 6;
  if (apci != 1 && apci != 2) return;   // response or write
  String key = gaText(ga);
  const Point* p = findPoint(d, key);
  if (!p) { LOGD(Sys, "KNX %s: %s (not in the address list)", d.name.c_str(), key.c_str()); return; }
  int dn = len > 1 ? min(len - 1, n - (at + 9)) : 0;
  setPoint(d, key, knxDecode(p->dpt, c + at + 9, dn, c[at + 8] & 0x3f), "", vars);
}
void knxPacket(Drv& d, const uint8_t* p, int n, std::vector<std::pair<int, bool>>& events, VarSets& vars) {
  if (n < 8 || p[0] != 0x06) return;
  uint16_t svc = p[2] << 8 | p[3];
  uint32_t now = millis();
  if (svc == 0x0206) {           // connect response
    d.connPending = false;
    if (p[7] == 0) {
      d.up = true;
      d.channel = p[6];
      d.seq = 0;
      d.waitAck = false;
      d.aliveAt = now;
      d.readDue = true;          // read the addresses straight away
      d.pushState = 2;
      LOGI(Sys, "KNX %s: tunnel open (channel %u)", d.name.c_str(), d.channel);
      if (markCheck(d, true, false, "")) events.push_back({d.id, true});
    } else {
      d.last = p[7] == 0x24 ? String("interface has no free tunnel (E_NO_MORE_CONNECTIONS)") : "connect refused (code 0x" + String(p[7], HEX) + ")";
      LOGW(Sys, "KNX %s: %s", d.name.c_str(), d.last.c_str());
      d.retryAt = now + 10000;
    }
  } else if (svc == 0x0208 && p[6] == d.channel) {   // connection state response
    d.statePending = false;
    if (p[7] == 0) d.aliveAt = now;
    else { d.up = false; d.retryAt = now + 1000; }
  } else if (svc == 0x0421 && n >= 10 && p[7] == d.channel && p[8] == d.seq && d.waitAck) {   // our frame arrived
    d.waitAck = false;
    d.seq++;
    if (!d.txq.empty()) d.txq.pop_front();
  } else if (svc == 0x0209) {    // the interface closes the tunnel
    uint8_t r[8] = {0x06, 0x10, 0x02, 0x0A, 0x00, 0x08, p[6], 0x00};
    knxSend(d, r, 8);
    d.up = d.waitAck = false;
    d.retryAt = now + 2000;
    LOGW(Sys, "KNX %s: tunnel closed by the interface", d.name.c_str());
  } else if (svc == 0x0420 && n > 10 && p[7] == d.channel) {   // tunnelling request: ack, then read
    uint8_t ack[10] = {0x06, 0x10, 0x04, 0x21, 0x00, 0x0A, 0x04, d.channel, p[8], 0x00};
    knxSend(d, ack, 10);
    d.aliveAt = now;
    knxCemi(d, p + 10, n - 10, vars);
  }
}

// ---- Kiss-Box ---------------------------------------------------------------
// Box -> us: $A1 slot v1..v8 (all channels) or $A3 slot channel value.
void kissPacket(Drv& d, const uint8_t* p, int n, VarSets& vars) {
  String slot = String(n > 1 ? p[1] + 1 : 0);
  if (p[0] == 0xA1 && n >= 10)
    for (int i = 0; i < 8; i++) setPoint(d, slot + "." + String(i + 1), String(p[2 + i]), "", vars);
  else if (p[0] == 0xA3 && n >= 4)
    setPoint(d, slot + "." + String(p[2] + 1), String(p[3]), "", vars);
}
String kissSlotType(const String& slots, int idx) {
  int at = 0;
  for (int i = 0; i < idx; i++) { at = slots.indexOf(',', at); if (at < 0) return ""; at++; }
  int end = slots.indexOf(',', at);
  String s = slots.substring(at, end < 0 ? slots.length() : end);
  s.trim();
  s.toLowerCase();
  return s;
}
void kissSend(const Drv& d, const uint8_t* p, size_t n) { udpSend(kissSock, d, p, n); }

void runUdp() {
  rtos::ThisThread::sleep_for(4s);
  uint8_t buf[600];
  for (;;) {
    uint32_t now = millis();
    std::vector<std::pair<int, bool>> events;   // driver id, online
    VarSets vars;
    mtx.lock();
    bool haveKnx = false;
    for (auto& d : list) haveKnx |= d.type == Knx;
    if (haveKnx && !knxOpen) {
      knxOpen = knxSock.begin(kKnxLocalPort);
      if (!knxOpen) LOGW(Sys, "KNX: cannot open UDP port %u", kKnxLocalPort);
    }
    if (kissPort != kissOpen) {
      if (kissOpen) kissSock.stop();
      kissOpen = kissPort;
      if (kissOpen && !kissSock.begin(kissOpen)) LOGW(Sys, "Kiss-Box: cannot listen on UDP port %u", kissOpen);
    }
    // Queued frames. KNX ones wait (up to 10 s) for the tunnel.
    for (auto it = ujobs.begin(); it != ujobs.end();) {
      Drv* d = byId(it->id);
      if (!d) { it = ujobs.erase(it); continue; }
      if (d->type == Knx && !d->up) {
        if (now - it->at > 10000) { LOGW(Sys, "KNX %s: %s dropped (no tunnel)", d->name.c_str(), it->label.c_str()); d->last = it->label + " failed: no tunnel"; it = ujobs.erase(it); }
        else ++it;
        continue;
      }
      if (d->type == Knx) { if (d->txq.size() < 64) d->txq.push_back(it->data); }
      else if (kissOpen) kissSend(*d, it->data.data(), it->data.size());
      d->last = it->label + " sent";
      LOGI(Sys, "%s %s: %s", kTypeNames[d->type], d->name.c_str(), it->label.c_str());
      it = ujobs.erase(it);
    }
    // Received packets, matched to a device by IP.
    if (knxOpen)
      for (int len; (len = knxSock.parsePacket()) > 0;) {
        int n = knxSock.read(buf, min(len, (int)sizeof buf));
        IPAddress from = knxSock.remoteIP();
        for (auto& d : list) if (d.type == Knx && d.ip == from) { knxPacket(d, buf, n, events, vars); break; }
      }
    if (kissOpen)
      for (int len; (len = kissSock.parsePacket()) > 0;) {
        int n = kissSock.read(buf, min(len, (int)sizeof buf));
        IPAddress from = kissSock.remoteIP();
        for (auto& d : list)
          if (d.type == Kiss && d.ip == from) {
            if (d.pollPending) { d.pollPending = false; if (markCheck(d, true, true, "")) events.push_back({d.id, true}); }
            else if (!d.online && markCheck(d, true, false, "")) events.push_back({d.id, true});
            kissPacket(d, buf, n, vars);
            break;
          }
      }
    // Timers: tunnel keep-alive, polls.
    for (auto& d : list) {
      if (d.type == Knx && knxOpen) {
        if (!d.up && (int32_t)(now - d.retryAt) >= 0) {
          if (d.connPending && markCheck(d, false, false, "no answer to the tunnel request")) events.push_back({d.id, false});
          knxCtrl(d, 0x0205);
          d.connPending = true;
          d.retryAt = now + 10000;
        }
        if (d.up && !d.statePending && now - d.aliveAt > 60000) { knxCtrl(d, 0x0207); d.statePending = true; d.sentAt = now; }
        if (d.up && d.statePending && now - d.sentAt > 10000) {
          d.up = d.statePending = d.waitAck = false;
          d.retryAt = now;
          if (markCheck(d, false, false, "tunnel keep-alive lost")) events.push_back({d.id, false});
        }
        if (d.up && !d.txq.empty()) {
          if (!d.waitAck) { knxTunnel(d, d.txq.front()); d.waitAck = true; d.tries = 1; d.ackAt = now; }
          else if (now - d.ackAt > 1000 && d.tries < 2) { knxTunnel(d, d.txq.front()); d.tries++; d.ackAt = now; }
          else if (now - d.ackAt > 1000) {
            // No ack after a repeat: the spec says the tunnel is broken, so open a new one.
            d.txq.pop_front();
            d.up = d.waitAck = false;
            d.retryAt = now;
            LOGW(Sys, "KNX %s: no ack from the interface - reconnecting", d.name.c_str());
          }
        }
        if ((int32_t)(now - d.nextPoll) >= 0) {
          d.nextPoll = now + Monitor::intervalMs();
          if (markCheck(d, d.up, true, d.connPending ? "no answer to the tunnel request" : "no tunnel")) events.push_back({d.id, d.up});
        }
        // Telegrams on the bus keep the values current; only read them all once per tunnel (and every readEvery s if set).
        if (d.up && (d.readDue || (d.readEvery && now - d.lastRead >= d.readEvery * 1000))) {
          d.readDue = false;
          d.lastRead = now;
          for (auto& p : d.points) if (d.txq.size() < 64) d.txq.push_back(knxFrame(parseGa(p.key), false, {}, false));
        }
      }
      if (d.type == Kiss && kissOpen) {
        if (d.pollPending && now - d.pollSentAt > 2000) {
          d.pollPending = false;
          // The box sends its answers to the return IP/port set in the box (Kiss-Box Editor),
          // not to whoever asked: commands still work when that points elsewhere, so say so.
          if (markCheck(d, false, true, "no reply - set the box's return IP to " + Net::localIP().toString() + " port " + String(kissOpen) + " (Kiss-Box Editor, I/O Mode Setup)"))
            events.push_back({d.id, false});
        }
        if ((int32_t)(now - d.nextPoll) >= 0) {
          d.nextPoll = now + Monitor::intervalMs();
          for (int s = 0; s < 8; s++) {
            String t = kissSlotType(d.slots, s);
            if ((t == "" && s > 0) || t == "-") continue;
            uint8_t q[2] = {0xA0, (uint8_t)s};
            kissSend(d, q, 2);
          }
          d.pollPending = true;
          d.pollSentAt = now;
        }
      }
    }
    mtx.unlock();
    applyVars(vars);
    for (auto& e : events) {
      mtx.lock();
      Drv* d = byId(e.first);
      String name = d ? d->name : String("");
      Type type = d ? d->type : Knx;
      mtx.unlock();
      if (name.length()) deviceEvent(true, type, name, e.second);
    }
    rtos::ThisThread::sleep_for(5ms);
  }
}

// ---- Live updates (push thread): Pharos WebSocket, MQTT broker ----------------
rtos::Thread pushThread(osPriorityNormal, 6 * 1024, nullptr, "drv-push");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds

// NETIO MQTT-flex: ${INOUT_STATUS} / ${OUTPUTS_STATUS} JSON, or a plain 0/1 on .../output/<n>/state.
void mqttPublish(const IPAddress& from, const String& topic, const String& payload) {
  Update u;
  if (payload.startsWith("{")) {
    JsonDocument d;
    if (deserializeJson(d, payload)) return;
    parseNetio(d, u);
  } else {
    int o = topic.indexOf("/output/");
    if (o < 0 || !topic.endsWith("/state")) return;
    String n = topic.substring(o + 8, topic.lastIndexOf('/'));
    String v = payload;
    v.trim();
    u.points.push_back({"out" + n, "", v, ""});
  }
  VarSets vars;
  mtx.lock();
  for (auto& d : list)
    if (d.type == Netio && d.ip == from) {
      applyUpdate(d, u, true, vars);
      d.lastSeen = epochNow();
      d.pushState = 2;
    }
  mtx.unlock();
  applyVars(vars);
}
void mqttClient(const IPAddress& from, bool connected) {
  bool changed = false;
  Type type = Netio;
  String name;
  mtx.lock();
  for (auto& d : list)
    if (d.type == Netio && d.ip == from && d.push) {
      d.pushState = connected ? 2 : 1;
      d.pushNote = connected ? "" : "MQTT connection closed";
      if (connected && !d.online) { changed = markCheck(d, true, false, ""); name = d.name; type = d.type; }
      if (connected) d.nextPoll = millis() + 500;   // fetch the full status once
    }
  mtx.unlock();
  deviceEvent(changed, type, name, true);
}

// Pharos /query WebSocket: subscribe to timeline, scene and group changes.
struct Ws {
  int id;
  EthernetClient c;
  bool up = false;
  uint32_t retryAt = 0, aliveAt = 0;
  std::vector<uint8_t> rx;
  String msg;   // text frame being assembled
};
std::vector<Ws> sockets;

void wsSend(Ws& w, uint8_t opcode, const String& text) {
  std::vector<uint8_t> f = {(uint8_t)(0x80 | opcode)};
  size_t n = text.length();
  if (n < 126) f.push_back(0x80 | n);
  else { f.push_back(0x80 | 126); f.push_back(n >> 8); f.push_back(n & 0xff); }
  uint8_t mask[4];
  for (auto& m : mask) m = random(256);
  f.insert(f.end(), mask, mask + 4);
  for (size_t i = 0; i < n; i++) f.push_back(text[i] ^ mask[i & 3]);   // clients must mask
  w.c.write(f.data(), f.size());
}
String withToken(const char* json, const String& token) {
  String s = json;
  if (token.length()) s = s.substring(0, s.length() - 1) + (s.length() > 2 ? "," : "") + "\"token\":\"" + token + "\"}";
  return s;
}
void wsBroadcast(int id, const String& text) {
  JsonDocument d;
  if (deserializeJson(d, text)) return;
  String kind = d["broadcast"] | "";
  JsonObject x = d["data"];
  if (!x) return;
  String n = String(x["num"] | 0);
  VarSets vars;
  mtx.lock();
  Drv* dp = byId(id);
  if (dp) {
    if (kind == "timeline") setPoint(*dp, "tl" + n, x["state"] | "", findPoint(*dp, "tl" + n) ? "" : "Timeline " + n, vars);
    else if (kind == "scene") setPoint(*dp, "sc" + n, x["state"] | "", findPoint(*dp, "sc" + n) ? "" : "Scene " + n, vars);
    else if (kind == "group") setPoint(*dp, "grp" + n, String(x["level"] | 0), String(x["name"] | ("Group " + n).c_str()) + " (%)", vars);
    dp->lastSeen = epochNow();
    if (kind == "timeline") {   // keep "Playing" current between polls
      String playing;
      for (auto& p : dp->points)
        if (p.key.startsWith("tl") && p.value == "running") playing += (playing.length() ? ", " : "") + p.name.substring(p.name.indexOf(' ', 9) + 1);
      setInfo(*dp, "Playing", playing.length() ? playing : String("nothing"));
    }
  }
  mtx.unlock();
  applyVars(vars);
}
// Frames from the controller (never masked). Returns false when the socket should close.
bool wsRead(Ws& w) {
  while (w.c.available() > 0 && w.rx.size() < 8192) {
    uint8_t buf[256];
    int n = w.c.read(buf, min(w.c.available(), (int)sizeof buf));
    if (n <= 0) break;
    w.rx.insert(w.rx.end(), buf, buf + n);
  }
  while (w.rx.size() >= 2) {
    uint8_t op = w.rx[0] & 0x0f;
    bool fin = w.rx[0] & 0x80;
    size_t len = w.rx[1] & 0x7f, at = 2;
    if (len == 126) { if (w.rx.size() < 4) return true; len = w.rx[2] << 8 | w.rx[3]; at = 4; }
    else if (len == 127) return false;   // > 64 KB: not from this API
    if (w.rx.size() < at + len) return true;
    const uint8_t* p = w.rx.data() + at;
    if (op == 1 || op == 0) {
      for (size_t i = 0; i < len && w.msg.length() < 8192; i++) w.msg += (char)p[i];
      if (fin) { wsBroadcast(w.id, w.msg); w.msg = ""; }
    } else if (op == 2) {
      // Keep-alive answer: all zeros means the session (token) expired.
      bool zero = true;
      for (size_t i = 0; i < len; i++) zero &= p[i] == 0;
      if (zero && len) {
        mtx.lock();
        Drv* dp = byId(w.id);
        if (dp) dp->token = "";
        mtx.unlock();
        return false;
      }
    } else if (op == 8) {
      return false;
    } else if (op == 9) {
      wsSend(w, 0xA, "");   // pong
    }
    w.rx.erase(w.rx.begin(), w.rx.begin() + at + len);
  }
  return true;
}
void setPush(int id, uint8_t state, const String& note, bool online) {
  bool changed = false;
  String name;
  mtx.lock();
  Drv* dp = byId(id);
  if (dp) {
    dp->pushState = state;
    dp->pushNote = note;
    if (online != dp->online) changed = markCheck(*dp, online, false, note);
    name = dp->name;
  }
  mtx.unlock();
  deviceEvent(changed, Pharos, name, online);
}
void wsConnect(Ws& w) {
  mtx.lock();
  Drv* dp = byId(w.id);
  if (!dp) { mtx.unlock(); return; }
  Conn c = connOf(*dp);
  mtx.unlock();
  String err;
  if (c.user.length() && !c.token.length() && !pharosLogin(c, err)) { setPush(w.id, 1, "WebSocket: " + err, false); w.retryAt = millis() + 30000; return; }
  w.c = EthernetClient();
  w.c.setSocketTimeout(3000);
  if (!w.c.connect(c.ip, c.port)) { setPush(w.id, 1, "WebSocket: no connection", false); w.retryAt = millis() + 30000; return; }
  // Sec-WebSocket-Key: 16 random bytes, base64 (no zero bytes: they would end the String).
  String raw;
  for (int i = 0; i < 16; i++) raw += (char)random(1, 256);
  String req = "GET /query HTTP/1.1\r\nHost: " + c.ip.toString() + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + b64(raw) +
               "\r\nSec-WebSocket-Version: 13\r\n\r\n";
  w.c.write((const uint8_t*)req.c_str(), req.length());
  // Status line + headers until the blank line.
  String line;
  int status = 0;
  uint32_t t0 = millis();
  while (millis() - t0 < 3000) {
    if (w.c.available() <= 0) { if (!w.c.connected()) break; rtos::ThisThread::sleep_for(5ms); continue; }
    char ch = w.c.read();
    if (ch == '\r') continue;
    if (ch != '\n') { if (line.length() < 200) line += ch; continue; }
    if (!status) status = line.substring(line.indexOf(' ') + 1).toInt();
    else if (!line.length()) break;
    line = "";
  }
  if (status != 101) {
    w.c.stop();
    setPush(w.id, 1, "WebSocket refused (HTTP " + String(status) + ") - firmware too old, or https only?", false);
    w.retryAt = millis() + 60000;
    return;
  }
  w.up = true;
  w.rx.clear();
  w.msg = "";
  w.aliveAt = millis();
  for (const char* t : {"{\"subscribe\":\"timeline\"}", "{\"subscribe\":\"scene\"}", "{\"subscribe\":\"group\"}"}) wsSend(w, 1, withToken(t, c.token));
  mtx.lock();
  dp = byId(w.id);
  if (dp && c.token.length()) dp->token = c.token;
  mtx.unlock();
  LOGI(Sys, "Pharos %s: live updates (WebSocket) connected", c.name.c_str());
  setPush(w.id, 2, "", true);
}

void runPush() {
  rtos::ThisThread::sleep_for(5s);
  for (;;) {
    Mqtt::service();
    // Keep one WebSocket per Pharos with live updates on.
    std::vector<std::pair<int, String>> want;   // id, token
    mtx.lock();
    for (auto& d : list) if (d.type == Pharos && d.push) want.push_back({d.id, d.token});
    mtx.unlock();
    for (size_t i = 0; i < sockets.size();) {
      bool keep = false;
      for (auto& x : want) keep |= x.first == sockets[i].id;
      if (!keep) { sockets[i].c.stop(); sockets.erase(sockets.begin() + i); } else i++;
    }
    uint32_t now = millis();
    for (auto& x : want) {
      Ws* w = nullptr;
      for (auto& s : sockets) if (s.id == x.first) w = &s;
      if (!w) { sockets.push_back(Ws()); w = &sockets.back(); w->id = x.first; }
      if (!w->up) {
        if ((int32_t)(now - w->retryAt) >= 0) wsConnect(*w);
        continue;
      }
      if (!w->c.connected() || !wsRead(*w)) {
        w->c.stop();
        w->up = false;
        w->retryAt = now + 5000;
        LOGW(Sys, "Pharos: live updates (WebSocket) closed - reconnecting");
        setPush(w->id, 1, "WebSocket closed", false);
        continue;
      }
      if (now - w->aliveAt > 10000) {   // keep-alive every 10 s (refreshes the token too)
        w->aliveAt = now;
        wsSend(*w, 1, withToken("{}", x.second));
      }
    }
    rtos::ThisThread::sleep_for(10ms);
  }
}

// ---- Commands -----------------------------------------------------------------
// Optional trailing "fade <seconds>" at t[i].
bool optFade(const std::vector<String>& t, size_t i, float& sec, String& err) {
  sec = -1;
  if (t.size() <= i) return true;
  if (t.size() == i + 2 && t[i].equalsIgnoreCase("fade")) { sec = t[i + 1].toFloat(); return true; }
  err = "expected: fade <seconds>";
  return false;
}
bool queueHttp(const Drv& d, const String& method, const String& path, const String& body, const String& label, String& msg) {
  if (jobs.size() > 64) { msg = "device queue full"; return false; }
  jobs.push_back({d.id, method, path, body, label});
  msg = String(kTypeNames[d.type]) + " " + d.name + ": " + label + " queued";
  return true;
}
bool queueUdp(const Drv& d, const std::vector<uint8_t>& data, const String& label, String& msg) {
  if (ujobs.size() > 64) { msg = "device queue full"; return false; }
  ujobs.push_back({d.id, data, label, millis()});
  msg = String(kTypeNames[d.type]) + " " + d.name + ": " + label + (d.type == Knx && !d.up ? " (waiting for the tunnel)" : " queued");
  return true;
}
String json(JsonDocument& d) { String s; serializeJson(d, s); return s; }
// "/api/..." stays as typed; "info" becomes prefix + "info".
String apiPath(const String& p, const char* prefix) {
  if (p.startsWith("/")) return p;
  return String(prefix) + p;
}
bool apiCmd(const Drv& d, const std::vector<String>& t, size_t i, const char* prefix, String& msg) {
  if (t.size() < i + 2) { msg = "expected: api get|post|put|delete <path> [body]"; return false; }
  String m;
  if (!httpMethod(t[i], m, msg)) return false;
  String path = apiPath(t[i + 1], prefix);
  return queueHttp(d, m, path, rest(t, i + 2), m + " " + path, msg);
}

bool kissCmd(Drv& d, const std::vector<String>& t, String& msg) {
  auto slotOf = [&](const String& s, int& slot) { slot = s.toInt(); return isNumber(s) && slot >= 1 && slot <= 8; };
  int slot;
  if (t.size() >= 4 && t[2].equalsIgnoreCase("send")) {
    std::vector<uint8_t> raw;
    for (size_t i = 3; i < t.size(); i++) raw.push_back((uint8_t)strtol(t[i].c_str() + (t[i].startsWith("$") ? 1 : 0), nullptr, 16));
    return queueUdp(d, raw, "send " + rest(t, 3), msg);
  }
  if (t.size() == 4 && t[2].equalsIgnoreCase("read")) {
    if (!slotOf(t[3], slot)) { msg = "slot must be 1-8"; return false; }
    return queueUdp(d, {0xA0, (uint8_t)(slot - 1)}, "read slot " + t[3], msg);
  }
  if (t.size() == 12 && t[3].equalsIgnoreCase("all")) {
    if (!slotOf(t[2], slot)) { msg = "slot must be 1-8"; return false; }
    std::vector<uint8_t> p = {0xA4, (uint8_t)(slot - 1)};
    for (int i = 4; i < 12; i++) { bool b; p.push_back(truthy(t[i], b) ? b : (uint8_t)constrain(t[i].toInt(), 0L, 255L)); }
    String readMsg;   // the reply describes the write, not the read-back after it
    return queueUdp(d, p, "slot " + t[2] + " all " + rest(t, 4), msg) && queueUdp(d, {0xA0, (uint8_t)(slot - 1)}, "read slot " + t[2], readMsg);
  }
  int dot = t.size() == 4 ? t[2].indexOf('.') : -1;
  if (dot > 0) {
    int ch = t[2].substring(dot + 1).toInt();
    if (!slotOf(t[2].substring(0, dot), slot) || ch < 1 || ch > 8) { msg = "expected <slot>.<channel>, both 1-8"; return false; }
    bool b;
    uint8_t v = truthy(t[3], b) ? b : (uint8_t)constrain(t[3].toInt(), 0L, 255L);
    if (!truthy(t[3], b) && !isNumber(t[3])) { msg = "value must be on|off or 0-255"; return false; }
    // Write one channel, then read the slot back so the status follows.
    String readMsg;
    return queueUdp(d, {0xA5, (uint8_t)(slot - 1), (uint8_t)(ch - 1), v}, t[2] + " = " + t[3], msg) &&
           queueUdp(d, {0xA0, (uint8_t)(slot - 1)}, "read slot " + String(slot), readMsg);
  }
  msg = "expected: <slot>.<ch> on|off|<0-255>, <slot> all <8 values>, read <slot> or send <hex bytes>";
  return false;
}

bool knxCmd(Drv& d, const std::vector<String>& t, String& msg) {
  bool write = t.size() >= 5 && t.size() <= 6 && t[2].equalsIgnoreCase("write");
  bool read = t.size() == 4 && t[2].equalsIgnoreCase("read");
  if (!write && !read) { msg = "expected: write <address> <value> [<dpt>] or read <address>"; return false; }
  // An address from the list (by group address or name) knows its DPT.
  const Point* p = nullptr;
  for (auto& x : d.points) if (x.key == t[3] || x.name.equalsIgnoreCase(t[3])) p = &x;
  uint16_t ga = p ? parseGa(p->key) : parseGa(t[3]);
  if (!ga) { msg = "unknown KNX address '" + t[3] + "' (use 1/2/3 or a name from the address list)"; return false; }
  String key = gaText(ga);
  if (read) return queueUdp(d, knxFrame(ga, false, {}, false), "read " + key, msg);
  String dpt = t.size() == 6 ? t[5] : p ? p->dpt : String("");
  bool b;
  if (!dpt.length()) dpt = truthy(t[4], b) ? "1" : "";
  if (!dpt.length()) { msg = "give the DPT for " + key + " (e.g. 5.001 for percent, 9 for temperature)"; return false; }
  std::vector<uint8_t> data;
  bool small;
  if (!knxEncode(dpt, t[4], data, small, msg)) return false;
  return queueUdp(d, knxFrame(ga, true, data, small), "write " + key + " = " + t[4] + " (DPT " + dpt + ")", msg);
}

// To the kdlink plugin: fields separated by tabs, so zone names and values may contain spaces.
bool pluginSend(Drv& d, const String& what, const String& a, const String& b, String& msg) {
  if (!d.plugin) { msg = "BrightSign " + d.name + ": switch on the KD plugin for this player first (Devices > BrightSign)"; return false; }
  String text = "kd\t" + what + (a.length() ? "\t" + a : String("")) + (b.length() ? "\t" + b : String(""));
  Triggers::sendRaw(d.ip, d.pluginPort, (const uint8_t*)text.c_str(), text.length());
  String label = what + (a.length() ? " " + a : String("")) + (b.length() ? " " + b : String(""));
  d.last = label;
  msg = "BrightSign " + d.name + ": " + label;
  return true;
}

bool bsignCmd(Drv& d, const std::vector<String>& t, String& msg) {
  auto is = [&](const char* w) { return t[2].equalsIgnoreCase(w); };
  // Through the plugin: a Plugin Message event, a user variable, a file in a zone.
  if (is("event") && t.size() >= 4) return pluginSend(d, "event", rest(t, 3), "", msg);
  if (is("var") && t.size() >= 5) return pluginSend(d, "var", t[3], rest(t, 4), msg);
  if (is("play") && t.size() == 5) return pluginSend(d, "play", t[3], t[4], msg);
  // test <zone> <state>: the plugin plays that state's media file (the presentation carries on after it).
  if (is("test") && t.size() >= 5) return pluginSend(d, "test", t[3], rest(t, 4), msg);
  // With the plugin, reboot doesn't need the DWS (which may be https-only).
  if (is("reboot") && t.size() == 3 && d.plugin) return pluginSend(d, "reboot", "", "", msg);
  if (is("stop") && t.size() == 4) return pluginSend(d, "stop", t[3], "", msg);
  if (t.size() >= 4 && t[2].equalsIgnoreCase("send")) {
    Triggers::sendUdp(d.ip, d.udpPort, rest(t, 3));
    d.last = "UDP '" + rest(t, 3) + "'";
    msg = "BrightSign " + d.name + ": sent UDP '" + rest(t, 3) + "' to port " + String(d.udpPort);
    return true;
  }
  if (t.size() == 3 && t[2].equalsIgnoreCase("reboot")) return queueHttp(d, "PUT", "/api/v1/control/reboot", "", "reboot", msg);
  if (t.size() >= 3 && t[2].equalsIgnoreCase("api")) return apiCmd(d, t, 3, "/api/v1/", msg);
  msg = "expected: test <zone> <state>, play <zone> <file>, stop <zone>, event <text>, var <name> <value>, send <text>, reboot or api get|put|post|delete <path> [body]";
  return false;
}

bool digiCmd(Drv& d, const std::vector<String>& t, String& msg) {
  auto is = [&](size_t i, const char* w) { return t.size() > i && t[i].equalsIgnoreCase(w); };
  JsonDocument j;
  float fade;
  if (is(2, "scene") && t.size() >= 4) {
    if (!optFade(t, 4, fade, msg)) return false;
    uint32_t uid = 0;
    for (auto& s : d.scenes) if (s.first.equalsIgnoreCase(t[3])) uid = s.second;
    if (!uid && isNumber(t[3])) {
      long n = t[3].toInt();
      uid = n >= 1 && n <= (long)d.scenes.size() ? d.scenes[n - 1].second : (uint32_t)n;   // list position or unique id
    }
    if (!uid) { msg = "unknown DiGidot scene '" + t[3] + "'" + (d.scenes.empty() ? " (scene list not read yet)" : ""); return false; }
    int ms = fade < 0 ? 0 : (int)(fade * 1000);
    j["action"] = "playback";
    j["subaction"] = "play";
    j["type"] = "scene";
    for (const char* k : {"in", "out"}) { JsonObject f = j["fade"][k].to<JsonObject>(); f["fade"] = ms; f["delay"] = 0; f["curve"] = 1; }
    j["unique_id"] = uid;
    j["alpha"] = 65535;
    j["priority"] = 2;
    return queueHttp(d, "POST", "", json(j), "scene " + t[3], msg);
  }
  if (is(2, "playlist") && t.size() == 4) {
    j["action"] = "playback"; j["subaction"] = "play"; j["type"] = "playlist";
    j["start_index"] = 0; j["unique_id"] = strtoul(t[3].c_str(), nullptr, 10); j["alpha"] = 65535; j["priority"] = 2;
    return queueHttp(d, "POST", "", json(j), "playlist " + t[3], msg);
  }
  if (is(2, "stop") && t.size() == 3) return queueHttp(d, "POST", "", "{\"action\":\"playback\",\"subaction\":\"stop\"}", "stop", msg);
  if (is(2, "reset") && t.size() == 3) return queueHttp(d, "POST", "", "{\"action\":\"reset\"}", "reset", msg);
  if (is(2, "master") && t.size() == 4) {
    j["action"] = "fader"; j["type"] = "master_fader"; j["value"] = (long)lround(constrain(t[3].toFloat(), 0.0f, 100.0f) * 655.35f);
    return queueHttp(d, "POST", "", json(j), "master " + t[3] + "%", msg);
  }
  if (is(2, "speed") && t.size() == 4) {
    j["action"] = "playback"; j["subaction"] = "speed"; j["speed"]["value"] = t[3].toInt(); j["speed"]["transition_duration"] = 0;
    return queueHttp(d, "POST", "", json(j), "speed " + t[3] + "%", msg);
  }
  if (is(2, "trigger") && t.size() == 4) {
    j["action"] = "trigger"; j["subaction"] = "fire"; j["unique_id"][0] = strtoul(t[3].c_str(), nullptr, 10);
    return queueHttp(d, "POST", "", json(j), "trigger " + t[3], msg);
  }
  if (is(2, "send") && t.size() >= 4) return queueHttp(d, "POST", "", rest(t, 3), "send " + rest(t, 3), msg);
  msg = "expected: scene <name|#> [fade <s>], playlist <id>, stop, master <0-100>, speed <%>, trigger <id>, reset or send <json>";
  return false;
}

bool netioCmd(Drv& d, const std::vector<String>& t, String& msg) {
  if (t.size() >= 4 && t[2].equalsIgnoreCase("send")) return queueHttp(d, "POST", "/netio.json", rest(t, 3), "send " + rest(t, 3), msg);
  if (t.size() < 5 || t.size() > 6 || !t[2].equalsIgnoreCase("output")) { msg = "expected: output <n|all> on|off|toggle|restart|pulse [<seconds>] or send <json>"; return false; }
  String a = t[4];
  a.toLowerCase();
  int action = a == "off" ? 0 : a == "on" ? 1 : a == "restart" ? 2 : a == "pulse" ? 3 : a == "toggle" ? 4 : -1;
  if (action < 0) { msg = "action must be on|off|toggle|restart|pulse"; return false; }
  std::vector<int> ids;
  if (t[3].equalsIgnoreCase("all")) {
    for (auto& p : d.points) if (p.key.startsWith("out")) ids.push_back(p.key.substring(3).toInt());
    for (int k = 1; ids.empty() && k <= d.outputs; k++) ids.push_back(k);   // from the model, before the first status read
    if (ids.empty()) { msg = "outputs not read yet - wait for the first status poll"; return false; }
  } else if (isNumber(t[3]) && t[3].toInt() >= 1) {
    ids.push_back(t[3].toInt());
  } else {
    for (auto& p : d.points) if (p.key.startsWith("out") && p.name.equalsIgnoreCase(t[3])) ids.push_back(p.key.substring(3).toInt());
    if (ids.empty()) { msg = "unknown NETIO output '" + t[3] + "'"; return false; }
  }
  JsonDocument j;
  for (int id : ids) {
    JsonObject o = j["Outputs"].add<JsonObject>();
    o["ID"] = id;
    o["Action"] = action;
    if (t.size() == 6 && (action == 2 || action == 3)) o["Delay"] = (long)(t[5].toFloat() * 1000);
  }
  String label = "output " + t[3] + " " + a;
  if (t.size() == 6) label += " " + t[5] + " s";
  return queueHttp(d, "POST", "/netio.json", json(j), label, msg);
}

bool pharosCmd(Drv& d, const std::vector<String>& t, String& msg) {
  auto is = [&](size_t i, const char* w) { return t.size() > i && t[i].equalsIgnoreCase(w); };
  JsonDocument j;
  float fade;
  String label = rest(t, 2);
  // timeline <n> start|release|toggle|pause|resume [fade <s>] | rate <x> | position <0-100>
  if ((is(2, "timeline") || is(2, "scene")) && t.size() >= 5) {
    bool tl = is(2, "timeline");
    String a = t[4];
    a.toLowerCase();
    j["num"] = t[3].toInt();
    if (tl && a == "rate" && t.size() == 6) { j["action"] = "set_rate"; j["rate"] = t[5]; }
    else if (tl && a == "position" && t.size() == 6) { j["action"] = "set_position"; j["position"] = String((int)lround(t[5].toFloat() * 10)) + ":1000"; }
    else {
      if (a != "start" && a != "release" && a != "toggle" && !(tl && (a == "pause" || a == "resume"))) {
        msg = tl ? "expected: start|release|toggle|pause|resume [fade <s>], rate <x> or position <0-100>" : "expected: start|release|toggle [fade <s>]";
        return false;
      }
      if (!optFade(t, 5, fade, msg)) return false;
      j["action"] = a;
      if (fade >= 0) j["fade"] = fade;
    }
    return queueHttp(d, "POST", tl ? "/api/timeline" : "/api/scene", json(j), label, msg);
  }
  if (is(2, "release") && is(3, "all")) {
    if (!optFade(t, 4, fade, msg)) return false;
    j["action"] = "release";
    if (fade >= 0) j["fade"] = fade;
    return queueHttp(d, "POST", "/api/timeline", json(j), "release all timelines", msg) &&
           queueHttp(d, "POST", "/api/scene", json(j), "release all scenes", msg);
  }
  if (is(2, "group") && is(4, "master") && t.size() >= 6) {
    if (!optFade(t, 6, fade, msg)) return false;
    j["action"] = "master_intensity";
    j["num"] = t[3].toInt();
    j["level"] = String((int)lround(constrain(t[5].toFloat(), 0.0f, 100.0f) * 10)) + ":1000";
    if (fade >= 0) j["fade"] = fade;
    return queueHttp(d, "POST", "/api/group", json(j), label, msg);
  }
  if (is(2, "trigger") && t.size() >= 4) {
    j["num"] = t[3].toInt();
    if (t.size() > 4) j["var"] = rest(t, 4);
    return queueHttp(d, "POST", "/api/trigger", json(j), label, msg);
  }
  if (is(2, "text") && t.size() >= 5) {
    j["name"] = t[3];
    j["value"] = rest(t, 4);
    return queueHttp(d, "PUT", "/api/text_slot", json(j), label, msg);
  }
  // override fixture|group <n> intensity <0-100> | color #rrggbb [fade <s>]
  if (is(2, "override") && (is(3, "fixture") || is(3, "group")) && t.size() >= 7) {
    if (!optFade(t, 7, fade, msg)) return false;
    j["target"] = is(3, "fixture") ? "fixture" : "group";
    j["num"] = t[4].toInt();
    if (is(5, "intensity")) j["intensity"] = (int)lround(constrain(t[6].toFloat(), 0.0f, 100.0f) * 2.55f);
    else if ((is(5, "color") || is(5, "colour")) && t[6].length() == 7 && t[6][0] == '#') {
      uint32_t c = strtoul(t[6].c_str() + 1, nullptr, 16);
      j["colour"]["red"] = c >> 16; j["colour"]["green"] = (c >> 8) & 255; j["colour"]["blue"] = c & 255;
    } else { msg = "expected: intensity <0-100> or color #rrggbb"; return false; }
    if (fade >= 0) j["fade"] = fade;
    return queueHttp(d, "PUT", "/api/override", json(j), label, msg);
  }
  if (is(2, "clear") && is(3, "overrides")) {
    if (!optFade(t, 4, fade, msg)) return false;
    if (fade >= 0) j["fade"] = fade;
    return queueHttp(d, "DELETE", "/api/override", fade >= 0 ? json(j) : String(""), label, msg);
  }
  if (is(2, "output") && t.size() == 5 && (is(4, "on") || is(4, "off"))) {
    j["protocol"] = t[3];
    j["action"] = is(4, "on") ? "enable" : "disable";
    return queueHttp(d, "POST", "/api/output", json(j), label, msg);
  }
  if (is(2, "beacon") && t.size() == 4 && (is(3, "on") || is(3, "off"))) {
    j["enable"] = is(3, "on");
    return queueHttp(d, "PUT", "/api/beacon", json(j), label, msg);
  }
  if (is(2, "api")) return apiCmd(d, t, 3, "/api/", msg);
  msg = "expected: timeline|scene|group|trigger|release all|text|override|clear overrides|output|beacon|api ...";
  return false;
}

}  // namespace

namespace Drivers {

void begin() {
  Mqtt::onPublish = mqttPublish;
  Mqtt::onClient = mqttClient;
  httpThread.start(runHttp);
  udpThread.start(runUdp);
  pushThread.start(runPush);
}

void addActivity(Drv& d, const String& text) {
  if (d.activity.size() >= kMaxActivity) d.activity.pop_front();
  d.activity.push_back({epochNow(), text.substring(0, 160)});
}

// Readings from the kdlink plugin: zones as z<n> (state) + z<n>.file, user variables as var.<name>,
// GPIO inputs as gpio<n>, the last serial line as "serial".
void pluginPacket(Drv& d, JsonDocument& j, VarSets& vars) {
  String kind = j["kd"] | "";
  d.pluginSeen = epochNow();
  if (kind == "hello") {
    String has = String(j["gpio"] | false ? " · GPIO" : "") + (j["serial"] | false ? " · serial port" : "");
    setInfo(d, "KD plugin", "kdlink v" + String(j["v"] | 1) + " · " + String(j["zones"] | 0) + " zones · " + String(j["vars"] | 0) + " user variables" + has);
    String model = j["model"] | "";
    if (model.length()) setInfo(d, "Model", model);
    setPoint(d, "zones", String(j["zones"] | 0), "Zones", vars);
    d.states.clear();   // the state list follows
  } else if (kind == "state") {
    if (d.states.size() < kMaxBsStates) d.states.push_back({(uint8_t)(j["z"] | 0), j["name"] | "", j["file"] | ""});
  } else if (kind == "zone") {
    String k = "z" + String(j["i"] | 0), name = "Zone " + String(j["i"] | 0) + " " + (j["name"] | "");
    String state = j["state"] | "";
    const Point* was = findPoint(d, k);
    if (was && was->value != state) addActivity(d, String(j["name"] | "zone") + ": " + state);
    setPoint(d, k, state, name, vars);
    setPoint(d, k + ".file", j["file"] | "", name + " file", vars);
  } else if (kind == "gpio") {
    long bits = j["bits"] | 0L;
    for (int i = 0; i < 8; i++) setPoint(d, "gpio" + String(i), (bits >> i) & 1 ? "1" : "0", "GPIO " + String(i), vars);
  } else if (kind == "log") {
    String src = j["src"] | "", text = j["text"] | "";
    addActivity(d, src + ": " + text);
    if (src == "serial") setPoint(d, "serial", text, "Serial in (last line)", vars);
  } else if (kind == "var") {
    String name = j["name"] | "";
    if (name.length()) setPoint(d, "var." + name, j["value"] | "", name, vars);
  } else if (kind == "msg") {
    setPoint(d, "msg", j["text"] | "", "Player says", vars);
    setPoint(d, "msgAt", String(epochNow()), "", vars);
  } else if (kind == "reply") {
    d.last = String("plugin: ") + (j["text"] | "");
    if (j["ok"] | false) LOGI(Sys, "BrightSign %s: %s", d.name.c_str(), d.last.c_str());
    else LOGW(Sys, "BrightSign %s: %s", d.name.c_str(), d.last.c_str());
  }
}

bool onUdp(const IPAddress& from, const String& text) {
  mtx.lock();
  for (auto& d : list)
    if (d.type == Bsign && d.ip == from) {
      VarSets vars;
      bool mine = false;
      if (text.startsWith("{\"kd\"")) {
        JsonDocument j;
        mine = !deserializeJson(j, text);
        if (mine) pluginPacket(d, j, vars);
      }
      if (!mine) {
        setPoint(d, "msg", text, "Player says", vars);
        setPoint(d, "msgAt", String(epochNow()), "", vars);
      }
      d.lastSeen = epochNow();
      mtx.unlock();
      applyVars(vars);
      return mine;
    }
  mtx.unlock();
  return false;
}

void load() {
  std::vector<Drv> nl;
  uint32_t now = millis();
  uint16_t kp = 0;
  for (JsonObjectConst o : Show::projectDoc()["drivers"].as<JsonArrayConst>()) {
    Drv d;
    int ty = typeOf(o["type"] | "");
    d.id = o["id"] | 0;
    d.name = o["name"] | "";
    if (ty < 0) { LOGW(Sys, "Device %d '%s': unknown type '%s'", d.id, d.name.c_str(), (const char*)(o["type"] | "")); continue; }
    d.type = (Type)ty;
    if (!d.ip.fromString(o["ip"] | "")) { LOGW(Sys, "%s %s: invalid IP", kTypeNames[ty], d.name.c_str()); continue; }
    if (nl.size() >= 24) { LOGW(Sys, "Max 24 drivers"); break; }
    d.port = o["port"] | kDefaultPort[ty];
    d.udpPort = o["udpPort"] | 5000;
    d.user = o["user"] | (ty == Bsign ? "admin" : "");
    d.pass = o["password"] | "";
    d.slots = o["slots"] | "";
    // Kiss-Box cards per slot (DO4PR, DI8DC...) decide what each slot is.
    if (o["cards"].is<JsonArrayConst>()) {
      d.slots = "";
      for (JsonVariantConst cv : o["cards"].as<JsonArrayConst>()) {
        String card = cv | "";
        card.toUpperCase();
        const char* kind = card.startsWith("DO") ? "out" : card.startsWith("DI") ? "in" : card.startsWith("AO") ? "aout" : card.startsWith("AI") ? "ain" : "-";
        d.slots += (d.slots.length() ? "," : "") + String(kind);
      }
    }
    d.push = o["live"] | false;
    d.plugin = ty == Bsign && (o["plugin"] | false);
    d.pluginPort = o["pluginPort"] | 5010;
    d.outputs = o["outputs"] | 0;
    d.readEvery = o["readEvery"] | 0;
    for (JsonPairConst kv : o["vars"].as<JsonObjectConst>()) {
      String v = kv.value() | "";
      if (v.length()) d.links.push_back({kv.key().c_str(), v});
    }
    d.session = random(1, 999999);
    if (ty == Kiss && !kp) kp = o["listenPort"] | 9813;
    String links = o["links"] | "";
    for (int at = 0; at < (int)links.length();) {
      int end = links.indexOf(',', at);
      if (end < 0) end = links.length();
      String l = links.substring(at, end);
      int eq = l.indexOf('=');
      if (eq > 0) { String k = l.substring(0, eq), v = l.substring(eq + 1); k.trim(); v.trim(); if (k.length() && v.length()) d.links.push_back({k, v}); }
      at = end + 1;
    }
    for (JsonObjectConst a : o["addresses"].as<JsonArrayConst>()) {
      uint16_t ga = parseGa(a["ga"] | "");
      if (ga && d.points.size() < kMaxPoints) d.points.push_back({gaText(ga), a["name"] | "", "", a["dpt"] | "1"});
      String v = a["var"] | "";
      if (ga && v.length()) d.links.push_back({gaText(ga), v});
    }
    // Keep live state (and an open KNX tunnel) for a device that survives the reload.
    for (auto& old : list)
      if (old.type == d.type && old.name == d.name && old.ip == d.ip && old.port == d.port) {
        d.online = old.online; d.seen = old.seen; d.last = old.last; d.lastSeen = old.lastSeen; d.lastCheck = old.lastCheck;
        d.history = old.history; d.checks = old.checks; d.info = old.info; d.scenes = old.scenes; d.token = old.token; d.triggers = old.triggers;
        d.onlineSince = old.onlineSince; d.dropouts = old.dropouts; d.restarts = old.restarts; d.lastRestart = old.lastRestart;
        d.uptime = old.uptime; d.lastError = old.lastError; d.lastErrorAt = old.lastErrorAt;
        d.pushState = d.push ? old.pushState : 0; d.pushNote = old.pushNote; d.lastRead = old.lastRead;
        d.nonce = old.nonce; d.session = old.session; d.up = old.up; d.channel = old.channel; d.seq = old.seq; d.aliveAt = old.aliveAt;
        d.pluginSeen = old.pluginSeen; d.states = old.states; d.activity = old.activity;
        for (auto& p : old.points)
          if (ty != Knx) d.points.push_back(p);
          else for (auto& np : d.points) if (np.key == p.key) np.value = p.value;
      }
    if (d.push && !d.pushState) d.pushState = 1;
    d.nextPoll = now + 1500 + nl.size() * 700;   // stagger the first polls
    nl.push_back(d);
  }
  bool broker = false;
  for (auto& d : nl) broker |= d.type == Netio && d.push;
  if (broker) Mqtt::setEnabled(true);   // stays on until reboot once started
  mtx.lock();
  list = std::move(nl);
  jobs.clear();
  ujobs.clear();
  kissPort = kp;
  mtx.unlock();
  LOGI(Sys, "%d device driver(s) loaded", (int)list.size());
}

bool isCommand(const String& word) { return typeOf(word) >= 0; }

// A device of type ty by number or name, -1 if none (caller holds mtx).
static int findDrv(int ty, const String& ref) {
  int idx = findRef(ref, list.size(), [](int i) { return list[i].id; }, [](int i) -> const String& { return list[i].name; });
  if (idx >= 0 && list[idx].type != ty) idx = -1;
  if (idx < 0) {
    for (size_t i = 0; i < list.size(); i++) if (list[i].type == ty && list[i].name.equalsIgnoreCase(ref)) idx = i;
  }
  return idx;
}

static bool runCmd(int ty, const String& ref, const std::vector<String>& t, String& msg);

bool command(const std::vector<String>& t, String& msg) {
  int ty = typeOf(t[0]);
  if (t.size() < 3) { msg = String("expected: ") + kTypes[ty] + " <device> ..."; return false; }
  // A group of this type: the same command for each of its devices (t[1] is only used to find the device).
  mtx.lock();
  bool single = findDrv(ty, t[1]) >= 0;
  mtx.unlock();
  std::vector<String> group;
  if (!single && State::groupMembers(kTypes[ty], t[1], group))
    return State::forMembers(t[1], group, [&](const String& n, String& m) { return runCmd(ty, n, t, m); }, msg);
  return runCmd(ty, t[1], t, msg);
}

static bool runCmd(int ty, const String& ref, const std::vector<String>& t, String& msg) {
  mtx.lock();
  int idx = findDrv(ty, ref);
  if (idx < 0) { mtx.unlock(); msg = "unknown " + String(kTypeNames[ty]) + " device '" + ref + "'"; return false; }
  Drv& d = list[idx];
  bool ok = false;
  switch (ty) {
    case Kiss: ok = kissCmd(d, t, msg); break;
    case Knx: ok = knxCmd(d, t, msg); break;
    case Bsign: ok = bsignCmd(d, t, msg); break;
    case Digi: ok = digiCmd(d, t, msg); break;
    case Netio: ok = netioCmd(d, t, msg); break;
    case Pharos: ok = pharosCmd(d, t, msg); break;
  }
  mtx.unlock();
  return ok;
}

void statusJson(JsonArray arr) {
  mtx.lock();
  for (auto& d : list) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = d.id;
    o["type"] = kTypes[d.type];
    o["name"] = d.name;
    o["ip"] = d.ip.toString();
    o["online"] = d.online;
    o["seen"] = d.seen;
    o["last"] = d.last;
    o["lastSeen"] = d.lastSeen;
    o["lastCheck"] = d.lastCheck;
    o["history"] = d.history;
    o["checks"] = d.checks;
    o["onlineSince"] = d.online ? d.onlineSince : 0;
    o["dropouts"] = d.dropouts;
    o["restarts"] = d.restarts;
    if (d.lastRestart) o["lastRestart"] = d.lastRestart;
    if (d.uptime) o["uptime"] = d.uptime;
    if (d.lastError.length()) { o["lastError"] = d.lastError; o["lastErrorAt"] = d.lastErrorAt; }
    if (d.type == Knx) o["tunnel"] = d.up;
    // Live updates: KNX (bus telegrams) and Kiss-Box inputs are always pushed; Pharos/NETIO when switched on.
    uint8_t ps = d.type == Knx ? (d.up ? 2 : 1) : d.pushState;
    // BrightSign plugin: live while it answered the last hellos.
    if (d.plugin) ps = d.pluginSeen && epochNow() - d.pluginSeen <= 2 * Monitor::intervalMs() / 1000 + 10 ? 2 : 1;
    if (ps) o["live"] = ps == 2 ? "live" : "waiting";
    if (d.plugin && ps == 1) o["liveNote"] = "No answer from the kdlink plugin on UDP port " + String(d.pluginPort);
    if (d.pushNote.length()) o["liveNote"] = d.pushNote;
    JsonObject info = o["info"].to<JsonObject>();
    for (auto& i : d.info) info[i.first] = i.second;
    JsonArray pts = o["points"].to<JsonArray>();
    for (auto& p : d.points) {
      JsonObject j = pts.add<JsonObject>();
      j["k"] = p.key;
      if (p.name.length()) j["n"] = p.name;
      j["v"] = p.value;
    }
    if (!d.scenes.empty()) {
      JsonArray sc = o["scenes"].to<JsonArray>();
      for (auto& s : d.scenes) sc.add(s.first);
    }
    if (!d.states.empty()) {
      JsonArray st = o["states"].to<JsonArray>();
      for (auto& s : d.states) { JsonObject x = st.add<JsonObject>(); x["z"] = s.zone; x["n"] = s.name; if (s.file.length()) x["f"] = s.file; }
    }
    if (!d.activity.empty()) {
      JsonArray ac = o["activity"].to<JsonArray>();
      for (auto& a : d.activity) { JsonArray x = ac.add<JsonArray>(); x.add(a.first); x.add(a.second); }
    }
    if (!d.triggers.empty()) {
      JsonArray tr = o["triggers"].to<JsonArray>();
      for (auto& t : d.triggers) { JsonObject x = tr.add<JsonObject>(); x["n"] = t.num; x["name"] = t.name; if (t.type.length()) x["t"] = t.type; }
    }
  }
  mtx.unlock();
}

void pollNow() {
  mtx.lock();
  uint32_t now = millis();
  for (size_t i = 0; i < list.size(); i++) list[i].nextPoll = now + i * 300;
  mtx.unlock();
}

bool state(const String& name, bool& online, bool& known) {
  mtx.lock();
  for (auto& d : list)
    if (d.name.equalsIgnoreCase(name)) { online = d.online; known = d.seen; mtx.unlock(); return true; }
  mtx.unlock();
  return false;
}

}  // namespace Drivers
