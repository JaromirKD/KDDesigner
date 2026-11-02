#include "Web.h"
#include <ArduinoJson.h>
#include <Ethernet.h>
#include <mbed.h>
#include <time.h>
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

void sendHeader(EthernetClient& c, int code, const char* type, long len = -1, const char* extra = nullptr) {
  const char* text = code == 200 ? "OK" : code == 400 ? "Bad Request" : code == 404 ? "Not Found" : code == 503 ? "Service Unavailable" : "Error";
  c.print("HTTP/1.1 "); c.print(code); c.print(' '); c.print(text); c.print("\r\n");
  c.print("Content-Type: "); c.print(type); c.print("\r\n");
  if (len >= 0) { c.print("Content-Length: "); c.print(len); c.print("\r\n"); }
  if (extra) c.print(extra);
  c.print("Cache-Control: no-cache\r\nConnection: close\r\n\r\n");
}

void sendText(EthernetClient& c, int code, const char* type, const String& body) {
  sendHeader(c, code, type, body.length());
  c.write((const uint8_t*)body.c_str(), body.length());
}

void sendJson(EthernetClient& c, JsonDocument& d, int code = 200) {
  String s;
  serializeJson(d, s);
  sendText(c, code, "application/json", s);
}

void sendResult(EthernetClient& c, bool ok, const String& msg) {
  JsonDocument d;
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

void sendFile(EthernetClient& c, const String& path, const char* type) {
  FILE* f = Storage::mounted() ? fopen(path.c_str(), "rb") : nullptr;
  if (!f) { sendText(c, 404, "text/plain", "Not found"); return; }
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  sendHeader(c, 200, type, size);
  uint8_t buf[1024];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
    if (c.write(buf, n) != n) break;
  }
  fclose(f);
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
  s["udpRx"] = g_stats.udpRxPs;
  s["tickUs"] = g_stats.tickUsMax;
  s["loopUs"] = g_stats.loopUsMax;
  s["http"] = g_stats.httpRequests;
  JsonObject heap = s["heap"].to<JsonObject>();
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
  String body;
  if (!readBody(c, len, body)) { sendResult(c, false, "Upload incomplete"); return; }
  String err;
  g_engine.lock();
  bool ok = Show::parse(body.c_str(), body.length(), err);
  if (ok) {
    Project::loadModules();
    Triggers::setSafeMode(false);   // the project was fixed (or the user takes the risk)
    Triggers::startup();
  }
  g_engine.unlock();
  if (!ok) { LOGW(Web, "Rejected project upload: %s", err.c_str()); sendResult(c, false, err); return; }

  // Atomic-ish save: write tmp, keep the previous version as .bak, swap.
  if (!Storage::writeFile(KD_PROJECT_TMP, body.c_str(), body.length())) {
    sendResult(c, false, "Write to USB failed");
    return;
  }
  remove(KD_PROJECT_BAK);
  rename(KD_PROJECT_PATH, KD_PROJECT_BAK);
  rename(KD_PROJECT_TMP, KD_PROJECT_PATH);
  LOGI(Web, "Project saved to USB (%u bytes)", (unsigned)body.length());
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
    if (line.startsWith("Content-Length:") || line.startsWith("content-length:"))
      req.contentLength = line.substring(15).toInt();
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
    JsonDocument d;
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
    String msg;
    g_engine.lock();
    bool ok = Triggers::panelEvent(queryParam(req.query, "control"), queryParam(req.query, "event"), msg);
    g_engine.unlock();
    sendResult(c, ok, msg);
  } else if (p == "/api/log") {
    uint32_t since = queryParam(req.query, "since").toInt();
    String out = "[";
    LogEntry e;
    char buf[KD_LOG_MSG_LEN * 2 + 96];
    for (uint32_t s = max(since + 1, Log::firstSeq()); s <= Log::lastSeq(); s++) {
      if (!Log::get(s, e)) continue;
      if (out.length() > 1) out += ',';
      Log::toJson(e, buf, sizeof(buf));
      out += buf;
    }
    out += "]";
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
    JsonDocument d;
    for (int i = 0; i < (int)Cat::COUNT; i++) d[Log::catName((Cat)i)] = Log::lvlName(Log::level((Cat)i));
    sendJson(c, d);
  } else if (p == "/api/dmx") {
    String out = "[";
    g_engine.lock();
    int u = Show::universeIndex(queryParam(req.query, "u").toInt());
    if (u >= 0) {
      const uint8_t* d = Show::output(u);
      for (int i = 0; i < 512; i++) { if (i) out += ','; out += d[i]; }
    }
    g_engine.unlock();
    out += "]";
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
    JsonDocument d;
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
    else if (Storage::exists((String(KD_WWW_ROOT) + rel).c_str())) sendFile(c, String(KD_WWW_ROOT) + rel, mimeType(rel));
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
    if (c) handle(c);
    else rtos::ThisThread::sleep_for(5ms);
  }
}

void sseLoop() {
  char buf[KD_LOG_MSG_LEN * 2 + 128];
  uint32_t lastStatus = 0, lastVersion = 0;
  for (;;) {
    // Push immediately when a mode or panel label changes, else once a second.
    bool statusDue = millis() - lastStatus >= 1000 || State::version() != lastVersion;
    String status;
    if (statusDue) {
      lastStatus = millis();
      lastVersion = State::version();
      JsonDocument d;
      buildStatus(d);
      serializeJson(d, status);
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
      if (ok && statusDue) {
        ok = s.c.print("event: status\ndata: ") > 0 && s.c.print(status) > 0 && s.c.print("\n\n") > 0;
      }
      if (!ok) {
        s.c.stop();
        s.used = false;
      }
    }
    sseMtx.unlock();
    rtos::ThisThread::sleep_for(50ms);
  }
}
}  // namespace

namespace Web {
void begin() {
  httpThread.start(httpLoop);
  sseThread.start(sseLoop);
}
}  // namespace Web
