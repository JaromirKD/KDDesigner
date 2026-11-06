#include "Monitor.h"
#include <Ethernet.h>
#include <mbed.h>
#include <time.h>
#include <algorithm>
#include <deque>
#include <vector>
#include "Config.h"
#include "Drivers.h"
#include "Io.h"
#include "Log.h"
#include "Projectors.h"
#include "Show.h"
#include "State.h"
#include "Storage.h"

using namespace std::chrono_literals;

namespace {
struct Target {
  String kind;                  // pc | device
  int id = 0;
  String name;
  IPAddress ip;
  // live state
  int state = -1;               // -1 unknown, 0 offline, 1 online
  int latency = -1;             // ms of the last successful ping
  uint32_t lastSeen = 0, lastCheck = 0;   // epoch seconds (0 = never)
  uint32_t history = 0;         // bit 0 = most recent check, 1 = answered
  uint8_t checks = 0;           // valid bits in history (max 32)
  uint8_t fails = 0;            // consecutive failures
};

std::vector<Target> targets;
std::deque<Monitor::Event> eventQueue;

// History lines waiting for the main loop (guarded by mtx), and the last state per
// device and kind of state for the top of each day file (main loop only).
struct Rec {
  String kind, name, state;
  uint32_t at;
};
std::deque<Rec> recQueue;
std::vector<Rec> lastRec;
uint32_t histDay = 0, histLastWrite = 0;
bool histBooted = false;
rtos::Mutex mtx;
rtos::Thread thread(osPriorityNormal, 6 * 1024, nullptr, "monitor");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds
uint32_t intervalS = 60, timeoutMs = 1000, failLimit = 2;
uint32_t lastRunMs = 0, lastRunEpoch = 0;
volatile bool forceRun = false;

uint32_t now() { return (uint32_t)time(nullptr); }

// KD_HISTORY_DIR/2026-11-01.txt for a day number (days since 1970, UTC).
String dayPath(uint32_t day) {
  time_t t = (time_t)day * 86400;
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char buf[16];
  strftime(buf, sizeof(buf), "%Y-%m-%d", &tmv);
  return String(KD_HISTORY_DIR) + "/" + buf + ".txt";
}
// Which lane a state belongs to: online/offline, power on/off, or a reading "p:<key>=1".
String lane(const String& s) { return s == "on" || s == "off" ? String("power") : s.startsWith("p:") ? s.substring(0, s.indexOf('=')) : String("up"); }

void checkOne(size_t i) {
  mtx.lock();
  if (i >= targets.size()) { mtx.unlock(); return; }
  IPAddress ip = targets[i].ip;
  String name = targets[i].name;
  mtx.unlock();

  int rtt = Ethernet.ping(ip, 255, timeoutMs);
  bool ok = rtt >= 0;

  mtx.lock();
  if (i < targets.size() && targets[i].name == name) {
    Target& t = targets[i];
    t.lastCheck = now();
    t.history = (t.history << 1) | (ok ? 1 : 0);
    if (t.checks < 32) t.checks++;
    if (ok) {
      t.latency = rtt;
      t.lastSeen = t.lastCheck;
      t.fails = 0;
    } else if (t.fails < 255) {
      t.fails++;
    }
    int newState = ok ? 1 : (t.fails >= failLimit || t.state < 0 ? 0 : t.state);
    if (newState != t.state) {
      bool first = t.state < 0;
      t.state = newState;
      String kind = t.kind;
      mtx.unlock();
      if (newState) LOGI(Sys, "%s '%s' (%s) is online (%d ms)", kind.c_str(), name.c_str(), ip.toString().c_str(), rtt);
      else LOGW(Sys, "%s '%s' (%s) is OFFLINE", kind.c_str(), name.c_str(), ip.toString().c_str());
      Monitor::record(kind.c_str(), name, newState ? "online" : "offline");
      // The first check after boot only sets the baseline; triggers fire on real changes.
      if (!first) Monitor::pushEvent(kind.c_str(), name, newState);
      return;
    }
  }
  mtx.unlock();
  LOGD(Sys, "ping %s %s: %s", name.c_str(), ip.toString().c_str(), ok ? (String(rtt) + " ms").c_str() : "no reply");
}

void run() {
  rtos::ThisThread::sleep_for(5s);  // let the network come up
  for (;;) {
    if (forceRun || !lastRunMs || millis() - lastRunMs >= intervalS * 1000) {
      forceRun = false;
      lastRunMs = millis();
      lastRunEpoch = now();
      mtx.lock();
      size_t n = targets.size();
      mtx.unlock();
      for (size_t i = 0; i < n; i++) checkOne(i);
    }
    rtos::ThisThread::sleep_for(200ms);
  }
}
}  // namespace

namespace Monitor {

void begin() { thread.start(run); }

void load() {
  JsonDocument& doc = Show::projectDoc();
  JsonObjectConst m = doc["settings"]["monitor"];
  std::vector<Target> nt;
  auto add = [&](const char* kind, JsonArrayConst list) {
    for (JsonObjectConst o : list) {
      if (!(o["monitor"] | true)) continue;
      Target t;
      t.kind = kind;
      t.id = o["id"] | 0;
      t.name = o["name"] | "";
      if (!t.ip.fromString(o["ip"] | "")) continue;
      // Keep live state for targets that survive a project reload.
      for (auto& old : targets)
        if (old.kind == t.kind && old.name == t.name && old.ip == t.ip) { t = old; t.id = o["id"] | 0; }
      nt.push_back(t);
    }
  };
  mtx.lock();
  intervalS = constrain((int)(m["interval"] | 60), 5, 3600);
  timeoutMs = constrain((int)(m["timeout"] | 1000), 100, 5000);
  failLimit = constrain((int)(m["failures"] | 2), 1, 10);
  add("pc", doc["pcs"]);
  add("device", doc["devices"]);
  targets = std::move(nt);
  mtx.unlock();
  LOGI(Sys, "Monitoring %d host(s) every %lu s", (int)targets.size(), (unsigned long)intervalS);
}

uint32_t intervalMs() { return intervalS * 1000; }

void setInterval(uint32_t s) {
  intervalS = constrain((int)s, 5, 3600);
  LOGI(Sys, "Monitor interval set to %lu s", (unsigned long)intervalS);
}

void checkNow() { forceRun = true; Projectors::pollNow(); Drivers::pollNow(); }

void pushEvent(const char* kind, const String& name, bool online) {
  mtx.lock();
  if (eventQueue.size() < 32) eventQueue.push_back({kind, name, online});
  mtx.unlock();
}

bool takeEvent(Event& e) {
  mtx.lock();
  bool have = !eventQueue.empty();
  if (have) { e = eventQueue.front(); eventQueue.pop_front(); }
  mtx.unlock();
  return have;
}

bool state(const String& name, bool& online, bool& known) {
  mtx.lock();
  for (auto& t : targets)
    if (t.name.equalsIgnoreCase(name)) {
      known = t.state >= 0;
      online = t.state == 1;
      mtx.unlock();
      return true;
    }
  mtx.unlock();
  return Projectors::state(name, online, known) || Drivers::state(name, online, known) || Tcp::state(name, online, known) ||
         Modbus::state(name, online, known);
}

void statusJson(JsonObject o) {
  mtx.lock();
  o["interval"] = intervalS;
  o["lastRun"] = lastRunEpoch;
  o["nextIn"] = lastRunMs ? (int32_t)(intervalS * 1000 - (millis() - lastRunMs)) / 1000 : 0;
  JsonArray arr = o["hosts"].to<JsonArray>();
  for (auto& t : targets) {
    JsonObject j = arr.add<JsonObject>();
    j["kind"] = t.kind;
    j["id"] = t.id;
    j["name"] = t.name;
    j["ip"] = t.ip.toString();
    j["state"] = t.state < 0 ? "unknown" : t.state ? "online" : "offline";
    if (t.latency >= 0) j["latency"] = t.latency;
    j["lastSeen"] = t.lastSeen;
    j["lastCheck"] = t.lastCheck;
    j["history"] = t.history;
    j["checks"] = t.checks;
  }
  mtx.unlock();
}

void record(const char* kind, const String& name, const char* state) {
  mtx.lock();
  if (recQueue.size() >= 160) recQueue.pop_front();   // no stick or no clock for a long time (a KNX tunnel reads all addresses at once)
  recQueue.push_back({kind, name, state, now()});
  mtx.unlock();
  State::changed();   // online/offline, projector power, show-device on/off, mode: show it at once
}

void flushHistory() {
  uint32_t t = now();
  if (t < 1600000000UL || !Storage::mounted()) return;   // keep the queue until there's a clock and a stick
  mtx.lock();
  std::deque<Rec> q;
  q.swap(recQueue);
  mtx.unlock();
  if (q.empty() && histBooted && t - histLastWrite < KD_HISTORY_ALIVE_S) return;

  uint32_t day = t / 86400;
  mkdir(KD_HISTORY_DIR, 0777);
  FILE* f = fopen(dayPath(day).c_str(), "a");
  if (!f) return;   // the lines are lost; the next change tries again
  if (day != histDay) {
    // A new day file: start it with the state of every device.
    for (auto& r : lastRec) fprintf(f, "%lu %s %s %s\n", (unsigned long)t, r.state.c_str(), r.kind.c_str(), r.name.c_str());
    if (histDay) remove(dayPath(day - KD_HISTORY_DAYS).c_str());
    histDay = day;
  }
  if (!histBooted) {
    // Lines queued before the clock was set get the boot time.
    uint32_t bootAt = t - millis() / 1000;
    fprintf(f, "%lu boot - -\n", (unsigned long)bootAt);
    for (auto& r : q) if (r.at < 1600000000UL) r.at = bootAt;
    histBooted = true;
  }
  if (q.empty()) fprintf(f, "%lu alive - -\n", (unsigned long)t);
  for (auto& r : q) {
    fprintf(f, "%lu %s %s %s\n", (unsigned long)(r.at < 1600000000UL ? t : r.at), r.state.c_str(), r.kind.c_str(), r.name.c_str());
    String ln = lane(r.state);
    auto it = std::find_if(lastRec.begin(), lastRec.end(),
                           [&](const Rec& x) { return x.kind == r.kind && x.name == r.name && lane(x.state) == ln; });
    if (it != lastRec.end()) it->state = r.state;
    else lastRec.push_back(r);
  }
  fclose(f);
  histLastWrite = t;
}

void historyJson(const String& name, uint32_t from, uint32_t to, String& out) {
  out = "[";
  if (to > from + 7 * 86400) to = from + 7 * 86400;
  char line[160];
  for (uint32_t day = from / 86400; day <= to / 86400; day++) {
    FILE* f = Storage::mounted() ? fopen(dayPath(day).c_str(), "r") : nullptr;
    if (!f) continue;
    bool past = false;
    while (fgets(line, sizeof(line), f)) {
      // "epoch state kind name"; the name may contain spaces
      char* p = line;
      uint32_t e = strtoul(p, &p, 10);
      if (e > to) { past = true; break; }
      char state[64], kind[16];
      int used = 0;
      if (sscanf(p, " %63s %15s %n", state, kind, &used) < 2 || !used) continue;
      String n = String(p + used);
      n.trim();
      bool ctl = !strcmp(state, "boot") || !strcmp(state, "alive");
      if (!ctl && !n.equalsIgnoreCase(name)) continue;
      if (out.length() > 1) out += ',';
      out += "[" + String(e) + ",\"" + state + "\"]";
    }
    fclose(f);
    if (past) break;
  }
  out += "]";
}

}  // namespace Monitor
