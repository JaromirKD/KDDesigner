#include "Triggers.h"
#include <EthernetUdp.h>
#include <time.h>
#include <vector>
#include "Board.h"
#include "Cmd.h"
#include "Clock.h"
#include "Drivers.h"
#include "Globals.h"
#include "Log.h"
#include "Monitor.h"
#include "Net.h"
#include "Osc.h"
#include "Projectors.h"
#include "Show.h"
#include "State.h"
#include "Util.h"

namespace {
enum class Type { Startup, Time, Interval, Udp, Osc, Input, TimelineEnd, Mode, Panel, DmxChange, Device, Projector, Variable, TcpLine, HttpResp, Manual, Sequence, DmxIn, Comment, Unknown };
// What a trigger does when it fires while it still runs (waits in a sleep, wait or loop).
enum WhileRunning : uint8_t { kAgain, kIgnore, kRestart, kQueue };

struct Table { String name; std::vector<String> values; };

struct Trigger {
  int id = 0;
  String name;
  bool enabled = true;
  Type type = Type::Unknown;
  std::vector<String> actions;
  std::vector<String> conditions;
  int hh = 0, mm = 0, ss = 0;
  int sun = 0, sunOffset = 0;   // time trigger at sunrise (1) / sunset (2) + offset minutes
  uint8_t days = 0x7f;          // bit per weekday, 0 = Sunday
  uint32_t intervalMs = 0, last = 0;
  String match;                 // udp text / osc address / mode / panel control
  String event;                 // panel: press|release|click
  uint16_t udpPort = 0;
  bool hasFromIp = false;
  IPAddress fromIp;
  int pin = -1;
  String io;                    // input: Machine Control point (in3, io5, ai0) instead of a pin
  float level = 5;              // input on an analog point: fires when crossing this value
  bool rising = true, falling = false;
  int state = -1;
  uint32_t changedAt = 0;
  int timeline = 0;
  int universe = -1;            // dmx_change: universe index
  std::vector<uint16_t> channels;  // dmx_change: 0-based channels, in index order
  std::vector<uint8_t> lastValues;
  std::vector<Table> tables;
  int alarm = -1;               // projector: part 0-5, Projectors::kLampHours, -1 = any error part
  int alarmLevel = 1;           // projector: 1 warning (or worse), 2 error, 0 back to ok
  int hours = 3000;             // projector: lamp hours limit
  uint32_t rateStart = 0;       // feedback guard: fires counted in the second from rateStart
  int rateCount = 0;
  uint32_t pausedUntil = 0;     // != 0: paused as a loop until then
  uint32_t cooldownMs = 0, lastRun = 0;   // fires within cooldownMs after a run are skipped
  uint8_t whileRunning = kAgain;
  // input / panel: "hold" fires after holdMs held down, "double" on a second press within withinMs.
  // sequence: withinMs = from the first step to the last.
  bool hold = false, dbl = false;
  uint32_t holdMs = 2000, withinMs = 500, pressAt = 0, lastPress = 0;
  std::vector<int> steps;       // sequence: the trigger ids that must fire in this order
  size_t seqPos = 0;
  uint32_t seqStart = 0;
  int dmxIn = -1;               // dmx_in: input slot in Net, channels/lastValues as dmx_change
  uint8_t when = 0;             // dmx_in: 0 any change, 1 goes above level, 2 goes below level
  uint32_t inFrames = 0;
  String onlyGroup;             // "onlyIn": only fires (not by hand) while this group is in one of onlyStates
  std::vector<String> onlyStates;
  bool internal = false;        // a mode state's enter / leave actions (not in the project's list)
};

// A mode state's "enter" / "leave" actions run as hidden Manual triggers (so sleep, wait and
// repeat work in them), numbered from kModeActId.
const int kModeActId = 20001;
struct ModeActs { String group, state; int enter = 0, leave = 0; };
std::vector<ModeActs> modeActs;

struct UdpListener {
  uint16_t port = 0;
  EthernetUDP udp;
  bool open = false;
};

enum JobKind : uint8_t { kFire, kWait, kLoop, kQueued };
struct Scheduled {
  int id;
  uint32_t due;
  uint32_t every;               // 0 = one-shot (fire trigger ... after)
  int remaining;                // repeats left, -1 = forever
  int count;
  Vars vars;
  int line = -1;                // >= 0: the rest of a trigger's actions after a "sleep" (part of a run)
  int by = 0;                   // the trigger that scheduled it (for the log / the UI flow view)
  uint8_t kind = kFire;         // kWait: "wait until" text, due = timeout (0 none); kLoop: "repeat <n> times"
  String text;                  //   line = the repeat line, count = next {i}, remaining = runs left, text = command
};                              // kQueued: fire again when the current run ends (never due)

// Last fires for the history strip: src 0 = its own event, 1-9999 = from that trigger,
// 0x8000 | n = timeline n, kSrcHand/Repeat/Delayed/Queued as below.
struct Fired { uint32_t ms; uint16_t id, src; };
const uint16_t kSrcHand = 0xffff, kSrcRepeat = 0xfffe, kSrcDelayed = 0xfffd, kSrcQueued = 0xfffc;

std::vector<Trigger> triggers;
UdpListener listeners[KD_MAX_UDP_PORTS];  // [0] is the global command/trigger port
std::vector<Scheduled> scheduled;
uint32_t udpCount = 0;
uint32_t lastSecond = 0;
int depth = 0;                  // nested "fire trigger" guard
int running = 0;                // trigger whose actions run now: "fired (… from trigger N)" in the log
bool safe = false;              // safe mode: only triggers fired by hand (UI / console) run
int userRun = 0;                // > 0 while a trigger fired by hand runs
bool ownSeen = false;           // logged that our own packets come back (broadcast)
uint32_t lastFullWarn = 0;
uint32_t lastWaitCheck = 0;
uint8_t pkt[600];
Fired history[KD_TRIGGER_HISTORY];
size_t histCount = 0, histNext = 0;

void remember(const Trigger& t, const char* reason) {
  // One per channel per frame: they would push everything else out.
  if (t.type == Type::DmxChange || (t.type == Type::DmxIn && t.when == 0) || t.internal) return;
  uint16_t src = 0;
  if (!strcmp(reason, "repeat")) src = kSrcRepeat;
  else if (!strcmp(reason, "delayed")) src = kSrcDelayed;
  else if (!strcmp(reason, "queued")) src = kSrcQueued;
  else if (running && running != t.id) src = running;
  else if (userRun) src = kSrcHand;
  else if (!strncmp(reason, "timeline ", 9)) src = 0x8000 | atoi(reason + 9);
  history[histNext] = {millis(), (uint16_t)t.id, src};
  histNext = (histNext + 1) % KD_TRIGGER_HISTORY;
  if (histCount < KD_TRIGGER_HISTORY) histCount++;
}

// Seconds: "2" or "0.5" (isNumber is whole numbers only).
bool isSeconds(const String& s) {
  if (!s.length()) return false;
  int dots = 0;
  for (size_t i = 0; i < s.length(); i++) {
    if (s[i] == '.') dots++;
    else if (!isdigit(s[i])) return false;
  }
  return dots <= 1 && s != ".";
}

// A duration: "90" / "90s" seconds, "10m" minutes, "2h" / "1.5h" hours.
bool parseDuration(const String& s, uint32_t& secs) {
  if (!s.length()) return false;
  char u = tolower(s[s.length() - 1]);
  bool unit = u == 's' || u == 'm' || u == 'h';
  String n = unit ? s.substring(0, s.length() - 1) : s;
  if (!isSeconds(n)) return false;
  secs = (uint32_t)(n.toFloat() * (u == 'h' ? 3600 : u == 'm' ? 60 : 1) + 0.5f);
  return true;
}

// A run of trigger id is still going: the rest of its actions waits in a sleep, wait or loop.
bool isRunning(int id) {
  for (auto& s : scheduled) if (s.id == id && s.line >= 0) return true;
  return false;
}

// Every waiting sleep / delayed fire / repeat takes memory; a loop that keeps
// adding them would run the board out of it and crash it.
bool schedule(const Scheduled& job, String* msg = nullptr) {
  if (scheduled.size() >= KD_MAX_SCHEDULED) {
    if (!lastFullWarn || millis() - lastFullWarn > 5000) {
      lastFullWarn = millis();
      LOGW(Trig, "Trigger %d: %d fires/sleeps are already waiting - this one is dropped (loop?)", job.id, KD_MAX_SCHEDULED);
    }
    if (msg) *msg = "too many waiting fires (max " + String(KD_MAX_SCHEDULED) + ")";
    return false;
  }
  scheduled.push_back(job);
  return true;
}

// Feedback guard: a trigger that fires itself again (through a variable, an echoed
// UDP packet, "fire ... after 0", a timeline it restarts) would never stop. The
// nesting limit doesn't see those: each round starts fresh from a queue.
bool overloaded(Trigger& t, uint32_t now) {
  if (t.pausedUntil) {
    if ((int32_t)(now - t.pausedUntil) < 0) return true;
    t.pausedUntil = 0;
    t.rateCount = 0;
    LOGI(Trig, "Trigger %d '%s' runs again", t.id, t.name.c_str());
  }
  if (t.type == Type::DmxChange || t.type == Type::DmxIn) return false;
  if (now - t.rateStart >= 1000) { t.rateStart = now; t.rateCount = 0; }
  if (++t.rateCount <= KD_TRIGGER_MAX_PER_S) return false;
  t.pausedUntil = (now + KD_TRIGGER_PAUSE_MS) | 1;
  LOGE(Trig, "Trigger %d '%s' fired over %d times in a second - paused for %d s (feedback loop?)", t.id, t.name.c_str(),
       KD_TRIGGER_MAX_PER_S, KD_TRIGGER_PAUSE_MS / 1000);
  return true;
}

Type parseType(const char* s) {
  static const struct { const char* n; Type t; } kTypes[] = {
      {"startup", Type::Startup}, {"time", Type::Time}, {"interval", Type::Interval}, {"udp", Type::Udp},
      {"osc", Type::Osc}, {"input", Type::Input}, {"timeline_end", Type::TimelineEnd}, {"mode", Type::Mode},
      {"panel", Type::Panel}, {"dmx_change", Type::DmxChange}, {"device", Type::Device}, {"projector", Type::Projector}, {"variable", Type::Variable},
      {"tcp", Type::TcpLine}, {"http", Type::HttpResp}, {"manual", Type::Manual},
      {"sequence", Type::Sequence}, {"dmx_in", Type::DmxIn}, {"comment", Type::Comment}};
  for (auto& k : kTypes) if (!strcmp(s, k.n)) return k.t;
  return Type::Unknown;
}

Trigger* byId(int id) {
  for (auto& t : triggers) if (t.id == id) return &t;
  return nullptr;
}

int weekday(const String& d) {
  static const char* const kDays[] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};
  for (int i = 0; i < 7; i++) if (d.equalsIgnoreCase(kDays[i])) return i;
  return -1;
}

bool localTime(struct tm& tmv) { return Clock::localTime(tmv); }  // time zone + summer time

void runTrigger(Trigger& t, const char* reason, const Vars* vars);

// A run has nothing left waiting: a fire that was queued meanwhile goes now.
void runEnded(Trigger& t) {
  if (t.whileRunning != kQueue || isRunning(t.id)) return;
  for (size_t i = 0; i < scheduled.size(); i++) {
    if (scheduled[i].id != t.id || scheduled[i].kind != kQueued) continue;
    Vars v = scheduled[i].vars;
    scheduled.erase(scheduled.begin() + i);
    runTrigger(t, "queued", &v);
    return;
  }
}

// "<word>" or "<word> ..." at the start of a line, any case.
bool startsWord(const String& line, const char* w) {
  size_t n = strlen(w);
  return line.length() >= n && line.substring(0, n).equalsIgnoreCase(w) && (line.length() == n || line[n] == ' ');
}

// The text after the first n words (the raw line still has its quotes and {variables}).
String afterWords(const String& line, int n) {
  int i = 0, len = line.length();
  for (int k = 0; k < n; k++) {
    while (i < len && line[i] == ' ') i++;
    while (i < len && line[i] != ' ') i++;
  }
  String r = line.substring(i);
  r.trim();
  return r;
}

// Runs actions from line `from`. "sleep <s>", "wait until <condition>" and a
// "repeat <n> times every <s>" loop stop here and schedule the rest (with the same
// variables); "cancel trigger" drops it like a delayed fire.
void runActions(Trigger& t, size_t from, const Vars* vars) {
  String src = "trigger " + String(t.id);
  int was = running;
  running = t.id;
  depth++;
  bool later = false;           // the rest of the lines waits: the run isn't over
  for (size_t i = from; i < t.actions.size(); i++) {
    String line = expandVars(t.actions[i], vars);
    line.trim();
    if (startsWord(line, "sleep")) {
      String s = line.substring(5);
      s.trim();
      if (!isSeconds(s)) { LOGW(Cmd, "[%s] '%s' failed: expected: sleep <seconds>", src.c_str(), line.c_str()); continue; }
      if (i + 1 < t.actions.size()) {
        Scheduled job{t.id, millis() + (uint32_t)(s.toFloat() * 1000), 0, 0, 1, vars ? *vars : Vars()};
        job.line = i + 1;
        later = schedule(job);
        if (later) LOGD(Cmd, "[%s] sleep %s s", src.c_str(), s.c_str());
      }
      break;
    }
    if (startsWord(line, "wait")) {
      // wait until <condition> [timeout <s>]: checked every KD_WAIT_CHECK_MS in poll.
      String cond = line.substring(4), err;
      cond.trim();
      if (!startsWord(cond, "until")) { LOGW(Cmd, "[%s] '%s' failed: expected: wait until <condition> [timeout <seconds>]", src.c_str(), line.c_str()); continue; }
      cond = cond.substring(5);
      cond.trim();
      uint32_t timeout = 0;
      String low = cond;
      low.toLowerCase();
      int k = low.lastIndexOf(" timeout ");
      if (k > 0) {
        String s = cond.substring(k + 9);
        s.trim();
        if (isSeconds(s)) { timeout = (uint32_t)(s.toFloat() * 1000); cond = cond.substring(0, k); cond.trim(); }
      }
      if (Triggers::checkCondition(cond, err)) continue;   // already true: carry on
      if (err.length()) { LOGW(Cmd, "[%s] wait until '%s': %s", src.c_str(), cond.c_str(), err.c_str()); break; }
      if (i + 1 < t.actions.size()) {
        Scheduled job{t.id, timeout ? (millis() + timeout) | 1 : 0, 0, 0, 1, vars ? *vars : Vars()};
        job.line = i + 1;
        job.kind = kWait;
        job.text = cond;
        later = schedule(job);
        if (later) LOGD(Cmd, "[%s] waiting until %s", src.c_str(), cond.c_str());
      }
      break;
    }
    if (startsWord(line, "repeat")) {
      // repeat <n> times [every <s>] <command>, or repeat <trigger> <n> times [every|for <s>]
      // (= fire trigger <trigger> each round): {i} = 1..n. The lines below run after the last one.
      std::vector<String> w = Cmd::tokenize(line);
      bool cmdLoop = w.size() >= 4 && isNumber(w[1]) && w[2].equalsIgnoreCase("times");
      bool trigLoop = !cmdLoop && w.size() >= 4 && !w[1].equalsIgnoreCase("trigger") && isNumber(w[2]) && w[3].equalsIgnoreCase("times") &&
                      (w.size() == 4 || (w.size() == 6 && (w[4].equalsIgnoreCase("every") || w[4].equalsIgnoreCase("for")) && isSeconds(w[5])));
      if (cmdLoop || trigLoop) {
        bool every = cmdLoop ? w.size() >= 6 && w[3].equalsIgnoreCase("every") && isSeconds(w[4]) : w.size() == 6;
        int n = (cmdLoop ? w[1] : w[2]).toInt();
        uint32_t ms = every ? (uint32_t)((cmdLoop ? w[4] : w[5]).toFloat() * 1000) : 0;
        String cmd = cmdLoop ? afterWords(t.actions[i], every ? 5 : 3) : "fire trigger \"" + w[1] + "\"";
        Vars v = vars ? *vars : Vars();
        int k = 1;
        for (; k <= n && (k == 1 || !ms); k++) {
          v.set("i", String(k));
          v.set("count", String(k));   // as "repeat trigger" gives the trigger it fires
          String reply;
          Cmd::exec(cmd, reply, src.c_str(), &v);
        }
        if (k > n) continue;   // all done: next line
        Scheduled job{t.id, millis() + ms, ms, n - k + 1, k, v};
        job.line = i;
        job.kind = kLoop;
        job.text = cmd;
        later = schedule(job);
        break;
      }
    }
    String reply;
    Cmd::exec(t.actions[i], reply, src.c_str(), vars);
  }
  depth--;
  running = was;
  if (!later) runEnded(t);
}

// A trigger fired: move the sequences it is a step of along.
void stepFired(const Trigger& t, uint32_t now) {
  for (auto& s : triggers) {
    if (!s.enabled || s.type != Type::Sequence || s.steps.empty() || s.id == t.id) continue;
    if (std::find(s.steps.begin(), s.steps.end(), t.id) == s.steps.end()) continue;
    if (s.seqPos && now - s.seqStart > s.withinMs) s.seqPos = 0;   // too slow: start again
    if (s.steps[s.seqPos] != t.id) s.seqPos = 0;                    // out of order: start again
    if (s.steps[s.seqPos] != t.id) continue;
    if (!s.seqPos) s.seqStart = now;
    if (++s.seqPos < s.steps.size()) continue;
    s.seqPos = 0;
    runTrigger(s, "sequence", nullptr);
  }
}

void runTrigger(Trigger& t, const char* reason, const Vars* vars) {
  if (t.type == Type::Comment) return;
  if (safe && !userRun) { LOGD(Trig, "Trigger %d '%s' not run (%s): safe mode", t.id, t.name.c_str(), reason); return; }
  for (auto& c : t.conditions) {
    String err;
    if (!Triggers::checkCondition(c, err)) {
      if (err.length()) LOGW(Trig, "Trigger %d '%s': condition '%s' invalid: %s", t.id, t.name.c_str(), c.c_str(), err.c_str());
      else LOGD(Trig, "Trigger %d '%s' skipped (%s): '%s' is false", t.id, t.name.c_str(), reason, c.c_str());
      return;
    }
  }
  if (depth > 8) { LOGE(Trig, "Trigger %d: nesting too deep (loop?)", t.id); return; }
  // "Only active in": like a switched-off trigger while the group is in another state. Fired by
  // hand still runs, so it can be tested.
  if (t.onlyGroup.length() && !(userRun && !running)) {
    const String& cur = State::current(State::findGroup(t.onlyGroup));
    bool in = false;
    for (auto& s : t.onlyStates) if (s.equalsIgnoreCase(cur)) in = true;
    if (!in) { LOGD(Trig, "Trigger %d '%s' skipped (%s): only active when %s is %s", t.id, t.name.c_str(), reason, t.onlyGroup.c_str(), t.onlyStates.empty() ? "?" : t.onlyStates[0].c_str()); return; }
  }
  uint32_t now = millis();
  // Fired by hand ("Fire now", the console) skips the cooldown, so it can be tested.
  if (t.cooldownMs && t.lastRun && now - t.lastRun < t.cooldownMs && !(userRun && !running)) {
    LOGD(Trig, "Trigger %d '%s' skipped (%s): cooldown, %lu ms left", t.id, t.name.c_str(), reason, (unsigned long)(t.cooldownMs - (now - t.lastRun)));
    return;
  }
  if (t.whileRunning != kAgain && strcmp(reason, "queued") && isRunning(t.id)) {
    if (t.whileRunning == kIgnore) { LOGD(Trig, "Trigger %d '%s' ignored (%s): still running", t.id, t.name.c_str(), reason); return; }
    if (t.whileRunning == kQueue) {
      for (auto& s : scheduled) if (s.id == t.id && s.kind == kQueued) { LOGD(Trig, "Trigger %d '%s' ignored (%s): one is already queued", t.id, t.name.c_str(), reason); return; }
      Scheduled job{t.id, 0, 0, 0, 1, vars ? *vars : Vars()};
      job.kind = kQueued;
      if (schedule(job)) LOGD(Trig, "Trigger %d '%s' queued (%s): runs when the current run ends", t.id, t.name.c_str(), reason);
      return;
    }
    // Restart: drop what the current run still had waiting.
    for (size_t i = 0; i < scheduled.size();)
      if (scheduled[i].id == t.id && scheduled[i].line >= 0) scheduled.erase(scheduled.begin() + i); else i++;
    LOGD(Trig, "Trigger %d '%s' restarts (%s)", t.id, t.name.c_str(), reason);
  }
  if (overloaded(t, now)) return;
  t.lastRun = now | 1;
  // The web UI reads this line (flow view on the Triggers page): keep "fired (<reason>[ from trigger N])".
  char from[24] = "";
  if (running && running != t.id) snprintf(from, sizeof(from), " from trigger %d", running);
  if (t.type == Type::DmxChange || (t.type == Type::DmxIn && t.when == 0)) LOGD(Trig, "Trigger %d '%s' fired (%s%s)", t.id, t.name.c_str(), reason, from);
  else LOGI(Trig, "Trigger %d '%s' fired (%s%s)", t.id, t.name.c_str(), reason, from);
  remember(t, reason);
  runActions(t, 0, vars);
  stepFired(t, now);
}

// An input switched on or off. Plain edges fire now; "hold" starts the clock (fired
// in poll), "double" fires on a second press within withinMs.
void inputEdge(Trigger& t, bool on, uint32_t now, const Vars* vars) {
  if (t.hold) { t.pressAt = on ? (now | 1) : 0; return; }
  if (t.dbl) {
    if (!on) return;
    if (t.lastPress && now - t.lastPress <= t.withinMs) { t.lastPress = 0; runTrigger(t, "double press", vars); }
    else t.lastPress = now | 1;
    return;
  }
  if ((on && t.rising) || (!on && t.falling)) runTrigger(t, on ? "input rising" : "input falling", vars);
}

// A new frame on a DMX input: fire for each watched channel that changed (or crossed the level).
void dmxInCheck(Trigger& t) {
  uint32_t frames;
  const uint8_t* d = Net::dmxIn(t.dmxIn, frames);
  if (!d || frames == t.inFrames) return;
  t.inFrames = frames;
  if (t.lastValues.size() != t.channels.size()) {   // first frame: only note where it starts
    t.lastValues.clear();
    for (auto c : t.channels) t.lastValues.push_back(d[c]);
    return;
  }
  for (size_t i = 0; i < t.channels.size(); i++) {
    uint8_t v = d[t.channels[i]], old = t.lastValues[i];
    if (v == old) continue;
    t.lastValues[i] = v;
    if ((t.when == 1 && !(old < t.level && v >= t.level)) || (t.when == 2 && !(old >= t.level && v < t.level))) continue;
    Vars vars;
    vars.set("channel", String(t.channels[i] + 1));
    vars.set("index", String(i + 1));
    vars.set("value", String(v));
    vars.set("old", String(old));
    runTrigger(t, "dmx in", &vars);
  }
}

bool udpMatches(const String& pattern, const String& msg, Vars& vars) {
  if (pattern.endsWith("*")) {
    String prefix = pattern.substring(0, pattern.length() - 1);
    if (!msg.startsWith(prefix)) return false;
    String rest = msg.substring(prefix.length());
    rest.trim();
    vars.set("1", rest);
    return true;
  }
  return msg == pattern;
}

void sendPacket(UdpListener& l, const IPAddress& ip, uint16_t port, const uint8_t* data, size_t len) {
  l.udp.beginPacket(ip, port);
  l.udp.write(data, len);
  l.udp.endPacket();
}

// Who sent it, so "reply" can answer on the same socket.
void senderVars(Vars& vars, IPAddress from, uint16_t fromPort, int listener) {
  vars.set("sender_ip", from.toString());
  vars.set("sender_port", String(fromPort));
  vars.set("socket", String(listener));
}

void handleOsc(UdpListener& l, int listener, IPAddress from, uint16_t fromPort, const String& address, const std::vector<String>& args) {
  LOGD(Trig, "OSC :%u from %s: %s (%d args)", l.port, from.toString().c_str(), address.c_str(), (int)args.size());
  Vars vars;
  vars.set("address", address);
  senderVars(vars, from, fromPort, listener);
  for (size_t i = 0; i < args.size(); i++) vars.set(String(i + 1), args[i]);
  for (auto& t : triggers) {
    if (!t.enabled || t.type != Type::Osc || t.udpPort != l.port) continue;
    if (t.hasFromIp && t.fromIp != from) continue;
    if (Osc::match(t.match.c_str(), address.c_str())) runTrigger(t, "osc", &vars);
  }
}

void handleUdp(UdpListener& l, int listener, bool isCommandPort) {
  int len;
  while ((len = l.udp.parsePacket()) > 0) {
    int n = l.udp.read(pkt, sizeof(pkt) - 1);
    l.udp.flush();
    if (n <= 0) continue;
    pkt[n] = 0;
    udpCount++;
    IPAddress from = l.udp.remoteIP();
    uint16_t fromPort = l.udp.remotePort();
    // Our own packets (a broadcast "udp send" comes back in) would fire our own
    // triggers - the most common feedback loop. Use "fire trigger" for that.
    if (from == Net::localIP()) {
      if (!ownSeen) { ownSeen = true; LOGI(Trig, "UDP :%u: ignoring packets from the controller itself (its own broadcast)", l.port); }
      continue;
    }

    String address;
    std::vector<String> args;
    if (pkt[0] == '/' && Osc::decode(pkt, n, address, args)) {
      // OSC "/kd/cmd" <command> on the command port runs it, like "cmd:" (e.g. "mode Museum Open").
      if (isCommandPort && address == "/kd/cmd" && !args.empty()) {
        String line, reply;
        for (auto& a : args) {
          if (line.length()) line += ' ';
          line += a;
        }
        Vars vars;
        senderVars(vars, from, fromPort, listener);
        bool ok = Cmd::exec(line, reply, "osc", &vars);
        reply = (ok ? "OK " : "ERR ") + reply;
        sendPacket(l, from, fromPort, (const uint8_t*)reply.c_str(), reply.length());
        continue;
      }
      handleOsc(l, listener, from, fromPort, address, args);
      continue;
    }

    String msg((const char*)pkt);
    msg.trim();
    LOGD(Trig, "UDP :%u from %s: '%s'", l.port, from.toString().c_str(), msg.c_str());
    if (Drivers::onUdp(from, msg)) continue;   // a BrightSign plugin report, not a trigger message
    Vars vars;
    vars.set("message", msg);
    senderVars(vars, from, fromPort, listener);
    if (isCommandPort && msg.startsWith("cmd:")) {
      String reply;
      bool ok = Cmd::exec(msg.substring(4), reply, "udp", &vars);
      reply = (ok ? "OK " : "ERR ") + reply;
      sendPacket(l, from, fromPort, (const uint8_t*)reply.c_str(), reply.length());
      continue;
    }
    bool matched = false;
    for (auto& t : triggers) {
      if (!t.enabled || t.type != Type::Udp || t.udpPort != l.port) continue;
      if (t.hasFromIp && t.fromIp != from) continue;
      if (udpMatches(t.match, msg, vars)) { runTrigger(t, "udp", &vars); matched = true; }
    }
    if (!matched) LOGD(Trig, "UDP '%s' matched no trigger", msg.c_str());
  }
}

void openListener(uint16_t port) {
  for (auto& l : listeners) if (l.open && l.port == port) return;
  for (auto& l : listeners) {
    if (l.open) continue;
    l.port = port;
    l.open = l.udp.begin(port);
    if (l.open) LOGI(Trig, "Listening for UDP/OSC on port %u", port);
    else LOGE(Trig, "Cannot open UDP port %u", port);
    return;
  }
  LOGE(Trig, "Too many UDP ports (max %d) - port %u ignored", KD_MAX_UDP_PORTS, port);
}

// "1-17" or "1,3,5-8" -> 0-based channel list
std::vector<uint16_t> parseChannels(const String& spec) {
  std::vector<uint16_t> out;
  int start = 0;
  while (start < (int)spec.length()) {
    int comma = spec.indexOf(',', start);
    String part = spec.substring(start, comma < 0 ? spec.length() : comma);
    int dash = part.indexOf('-');
    int a = part.toInt(), b = dash > 0 ? part.substring(dash + 1).toInt() : a;
    for (int c = a; c <= b && c <= 512 && out.size() < 64; c++) if (c >= 1) out.push_back(c - 1);
    if (comma < 0) break;
    start = comma + 1;
  }
  return out;
}
}  // namespace

namespace Triggers {

void load() {
  triggers.clear();
  scheduled.clear();
  ownSeen = false;
  bool inSacn[KD_MAX_DMX_IN];
  uint16_t inUni[KD_MAX_DMX_IN];
  int nIn = 0;
  for (JsonObjectConst o : Show::projectDoc()["triggers"].as<JsonArrayConst>()) {
    Trigger t;
    t.id = o["id"] | 0;
    t.name = o["name"] | "";
    t.enabled = o["enabled"] | true;
    t.type = parseType(o["type"] | "");
    t.cooldownMs = (uint32_t)((float)(o["cooldown"] | 0.0f) * 1000);
    const char* wr = o["whileRunning"] | "again";
    t.whileRunning = !strcmp(wr, "ignore") ? kIgnore : !strcmp(wr, "restart") ? kRestart : !strcmp(wr, "queue") ? kQueue : kAgain;
    t.holdMs = (uint32_t)((float)(o["hold"] | 2.0f) * 1000);
    t.withinMs = (uint32_t)((float)(o["within"] | (t.type == Type::Sequence ? 5.0f : 0.5f)) * 1000);
    for (JsonVariantConst a : o["actions"].as<JsonArrayConst>()) t.actions.push_back(a.as<const char*>());
    // "onlyIn": {"group": "Museum", "states": ["Open", "Starting up"]}
    t.onlyGroup = o["onlyIn"]["group"] | "";
    for (JsonVariantConst s : o["onlyIn"]["states"].as<JsonArrayConst>()) t.onlyStates.push_back(s.as<const char*>());
    if (t.onlyStates.empty()) t.onlyGroup = "";
    for (JsonVariantConst c : o["conditions"].as<JsonArrayConst>()) {
      String s = c.as<const char*>();
      s.trim();
      if (s.length()) t.conditions.push_back(s);
    }
    switch (t.type) {
      case Type::Time: {
        String at = o["at"] | "00:00:00";
        if (at == "sunrise" || at == "sunset") {
          t.sun = at == "sunrise" ? 1 : 2;
          t.sunOffset = o["offset"] | 0;
        } else {
          sscanf(at.c_str(), "%d:%d:%d", &t.hh, &t.mm, &t.ss);
        }
        JsonArrayConst days = o["days"];
        if (!days.isNull()) {
          t.days = 0;
          for (JsonVariantConst d : days) { int w = weekday(d | ""); if (w >= 0) t.days |= 1 << w; }
        }
        break;
      }
      case Type::Interval: t.intervalMs = (uint32_t)((float)(o["seconds"] | 60) * 1000); break;
      case Type::Udp:
      case Type::Osc: {
        t.match = t.type == Type::Udp ? (o["match"] | "") : (o["address"] | "/*");
        t.udpPort = o["port"] | Show::settings().udpPort;
        const char* from = o["fromIp"] | "";
        t.hasFromIp = *from && t.fromIp.fromString(from);
        break;
      }
      case Type::Input: {
        t.pin = o["pin"] | -1;
        String edge = o["edge"] | "rising";
        t.rising = edge == "rising" || edge == "both";
        t.falling = edge == "falling" || edge == "both";
        t.hold = edge == "hold";
        t.dbl = edge == "double";
        String io = o["io"] | "";
        if (io.length()) {
          String err;
          if (!Board::find(io, t.io, err)) LOGW(Trig, "Trigger %d: %s", t.id, err.c_str());
          t.level = o["level"] | 5.0f;
          t.pin = -1;
        } else if (t.pin >= 0) {
          pinMode(t.pin, INPUT_PULLUP);
        }
        break;
      }
      case Type::TimelineEnd: t.timeline = o["timeline"] | 0; break;
      case Type::Mode: t.match = o["mode"] | ""; t.event = o["group"] | ""; break;  // "" = any
      case Type::Panel:
        t.match = o["control"] | "";
        t.event = o["event"] | "click";
        t.hold = t.event == "hold";
        t.dbl = t.event == "double";
        break;
      case Type::DmxIn: {
        // Each distinct protocol + universe takes one of Net's KD_MAX_DMX_IN input slots.
        bool sacn = !strcmp(o["protocol"] | "artnet", "sacn");
        uint16_t uni = o["universe"] | (sacn ? 1 : 0);
        t.channels = parseChannels(o["channels"] | "1");
        String when = o["when"] | "change";
        t.when = when == "above" ? 1 : when == "below" ? 2 : 0;
        t.level = o["level"] | 128;
        for (int k = 0; k < nIn && t.dmxIn < 0; k++) if (inSacn[k] == sacn && inUni[k] == uni) t.dmxIn = k;
        if (t.dmxIn < 0 && nIn < KD_MAX_DMX_IN) { inSacn[nIn] = sacn; inUni[nIn] = uni; t.dmxIn = nIn++; }
        if (t.dmxIn < 0) LOGW(Trig, "Trigger %d: more than %d DMX input universes - ignored", t.id, KD_MAX_DMX_IN);
        break;
      }
      case Type::Device: t.match = o["device"] | ""; t.event = o["state"] | "offline"; break;
      case Type::Projector: {
        t.match = o["projector"] | "";   // "" = any
        String alarm = o["alarm"] | "any", level = o["level"] | "warning";
        t.alarm = -1;
        for (int k = 0; k <= Projectors::kLampHours; k++)
          if (alarm == (k == Projectors::kLampHours ? "lamp_hours" : Projectors::partName(k))) t.alarm = k;
        t.alarmLevel = level == "error" ? 2 : level == "ok" ? 0 : 1;
        t.hours = o["hours"] | 3000;
        break;
      }
      case Type::Variable: t.event = o["variable"] | ""; t.match = o["value"] | ""; break;   // "" = any
      case Type::TcpLine: t.event = o["device"] | ""; t.match = o["match"] | "*"; break;
      case Type::HttpResp: t.match = o["url"] | ""; break;                                   // URL prefix, "" = any
      case Type::DmxChange: {
        t.universe = Show::universeIndex(o["universe"] | 1);
        t.channels = parseChannels(o["channels"] | "1");
        if (t.universe >= 0) {
          const uint8_t* now = Show::output(t.universe);
          for (auto c : t.channels) t.lastValues.push_back(now[c]);
        } else {
          LOGW(Trig, "Trigger %d: unknown universe", t.id);
        }
        for (JsonPairConst p : o["tables"].as<JsonObjectConst>()) {
          Table tb;
          tb.name = p.key().c_str();
          for (JsonVariantConst v : p.value().as<JsonArrayConst>()) tb.values.push_back(v.is<const char*>() ? String(v.as<const char*>()) : String(v.as<long>()));
          t.tables.push_back(tb);
        }
        break;
      }
      case Type::Unknown: LOGW(Trig, "Trigger %d has unknown type '%s'", t.id, (const char*)(o["type"] | "")); break;
      default: break;
    }
    t.last = millis();
    triggers.push_back(t);
  }
  Net::setDmxInputs(inSacn, inUni, nIn);
  // Sequence steps refer to other triggers by name or number: resolved once all are loaded.
  size_t k = 0;
  for (JsonObjectConst o : Show::projectDoc()["triggers"].as<JsonArrayConst>()) {
    Trigger& t = triggers[k++];
    if (t.type != Type::Sequence) continue;
    for (JsonVariantConst s : o["steps"].as<JsonArrayConst>()) {
      String ref = s.is<const char*>() ? String(s.as<const char*>()) : String(s.as<long>()), err;
      ref.trim();
      if (!ref.length()) continue;
      int id = findId(ref, err);
      if (id < 0) LOGW(Trig, "Trigger %d: sequence step: %s", t.id, err.c_str());
      else t.steps.push_back(id);
    }
  }
  // Mode states' enter / leave actions: "modes": [{"name": "Museum", "states": [...],
  //   "stateInfo": {"Open": {"enter": ["start timeline Inloop"], "leave": [...]}}}]
  modeActs.clear();
  int nextId = kModeActId;
  for (JsonObjectConst g : Show::projectDoc()["modes"].as<JsonArrayConst>()) {
    for (JsonPairConst p : g["stateInfo"].as<JsonObjectConst>()) {
      ModeActs m;
      m.group = g["name"] | "";
      m.state = p.key().c_str();
      for (int leave = 0; leave < 2; leave++) {
        JsonArrayConst acts = p.value()[leave ? "leave" : "enter"];
        if (acts.isNull() || !acts.size()) continue;
        Trigger t;
        t.id = nextId++;
        t.name = m.group + " " + m.state + (leave ? " (leave)" : " (enter)");
        t.type = Type::Manual;
        t.internal = true;
        for (JsonVariantConst a : acts) t.actions.push_back(a.as<const char*>());
        (leave ? m.leave : m.enter) = t.id;
        triggers.push_back(t);
      }
      if (m.enter || m.leave) modeActs.push_back(m);
    }
  }
  LOGI(Trig, "%d trigger(s) loaded", (int)triggers.size() - (nextId - kModeActId));
}

void begin() {
  for (auto& l : listeners) {
    if (l.open) l.udp.stop();
    l.open = false;
  }
  openListener(Show::settings().udpPort);
  for (auto& t : triggers)
    if (t.type == Type::Udp || t.type == Type::Osc) openListener(t.udpPort);
}

void startup() {
  for (auto& t : triggers) if (t.enabled && t.type == Type::Startup) runTrigger(t, "startup", nullptr);
}

void poll(uint32_t now) {
  for (size_t i = 0; i < KD_MAX_UDP_PORTS; i++)
    if (listeners[i].open) handleUdp(listeners[i], i, listeners[i].port == Show::settings().udpPort);

  struct tm tmv;
  time_t utc = time(nullptr);
  if ((uint32_t)utc != lastSecond && localTime(tmv)) {
    lastSecond = utc;
    int nowMin = tmv.tm_hour * 60 + tmv.tm_min;
    int rise = -2, set = -2;  // computed once per second, only if needed
    for (auto& t : triggers) {
      if (!t.enabled || t.type != Type::Time || !(t.days & (1 << tmv.tm_wday))) continue;
      if (t.sun) {
        int& base = t.sun == 1 ? rise : set;
        if (base == -2) base = Clock::sunMinutes(t.sun == 1);
        if (base < 0 || tmv.tm_sec != 0) continue;
        if (nowMin == ((base + t.sunOffset) % 1440 + 1440) % 1440) runTrigger(t, t.sun == 1 ? "sunrise" : "sunset", nullptr);
      } else if (tmv.tm_hour == t.hh && tmv.tm_min == t.mm && tmv.tm_sec == t.ss) {
        runTrigger(t, "time", nullptr);
      }
    }
  }

  for (auto& t : triggers) {
    if (!t.enabled) continue;
    if (t.type == Type::Interval && t.intervalMs && now - t.last >= t.intervalMs) {
      t.last = now;
      runTrigger(t, "interval", nullptr);
    } else if (t.type == Type::Input && t.pin >= 0) {
      int s = digitalRead(t.pin);
      if (t.state < 0) { t.state = s; continue; }
      if (s != t.state && now - t.changedAt > 30) {  // 30 ms debounce
        t.changedAt = now;
        t.state = s;
        inputEdge(t, s, now, nullptr);
      }
      if (t.hold && t.pressAt && now - t.pressAt >= t.holdMs) { t.pressAt = 0; runTrigger(t, "input held", nullptr); }
    } else if (t.type == Type::Input && t.io.length()) {
      // Board inputs are debounced by Board; analog ones cross "level" with a little hysteresis.
      float v;
      if (!Board::value(t.io, v)) continue;
      bool analog = t.io.startsWith("ai") || t.io.startsWith("ao");
      float hyst = analog ? max(0.05f, fabsf(t.level) * 0.02f) : 0;
      int s = !analog ? v >= 0.5f : t.state == 1 ? v > t.level - hyst : v > t.level + hyst;
      if (t.state < 0) { t.state = s; continue; }
      bool held = t.hold && t.pressAt && now - t.pressAt >= t.holdMs;
      if (s == t.state && !held) continue;
      Vars vars;
      vars.set("input", t.io);
      vars.set("value", analog ? String(v, 2) : String(s));
      if (s != t.state) { t.state = s; inputEdge(t, s, now, &vars); }
      else { t.pressAt = 0; runTrigger(t, "input held", &vars); }
    } else if (t.type == Type::Panel && t.hold && t.pressAt && now - t.pressAt >= t.holdMs) {
      t.pressAt = 0;
      Vars vars;
      vars.set("control", t.match);
      vars.set("event", "hold");
      runTrigger(t, "panel hold", &vars);
    } else if (t.type == Type::DmxIn && t.dmxIn >= 0) {
      dmxInCheck(t);
    }
  }

  // Delayed and repeating fires, waits and loops. Work on a copy: actions may schedule more.
  bool checkWaits = now - lastWaitCheck >= KD_WAIT_CHECK_MS;
  if (checkWaits) lastWaitCheck = now;
  for (size_t i = 0; i < scheduled.size();) {
    Scheduled& s = scheduled[i];
    if (s.kind == kQueued) { i++; continue; }   // runs when its trigger's current run ends
    if (s.kind == kWait) {
      if (!checkWaits) { i++; continue; }
      String err;
      bool ok = checkCondition(s.text, err);
      bool late = !ok && s.due && (int32_t)(now - s.due) >= 0;
      if (!ok && !late) { i++; continue; }
      Scheduled job = s;
      scheduled.erase(scheduled.begin() + i);
      Trigger* t = byId(job.id);
      if (!t) continue;
      if (ok) runActions(*t, job.line, &job.vars);
      else { LOGW(Trig, "Trigger %d '%s': wait until %s - timed out, the rest is skipped", t->id, t->name.c_str(), job.text.c_str()); runEnded(*t); }
      continue;
    }
    if ((int32_t)(now - s.due) < 0) { i++; continue; }
    Scheduled job = s;
    if (job.kind == kLoop) {
      if (job.remaining > 1) { s.due += s.every; s.count++; s.remaining--; i++; }
      else scheduled.erase(scheduled.begin() + i);
      Trigger* t = byId(job.id);
      if (!t) continue;
      job.vars.set("i", String(job.count));
      job.vars.set("count", String(job.count));
      String reply, src = "trigger " + String(t->id);
      running = t->id;
      depth++;
      Cmd::exec(job.text, reply, src.c_str(), &job.vars);
      depth--;
      running = 0;
      if (job.remaining <= 1) runActions(*t, job.line + 1, &job.vars);   // the last one: carry on below
      continue;
    }
    if (job.every && (job.remaining < 0 || job.remaining > 1)) {
      s.due += job.every;
      s.count++;
      if (s.remaining > 0) s.remaining--;
      i++;
    } else {
      scheduled.erase(scheduled.begin() + i);
    }
    if (job.line >= 0) {
      // After a sleep: carry on, without checking the conditions again.
      if (Trigger* t = byId(job.id)) runActions(*t, job.line, &job.vars);
    } else if (Trigger* t = byId(job.id)) {
      job.vars.set("count", String(job.count));
      running = job.by;
      runTrigger(*t, job.every ? "repeat" : "delayed", &job.vars);
      running = 0;
    }
  }
}

void afterTick() {
  for (auto& t : triggers) {
    if (!t.enabled || t.type != Type::DmxChange || t.universe < 0) continue;
    const uint8_t* out = Show::output(t.universe);
    for (size_t i = 0; i < t.channels.size(); i++) {
      uint8_t v = out[t.channels[i]];
      if (v == t.lastValues[i]) continue;
      t.lastValues[i] = v;
      Vars vars;
      vars.set("channel", String(t.channels[i] + 1));
      vars.set("index", String(i + 1));
      vars.set("value", String(v));
      for (auto& tb : t.tables)
        if (i < tb.values.size()) vars.set(tb.name, tb.values[i]);
      runTrigger(t, "dmx change", &vars);
    }
  }
}

void onTimelineEnd(int timelineId) {
  for (auto& t : triggers)
    if (t.enabled && t.type == Type::TimelineEnd && t.timeline == timelineId) runTrigger(t, ("timeline " + String(timelineId) + " end").c_str(), nullptr);
}

void onTimelineCue(int timelineId, const String& ref) {
  String err;
  int id = findId(ref, err);
  if (id < 0) { LOGW(Trig, "Timeline %d: trigger cue: %s", timelineId, err.c_str()); return; }
  Vars vars;
  vars.set("timeline", String(timelineId));
  runTrigger(*byId(id), ("timeline " + String(timelineId) + " cue").c_str(), &vars);
}

bool changeMode(int g, int s, String& msg, const char* by) {
  String old = State::current(g);
  if (!State::setMode(g, s, msg, by)) return true;   // already in that state: nothing runs
  String group = State::groupName(g), state = State::current(g);
  Vars vars;
  vars.set("group", group);
  vars.set("mode", state);
  vars.set("old", old);
  // The old state's leave actions, the new one's enter actions, then the Mode change triggers.
  for (auto& m : modeActs)
    if (m.leave && m.group == group && m.state == old) if (Trigger* t = byId(m.leave)) runTrigger(*t, "mode leave", &vars);
  for (auto& m : modeActs)
    if (m.enter && m.group == group && m.state == state) if (Trigger* t = byId(m.enter)) runTrigger(*t, "mode enter", &vars);
  for (auto& t : triggers)
    if (t.enabled && t.type == Type::Mode && (!t.event.length() || t.event.equalsIgnoreCase(group)) &&
        (!t.match.length() || t.match.equalsIgnoreCase(state)))
      runTrigger(t, "mode change", &vars);
  // The linked variable follows: the state's name, or its number for a number variable.
  const String& v = State::groupVar(g);
  String vm;
  if (v.length() && !Globals::set(v, state, vm) && !Globals::set(v, String(s + 1), vm)) LOGW(Trig, "Mode %s: %s", group.c_str(), vm.c_str());
  return true;
}

void onVariable(const String& name, const String& value, const String& old) {
  // A mode group linked to this variable goes to the state it names (or numbers), but only
  // for the variable's current value: changes are queued, and acting on an older one made a
  // mode and a variable linked to a PLC register flip each other forever (each mode change
  // sets the variable again, behind the newer queued value). The newer change decides.
  String current;
  bool stale = Globals::get(name, current) && current != value;
  for (int g = 0; g < State::groupCount() && !stale; g++) {
    if (!State::groupVar(g).equalsIgnoreCase(name)) continue;
    int s = State::findState(g, value);
    if (s < 0) { LOGW(Trig, "Variable %s = '%s' is not a state of mode %s", name.c_str(), value.c_str(), State::groupName(g).c_str()); continue; }
    String msg, by = "variable " + name;
    changeMode(g, s, msg, by.c_str());
  }
  Vars vars;
  vars.set("variable", name);
  vars.set("value", value);
  vars.set("old", old);
  for (auto& t : triggers)
    if (t.enabled && t.type == Type::Variable && (!t.event.length() || t.event.equalsIgnoreCase(name)) &&
        (!t.match.length() || t.match.equalsIgnoreCase(value) || (t.match == "on" && value == "1") || (t.match == "off" && value == "0")))
      runTrigger(t, "variable", &vars);
}

void onTcpLine(const String& device, const String& line) {
  Vars vars;
  vars.set("device", device);
  vars.set("message", line);
  for (auto& t : triggers) {
    if (!t.enabled || t.type != Type::TcpLine || (t.event.length() && !t.event.equalsIgnoreCase(device))) continue;
    if (t.match == "*" || !t.match.length()) { runTrigger(t, "tcp", &vars); continue; }
    if (udpMatches(t.match, line, vars)) runTrigger(t, "tcp", &vars);   // exact or prefix* (rest -> {1})
  }
}

void onHttpResponse(const String& method, const String& url, int status, const String& body) {
  Vars vars;
  vars.set("url", url);
  vars.set("method", method);
  vars.set("status", String(status));
  vars.set("body", body);
  for (auto& t : triggers)
    if (t.enabled && t.type == Type::HttpResp && (!t.match.length() || url.startsWith(t.match)))
      runTrigger(t, "http response", &vars);
}

void onDeviceState(const String& kind, const String& name, bool online) {
  Vars vars;
  vars.set("device", name);
  vars.set("kind", kind);
  vars.set("state", online ? "online" : "offline");
  for (auto& t : triggers) {
    if (!t.enabled || t.type != Type::Device) continue;
    if (t.match.length() && !t.match.equalsIgnoreCase(name)) continue;
    if (!t.event.equalsIgnoreCase("any") && t.event.equalsIgnoreCase("online") != online) continue;
    runTrigger(t, online ? "device online" : "device offline", &vars);
  }
}

void onProjectorAlarm(const Projectors::Alarm& a) {
  bool lamp = a.part == Projectors::kLampHours;
  static const char* const kLevels[] = {"ok", "warning", "error"};
  Vars vars;
  vars.set("projector", a.projector);
  vars.set("alarm", Projectors::partName(a.part));
  vars.set("lamp", a.lamp >= 0 ? String(a.lamp) : String("?"));
  vars.set("state", lamp ? String("over the limit") : String(kLevels[a.to]));
  for (auto& t : triggers) {
    if (!t.enabled || t.type != Type::Projector) continue;
    if (t.match.length() && !t.match.equalsIgnoreCase(a.projector)) continue;
    if (lamp) {
      // Fires once when the lamp hours reach the limit (also at the first reading after boot).
      if (t.alarm != Projectors::kLampHours || !(a.from < t.hours && a.to >= t.hours)) continue;
      vars.set("hours", String(t.hours));
    } else {
      if (t.alarm == Projectors::kLampHours || (t.alarm >= 0 && t.alarm != a.part)) continue;
      // warning: gets worse to warning or error; error: becomes an error; ok: clears.
      bool hit = t.alarmLevel == 0 ? a.to == 0 : t.alarmLevel == 2 ? a.to == 2 : a.to > a.from;
      if (!hit) continue;
    }
    runTrigger(t, "projector alarm", &vars);
  }
}

int findId(const String& ref, String& err) {
  bool numeric = isNumber(ref);
  int found = -1, hits = 0;
  for (auto& t : triggers) {
    if (t.type == Type::Comment || t.internal) continue;
    if (numeric ? t.id == ref.toInt() : t.name.equalsIgnoreCase(ref)) { if (!hits) found = t.id; hits++; }
  }
  if (!hits) { err = "unknown trigger '" + ref + "'"; return -1; }
  if (hits > 1) { err = String(hits) + " triggers are named '" + ref + "' - use its number or rename one"; return -1; }
  return found;
}

bool fire(int id, String& msg, const Vars* vars, uint32_t delayMs) {
  Trigger* t = byId(id);
  if (!t) { msg = "Unknown trigger " + String(id); return false; }
  if (delayMs) {
    Scheduled job{id, millis() + delayMs, 0, 0, 1, vars ? *vars : Vars()};
    job.by = running;
    if (!schedule(job, &msg)) return false;
    msg = "Trigger " + String(id) + " in " + String(delayMs / 1000.0f, 1) + "s";
    return true;
  }
  bool user = !depth && !running;   // from the web UI / console / "cmd:", not from a trigger
  if (user) userRun++;
  runTrigger(*t, vars ? "nested" : "manual", vars);
  if (user) userRun--;
  msg = "Fired trigger " + String(id);
  return true;
}

bool cancel(int id, String& msg) {
  size_t before = scheduled.size();
  for (size_t i = 0; i < scheduled.size();)
    if (scheduled[i].id == id) scheduled.erase(scheduled.begin() + i); else i++;
  msg = "Cancelled " + String(before - scheduled.size()) + " pending fire(s) of trigger " + String(id);
  return true;
}

bool repeat(int id, uint32_t everyMs, int times, String& msg) {
  if (!byId(id)) { msg = "Unknown trigger " + String(id); return false; }
  if (everyMs < 100) { msg = "interval must be >= 0.1 s"; return false; }
  stopRepeat(id, msg);
  // Like the Pharos Repeat module: fire now, then every interval.
  Scheduled job{id, millis(), everyMs, times > 0 ? times : -1, 1, Vars()};
  job.by = running;
  if (!schedule(job, &msg)) return false;
  msg = "Repeating trigger " + String(id) + " every " + String(everyMs / 1000.0f, 1) + "s" + (times > 0 ? " x" + String(times) : String(""));
  return true;
}

bool stopRepeat(int id, String& msg) {
  for (size_t i = 0; i < scheduled.size();)
    if (scheduled[i].id == id && scheduled[i].every) scheduled.erase(scheduled.begin() + i); else i++;
  msg = "Stopped repeat of trigger " + String(id);
  return true;
}

bool panelEvent(const String& control, const String& event, const String& value, String& msg) {
  Vars vars;
  vars.set("control", control);
  vars.set("event", event);
  if (value.length()) {
    vars.set("value", value);
    if (value.length() == 7 && value[0] == '#') {   // colour wheel
      long c = strtol(value.c_str() + 1, nullptr, 16);
      vars.set("r", String((c >> 16) & 255));
      vars.set("g", String((c >> 8) & 255));
      vars.set("b", String(c & 255));
    }
    int comma = value.indexOf(',');
    if (comma > 0) {   // XY pad: "x,y"
      vars.set("x", value.substring(0, comma));
      vars.set("y", value.substring(comma + 1));
    }
  }
  int n = 0;
  uint32_t now = millis();
  for (auto& t : triggers) {
    if (!t.enabled || t.type != Type::Panel || !t.match.equalsIgnoreCase(control)) continue;
    if (t.hold) {   // press starts the clock, poll fires it, an early release cancels
      if (event.equalsIgnoreCase("press")) t.pressAt = now | 1;
      else if (event.equalsIgnoreCase("release")) t.pressAt = 0;
      continue;
    }
    if (t.dbl) {
      if (!event.equalsIgnoreCase("click")) continue;
      if (!t.lastPress || now - t.lastPress > t.withinMs) { t.lastPress = now | 1; continue; }
      t.lastPress = 0;
      Vars dv = vars;
      dv.set("event", "double");
      runTrigger(t, "panel double", &dv);
      n++;
      continue;
    }
    if (!t.event.equalsIgnoreCase(event)) continue;
    runTrigger(t, "panel", &vars);
    n++;
  }
  LOGD(Trig, "Panel %s %s (%d trigger(s))", control.c_str(), event.c_str(), n);
  msg = String(n) + " trigger(s)";
  return true;
}

bool checkCondition(const String& cond, String& err) {
  err = "";
  std::vector<String> t = Cmd::tokenize(cond);
  auto is = [&](size_t i, const char* w) { return t.size() > i && t[i].equalsIgnoreCase(w); };
  // mode <group> is|not <state> [for <duration>]   (old form: mode is|not <state>, state unique across groups)
  // "for": has been in that state at least that long (10m, 2h, 90 = seconds).
  if (is(0, "mode") && t.size() >= 3) {
    uint32_t need = 0;
    size_t n = t.size();
    bool forPart = n >= 5 && is(n - 2, "for");
    if (forPart) {
      if (!parseDuration(t[n - 1], need)) { err = "expected a duration after 'for' (90, 30s, 10m, 2h)"; return false; }
      n -= 2;
    }
    if ((n == 4 && (is(2, "is") || is(2, "not"))) || (n == 3 && (is(1, "is") || is(1, "not")))) {
      int g, s;
      bool full = n == 4;
      if (!State::findMode(full ? &t[1] : nullptr, t[full ? 3 : 2], g, s, err)) return false;
      bool wantIs = is(full ? 2 : 1, "is");
      if (forPart && !wantIs) { err = "'for' only works with 'is'"; return false; }
      bool eq = State::current(g) == State::stateName(g, s);
      if (forPart) return eq && State::secondsIn(g) >= need;
      return wantIs ? eq : !eq;
    }
  }
  if (is(0, "timeline") && t.size() == 3 && (is(2, "running") || is(2, "stopped"))) {
    int idx = Show::findTimeline(t[1]);
    if (idx < 0) { err = "unknown timeline '" + t[1] + "'"; return false; }
    return Show::timelineRunning(idx) == is(2, "running");
  }
  if (is(0, "device") && t.size() == 4 && is(2, "is") && (is(3, "online") || is(3, "offline"))) {
    bool online, known;
    if (!Monitor::state(t[1], online, known)) { err = "unknown device '" + t[1] + "'"; return false; }
    if (!known) return false;  // not checked yet: neither online nor offline
    return online == is(3, "online");
  }
  if (is(0, "time") && is(1, "between") && t.size() == 4) {
    struct tm tmv;
    if (!localTime(tmv)) return false;  // clock not set
    int a, b;
    if (!Clock::parseClock(t[2], a, err) || !Clock::parseClock(t[3], b, err)) return false;
    int now = tmv.tm_hour * 60 + tmv.tm_min;
    return a <= b ? (now >= a && now < b) : (now >= a || now < b);  // may wrap midnight
  }
  // var <name> = != > < >= <= <value>
  if (is(0, "var") && t.size() >= 4) {
    String rhs = t[3];
    for (size_t i = 4; i < t.size(); i++) rhs += " " + t[i];
    return Globals::compare(t[1], t[2], rhs, err);
  }
  // calendar <name> active|inactive
  if (is(0, "calendar") && t.size() == 3 && (is(2, "active") || is(2, "inactive"))) {
    bool known;
    bool active = Clock::calendarActive(t[1], known);
    if (!known) { err = "unknown calendar entry '" + t[1] + "'"; return false; }
    return active == is(2, "active");
  }
  // io <point> is on|off | io <point> = != > < >= <= <number>   (Machine Control I/O)
  if (is(0, "io") && t.size() == 4) {
    String key;
    float v;
    if (!Board::find(t[1], key, err)) return false;
    if (!Board::value(key, v)) return false;   // not read yet
    if (is(2, "is") && (is(3, "on") || is(3, "off"))) return (v >= 0.5f) == is(3, "on");
    float r = t[3].toFloat();
    if (is(3, "on")) r = 1;
    if (t[2] == "=") return fabsf(v - r) < 0.005f;
    if (t[2] == "!=") return fabsf(v - r) >= 0.005f;
    if (t[2] == ">") return v > r;
    if (t[2] == "<") return v < r;
    if (t[2] == ">=") return v >= r;
    if (t[2] == "<=") return v <= r;
    err = "expected: io <point> is on|off or io <point> =|!=|>|<|>=|<= <value>";
    return false;
  }
  // date between <MM-DD|YYYY-MM-DD> <MM-DD|YYYY-MM-DD>
  if (is(0, "date") && is(1, "between") && t.size() == 4) return Clock::dateBetween(t[2], t[3], err);
  if (is(0, "day") && is(1, "is") && t.size() >= 3) {
    struct tm tmv;
    if (!localTime(tmv)) return false;
    String list = t[2];
    for (size_t i = 3; i < t.size(); i++) list += "," + t[i];
    int start = 0;
    while (start < (int)list.length()) {
      int comma = list.indexOf(',', start);
      String d = list.substring(start, comma < 0 ? list.length() : comma);
      d.trim();
      int w = weekday(d);
      if (w < 0) { err = "unknown day '" + d + "'"; return false; }
      if (w == tmv.tm_wday) return true;
      if (comma < 0) break;
      start = comma + 1;
    }
    return false;
  }
  err = "unknown condition";
  return false;
}

void sendUdp(const IPAddress& ip, uint16_t port, const String& text) {
  UdpListener& l = listeners[0];
  if (!l.open) return;
  String data = unescape(text);
  sendPacket(l, ip, port, (const uint8_t*)data.c_str(), data.length());
  LOGD(Trig, "UDP sent to %s:%u (%u bytes)", ip.toString().c_str(), port, (unsigned)data.length());
}

void sendRaw(const IPAddress& ip, uint16_t port, const uint8_t* data, size_t len) {
  UdpListener& l = listeners[0];
  if (l.open) sendPacket(l, ip, port, data, len);
}

bool sendOsc(const IPAddress& ip, uint16_t port, const String& address, const std::vector<String>& args) {
  UdpListener& l = listeners[0];
  if (!l.open) return false;
  size_t n = Osc::encode(address, args, pkt, sizeof(pkt));
  if (!n) return false;
  sendPacket(l, ip, port, pkt, n);
  LOGD(Trig, "OSC sent to %s:%u %s (%d args)", ip.toString().c_str(), port, address.c_str(), (int)args.size());
  return true;
}

bool reply(const Vars* vars, const String& text, String& msg) {
  const String* ip = vars ? vars->get("sender_ip") : nullptr;
  const String* port = vars ? vars->get("sender_port") : nullptr;
  const String* sock = vars ? vars->get("socket") : nullptr;
  IPAddress addr;
  if (!ip || !port || !sock || !addr.fromString(*ip)) { msg = "reply only works in a udp/osc trigger"; return false; }
  UdpListener& l = listeners[constrain(sock->toInt(), 0, KD_MAX_UDP_PORTS - 1)];
  String data = unescape(text);
  sendPacket(l, addr, port->toInt(), (const uint8_t*)data.c_str(), data.length());
  msg = "Replied to " + *ip + ":" + *port;
  return true;
}

uint32_t udpReceived() { return udpCount; }

void statusJson(JsonObject o) {
  JsonArray arr = o["scheduled"].to<JsonArray>();
  uint32_t now = millis();
  for (auto& s : scheduled) {
    if (s.kind == kQueued) continue;
    JsonObject j = arr.add<JsonObject>();
    j["trigger"] = s.id;
    // A wait without a timeout has no time: -1.
    j["in"] = s.kind == kWait && !s.due ? -1 : (int32_t)(s.due - now);
    if (s.kind == kLoop) j["loop"] = s.remaining;
    else if (s.every) { j["every"] = s.every; j["count"] = s.count; j["remaining"] = s.remaining; }
    if (s.kind == kWait) j["wait"] = s.text;
    if (s.line >= 0) j["sleep"] = true;   // part of a run that is still going
  }
  JsonArray paused = o["paused"].to<JsonArray>();
  for (auto& t : triggers) {
    if (!t.pausedUntil || (int32_t)(t.pausedUntil - now) <= 0) continue;
    JsonObject j = paused.add<JsonObject>();
    j["trigger"] = t.id;
    j["in"] = (int32_t)(t.pausedUntil - now);
  }
  if (safe) o["safeMode"] = true;
}

void historyJson(String& out) {
  out = "{\"now\":" + String(millis()) + ",\"h\":[";
  out.reserve(out.length() + histCount * 20 + 4);
  size_t start = (histNext + KD_TRIGGER_HISTORY - histCount) % KD_TRIGGER_HISTORY;
  char buf[40];
  for (size_t k = 0; k < histCount; k++) {
    const Fired& f = history[(start + k) % KD_TRIGGER_HISTORY];
    snprintf(buf, sizeof(buf), "%s[%lu,%u,%u]", k ? "," : "", (unsigned long)f.ms, f.id, f.src);
    out += buf;
  }
  out += "]}";
}

void setSafeMode(bool on) {
  if (safe && !on) LOGI(Trig, "Safe mode off - triggers run again");
  safe = on;
}

}  // namespace Triggers
