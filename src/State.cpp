#include "State.h"
#include <mbed.h>
#include <algorithm>
#include <vector>
#include "Config.h"
#include "Log.h"
#include "Monitor.h"
#include "Show.h"
#include "Storage.h"
#include "Util.h"

namespace {
// disabled / locked: "" = as the Panel page sets it ("disabled" / "display only"),
// "1" / "0" = set by panel disable/enable, lock/unlock.
struct Label { String name, text, color, flash, value, disabled, locked; };
struct Device { String name; IPAddress ip; uint16_t port; };
// since*: when current was set (epoch when the clock was set then, else 0; millis always).
struct Group {
  String name;
  std::vector<String> states;
  String current, previous, var, startup;
  uint32_t sinceEpoch = 0, sinceMs = 0;
};
struct DeviceGroup { String name; std::vector<int> members; };   // indexes into devices
struct KindGroup { String kind, name; std::vector<String> members; };   // PCs, projectors, TCP, show devices: by name

std::vector<Group> groups;
std::vector<Label> labels;
std::vector<Device> devices;
std::vector<DeviceGroup> deviceGroups;
std::vector<KindGroup> kindGroups;
volatile uint32_t ver = 1;
rtos::Mutex mtx;   // guards labels/current for the web status thread
const String kEmpty;

const char kStatePath[] = KD_USB_ROOT "/show/state.json";
bool booted = false;            // the first load after power-up: "startup" states apply

uint32_t clockNow() { uint32_t t = epochNow(); return t > 1600000000UL ? t : 0; }

// Mode history for the Modes page: a line in the device history as "mode:<group>", state
// "m:<state>" with space % " \ as %20 %25 %22 %5C (the line is space separated, /api/history is JSON).
void record(const Group& g) {
  String s = "m:";
  for (size_t i = 0; i < g.current.length(); i++) {
    char c = g.current[i];
    if (c == ' ') s += "%20";
    else if (c == '%') s += "%25";
    else if (c == '"') s += "%22";
    else if (c == '\\') s += "%5C";
    else s += c;
  }
  Monitor::record("mode", "mode:" + g.name, s.c_str());
}

void persist() {
  if (!Storage::mounted()) return;
  JsonDocument d;
  JsonObject m = d["modes"].to<JsonObject>();
  JsonObject since = d["since"].to<JsonObject>();
  for (auto& g : groups) {
    if (!g.current.length()) continue;
    m[g.name] = g.current;
    if (g.sinceEpoch) since[g.name] = g.sinceEpoch;
  }
  String s;
  serializeJson(d, s);
  Storage::writeFile(kStatePath, s.c_str(), s.length());
}

Label& label(const String& name) {
  for (auto& l : labels) if (l.name.equalsIgnoreCase(name)) return l;
  labels.push_back({name, "", "", "", "", "", ""});
  return labels.back();
}
}  // namespace

namespace State {

void load() {
  JsonDocument& doc = Show::projectDoc();
  // "modes": [{"name":"Curtains","states":["Open","Closed"]}, ...]
  // Old projects have a plain list of names: that becomes one group "Mode".
  std::vector<Group> ng;
  Group legacy{"Mode", {}, ""};
  for (JsonVariantConst m : doc["modes"].as<JsonArrayConst>()) {
    if (m.is<const char*>()) { legacy.states.push_back(m.as<const char*>()); continue; }
    Group g;
    g.name = m["name"] | "";
    g.var = m["var"] | "";
    g.startup = m["startup"] | "";   // "" = keep the last state
    for (JsonVariantConst s : m["states"].as<JsonArrayConst>()) g.states.push_back(s.as<const char*>());
    if (g.name.length() && !g.states.empty()) ng.push_back(g);
  }
  if (!legacy.states.empty()) ng.insert(ng.begin(), legacy);

  std::vector<Device> nd;
  for (JsonObjectConst o : doc["devices"].as<JsonArrayConst>()) {
    Device d;
    d.name = o["name"] | "";
    d.port = o["port"] | 0;
    if (d.name.length() && d.ip.fromString(o["ip"] | "")) nd.push_back(d);
    else LOGW(Sys, "Device '%s' has an invalid IP", d.name.c_str());
  }
  // "deviceGroups": [{"name":"screens","devices":["pc1","pc2"]}] - send udp/osc to all of them at once.
  // With "kind" (pc, projector, tcp, netio...) the group is for that kind's commands; its members are
  // checked when a command uses it (those lists load in their own modules).
  std::vector<DeviceGroup> ndg;
  std::vector<KindGroup> nkg;
  for (JsonObjectConst o : doc["deviceGroups"].as<JsonArrayConst>()) {
    String kind = o["kind"] | "";
    if (kind.length() && kind != "network") {
      KindGroup k;
      k.kind = kind;
      k.name = o["name"] | "";
      for (JsonVariantConst m : o["devices"].as<JsonArrayConst>()) k.members.push_back(m.as<const char*>());
      if (k.name.length()) nkg.push_back(k);
      continue;
    }
    DeviceGroup g;
    g.name = o["name"] | "";
    for (JsonVariantConst m : o["devices"].as<JsonArrayConst>()) {
      String n = m.as<const char*>();
      int k = -1;
      for (size_t i = 0; i < nd.size(); i++) if (nd[i].name.equalsIgnoreCase(n)) k = i;
      if (k >= 0) g.members.push_back(k);
      else LOGW(Sys, "Device group '%s': unknown device '%s'", g.name.c_str(), n.c_str());
    }
    if (g.name.length()) ndg.push_back(g);
  }

  // Restore each group's state from the last run, or at power-up the group's startup state.
  // A reload (saving the project) always keeps the state: it isn't a restart.
  String saved;
  JsonDocument s;
  bool haveSaved = Storage::readFile(kStatePath, saved, 4096) && !deserializeJson(s, saved);
  bool changed = false;
  for (auto& g : ng) {
    const char* want = haveSaved ? (s["modes"][g.name] | (g.name == "Mode" ? (s["mode"] | "") : "")) : "";
    for (auto& st : g.states) if (st == want) g.current = st;
    g.sinceMs = millis();
    if (g.current.length()) g.sinceEpoch = haveSaved ? (uint32_t)(s["since"][g.name] | 0) : 0;
    // The groups of the old project keep their "previous" (for "mode <group> back").
    for (auto& old : groups) if (old.name == g.name && old.current == g.current) { g.previous = old.previous; g.sinceMs = old.sinceMs; }
    if (!booted && g.startup.length()) {
      String start;
      for (auto& st : g.states) if (st.equalsIgnoreCase(g.startup)) start = st;
      if (!start.length()) LOGW(Sys, "Mode %s: startup state '%s' is not one of its states", g.name.c_str(), g.startup.c_str());
      else if (start != g.current) {
        LOGI(Sys, "Mode %s starts in %s", g.name.c_str(), start.c_str());
        g.previous = g.current;
        g.current = start;
        g.sinceEpoch = clockNow();
        changed = true;
      }
    }
  }

  mtx.lock();
  groups = std::move(ng);
  devices = std::move(nd);
  deviceGroups = std::move(ndg);
  kindGroups = std::move(nkg);
  labels.clear();
  ver++;
  mtx.unlock();
  if (changed) persist();
  for (auto& g : groups) {
    if (booted || !g.current.length()) continue;
    LOGI(Sys, "Mode %s restored: %s", g.name.c_str(), g.current.c_str());
    record(g);   // the history starts with the state at power-up
  }
  booted = true;
  LOGI(Sys, "%d mode group(s), %d device(s), %d device group(s) loaded", (int)groups.size(), (int)devices.size(), (int)(deviceGroups.size() + kindGroups.size()));
}

int groupCount() { return groups.size(); }
const String& groupName(int g) { return groups[g].name; }

int findGroup(const String& ref) {
  for (size_t i = 0; i < groups.size(); i++)
    if (isNumber(ref) ? (int)i + 1 == ref.toInt() : groups[i].name.equalsIgnoreCase(ref)) return i;
  return -1;
}

int findState(int g, const String& ref) {
  const auto& st = groups[g].states;
  for (size_t i = 0; i < st.size(); i++)
    if (isNumber(ref) ? (int)i + 1 == ref.toInt() : st[i].equalsIgnoreCase(ref)) return i;
  return -1;
}

bool findAnyState(const String& ref, int& g, int& s, String& err) {
  g = s = -1;
  for (size_t i = 0; i < groups.size(); i++) {
    int k = findState(i, ref);
    if (k < 0) continue;
    if (g >= 0) { err = "'" + ref + "' exists in several mode groups - use: mode <group> " + ref; return false; }
    g = i;
    s = k;
  }
  if (g < 0) { err = "unknown mode '" + ref + "'"; return false; }
  return true;
}

bool findMode(const String* group, const String& state, int& g, int& s, String& err) {
  if (!group) return findAnyState(state, g, s, err);
  g = findGroup(*group);
  if (g < 0) { err = "unknown mode group '" + *group + "'"; return false; }
  s = findState(g, state);
  if (s < 0) { err = "'" + state + "' is not a state of " + groupName(g); return false; }
  return true;
}

const String& current(int g) { return g >= 0 && g < (int)groups.size() ? groups[g].current : kEmpty; }
const String& stateName(int g, int s) { return groups[g].states[s]; }
int stateCount(int g) { return groups[g].states.size(); }
const String& groupVar(int g) { return groups[g].var; }

bool setMode(int g, int s, String& msg, const char* by) {
  Group& grp = groups[g];
  const String& m = grp.states[s];
  if (grp.current == m) { msg = grp.name + " already " + m; return false; }
  String prev = grp.current;
  mtx.lock();
  grp.previous = prev;
  grp.current = m;
  grp.sinceEpoch = clockNow();
  grp.sinceMs = millis();
  ver++;
  mtx.unlock();
  persist();
  record(grp);
  msg = grp.name + ": " + m;
  // The Modes page history shows this line: "by ..." says who changed it.
  String who = by ? String(" (by ") + by + ")" : String("");
  LOGI(Sys, "Mode %s changed: %s -> %s%s", grp.name.c_str(), prev.length() ? prev.c_str() : "(none)", m.c_str(), who.c_str());
  return true;
}

int stepState(int g, const String& how, String& err) {
  const Group& grp = groups[g];
  int n = grp.states.size(), cur = -1;
  for (int i = 0; i < n; i++) if (grp.states[i] == grp.current) cur = i;
  if (how.equalsIgnoreCase("next")) return cur < 0 ? 0 : (cur + 1) % n;
  if (how.equalsIgnoreCase("previous")) return cur < 0 ? n - 1 : (cur + n - 1) % n;
  if (how.equalsIgnoreCase("toggle")) {
    if (n != 2) { err = "toggle needs a group with 2 states (" + grp.name + " has " + String(n) + ") - use next"; return -1; }
    return cur == 0 ? 1 : 0;
  }
  if (how.equalsIgnoreCase("back")) {
    for (int i = 0; i < n; i++) if (grp.states[i] == grp.previous) return i;
    err = grp.name + " has no state to go back to";
    return -1;
  }
  err = "'" + how + "' is not a state of " + grp.name;
  return -1;
}

uint32_t secondsIn(int g) {
  const Group& grp = groups[g];
  uint32_t now = clockNow();
  return grp.sinceEpoch && now >= grp.sinceEpoch ? now - grp.sinceEpoch : (millis() - grp.sinceMs) / 1000;
}

void setControl(const String& name, const String& what, const String& value) {
  mtx.lock();
  Label& l = label(name);
  if (what == "text") l.text = value;
  else if (what == "color") l.color = value;
  else if (what == "flash") l.flash = value;
  else if (what == "value") l.value = value;
  else if (what == "disabled") l.disabled = value;
  else if (what == "locked") l.locked = value;
  else if (what == "reset") l.text = l.color = l.flash = l.disabled = l.locked = "";   // the value stays: it is where the slider is
  ver++;
  mtx.unlock();
}

bool findDevice(const String& name, IPAddress& ip, uint16_t& port) {
  for (auto& d : devices)
    if (d.name.equalsIgnoreCase(name)) { ip = d.ip; port = d.port; return true; }
  return false;
}

bool findDeviceGroup(const String& name, std::vector<std::pair<IPAddress, uint16_t>>& out) {
  for (auto& g : deviceGroups) {
    if (!g.name.equalsIgnoreCase(name)) continue;
    out.clear();
    for (int k : g.members) out.push_back({devices[k].ip, devices[k].port});
    return true;
  }
  return false;
}

bool groupMembers(const char* kind, const String& name, std::vector<String>& out) {
  for (auto& g : kindGroups) {
    if (g.kind != kind || !g.name.equalsIgnoreCase(name)) continue;
    out = g.members;
    return true;
  }
  return false;
}

uint32_t version() { return ver; }
void changed() { core_util_atomic_incr_u32(&ver, 1); }

void statusJson(JsonObject o) {
  mtx.lock();
  JsonObject m = o["modes"].to<JsonObject>();
  for (auto& g : groups) m[g.name] = g.current;
  if (!groups.empty()) o["mode"] = groups[0].current;  // first group, for simple displays
  JsonObject f = o["modeFor"].to<JsonObject>();         // seconds in the current state
  for (size_t i = 0; i < groups.size(); i++) if (groups[i].current.length()) f[groups[i].name] = secondsIn(i);
  JsonObject lj = o["labels"].to<JsonObject>();
  for (auto& l : labels) {
    JsonObject x = lj[l.name].to<JsonObject>();
    if (l.text.length()) x["text"] = l.text;
    if (l.color.length()) x["color"] = l.color;
    if (l.flash.length()) x["flash"] = l.flash;
    if (l.value.length()) x["value"] = l.value;
    if (l.disabled.length()) x["disabled"] = l.disabled == "1";
    if (l.locked.length()) x["locked"] = l.locked == "1";
  }
  mtx.unlock();
}

}  // namespace State
