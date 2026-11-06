#include "Projectors.h"
#include <Ethernet.h>
#include <mbed.h>
#include <algorithm>
#include <deque>
#include <vector>
#include "Config.h"
#include "Log.h"
#include "Monitor.h"
#include "Show.h"
#include "Util.h"

using namespace std::chrono_literals;

namespace {

struct Projector {
  int id = 0;
  String name;
  IPAddress ip;
  uint16_t port = 4352;
  String password;
  // live state
  bool online = false;
  bool everSeen = false;
  int power = -1;              // -1 unknown, 0 off, 1 on, 2 cooling, 3 warming
  String last;                 // last result / error, for the UI
  uint32_t nextPoll = 0;
  // monitoring info (from the poll)
  String errst;                // ERST: fan lamp temp cover filter other, 0 ok 1 warn 2 error
  int lampHours = -1;
  String input, mute, model, pjName;
  uint32_t lastSeen = 0, lastCheck = 0;   // epoch seconds
  uint32_t history = 0;
  uint8_t checks = 0;
};

struct Job {
  int id;                      // projector id (stable across reloads)
  String body;
};

std::vector<Projector> list;
std::deque<Job> jobs;
std::deque<Projectors::Alarm> alarms;
rtos::Mutex mtx;               // guards list + jobs + alarms
rtos::Thread thread(osPriorityNormal, 8 * 1024, nullptr, "pjlink");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds

const char* powerName(int p) {
  static const char* const kNames[] = {"off", "on", "cooling", "warming"};
  return p >= 0 && p <= 3 ? kNames[p] : "unknown";
}

bool readLine(EthernetClient& c, String& line) {
  line = "";
  uint32_t t0 = millis();
  while (millis() - t0 < KD_PJLINK_TIMEOUT_MS) {
    while (c.available()) {
      char ch = c.read();
      if (ch == '\r') return true;
      if (ch != '\n' && line.length() < 160) line += ch;
    }
    if (!c.connected()) return line.length() > 0;
    rtos::ThisThread::sleep_for(5ms);
  }
  return false;
}

const char* errText(const String& code) {
  if (code == "ERR1") return "undefined command";
  if (code == "ERR2") return "out of parameter";
  if (code == "ERR3") return "unavailable time (warming/cooling?)";
  if (code == "ERR4") return "projector/display failure";
  return nullptr;
}

// One TCP session: greeting, optional auth, then several commands (the auth
// digest only goes in front of the first). values[i] holds the reply after '='
// or an error text; ok[i] says which. Returns false on connection/auth errors.
bool session(const Projector& p, const std::vector<String>& bodies, std::vector<String>& values,
             std::vector<bool>& ok, String& err) {
  values.assign(bodies.size(), "");
  ok.assign(bodies.size(), false);
  EthernetClient c;
  c.setSocketTimeout(KD_PJLINK_TIMEOUT_MS);
  if (!c.connect(p.ip, p.port)) { err = "no connection"; return false; }

  String greet;
  if (!readLine(c, greet)) { c.stop(); err = "no greeting"; return false; }
  String prefix;
  if (greet.startsWith("PJLINK 1 ")) {
    if (!p.password.length()) { c.stop(); err = "projector requires a password"; return false; }
    prefix = md5hex(greet.substring(9) + p.password);
  } else if (greet.startsWith("PJLINK ERRA")) {
    c.stop(); err = "authentication error"; return false;
  } else if (!greet.startsWith("PJLINK 0")) {
    c.stop(); err = "unexpected greeting '" + greet + "'"; return false;
  }

  for (size_t i = 0; i < bodies.size(); i++) {
    String out = (i == 0 ? prefix : String("")) + "%1" + bodies[i] + "\r";
    c.write((const uint8_t*)out.c_str(), out.length());
    String resp;
    if (!readLine(c, resp)) { values[i] = "no response"; if (i == 0) { c.stop(); err = "no response"; return false; } break; }
    if (resp.startsWith("PJLINK ERRA")) { c.stop(); err = "wrong password"; return false; }
    int eq = resp.indexOf('=');
    if (eq < 0) { values[i] = "bad response '" + resp + "'"; continue; }
    values[i] = resp.substring(eq + 1);
    if (const char* e = errText(values[i])) values[i] = e;
    else ok[i] = true;
  }
  c.stop();
  return true;
}

const char* const kErrParts[] = {"fan", "lamp", "temperature", "cover", "filter", "other"};

// ERST digit k: 0 ok, 1 warning, 2 error (missing = ok).
int errLevel(const String& errst, int k) {
  return k < (int)errst.length() && errst[k] >= '1' && errst[k] <= '2' ? errst[k] - '0' : 0;
}

void pushAlarm(const String& name, int part, int from, int to, int lamp) {   // caller holds mtx
  if (alarms.size() < 32) alarms.push_back({name, part, from, to, lamp});
}

// Runs one job (single command) or a monitoring poll against a copy of the
// projector, then stores the result.
void execute(int id, const String& body, bool isPoll) {
  mtx.lock();
  auto it = std::find_if(list.begin(), list.end(), [&](const Projector& p) { return p.id == id; });
  if (it == list.end()) { mtx.unlock(); return; }
  Projector p = *it;
  mtx.unlock();

  std::vector<String> bodies;
  if (isPoll) {
    bodies = {"POWR ?", "ERST ?", "LAMP ?", "INPT ?", "AVMT ?"};
    if (!p.model.length()) { bodies.push_back("INF1 ?"); bodies.push_back("INF2 ?"); bodies.push_back("NAME ?"); }
  } else {
    bodies = {body};
  }
  std::vector<String> v;
  std::vector<bool> ok;
  String err;
  bool connected = session(p, bodies, v, ok, err);
  bool good = connected && ok[0];

  bool changed = false, recorded = false, nowOnline = false;
  const char* powerRec = nullptr;   // "on"/"off" for the history when the power changed
  mtx.lock();
  it = std::find_if(list.begin(), list.end(), [&](const Projector& x) { return x.id == id; });
  if (it != list.end()) {
    bool wasOnline = it->online, first = !it->everSeen;
    it->online = connected;
    it->lastCheck = (uint32_t)time(nullptr);
    if (connected) it->lastSeen = it->lastCheck;
    if (isPoll) {
      it->history = (it->history << 1) | (connected ? 1 : 0);
      if (it->checks < 32) it->checks++;
    }
    if (isPoll && connected) {
      if (ok[0]) {
        int pw = v[0].toInt();
        if (pw != it->power && it->everSeen) LOGI(Pjl, "%s: power %s", it->name.c_str(), powerName(pw));
        // History: warming up counts as on, cooling down as off.
        bool wasOn = it->power == 1 || it->power == 3, isOn = pw == 1 || pw == 3;
        if (it->power < 0 || wasOn != isOn) powerRec = isOn ? "on" : "off";
        it->power = pw;
      }
      int lamp = ok[2] ? (int)v[2].toInt() : it->lampHours;
      if (ok[1] && v[1] != it->errst) {
        for (int k = 0; k < 6; k++) {
          int from = errLevel(it->errst, k), to = errLevel(v[1], k);
          if (from == to) continue;
          if (to) LOGW(Pjl, "%s: %s %s", it->name.c_str(), kErrParts[k], to == 2 ? "ERROR" : "warning");
          else LOGI(Pjl, "%s: %s ok again", it->name.c_str(), kErrParts[k]);
          pushAlarm(it->name, k, from, to, lamp);
        }
        it->errst = v[1];
      }
      if (ok[2] && lamp != it->lampHours) {
        pushAlarm(it->name, Projectors::kLampHours, it->lampHours, lamp, lamp);
        it->lampHours = lamp;
      }
      it->input = ok[3] ? v[3] : "";
      it->mute = ok[4] ? v[4] : "";
      if (bodies.size() > 5) {
        String model = (ok[5] ? v[5] : String("")) + " " + (ok[6] ? v[6] : String(""));
        model.trim();
        it->model = model.length() ? model : "PJLink";
        if (ok[7]) it->pjName = v[7];
      }
    }
    if (!isPoll || !good) it->last = good ? (bodies[0] + " -> " + v[0]) : (connected ? v[0] : err);
    if (connected && !wasOnline) LOGI(Pjl, "%s (%s) online", it->name.c_str(), it->ip.toString().c_str());
    if (!connected && (wasOnline || first)) LOGW(Pjl, "%s (%s) offline: %s", it->name.c_str(), it->ip.toString().c_str(), err.c_str());
    changed = !first && connected != wasOnline;
    recorded = first || connected != wasOnline;
    nowOnline = connected;
    it->everSeen = true;
    // Check state soon after a command (power changes take a while).
    it->nextPoll = millis() + (isPoll ? Monitor::intervalMs() : 3000);
  }
  mtx.unlock();
  if (recorded) Monitor::record("projector", p.name, nowOnline ? "online" : "offline");
  if (powerRec) Monitor::record("projector", p.name, powerRec);
  if (changed) Monitor::pushEvent("projector", p.name, nowOnline);

  if (!isPoll) {
    if (good) LOGI(Pjl, "%s: %s -> %s", p.name.c_str(), body.c_str(), v[0].c_str());
    else LOGW(Pjl, "%s: %s failed: %s", p.name.c_str(), body.c_str(), connected ? v[0].c_str() : err.c_str());
  } else if (connected) {
    LOGD(Pjl, "%s: power %s, errors %s, lamp %dh", p.name.c_str(), powerName(p.power), v[1].c_str(), (int)v[2].toInt());
  }
}

void run() {
  for (;;) {
    mtx.lock();
    bool haveJob = !jobs.empty();
    Job job;
    if (haveJob) { job = jobs.front(); jobs.pop_front(); }
    int pollId = -1;
    if (!haveJob) {
      uint32_t now = millis();
      for (auto& p : list)
        if ((int32_t)(now - p.nextPoll) >= 0) { pollId = p.id; p.nextPoll = now + Monitor::intervalMs(); break; }
    }
    mtx.unlock();

    if (haveJob) execute(job.id, job.body, false);
    else if (pollId >= 0) execute(pollId, "", true);
    else rtos::ThisThread::sleep_for(100ms);
  }
}
}  // namespace

namespace Projectors {

void begin() { thread.start(run); }

void load() {
  std::vector<Projector> nl;
  uint32_t now = millis();
  for (JsonObjectConst o : Show::projectDoc()["projectors"].as<JsonArrayConst>()) {
    if ((int)nl.size() >= KD_MAX_PROJECTORS) { LOGW(Pjl, "Too many projectors (max %d)", KD_MAX_PROJECTORS); break; }
    Projector p;
    p.id = o["id"] | 0;
    p.name = o["name"] | "";
    if (!p.ip.fromString(o["ip"] | "")) { LOGW(Pjl, "Projector %d: invalid IP", p.id); continue; }
    p.port = o["port"] | 4352;
    p.password = o["password"] | "";
    p.nextPoll = now + 1000 + nl.size() * 500;  // stagger the first polls
    nl.push_back(p);
  }
  mtx.lock();
  // Keep the last readings of the same projector, so saving the project doesn't
  // fire its projector alarms again.
  for (auto& p : nl)
    for (auto& old : list)
      if (old.id == p.id && old.ip == p.ip) { p.errst = old.errst; p.lampHours = old.lampHours; break; }
  list = std::move(nl);
  jobs.clear();
  mtx.unlock();
  LOGI(Pjl, "%d projector(s) loaded", (int)list.size());
}

int find(const String& ref) {
  mtx.lock();
  int found = findRef(ref, list.size(), [](int i) { return list[i].id; }, [](int i) -> const String& { return list[i].name; });
  mtx.unlock();
  return found;
}

bool queue(int idx, const String& body, String& msg) {
  mtx.lock();
  if (idx >= (int)list.size()) { mtx.unlock(); msg = "unknown projector"; return false; }
  if (jobs.size() > 64) { mtx.unlock(); msg = "PJLink queue full"; LOGW(Pjl, "%s", msg.c_str()); return false; }
  int n = 0;
  for (size_t i = 0; i < list.size(); i++) {
    if (idx >= 0 && (int)i != idx) continue;
    jobs.push_back({list[i].id, body});
    n++;
  }
  String who = idx >= 0 ? list[idx].name : String("all projectors");
  mtx.unlock();
  msg = "PJLink '" + body + "' queued for " + who;
  return n > 0;
}

void statusJson(JsonArray arr) {
  mtx.lock();
  for (auto& p : list) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = p.id;
    o["name"] = p.name;
    o["ip"] = p.ip.toString();
    o["online"] = p.online;
    o["seen"] = p.everSeen;
    o["power"] = powerName(p.power);
    o["last"] = p.last;
    if (p.errst.length()) o["errors"] = p.errst;
    if (p.lampHours >= 0) o["lamp"] = p.lampHours;
    if (p.input.length()) o["input"] = p.input;
    if (p.mute.length()) o["mute"] = p.mute;
    if (p.model.length()) o["model"] = p.model;
    if (p.pjName.length()) o["pjName"] = p.pjName;
    o["lastSeen"] = p.lastSeen;
    o["lastCheck"] = p.lastCheck;
    o["history"] = p.history;
    o["checks"] = p.checks;
  }
  mtx.unlock();
}

void pollNow() {
  mtx.lock();
  uint32_t now = millis();
  for (size_t i = 0; i < list.size(); i++) list[i].nextPoll = now + i * 200;
  mtx.unlock();
}

bool state(const String& name, bool& online, bool& known) {
  mtx.lock();
  for (auto& p : list)
    if (p.name.equalsIgnoreCase(name)) {
      online = p.online;
      known = p.everSeen;
      mtx.unlock();
      return true;
    }
  mtx.unlock();
  return false;
}

bool takeAlarm(Alarm& a) {
  mtx.lock();
  bool have = !alarms.empty();
  if (have) { a = alarms.front(); alarms.pop_front(); }
  mtx.unlock();
  return have;
}

const char* partName(int part) { return part >= 0 && part < 6 ? kErrParts[part] : "lamp hours"; }

}  // namespace Projectors
