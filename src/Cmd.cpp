#include "Cmd.h"
#include <vector>
#include "Config.h"
#include "Log.h"
#include "Board.h"
#include "Clock.h"
#include "Drivers.h"
#include "Globals.h"
#include "Io.h"
#include "Mail.h"
#include "Monitor.h"
#include "Pcs.h"
#include "Project.h"
#include "Projectors.h"
#include "Show.h"
#include "State.h"
#include "Triggers.h"
#include "Util.h"

namespace {

uint32_t seconds(const String& s) { return (uint32_t)(s.toFloat() * 1000); }

// Parses an optional trailing "fade <seconds>" at position i.
bool parseFade(const std::vector<String>& t, size_t i, uint32_t& ms, String& err) {
  ms = 0;
  if (t.size() <= i) return true;
  if (!t[i].equalsIgnoreCase("fade") || t.size() != i + 2) { err = "expected: fade <seconds>"; return false; }
  ms = seconds(t[i + 1]);
  return true;
}

bool needTimeline(const std::vector<String>& t, size_t i, int& idx, String& err) {
  if (t.size() <= i) { err = "missing timeline"; return false; }
  idx = Show::findTimeline(t[i]);
  if (idx < 0) { err = "unknown timeline '" + t[i] + "'"; return false; }
  return true;
}

bool needScene(const std::vector<String>& t, size_t i, int& idx, String& err) {
  if (t.size() <= i) { err = "missing scene"; return false; }
  idx = Show::findScene(t[i]);
  if (idx < 0) { err = "unknown scene '" + t[i] + "'"; return false; }
  return true;
}

// "<ip> <port>" or "<device>" at position i; returns the index after it.
bool needTarget(const std::vector<String>& t, size_t i, IPAddress& ip, uint16_t& port, size_t& next, String& err) {
  if (t.size() <= i) { err = "missing destination"; return false; }
  if (ip.fromString(t[i])) {
    if (t.size() <= i + 1) { err = "missing port"; return false; }
    port = t[i + 1].toInt();
    next = i + 2;
  } else if (State::findDevice(t[i], ip, port)) {
    next = i + 1;
  } else {
    err = "unknown device or IP '" + t[i] + "'";
    return false;
  }
  if (!port) { err = "bad port"; return false; }
  return true;
}

// Like needTarget, but a device group name gives all of its devices.
bool needTargets(const std::vector<String>& t, size_t i, std::vector<std::pair<IPAddress, uint16_t>>& to, size_t& next, String& err) {
  IPAddress ip;
  uint16_t port;
  if (t.size() > i && !ip.fromString(t[i]) && !State::findDevice(t[i], ip, port) && State::findDeviceGroup(t[i], to)) {
    if (to.empty()) { err = "device group '" + t[i] + "' has no devices"; return false; }
    next = i + 1;
    return true;
  }
  if (!needTarget(t, i, ip, port, next, err)) return false;
  to.assign(1, {ip, port});
  return true;
}
// A whole number 1-65535 right after a device or group name is a port that
// replaces the devices' own; `next` then moves past it.
void overridePort(const std::vector<String>& t, size_t& next, std::vector<std::pair<IPAddress, uint16_t>>& to) {
  const String& p = t[next];
  for (size_t k = 0; k < p.length(); k++) if (!isDigit(p[k])) return;
  long port = p.toInt();
  if (!p.length() || p.length() > 5 || port < 1 || port > 65535) return;
  for (auto& d : to) d.second = port;
  next++;
}
bool parseOutput(const String& name, Output& o, String& err) {
  if (name.equalsIgnoreCase("dmx")) o = Output::Dmx;
  else if (name.equalsIgnoreCase("artnet")) o = Output::ArtNet;
  else if (name.equalsIgnoreCase("sacn")) o = Output::Sacn;
  else { err = "output must be dmx|artnet|sacn"; return false; }
  return true;
}

// "1.2.3.4:5000" or "group 'screens' (3 devices)" for replies.
String targetText(const std::vector<String>& t, size_t i, const std::vector<std::pair<IPAddress, uint16_t>>& to) {
  if (to.size() == 1 && t[i].indexOf('.') > 0) return to[0].first.toString() + ":" + to[0].second;
  if (to.size() == 1) return t[i] + " (" + to[0].first.toString() + ":" + to[0].second + ")";
  return "group " + t[i] + " (" + String((int)to.size()) + " devices)";
}

bool run(const std::vector<String>& t, String& r, const Vars* vars) {
  auto is = [&](size_t i, const char* w) { return t.size() > i && t[i].equalsIgnoreCase(w); };
  int idx;
  uint32_t fade;

  if (is(0, "start") && is(1, "timeline")) {
    if (!needTimeline(t, 2, idx, r)) return false;
    uint32_t at = 0;   // "at <seconds>": start part-way
    if (t.size() > 3) {
      if (!is(3, "at") || t.size() != 5) { r = "expected: at <seconds>"; return false; }
      at = seconds(t[4]);
    }
    return Show::startTimeline(idx, r, at);
  }
  if (is(0, "stop") && is(1, "timeline")) {
    return needTimeline(t, 2, idx, r) && parseFade(t, 3, fade, r) && Show::stopTimeline(idx, fade, r);
  }
  if ((is(0, "pause") || is(0, "resume")) && is(1, "timeline")) {
    return needTimeline(t, 2, idx, r) && Show::pauseTimeline(idx, is(0, "pause"), r);
  }
  if (is(0, "master") && is(1, "timeline")) {
    if (!needTimeline(t, 2, idx, r)) return false;
    if (t.size() < 4) { r = "missing level (0-100)"; return false; }
    return parseFade(t, 4, fade, r) && Show::setMaster(idx, t[3].toFloat() / 100.0f, fade, r);
  }
  if (is(0, "scene")) {
    return needScene(t, 1, idx, r) && parseFade(t, 2, fade, r) && Show::playScene(idx, fade, r);
  }
  if (is(0, "release") && is(1, "scene")) {
    return needScene(t, 2, idx, r) && parseFade(t, 3, fade, r) && Show::releaseScene(idx, fade, r);
  }
  if (is(0, "release") && is(1, "all")) {
    if (!parseFade(t, 2, fade, r)) return false;
    Show::releaseAll(fade);
    r = "Released all";
    return true;
  }
  if (is(0, "set") && t.size() == 3) {
    int dot = t[1].indexOf('.');
    if (dot < 0) { r = "expected <universe>.<channel>"; return false; }
    int u = Show::universeIndex(t[1].substring(0, dot).toInt());
    String chs = t[1].substring(dot + 1);
    int dash = chs.indexOf('-');
    int c1 = chs.toInt(), c2 = dash > 0 ? chs.substring(dash + 1).toInt() : c1;
    int v = t[2].toInt();
    if (u < 0) { r = "unknown universe"; return false; }
    if (c1 < 1 || c2 > 512 || c2 < c1) { r = "channel out of range (1-512)"; return false; }
    if (v < 0 || v > 255) { r = "value out of range (0-255)"; return false; }
    for (int c = c1; c <= c2; c++) Show::setOverride(u, c - 1, v);
    r = "Set " + t[1] + " = " + v;
    return true;
  }
  if (is(0, "clear") && is(1, "overrides")) { Show::clearOverrides(); r = "Overrides cleared"; return true; }
  if (is(0, "grandmaster") && t.size() == 2) {
    Show::setGrandMaster(t[1].toFloat() / 100.0f);
    r = "Grand master " + t[1] + "%";
    return true;
  }
  if (is(0, "blackout") && (is(1, "on") || is(1, "off"))) {
    Show::setBlackout(is(1, "on"));
    r = String("Blackout ") + (is(1, "on") ? "on" : "off");
    return true;
  }
  if (is(0, "mode") && (t.size() == 2 || t.size() == 3)) {
    int g, s;
    if (!State::findMode(t.size() == 3 ? &t[1] : nullptr, t.back(), g, s, r)) return false;
    if (State::setMode(g, s, r)) Triggers::onModeChanged(State::groupName(g), State::current(g));
    return true;
  }
  if (is(0, "label") && t.size() >= 3) {
    if (is(2, "color") && t.size() == 4) { State::setLabelColor(t[1], t[3]); r = "Label " + t[1] + " colour " + t[3]; }
    else { State::setLabel(t[1], rest(t, 2)); r = "Label " + t[1] + " = " + rest(t, 2); }
    return true;
  }
  if (is(0, "fire") && is(1, "trigger") && (t.size() == 3 || (t.size() == 5 && is(3, "after")))) {
    int id = Triggers::findId(t[2], r);
    return id >= 0 && Triggers::fire(id, r, vars, t.size() == 5 ? seconds(t[4]) : 0);
  }
  if (is(0, "cancel") && is(1, "trigger") && t.size() == 3) { int id = Triggers::findId(t[2], r); return id >= 0 && Triggers::cancel(id, r); }
  if (is(0, "repeat") && is(1, "trigger") && t.size() >= 5 && is(3, "every")) {
    int times = 0;
    if (t.size() == 7 && is(5, "times")) times = t[6].toInt();
    else if (t.size() != 5) { r = "expected: repeat trigger <id> every <s> [times <n>]"; return false; }
    int id = Triggers::findId(t[2], r);
    return id >= 0 && Triggers::repeat(id, seconds(t[4]), times, r);
  }
  if (is(0, "stop") && is(1, "repeat") && t.size() == 3) { int id = Triggers::findId(t[2], r); return id >= 0 && Triggers::stopRepeat(id, r); }
  if (is(0, "log") && t.size() > 1) { LOGI(Cmd, "%s", rest(t, 1).c_str()); r = "Logged"; return true; }
  if (is(0, "email") && t.size() >= 4) {
    if (t[1].indexOf('@') < 1) { r = "bad email address"; return false; }
    return Mail::queue(t[1], t[2], rest(t, 3), r);
  }
  if (is(0, "sleep")) { r = "sleep only works on its own line in a trigger's actions"; return false; }
  if (is(0, "wait")) { r = "wait only works on its own line in a trigger's actions"; return false; }
  if (is(0, "repeat") && t.size() >= 3 && (is(2, "times") || (t.size() >= 4 && is(3, "times")))) { r = "repeat ... times only works on its own line in a trigger's actions"; return false; }
  if (is(0, "send") && is(1, "udp")) {
    std::vector<std::pair<IPAddress, uint16_t>> to;
    size_t next;
    if (!needTargets(t, 2, to, next, r)) return false;
    // send udp <device|group> <port> <text>: another port than the device's own.
    if (next == 3 && t.size() > 4) overridePort(t, next, to);
    if (t.size() <= next) { r = "missing text"; return false; }
    String text = rest(t, next);
    for (auto& d : to) Triggers::sendUdp(d.first, d.second, text);
    r = "Sent UDP to " + targetText(t, 2, to);
    return true;
  }
  if (is(0, "send") && is(1, "osc")) {
    std::vector<std::pair<IPAddress, uint16_t>> to;
    size_t next;
    if (!needTargets(t, 2, to, next, r)) return false;
    if (next == 3 && t.size() > 4 && t[4].startsWith("/")) overridePort(t, next, to);
    if (t.size() <= next || !t[next].startsWith("/")) { r = "missing OSC address (/...)"; return false; }
    std::vector<String> args(t.begin() + next + 1, t.end());
    for (auto& d : to)
      if (!Triggers::sendOsc(d.first, d.second, t[next], args)) { r = "OSC send failed"; return false; }
    r = "Sent OSC " + t[next] + " to " + targetText(t, 2, to);
    return true;
  }
  if (is(0, "reply") && t.size() > 1) return Triggers::reply(vars, rest(t, 1), r);
  if (is(0, "loglevel") && t.size() == 3) {
    Lvl l;
    if (!Log::lvlFromName(t[2].c_str(), l)) { r = "level must be debug|info|warn|error"; return false; }
    if (t[1].equalsIgnoreCase("all")) {
      for (int i = 0; i < (int)Cat::COUNT; i++) Log::setLevel((Cat)i, l);
    } else {
      Cat c;
      if (!Log::catFromName(t[1].c_str(), c)) { r = "unknown log category"; return false; }
      Log::setLevel(c, l);
    }
    r = "Log level " + t[1] + " = " + t[2];
    return true;
  }
  if (is(0, "output") && t.size() == 4 && is(2, "fps")) {
    Output o;
    return parseOutput(t[1], o, r) && Show::setFps(o, t[3].toInt(), r);
  }
  if (is(0, "output") && t.size() == 3 && (is(2, "on") || is(2, "off"))) {
    Output o;
    if (!parseOutput(t[1], o, r)) return false;
    Show::setOutput(o, is(2, "on"));
    r = "Output " + t[1] + " " + t[2];
    return true;
  }
  if (is(0, "projector") && t.size() >= 3) {
    int pj = -1;
    if (!is(1, "all")) {
      pj = Projectors::find(t[1]);
      if (pj < 0) { r = "unknown projector '" + t[1] + "'"; return false; }
    }
    String body;
    if (t.size() == 3 && (is(2, "on") || is(2, "off"))) body = is(2, "on") ? "POWR 1" : "POWR 0";
    else if (is(2, "mute") && t.size() == 4 && (is(3, "on") || is(3, "off"))) body = is(3, "on") ? "AVMT 31" : "AVMT 30";
    else if (is(2, "input") && t.size() == 4) body = "INPT " + t[3];
    else if (is(2, "send") && t.size() >= 4) body = rest(t, 3);
    else { r = "expected: on|off, mute on|off, input <code> or send <command>"; return false; }
    return Projectors::queue(pj, body, r);
  }
  if (is(0, "pc") && t.size() == 3) {
    int idx = -1;
    if (!is(1, "all")) {
      idx = Pcs::find(t[1]);
      if (idx < 0) { r = "unknown PC '" + t[1] + "'"; return false; }
    }
    return Pcs::run(idx, t[2], r);
  }
  // var <name> = <value...> | var <name> + <n> | var <name> - <n> | var <name> toggle
  if (is(0, "var") && t.size() >= 3) {
    if (is(2, "=") && t.size() >= 4) return Globals::set(t[1], rest(t, 3), r);
    if ((is(2, "+") || is(2, "-")) && t.size() == 4) return Globals::add(t[1], (is(2, "+") ? 1 : -1) * t[3].toDouble(), r);
    if (is(2, "toggle") && t.size() == 3) return Globals::toggle(t[1], r);
    r = "expected: var <name> = <value> | + <n> | - <n> | toggle";
    return false;
  }
  if (is(0, "send") && is(1, "tcp") && t.size() >= 4) return Tcp::send(t[2], rest(t, 3), r);
  if (is(0, "http") && t.size() >= 3) {
    String m;
    if (!httpMethod(t[1], m, r)) return false;
    return Http::request(m, t[2], t.size() > 3 ? rest(t, 3) : String(""), r);
  }
  // modbus <device> write coil|holding <address> <value>
  if (is(0, "modbus") && t.size() == 6 && is(2, "write")) {
    String table = t[3];
    table.toLowerCase();
    if (table == "register") table = "holding";
    return Modbus::write(t[1], table, t[4].toInt(), t[5].toInt(), r);
  }
  if (is(0, "ntp") && is(1, "sync") && t.size() == 2) { Clock::syncNow(); r = "NTP sync requested"; return true; }
  if (is(0, "monitor") && is(1, "check") && t.size() == 2) {
    Monitor::checkNow();
    r = "Checking all devices now";
    return true;
  }
  if (is(0, "monitor") && is(1, "interval") && t.size() == 3) {
    int s = t[2].toInt();
    if (s < 5 || s > 3600) { r = "interval must be 5-3600 seconds"; return false; }
    Monitor::setInterval(s);
    r = "Monitor interval " + String(s) + " s";
    return true;
  }
  // io <point> on|off|toggle|pulse <s>|<volts> [fade <s>]  (Machine Control I/O)
  if (is(0, "io")) return Board::command(t, r);
  // kissbox | knx | brightsign | digidot | netio | pharos <device> ...
  if (!t.empty() && Drivers::isCommand(t[0])) return Drivers::command(t, r);
  if (is(0, "reload") && t.size() == 1) {
    if (!Show::loadFile(KD_PROJECT_PATH, r)) return false;
    Project::loadModules();
    r = "Project reloaded";
    return true;
  }
  r = "unknown command";
  return false;
}
}  // namespace

namespace Cmd {

std::vector<String> tokenize(const String& line) {
  std::vector<String> t;
  size_t i = 0, n = line.length();
  while (i < n) {
    while (i < n && isspace(line[i])) i++;
    if (i >= n) break;
    String tok;
    if (line[i] == '"') {
      i++;
      while (i < n && line[i] != '"') tok += line[i++];
      i++;
    } else {
      while (i < n && !isspace(line[i])) tok += line[i++];
    }
    t.push_back(tok);
  }
  return t;
}

// Splits "if <cond> then <a> [else <b>]" on unquoted "then"/"else" words.
static bool splitIf(const String& s, String& cond, String& a, String& b) {
  int thenAt = -1, thenEnd = -1, elseAt = -1, elseEnd = -1;
  size_t i = 0, n = s.length();
  bool first = true;
  while (i < n) {
    while (i < n && isspace(s[i])) i++;
    if (i >= n) break;
    size_t start = i;
    if (s[i] == '"') { i++; while (i < n && s[i] != '"') i++; if (i < n) i++; }
    else while (i < n && !isspace(s[i])) i++;
    String w = s.substring(start, i);
    if (first) { first = false; continue; }  // the "if" itself
    if (thenAt < 0 && w.equalsIgnoreCase("then")) { thenAt = start; thenEnd = i; }
    else if (thenAt >= 0 && elseAt < 0 && w.equalsIgnoreCase("else")) { elseAt = start; elseEnd = i; }
  }
  if (thenAt < 0) return false;
  cond = s.substring(2, thenAt);
  a = s.substring(thenEnd, elseAt < 0 ? n : elseAt);
  b = elseAt < 0 ? String("") : s.substring(elseEnd);
  cond.trim(); a.trim(); b.trim();
  return cond.length() && a.length();
}

bool exec(const String& line, String& reply, const char* source, const Vars* vars) {
  String trimmed = expandVars(line, vars);
  trimmed.trim();
  if (!trimmed.length() || trimmed[0] == '#') { reply = ""; return true; }
  // if <condition> then <command> [else <command>]
  if (trimmed.length() > 3 && (trimmed.startsWith("if ") || trimmed.startsWith("IF ") || trimmed.startsWith("If "))) {
    String cond, a, b, err;
    if (!splitIf(trimmed, cond, a, b)) { reply = "expected: if <condition> then <command> [else <command>]"; LOGW(Cmd, "[%s] '%s': %s", source, trimmed.c_str(), reply.c_str()); return false; }
    bool yes = Triggers::checkCondition(cond, err);
    if (err.length()) { reply = "condition '" + cond + "': " + err; LOGW(Cmd, "[%s] %s", source, reply.c_str()); return false; }
    LOGD(Cmd, "[%s] if %s -> %s", source, cond.c_str(), yes ? "then" : (b.length() ? "else" : "skip"));
    if (yes) return exec(a, reply, source, vars);
    if (b.length()) return exec(b, reply, source, vars);
    reply = "condition false, nothing to do";
    return true;
  }
  std::vector<String> t = tokenize(trimmed);
  bool ok = run(t, reply, vars);
  if (ok) LOGD(Cmd, "[%s] %s -> %s", source, trimmed.c_str(), reply.c_str());
  else LOGW(Cmd, "[%s] '%s' failed: %s", source, trimmed.c_str(), reply.c_str());
  return ok;
}

}  // namespace Cmd
