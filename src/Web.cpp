#include "Web.h"
#include <ArduinoJson.h>
#include <Ethernet.h>
#include <mbed.h>
#include <sys/stat.h>
#include <time.h>
#include <vector>
#include "BigRam.h"
#include "Board.h"
#include "Cmd.h"
#include "Config.h"
#include "Log.h"
#include "Mail.h"
#include "Clock.h"
#include "Drivers.h"
#include "Globals.h"
#include "Io.h"
#include "Monitor.h"
#include "Mqtt.h"
#include "Net.h"
#include "Pcs.h"
#include "Project.h"
#include "Projectors.h"
#include "Show.h"
#include "State.h"
#include "Stats.h"
#include "Storage.h"
#include "Triggers.h"
#include "Update.h"

using namespace std::chrono_literals;

namespace {

// Shown when the stick has no /www folder: still gives status and the live log.
const char kFallbackPage[] = R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>KD Designer</title>
<style>body{background:#15171c;color:#d8dbe2;font:14px system-ui;margin:16px}pre{font:12px monospace;white-space:pre-wrap}</style>
</head><body><h2>KD Designer</h2><p>Web UI not found. Copy the <code>www</code> folder to the USB stick.</p>
<pre id="l"></pre><script>
const l=document.getElementById('l'),es=new EventSource('/api/events');
es.addEventListener('log',e=>{const m=JSON.parse(e.data);l.textContent=m.c+' '+m.m+'\n'+l.textContent.slice(0,20000)});
</script></body></html>)HTML";

struct SseClient {
  EthernetClient c;
  uint32_t seq = 0;
  bool used = false;
};

EthernetServer server(KD_HTTP_PORT);
SseClient sse[KD_MAX_SSE];
rtos::Mutex sseMtx;
rtos::Thread httpThread(osPriorityNormal, 16 * 1024, nullptr, "http");
rtos::Thread sseThread(osPriorityNormal, 8 * 1024, nullptr, "sse");

struct Request {
  String method, path, query;
  size_t contentLength = 0;
  bool gzip = false;     // Accept-Encoding has gzip
  String ifNoneMatch;    // ETag the browser already has
};

bool readLine(EthernetClient& c, String& line, uint32_t timeoutMs) {
  line = "";
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    while (c.available()) {
      char ch = c.read();
      if (ch == '\n') return true;
      if (ch != '\r' && line.length() < 1024) line += ch;
    }
    if (!c.connected()) return false;
    rtos::ThisThread::sleep_for(1ms);
  }
  return false;
}

String queryParam(const String& q, const char* key) {
  String k = String(key) + "=";
  int i = q.startsWith(k) ? 0 : q.indexOf("&" + k);
  if (i < 0) return "";
  if (i > 0) i++;
  int end = q.indexOf('&', i);
  String raw = q.substring(i + k.length(), end < 0 ? q.length() : end);
  String out;
  for (size_t j = 0; j < raw.length(); j++) {
    if (raw[j] == '+') out += ' ';
    else if (raw[j] == '%' && j + 2 < raw.length()) { out += (char)strtol(raw.substring(j + 1, j + 3).c_str(), nullptr, 16); j += 2; }
    else out += raw[j];
  }
  return out;
}

// Replies go out in as few writes as possible, in blocks of whole TCP segments. lwIP holds
// back a part-filled segment while one is unacknowledged (Nagle) and Windows delays the ACK
// of a single segment, so small or odd-sized writes made every 1 KB wait ~50 ms: the web UI
// loaded at ~22 KB/s. Mbed has no TCP_NODELAY, so the sizes avoid it instead.
const size_t kTxBlock = 8 * MBED_CONF_LWIP_TCP_MSS;
uint8_t txBuf[kTxBlock];   // HTTP thread only

String headerText(int code, const char* type, long len = -1, const char* extra = nullptr) {
  const char* text = code == 200 ? "OK" : code == 304 ? "Not Modified" : code == 400 ? "Bad Request" : code == 404 ? "Not Found" : code == 503 ? "Service Unavailable" : "Error";
  String h = "HTTP/1.1 " + String(code) + ' ' + text + "\r\nContent-Type: " + type + "\r\n";
  if (len >= 0) h += "Content-Length: " + String(len) + "\r\n";
  if (extra) h += extra;
  h += "Cache-Control: no-cache\r\nConnection: close\r\n\r\n";
  return h;
}

// One huge write (a 58 KB log) never arrived: only the header got out. In blocks it does.
// Data in SDRAM (BigRam) is copied to internal RAM first: sent straight from SDRAM it
// arrived garbled from the second block on (seen on the hardware; the SDRAM itself tests fine).
bool writeAll(EthernetClient& c, const uint8_t* p, size_t len) {
  const bool sdram = (uintptr_t)p >= 0x60000000 && (uintptr_t)p < 0x60800000;
  uint8_t bounce[2 * MBED_CONF_LWIP_TCP_MSS];
  const size_t block = sdram ? sizeof(bounce) : kTxBlock;
  for (size_t at = 0; at < len; at += block) {
    size_t n = min(block, len - at);
    const uint8_t* src = p + at;
    if (sdram) { memcpy(bounce, src, n); src = bounce; }
    if (c.write(src, n) != n) return false;
  }
  return true;
}

void sendHeader(EthernetClient& c, int code, const char* type, long len = -1, const char* extra = nullptr) {
  String h = headerText(code, type, len, extra);
  writeAll(c, (const uint8_t*)h.c_str(), h.length());
}

// Header and the start of the body share the first block; no copy of the body (a big log
// copied once more could fail to allocate, and then only the header went out).
void sendText(EthernetClient& c, int code, const char* type, const char* body, size_t len) {
  String h = headerText(code, type, len);
  size_t hl = min(h.length(), kTxBlock), first = min(len, kTxBlock - hl);
  memcpy(txBuf, h.c_str(), hl);
  memcpy(txBuf + hl, body, first);
  if (c.write(txBuf, hl + first) != hl + first) return;
  writeAll(c, (const uint8_t*)body + first, len - first);
}
void sendText(EthernetClient& c, int code, const char* type, const String& body) { sendText(c, code, type, body.c_str(), body.length()); }

// Big replies are built in SDRAM (BigRam::Text): a 6 KB status String on a fragmented heap
// came out cut off. If even that fails, say so instead of sending broken JSON.
void sendText(EthernetClient& c, int code, const char* type, const BigRam::Text& t) {
  if (t.failed) sendText(c, 503, "application/json", "{\"ok\":false,\"reply\":\"out of memory\"}");
  else sendText(c, code, type, t.data ? t.data : "", t.len);
}

void sendJson(EthernetClient& c, JsonDocument& d, int code = 200) {
  BigRam::Text t;
  serializeJson(d, t);
  if (d.overflowed()) t.failed = true;
  sendText(c, code, "application/json", t);
}

void sendResult(EthernetClient& c, bool ok, const String& msg) {
  JsonDocument d(BigRam::json());
  d["ok"] = ok;
  d["reply"] = msg;
  sendJson(c, d, ok ? 200 : 400);
}

bool readBody(EthernetClient& c, size_t len, String& body) {
  body = "";
  body.reserve(len);
  uint32_t t0 = millis();
  char buf[512];
  while (body.length() < len && millis() - t0 < 5000) {
    int n = c.read((uint8_t*)buf, min(sizeof(buf), len - body.length()));
    if (n > 0) { body.concat(buf, n); t0 = millis(); }
    else if (!c.connected()) break;
    else rtos::ThisThread::sleep_for(1ms);
  }
  return body.length() == len;
}

// The same into SDRAM, for a project upload (a heap String of that size often can't be had).
bool readBody(EthernetClient& c, size_t len, BigRam::Buffer& body) {
  if (!body.reserve(len)) return false;
  uint32_t t0 = millis();
  while (body.len < len && millis() - t0 < 5000) {
    int n = c.read((uint8_t*)body.data + body.len, min((size_t)1024, len - body.len));
    if (n > 0) { body.len += n; t0 = millis(); }
    else if (!c.connected()) break;
    else rtos::ThisThread::sleep_for(1ms);
  }
  body.data[body.len] = 0;
  return body.len == len;
}

const char* mimeType(const String& p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript";
  if (p.endsWith(".css")) return "text/css";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

void sendFile(EthernetClient& c, const String& path, const char* type, const char* extra = nullptr) {
  FILE* f = Storage::mounted() ? fopen(path.c_str(), "rb") : nullptr;
  if (!f) { sendText(c, 404, "text/plain", "Not found"); return; }
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  // The header shares the first block with the file, so every write but the last is full.
  String h = headerText(200, type, size, extra);
  size_t fill = min(h.length(), kTxBlock);
  memcpy(txBuf, h.c_str(), fill);
  for (;;) {
    size_t n = fread(txBuf + fill, 1, kTxBlock - fill, f);
    fill += n;
    if (!fill) break;
    if (c.write(txBuf, fill) != fill) break;
    if (fill < kTxBlock) break;   // end of file
    fill = 0;
  }
  fclose(f);
}

// ---- Web UI files: gzipped copies and ETags from a network update (tools/make_update.py) ----
// The stick reads at ~300 KB/s, so the update stores text files as <name>.gz (a quarter of
// the bytes) and www/etags.txt with "<url> <stored size> <crc>" per file. A reload then only
// asks "changed?" (If-None-Match -> 304). A stick filled by hand has plain files and no list,
// and is served as before. The list is re-read on every page open ("/" or "/panel"), so a
// swapped stick or a new update is picked up; a tag only counts while the size still matches.
struct WwwTag { String url; long size; String tag; };
std::vector<WwwTag> wwwTags;

long fileSize(const String& path) {
  struct stat st;
  return Storage::mounted() && stat(path.c_str(), &st) == 0 ? (long)st.st_size : -1;
}

void loadWwwTags() {
  wwwTags.clear();
  String txt;
  if (!Storage::readFile(KD_WWW_ROOT "/etags.txt", txt, 16384)) return;
  for (int i = 0; i < (int)txt.length();) {
    int end = txt.indexOf('\n', i);
    if (end < 0) end = txt.length();
    String l = txt.substring(i, end);
    i = end + 1;
    int a = l.indexOf(' '), b = l.lastIndexOf(' ');
    if (a > 0 && b > a) wwwTags.push_back({l.substring(0, a), l.substring(a + 1, b).toInt(), "\"" + l.substring(b + 1) + "\""});
  }
}

// Sends /www<rel> (or its .gz), or a 304 when the browser has it. False = no such file.
bool serveWww(EthernetClient& c, const Request& req, const String& rel) {
  if (rel == "/index.html" || rel == "/panel.html") loadWwwTags();
  String path = String(KD_WWW_ROOT) + rel;
  long size = req.gzip ? fileSize(path + ".gz") : -1;
  bool gz = size >= 0;
  if (gz) path += ".gz";
  else size = fileSize(path);
  if (size < 0) return false;
  String extra = gz ? "Content-Encoding: gzip\r\nVary: Accept-Encoding\r\n" : "";
  for (auto& t : wwwTags) {
    if (t.url != rel || t.size != size) continue;
    if (req.ifNoneMatch == t.tag) {
      String h = headerText(304, mimeType(rel), -1, ("ETag: " + t.tag + "\r\n").c_str());
      writeAll(c, (const uint8_t*)h.c_str(), h.length());
      return true;
    }
    extra += "ETag: " + t.tag + "\r\n";
    break;
  }
  sendFile(c, path, mimeType(rel), extra.c_str());
  return true;
}

void buildStatus(JsonDocument& d) {
  d["version"] = KD_VERSION;
  d["uptime"] = millis();
  d["started"] = g_stats.resetReason;
  d["time"] = (uint32_t)time(nullptr);
  d["usb"] = Storage::mounted();
  d["ip"] = Net::localIP().toString();
  JsonObject s = d["stats"].to<JsonObject>();
  s["engineFps"] = g_stats.engineFps;
  s["dmxFps"] = g_stats.dmxFps;
  s["artTx"] = g_stats.artTxPs;
  s["artRx"] = g_stats.artRxPs;
  s["sacnTx"] = g_stats.sacnTxPs;
  s["sacnRx"] = g_stats.sacnRxPs;
  s["udpRx"] = g_stats.udpRxPs;
  s["tickUs"] = g_stats.tickUsMax;
  s["loopUs"] = g_stats.loopUsMax;
  s["http"] = g_stats.httpRequests;
  JsonObject heap = s["heap"].to<JsonObject>();
  heap["sdramFree"] = BigRam::freeBytes();
  heap["size"] = g_stats.heapSize;
  heap["used"] = g_stats.heapUsed;
  heap["free"] = g_stats.heapFree;
  heap["minFree"] = g_stats.heapMinFree;
  d["logSeq"] = Log::lastSeq();
  g_engine.lock();
  Show::statusJson(d.as<JsonObject>());
  Triggers::statusJson(d.as<JsonObject>());
  Pcs::statusJson(d["pcs"].to<JsonArray>());
  g_engine.unlock();
  State::statusJson(d.as<JsonObject>());
  Projectors::statusJson(d["projectors"].to<JsonArray>());
  Drivers::statusJson(d["drivers"].to<JsonArray>());
  Mqtt::statusJson(d["mqtt"].to<JsonObject>());
  Monitor::statusJson(d["monitor"].to<JsonObject>());
  Globals::statusJson(d["vars"].to<JsonObject>());
  Clock::statusJson(d["clock"].to<JsonObject>());
  Io::statusJson(d["io"].to<JsonObject>());
  if (Board::present()) Board::statusJson(d["board"].to<JsonObject>());
  Update::statusJson(d["update"].to<JsonObject>());
}

void handleProjectPut(EthernetClient& c, size_t len) {
  if (!Storage::mounted()) { sendResult(c, false, "No USB stick"); return; }
  BigRam::Buffer body;
  Log::crumb(Log::kCrumbWeb, "save: receiving");
  if (!readBody(c, len, body)) { sendResult(c, false, body.data ? "Upload incomplete" : "Project too big for the memory"); return; }
  String err;
  Log::crumb(Log::kCrumbWeb, "save: waiting for g_engine");
  g_engine.lock();
  Log::crumb(Log::kCrumbWeb, "save: Show::parse");
  bool ok = Show::parse(body.data, body.len, err);
  if (ok) {
    Log::crumb(Log::kCrumbWeb, "save: loadModules");
    Project::loadModules();
    Triggers::setSafeMode(false);   // the project was fixed (or the user takes the risk)
    Log::crumb(Log::kCrumbWeb, "save: Startup trigger");
    Triggers::startup();
  }
  g_engine.unlock();
  Log::crumb(Log::kCrumbWeb, "save: writing the stick");
  if (!ok) { LOGW(Web, "Rejected project upload: %s", err.c_str()); sendResult(c, false, err); return; }

  // Atomic-ish save: write tmp, keep the previous version as .bak, swap.
  if (!Storage::writeFile(KD_PROJECT_TMP, body.data, body.len)) {
    sendResult(c, false, "Write to USB failed");
    return;
  }
  remove(KD_PROJECT_BAK);
  rename(KD_PROJECT_PATH, KD_PROJECT_BAK);
  rename(KD_PROJECT_TMP, KD_PROJECT_PATH);
  LOGI(Web, "Project saved to USB (%u bytes)", (unsigned)body.len);
  sendResult(c, true, "Saved and loaded");
}

// Media file name: letters, digits, '.', '-', '_' only, and an image extension.
bool mediaName(const String& n) {
  if (!n.length() || n.length() > 64 || n[0] == '.') return false;
  for (size_t i = 0; i < n.length(); i++)
    if (!isalnum(n[i]) && n[i] != '.' && n[i] != '-' && n[i] != '_') return false;
  String l = n;
  l.toLowerCase();
  return l.endsWith(".png") || l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".webp") || l.endsWith(".gif") || l.endsWith(".svg");
}

// PUT /api/media?name=plan.jpg - streamed straight to the stick (images can be MBs).
void handleMediaPut(EthernetClient& c, const String& name, size_t len) {
  if (!Storage::mounted()) { sendResult(c, false, "No USB stick"); return; }
  if (!mediaName(name)) { sendResult(c, false, "Bad file name (letters, digits, . - _ and an image extension)"); return; }
  if (!len || len > KD_MAX_UPLOAD) { sendResult(c, false, "File too big (max " + String(KD_MAX_UPLOAD / 1048576) + " MB)"); return; }
  String path = String(KD_MEDIA_DIR) + "/" + name;
  String tmp = path + ".part";
  FILE* f = fopen(tmp.c_str(), "wb");
  if (!f) { sendResult(c, false, "Cannot write to USB"); return; }
  uint8_t buf[1024];
  size_t got = 0;
  uint32_t t0 = millis();
  bool ok = true;
  while (got < len && millis() - t0 < 10000) {
    int n = c.read(buf, min(sizeof(buf), len - got));
    if (n > 0) {
      if (fwrite(buf, 1, n, f) != (size_t)n) { ok = false; break; }
      got += n;
      t0 = millis();
    } else if (!c.connected()) break;
    else rtos::ThisThread::sleep_for(1ms);
  }
  fclose(f);
  if (!ok || got != len) { remove(tmp.c_str()); sendResult(c, false, "Upload incomplete"); return; }
  remove(path.c_str());
  rename(tmp.c_str(), path.c_str());
  LOGI(Web, "Media '%s' saved (%u bytes)", name.c_str(), (unsigned)len);
  sendResult(c, true, "/media/" + name);
}

void handle(EthernetClient& c) {
  Request req;
  String line;
  if (!readLine(c, line, 2000)) { c.stop(); return; }
  int s1 = line.indexOf(' '), s2 = line.indexOf(' ', s1 + 1);
  if (s1 < 0 || s2 < 0) { c.stop(); return; }
  req.method = line.substring(0, s1);
  String target = line.substring(s1 + 1, s2);
  int q = target.indexOf('?');
  req.path = q < 0 ? target : target.substring(0, q);
  req.query = q < 0 ? "" : target.substring(q + 1);
  while (readLine(c, line, 2000) && line.length()) {
    int colon = line.indexOf(':');
    if (colon < 0) continue;
    String name = line.substring(0, colon), value = line.substring(colon + 1);
    name.toLowerCase();
    value.trim();
    if (name == "content-length") req.contentLength = value.toInt();
    else if (name == "accept-encoding") req.gzip = value.indexOf("gzip") >= 0;
    else if (name == "if-none-match") req.ifNoneMatch = value;
  }
  g_stats.httpRequests++;
  LOGD(Web, "%s %s", req.method.c_str(), target.c_str());

  const String& p = req.path;
  if (p == "/api/events") {
    sendHeader(c, 200, "text/event-stream", -1, "Access-Control-Allow-Origin: *\r\n");
    c.print("retry: 2000\n\n");
    sseMtx.lock();
    for (auto& s : sse) {
      if (s.used) continue;
      s.c = c;
      s.used = true;
      uint32_t since = queryParam(req.query, "since").toInt();
      uint32_t first = Log::firstSeq();
      s.seq = since ? max(since + 1, first) : (Log::lastSeq() > 200 ? Log::lastSeq() - 199 : first);
      sseMtx.unlock();
      return;  // connection stays open, served by the SSE thread
    }
    sseMtx.unlock();
    c.stop();
    LOGW(Web, "Too many live-log clients (max %d)", KD_MAX_SSE);
    return;
  }

  if (p == "/api/status") {
    JsonDocument d(BigRam::json());
    buildStatus(d);
    sendJson(c, d);
  } else if (p == "/api/project" && req.method == "GET") {
    if (!Storage::mounted()) sendResult(c, false, "No USB stick");
    else sendFile(c, KD_PROJECT_PATH, "application/json");
  } else if (p == "/api/project" && (req.method == "PUT" || req.method == "POST")) {
    handleProjectPut(c, req.contentLength);
  } else if (p == "/api/cmd" && req.method == "POST") {
    String body, reply;
    readBody(c, min(req.contentLength, (size_t)1024), body);
    g_engine.lock();
    bool ok = true;
    // Several commands can be sent at once, one per line.
    int start = 0;
    while (start <= (int)body.length()) {
      int nl = body.indexOf('\n', start);
      String one = body.substring(start, nl < 0 ? body.length() : nl);
      String r;
      if (one.length()) { ok = Cmd::exec(one, r, "web") && ok; reply += r + "\n"; }
      if (nl < 0) break;
      start = nl + 1;
    }
    g_engine.unlock();
    reply.trim();
    sendResult(c, ok, reply);
  } else if (p == "/api/mode") {
    // For other systems (a plain GET is all some can send): no group = every group's state as
    // JSON, ?group=X = its state as text, &state=Y (or next/previous/toggle/back) sets it.
    String group = queryParam(req.query, "group"), state = queryParam(req.query, "state"), r;
    g_engine.lock();
    int g = State::findGroup(group);
    if (state.length()) {
      bool ok = Cmd::exec("mode \"" + group + "\" \"" + state + "\"", r, "http");
      g_engine.unlock();
      sendResult(c, ok, r);
    } else if (group.length()) {
      r = g >= 0 ? State::current(g) : String("");
      g_engine.unlock();
      if (g < 0) sendText(c, 404, "text/plain", "unknown mode group '" + group + "'");
      else sendText(c, 200, "text/plain", r);
    } else {
      JsonDocument d(BigRam::json());
      for (int i = 0; i < State::groupCount(); i++) d[State::groupName(i)] = State::current(i);
      g_engine.unlock();
      sendJson(c, d);
    }
  } else if (p == "/api/trigger" && req.method == "POST") {
    String msg;
    g_engine.lock();
    bool ok = Triggers::fire(queryParam(req.query, "id").toInt(), msg);
    g_engine.unlock();
    sendResult(c, ok, msg);
  } else if (p == "/api/trighistory") {
    String out;
    g_engine.lock();
    Triggers::historyJson(out);
    g_engine.unlock();
    sendText(c, 200, "application/json", out);
  } else if (p == "/api/panel" && req.method == "POST") {
    String msg, control = queryParam(req.query, "control"), value = queryParam(req.query, "value"), links = queryParam(req.query, "vars");
    g_engine.lock();
    // A slider / dial / wheel / toggle / XY pad keeps its value (other panels follow) and sets its
    // linked variables: vars=<name>=<value>;<name>=<value> (the panel works out each part).
    if (value.length()) {
      State::setControl(control, "value", value);
      for (int i = 0; i < (int)links.length();) {
        int end = links.indexOf(';', i);
        if (end < 0) end = links.length();
        String pair = links.substring(i, end), vm;
        int eq = pair.indexOf('=');
        if (eq > 0 && !Globals::set(pair.substring(0, eq), pair.substring(eq + 1), vm)) LOGW(Web, "Panel %s: %s", control.c_str(), vm.c_str());
        i = end + 1;
      }
    }
    bool ok = Triggers::panelEvent(control, queryParam(req.query, "event"), value, msg);
    g_engine.unlock();
    sendResult(c, ok, msg);
  } else if (p == "/api/log") {
    uint32_t since = queryParam(req.query, "since").toInt();
    BigRam::Text out;   // up to ~60 KB: in SDRAM (growing a heap String took ~1 s and could fail)
    out.add('[');
    LogEntry e;
    char buf[KD_LOG_MSG_LEN * 2 + 96];
    for (uint32_t s = max(since + 1, Log::firstSeq()); s <= Log::lastSeq(); s++) {
      if (!Log::get(s, e)) continue;
      if (out.len > 1) out.add(',');
      out.add(buf, Log::toJson(e, buf, sizeof(buf)));
    }
    out.add(']');
    sendText(c, 200, "application/json", out);
  } else if (p == "/api/history") {
    // One device's on/off history (Monitoring detail view); reads the stick, no engine lock.
    String out;
    Monitor::historyJson(queryParam(req.query, "name"), queryParam(req.query, "from").toInt(), queryParam(req.query, "to").toInt(), out);
    sendText(c, 200, "application/json", out);
  } else if (p == "/api/devlog") {
    // Log lines that mention a device (its name or IP) from the log files on the stick.
    String out;
    Log::search(queryParam(req.query, "name"), queryParam(req.query, "ip"), queryParam(req.query, "from").toInt(), queryParam(req.query, "to").toInt(), 300, out);
    sendText(c, 200, "application/json", out);
  } else if (p == "/api/loglevels") {
    JsonDocument d(BigRam::json());
    for (int i = 0; i < (int)Cat::COUNT; i++) d[Log::catName((Cat)i)] = Log::lvlName(Log::level((Cat)i));
    sendJson(c, d);
  } else if (p == "/api/dmx") {
    // ?o=1 (DMX monitor): {"v":[512 values],"o":[overridden channel numbers]}; without it the plain array.
    const bool withOvr = queryParam(req.query, "o") == "1";
    String out = withOvr ? "{\"v\":[" : "[";
    g_engine.lock();
    int u = Show::universeIndex(queryParam(req.query, "u").toInt());
    if (u >= 0) {
      const uint8_t* d = Show::output(u);
      for (int i = 0; i < 512; i++) { if (i) out += ','; out += d[i]; }
      if (withOvr) {
        out += "],\"o\":[";
        bool first = true;
        for (int i = 0; i < 512; i++)
          if (Show::isOverride(u, i)) { if (!first) out += ','; out += i + 1; first = false; }
      }
    }
    g_engine.unlock();
    out += withOvr ? "]}" : "]";
    sendText(c, u >= 0 ? 200 : 404, "application/json", out);
  } else if (p == "/api/time" && req.method == "POST") {
    String body;
    readBody(c, min(req.contentLength, (size_t)32), body);
    uint32_t epoch = body.toInt();
    if (epoch > 1600000000UL) {
      set_time(epoch);
      LOGI(Sys, "Clock set from browser");
      sendResult(c, true, "Clock set");
    } else {
      sendResult(c, false, "Bad epoch");
    }
  } else if (p == "/api/media" && (req.method == "PUT" || req.method == "POST")) {
    handleMediaPut(c, queryParam(req.query, "name"), req.contentLength);
  } else if (p == "/api/media" && req.method == "DELETE") {
    String name = queryParam(req.query, "name");
    bool ok = mediaName(name) && remove((String(KD_MEDIA_DIR) + "/" + name).c_str()) == 0;
    sendResult(c, ok, ok ? "Deleted" : "Not found");
  } else if (p == "/api/update" && (req.method == "PUT" || req.method == "POST")) {
    String msg;
    bool restart;
    bool ok = Update::receive(c, req.contentLength, msg, restart);
    JsonDocument d(BigRam::json());
    d["ok"] = ok;
    d["reply"] = msg;
    d["restart"] = restart;
    sendJson(c, d, ok ? 200 : 400);
  } else if (p.startsWith("/api/")) {
    sendText(c, 404, "application/json", "{\"ok\":false,\"reply\":\"unknown endpoint\"}");
  } else if (p.startsWith("/media/")) {
    String name = p.substring(7);
    if (!mediaName(name)) sendText(c, 400, "text/plain", "Bad path");
    else sendFile(c, String(KD_MEDIA_DIR) + "/" + name, mimeType(name));
  } else {
    // Static file from the stick.
    String rel = p == "/" ? "/index.html" : p == "/panel" ? "/panel.html" : p;
    if (rel.indexOf("..") >= 0) { sendText(c, 400, "text/plain", "Bad path"); }
    else if (serveWww(c, req, rel)) {}
    else if (rel == "/index.html") sendText(c, 200, "text/html; charset=utf-8", kFallbackPage);
    else sendText(c, 404, "text/plain", "Not found");
  }
  c.stop();
}

void httpLoop() {
  server.begin();
  LOGI(Web, "Web UI on http://%s/", Net::localIP().toString().c_str());
  for (;;) {
    EthernetClient c = server.accept();
    if (c) { Log::crumb(Log::kCrumbWeb, "handling a request"); handle(c); Log::crumb(Log::kCrumbWeb, "idle"); }
    else rtos::ThisThread::sleep_for(5ms);
  }
}

void sseLoop() {
  char buf[KD_LOG_MSG_LEN * 2 + 128];
  uint32_t lastStatus = 0, lastVersion = 0;
  for (;;) {
    // Push as soon as something changed (State::changed: commands, variables, inputs, devices,
    // modes, labels), at most 10 times a second so a busy trigger can't eat the CPU; else once a second.
    uint32_t since = millis() - lastStatus;
    bool statusDue = since >= 1000 || (State::version() != lastVersion && since >= 100);
    // The whole status event in SDRAM and sent in one go (see kTxBlock / BigRam::Text).
    BigRam::Text ev;
    if (statusDue) {
      lastStatus = millis();
      lastVersion = State::version();
      JsonDocument d(BigRam::json());
      buildStatus(d);
      ev.add("event: status\ndata: ");
      serializeJson(d, ev);
      ev.add("\n\n");
      if (ev.failed || d.overflowed()) statusDue = false;   // skip this one rather than send broken JSON
    }
    sseMtx.lock();
    for (auto& s : sse) {
      if (!s.used) continue;
      bool ok = s.c.connected();
      LogEntry e;
      int sent = 0;
      if (ok && s.seq < Log::firstSeq()) {
        snprintf(buf, sizeof(buf), "event: gap\ndata: %lu\n\n", (unsigned long)(Log::firstSeq() - s.seq));
        ok = s.c.print(buf) > 0;
        s.seq = Log::firstSeq();
      }
      while (ok && s.seq <= Log::lastSeq() && sent < 40) {
        if (Log::get(s.seq, e)) {
          int n = snprintf(buf, sizeof(buf), "event: log\ndata: ");
          size_t m = Log::toJson(e, buf + n, sizeof(buf) - n - 3);
          strcpy(buf + n + m, "\n\n");
          ok = s.c.write((const uint8_t*)buf, n + m + 2) > 0;
        }
        s.seq++;
        sent++;
      }
      if (ok && statusDue) ok = writeAll(s.c, (const uint8_t*)ev.data, ev.len);
      if (!ok) {
        s.c.stop();
        s.used = false;
      }
    }
    sseMtx.unlock();
    rtos::ThisThread::sleep_for(20ms);
  }
}
}  // namespace

namespace Web {
void begin() {
  httpThread.start(httpLoop);
  sseThread.start(sseLoop);
}
}  // namespace Web
