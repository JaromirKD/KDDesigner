#include "Io.h"
#include <Ethernet.h>
#include <mbed.h>
#include <deque>
#include <vector>
#include "Clock.h"
#include "Log.h"
#include "Net.h"
#include "Show.h"
#include "Util.h"

using namespace std::chrono_literals;

namespace {
// Locking: `dev` guards the device lists (taken by the io thread while it works,
// and by load()); `q` guards the small queues and the public state the main
// thread reads, so commands and conditions never wait on a slow device.
rtos::Mutex dev, q;
rtos::Thread thread(osPriorityNormal, 8 * 1024, nullptr, "io");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds

// Takes the oldest item of a queue guarded by q; false when it is empty.
template <class T>
bool takeFront(std::deque<T>& from, T& item) {
  q.lock();
  bool have = !from.empty();
  if (have) { item = from.front(); from.pop_front(); }
  q.unlock();
  return have;
}
// Online state of a device in a public list (TcpPub / MbPub, guarded by q); false if unknown.
template <class Pub>
bool pubState(const std::vector<Pub>& list, const String& name, bool& online, bool& known) {
  q.lock();
  for (auto& p : list)
    if (p.name.equalsIgnoreCase(name)) { known = p.state >= 0; online = p.state == 1; q.unlock(); return true; }
  q.unlock();
  return false;
}
const char* stateText(int state) { return state < 0 ? "unknown" : state ? "online" : "offline"; }

bool readExact(EthernetClient& c, uint8_t* buf, size_t n, uint32_t timeoutMs) {
  size_t got = 0;
  uint32_t t0 = millis();
  while (got < n && millis() - t0 < timeoutMs) {
    int a = c.available();
    if (a > 0) { int r = c.read(buf + got, min((size_t)a, n - got)); if (r > 0) got += r; }
    else if (!c.connected()) return false;
    else rtos::ThisThread::sleep_for(2ms);
  }
  return got == n;
}

// ---- TCP --------------------------------------------------------------------
struct TcpDev {
  String name, eol;
  IPAddress ip;
  uint16_t port = 0;
  EthernetClient c;
  bool connected = false;
  uint32_t retryAt = 0;
  String rx;
  bool everConnected = false;
};
struct TcpPub { String name, ip, lastLine; uint16_t port; int state; uint32_t lastRx; };

std::vector<TcpDev> tcps;
std::vector<TcpPub> tcpPub;                       // guarded by q
std::deque<std::pair<String, String>> tcpOut;     // device, text (q)
std::deque<Tcp::Line> tcpIn;                      // (q)

void tcpPublish(const TcpDev& d, int state, const String* line) {
  q.lock();
  for (auto& p : tcpPub)
    if (p.name == d.name) {
      p.state = state;
      if (line) { p.lastLine = *line; p.lastRx = epochNow(); }
    }
  q.unlock();
}

void tcpService() {
  uint32_t now = millis();
  for (auto& d : tcps) {
    if (!d.connected) {
      if ((int32_t)(now - d.retryAt) < 0) continue;
      d.c = EthernetClient();
      d.c.setSocketTimeout(2000);
      if (d.c.connect(d.ip, d.port)) {
        d.connected = true;
        d.everConnected = true;
        d.rx = "";
        LOGI(Sys, "TCP %s connected (%s:%u)", d.name.c_str(), d.ip.toString().c_str(), d.port);
        tcpPublish(d, 1, nullptr);
      } else {
        if (d.retryAt == 0 || d.everConnected) LOGW(Sys, "TCP %s: cannot connect to %s:%u", d.name.c_str(), d.ip.toString().c_str(), d.port);
        d.everConnected = false;
        d.retryAt = now + 10000;
        tcpPublish(d, 0, nullptr);
      }
      continue;
    }
    if (!d.c.connected()) {
      d.connected = false;
      d.retryAt = now + 2000;
      LOGW(Sys, "TCP %s disconnected", d.name.c_str());
      tcpPublish(d, 0, nullptr);
      continue;
    }
    // Send what the main thread queued for this device.
    q.lock();
    std::vector<String> outs;
    for (auto it = tcpOut.begin(); it != tcpOut.end();)
      if (it->first == d.name) { outs.push_back(it->second); it = tcpOut.erase(it); } else ++it;
    q.unlock();
    for (auto& o : outs) {
      String data = o + d.eol;
      d.c.write((const uint8_t*)data.c_str(), data.length());
    }
    // Receive lines (\r or \n terminated).
    while (d.c.available() > 0) {
      char ch = d.c.read();
      if (ch == '\r' || ch == '\n') {
        if (d.rx.length()) {
          String line = d.rx;
          d.rx = "";
          q.lock();
          if (tcpIn.size() < 64) tcpIn.push_back({d.name, line});
          q.unlock();
          tcpPublish(d, 1, &line);
          LOGD(Sys, "TCP %s <- %s", d.name.c_str(), line.c_str());
        }
      } else if (d.rx.length() < 256) {
        d.rx += ch;
      }
    }
  }
}

// ---- HTTP -------------------------------------------------------------------
struct HttpReq { String method, url, body; };
std::deque<HttpReq> httpQ;                 // (q)
std::deque<Http::Response> httpDone;       // (q)
String httpLast;                           // (q) "GET url -> 200"

bool parseUrl(const String& url, String& host, uint16_t& port, String& path, String& err) {
  if (url.startsWith("https://")) { err = "https is not supported, use http://"; return false; }
  String u = url.startsWith("http://") ? url.substring(7) : url;
  int slash = u.indexOf('/');
  String hp = slash < 0 ? u : u.substring(0, slash);
  path = slash < 0 ? String("/") : u.substring(slash);
  int colon = hp.indexOf(':');
  host = colon < 0 ? hp : hp.substring(0, colon);
  port = colon < 0 ? 80 : hp.substring(colon + 1).toInt();
  if (!host.length() || !port) { err = "bad URL"; return false; }
  return true;
}

void httpService() {
  HttpReq r;
  if (!takeFront(httpQ, r)) return;

  Http::Response res{r.method, r.url, "", 0};
  String host, path, err;
  uint16_t port;
  if (parseUrl(r.url, host, port, path, err)) {
    EthernetClient c;
    c.setSocketTimeout(3000);
    IPAddress ip;
    bool ok = ip.fromString(host) ? c.connect(ip, port) : c.connect(host.c_str(), port);
    if (ok) {
      // HTTP/1.0 like Drivers.cpp: a 1.1 server may send the body "chunked" (size lines in
      // between), and {body} in http triggers got those numbers (seen on the first hardware test).
      String req = r.method + " " + path + " HTTP/1.0\r\nHost: " + host + "\r\nUser-Agent: KD-Designer\r\nConnection: close\r\n";
      if (r.body.length() || r.method != "GET") {
        req += String("Content-Type: ") + (r.body.startsWith("{") || r.body.startsWith("[") ? "application/json" : "text/plain") + "\r\n";
        req += "Content-Length: " + String(r.body.length()) + "\r\n";
      }
      req += "\r\n" + r.body;
      c.write((const uint8_t*)req.c_str(), req.length());
      // Status line, skip headers, keep the first 1 KB of the body.
      String line, body;
      bool inBody = false;
      uint32_t t0 = millis();
      while (millis() - t0 < 5000 && (c.connected() || c.available())) {
        if (c.available() <= 0) { rtos::ThisThread::sleep_for(5ms); continue; }
        char ch = c.read();
        if (inBody) { if (body.length() < 1024) body += ch; continue; }
        if (ch == '\n') {
          if (!res.status && line.startsWith("HTTP/")) res.status = line.substring(line.indexOf(' ') + 1).toInt();
          else if (line.length() == 0 || line == "\r") inBody = true;
          line = "";
        } else if (ch != '\r') {
          line += ch;
        } else if (line.length() == 0) {
          // blank line "\r\n" -> handled on '\n'
        }
      }
      c.stop();
      res.body = body;
      if (!res.status) err = "no HTTP response";
    } else {
      err = "cannot connect to " + host;
    }
  }
  if (err.length()) {
    res.body = err;
    LOGW(Sys, "HTTP %s %s failed: %s", r.method.c_str(), r.url.c_str(), err.c_str());
  } else {
    String preview = res.body.substring(0, 80);
    preview.replace("\n", " ");
    LOGI(Sys, "HTTP %s %s -> %d %s", r.method.c_str(), r.url.c_str(), res.status, preview.c_str());
  }
  q.lock();
  if (httpDone.size() < 16) httpDone.push_back(res);
  httpLast = r.method + " " + r.url + " -> " + (res.status ? String(res.status) : String("error"));
  q.unlock();
}

// ---- Modbus TCP --------------------------------------------------------------
struct Point { String var, table; uint16_t address; String last; };
struct MbDev {
  String name;
  IPAddress ip;
  uint16_t port = 502;
  uint8_t unit = 1;
  uint32_t pollMs = 500, lastPoll = 0, retryAt = 0;
  EthernetClient c;
  bool connected = false, everConnected = false;
  uint16_t tid = 0;
  std::vector<Point> points;
};
struct MbPub { String name, ip; int state; uint32_t errors, lastOk; };
struct MbWrite { String device, table; uint16_t address, value; };

std::vector<MbDev> mbs;
std::vector<MbPub> mbPub;      // (q)
std::deque<MbWrite> mbWrites;  // (q)

uint8_t fcFor(const String& table, bool write) {
  if (write) return table == "coil" ? 5 : table == "holding" ? 6 : 0;
  return table == "coil" ? 1 : table == "discrete" ? 2 : table == "holding" ? 3 : table == "input" ? 4 : 0;
}

void mbPublish(const MbDev& d, int state, bool error) {
  q.lock();
  for (auto& p : mbPub)
    if (p.name == d.name) {
      p.state = state;
      if (error) p.errors++;
      else if (state == 1) p.lastOk = epochNow();
    }
  q.unlock();
}

// One request/response. Returns the response PDU (function code first).
bool mbTransact(MbDev& d, uint8_t fc, uint16_t addr, uint16_t val, uint8_t* pdu, int& pduLen, String& err) {
  uint8_t req[12] = {(uint8_t)(++d.tid >> 8), (uint8_t)d.tid, 0, 0, 0, 6, d.unit, fc,
                     (uint8_t)(addr >> 8), (uint8_t)addr, (uint8_t)(val >> 8), (uint8_t)val};
  while (d.c.available() > 0) d.c.read();  // drop anything stale
  if (d.c.write(req, sizeof(req)) != sizeof(req)) { err = "send failed"; return false; }
  uint8_t h[7];
  if (!readExact(d.c, h, 7, 1000)) { err = "timeout"; return false; }
  int len = ((h[4] << 8) | h[5]) - 1;  // PDU length (minus unit id)
  if (len < 2 || len > 64) { err = "bad response length"; return false; }
  if (!readExact(d.c, pdu, len, 1000)) { err = "timeout"; return false; }
  pduLen = len;
  if (pdu[0] == (fc | 0x80)) { err = "PLC exception " + String(pdu[1]); return false; }
  if (pdu[0] != fc) { err = "unexpected function " + String(pdu[0]); return false; }
  return true;
}

void mbDrop(MbDev& d, const String& why) {
  d.c.stop();
  d.connected = false;
  d.retryAt = millis() + 5000;
  LOGW(Sys, "Modbus %s: %s - reconnecting", d.name.c_str(), why.c_str());
  mbPublish(d, 0, true);
}

void modbusService() {
  uint32_t now = millis();
  for (auto& d : mbs) {
    if (!d.connected) {
      if ((int32_t)(now - d.retryAt) < 0) continue;
      d.c = EthernetClient();
      d.c.setSocketTimeout(2000);
      if (d.c.connect(d.ip, d.port)) {
        d.connected = d.everConnected = true;
        LOGI(Sys, "Modbus %s connected (%s:%u, unit %u)", d.name.c_str(), d.ip.toString().c_str(), d.port, d.unit);
        mbPublish(d, 1, false);
      } else {
        if (d.retryAt == 0 || d.everConnected) LOGW(Sys, "Modbus %s: cannot connect to %s:%u", d.name.c_str(), d.ip.toString().c_str(), d.port);
        d.everConnected = false;
        d.retryAt = now + 10000;
        mbPublish(d, 0, false);
      }
      continue;
    }
    uint8_t pdu[64];
    int len;
    String err;
    // Writes first: they are what the operator is waiting for.
    for (;;) {
      q.lock();
      MbWrite w;
      bool have = false;
      for (auto it = mbWrites.begin(); it != mbWrites.end(); ++it)
        if (it->device == d.name) { w = *it; mbWrites.erase(it); have = true; break; }
      q.unlock();
      if (!have) break;
      uint8_t fc = fcFor(w.table, true);
      uint16_t v = fc == 5 ? (w.value ? 0xFF00 : 0) : w.value;
      if (!mbTransact(d, fc, w.address, v, pdu, len, err)) {
        q.lock();
        mbWrites.push_front(w);   // sent again once reconnected, not lost
        q.unlock();
        mbDrop(d, "write " + w.table + " " + w.address + ": " + err);
        break;
      }
      LOGD(Sys, "Modbus %s: wrote %s %u = %u", d.name.c_str(), w.table.c_str(), w.address, w.value);
    }
    if (!d.connected || now - d.lastPoll < d.pollMs) continue;
    d.lastPoll = now;
    for (auto& p : d.points) {
      uint8_t fc = fcFor(p.table, false);
      if (!fc) continue;
      if (!mbTransact(d, fc, p.address, 1, pdu, len, err)) { mbDrop(d, "read " + p.table + " " + p.address + ": " + err); break; }
      String val = fc <= 2 ? String(pdu[2] & 1) : String((uint16_t)((pdu[2] << 8) | pdu[3]));
      if (val != p.last) {
        p.last = val;
        String msg;
        Globals::set(p.var, val, msg, true);
      }
    }
    if (d.connected) mbPublish(d, 1, false);
  }
}

// The jobs below share this thread, so a slow one delays the others (TCP lines, HTTP
// responses, PLC polls). Anything over half a second is logged with its name.
void timed(const char* what, void (*job)()) {
  uint32_t t0 = millis();
  job();
  uint32_t ms = millis() - t0;
  if (ms > 500) LOGW(Sys, "I/O thread: %s took %lu ms", what, (unsigned long)ms);
}

void run() {
  rtos::ThisThread::sleep_for(3s);  // let the network come up
  for (;;) {
    dev.lock();
    timed("TCP devices", tcpService);
    timed("Modbus", modbusService);
    dev.unlock();
    timed("HTTP request", httpService);
    rtos::ThisThread::sleep_for(10ms);
  }
}
}  // namespace

namespace Io {

void begin() { thread.start(run); }

void load() {
  JsonDocument& doc = Show::projectDoc();
  std::vector<TcpDev> nt;
  std::vector<TcpPub> ntp;
  for (JsonObjectConst o : doc["tcp"].as<JsonArrayConst>()) {
    TcpDev d;
    d.name = o["name"] | "";
    d.port = o["port"] | 0;
    d.eol = unescape(o["eol"] | "\\r\\n");
    if (!d.name.length() || !d.port || !d.ip.fromString(o["ip"] | "")) { LOGW(Sys, "TCP device '%s': bad IP/port", d.name.c_str()); continue; }
    if (nt.size() >= 8) { LOGW(Sys, "Max 8 TCP devices"); break; }
    nt.push_back(d);
    ntp.push_back({d.name, d.ip.toString(), "", d.port, -1, 0});
  }
  std::vector<MbDev> nm;
  std::vector<MbPub> nmp;
  for (JsonObjectConst o : doc["modbus"].as<JsonArrayConst>()) {
    MbDev d;
    d.name = o["name"] | "";
    d.port = o["port"] | 502;
    d.unit = o["unit"] | 1;
    d.pollMs = constrain((int)(o["pollMs"] | 500), 50, 60000);
    if (!d.name.length() || !d.ip.fromString(o["ip"] | "")) { LOGW(Sys, "Modbus device '%s': bad IP", d.name.c_str()); continue; }
    if (nm.size() >= 4) { LOGW(Sys, "Max 4 Modbus devices"); break; }
    nm.push_back(d);
    nmp.push_back({d.name, d.ip.toString(), -1, 0, 0});
  }
  // Attach the variables linked to Modbus points.
  Globals::ModbusLink links[32];
  size_t n = Globals::modbusLinks(links, 32);
  for (size_t i = 0; i < n; i++) {
    bool found = false;
    for (auto& d : nm)
      if (d.name.equalsIgnoreCase(links[i].device)) { d.points.push_back({links[i].name, links[i].table, links[i].address, ""}); found = true; }
    if (!found) LOGW(Sys, "Variable %s: unknown Modbus device '%s'", links[i].name.c_str(), links[i].device.c_str());
  }

  dev.lock();
  for (auto& d : tcps) d.c.stop();
  for (auto& d : mbs) d.c.stop();
  tcps = std::move(nt);
  mbs = std::move(nm);
  dev.unlock();
  q.lock();
  tcpPub = std::move(ntp);
  mbPub = std::move(nmp);
  tcpOut.clear();
  mbWrites.clear();
  q.unlock();
  LOGI(Sys, "%d TCP device(s), %d Modbus device(s)", (int)tcps.size(), (int)mbs.size());
}

void statusJson(JsonObject o) {
  q.lock();
  JsonArray t = o["tcp"].to<JsonArray>();
  for (auto& p : tcpPub) {
    JsonObject j = t.add<JsonObject>();
    j["name"] = p.name;
    j["ip"] = p.ip;
    j["port"] = p.port;
    j["state"] = stateText(p.state);
    j["lastRx"] = p.lastRx;
    if (p.lastLine.length()) j["lastLine"] = p.lastLine;
  }
  JsonArray m = o["modbus"].to<JsonArray>();
  for (auto& p : mbPub) {
    JsonObject j = m.add<JsonObject>();
    j["name"] = p.name;
    j["ip"] = p.ip;
    j["state"] = stateText(p.state);
    j["errors"] = p.errors;
    j["lastOk"] = p.lastOk;
  }
  o["httpQueued"] = httpQ.size();
  if (httpLast.length()) o["httpLast"] = httpLast;
  q.unlock();
}

}  // namespace Io

namespace Tcp {

bool send(const String& device, const String& text, String& msg) {
  q.lock();
  bool known = false;
  int state = -1;
  String name = device;
  for (auto& p : tcpPub) if (p.name.equalsIgnoreCase(device)) { known = true; state = p.state; name = p.name; }
  if (known && tcpOut.size() < 64) tcpOut.push_back({name, unescape(text)});
  q.unlock();
  if (!known) { msg = "unknown TCP device '" + device + "'"; return false; }
  msg = "TCP " + name + (state == 1 ? " <- " : " (not connected, queued) <- ") + text;
  return true;
}

bool takeLine(Line& l) { return takeFront(tcpIn, l); }

bool state(const String& name, bool& online, bool& known) { return pubState(tcpPub, name, online, known); }

}  // namespace Tcp

namespace Http {

bool request(const String& method, const String& url, const String& body, String& msg) {
  String host, path, err;
  uint16_t port;
  if (!parseUrl(url, host, port, path, err)) { msg = err; return false; }
  q.lock();
  bool ok = httpQ.size() < 16;
  if (ok) httpQ.push_back({method, url, body});
  q.unlock();
  msg = ok ? method + " " + url + " queued" : String("HTTP queue full");
  return ok;
}

bool takeResponse(Response& r) { return takeFront(httpDone, r); }

}  // namespace Http

namespace Modbus {

bool write(const String& device, const String& table, uint16_t address, uint16_t value, String& msg) {
  if (!fcFor(table, true)) { msg = "only coil and holding can be written"; return false; }
  q.lock();
  bool known = false;
  String name;
  for (auto& p : mbPub) if (p.name.equalsIgnoreCase(device)) { known = true; name = p.name; }
  if (known && mbWrites.size() < 64) mbWrites.push_back({name, table, address, value});
  q.unlock();
  if (!known) { msg = "unknown Modbus device '" + device + "'"; return false; }
  msg = "Modbus " + name + ": " + table + " " + address + " = " + value;
  return true;
}

bool writeLink(const Globals::ModbusLink& l, const String& value, String& err) {
  if (!fcFor(l.table, true)) { err = l.table + " " + l.address + " is read-only (from the PLC)"; return false; }
  return write(l.device, l.table, l.address, (uint16_t)value.toInt(), err);
}

bool state(const String& name, bool& online, bool& known) { return pubState(mbPub, name, online, known); }

}  // namespace Modbus
