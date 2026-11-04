#include "State.h"
#include <mbed.h>
#include <algorithm>
#include <vector>
#include "Config.h"
#include "Log.h"
#include "Show.h"
#include "Storage.h"
#include "Util.h"

namespace {
// disabled / locked: "" = as the Panel page sets it ("disabled" / "display only"),
// "1" / "0" = set by panel disable/enable, lock/unlock.
struct Label { String name, text, color, flash, value, disabled, locked; };
struct Device { String name; IPAddress ip; uint16_t port; };
struct Group { String name; std::vector<String> states; String current; };
struct DeviceGroup { String name; std::vector<int> members; };   // indexes into devices

std::vector<Group> groups;
std::vector<Label> labels;
std::vector<Device> devices;
std::vector<DeviceGroup> deviceGroups;
volatile uint32_t ver = 1;
rtos::Mutex mtx;   // guards labels/current for the web status thread
const String kEmpty;

const char kStatePath[] = KD_USB_ROOT "/show/state.json";

void persist() {
  if (!Storage::mounted()) return;
  JsonDocument d;
  JsonObject m = d["modes"].to<JsonObject>();
  for (auto& g : groups) if (g.current.length()) m[g.name] = g.current;
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
  std::vector<DeviceGroup> ndg;
  for (JsonObjectConst o : doc["deviceGroups"].as<JsonArrayConst>()) {
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

  // Restore each group's state from the last run.
  String saved;
  JsonDocument s;
  bool haveSaved = Storage::readFile(kStatePath, saved, 4096) && !deserializeJson(s, saved);
  for (auto& g : ng) {
    const char* want = haveSaved ? (s["modes"][g.name] | (g.name == "Mode" ? (s["mode"] | "") : "")) : "";
    for (auto& st : g.states) if (st == want) g.current = st;
  }

  mtx.lock();
  groups = std::move(ng);
  devices = std::move(nd);
  deviceGroups = std::move(ndg);
  labels.clear();
  ver++;
  mtx.unlock();
  for (auto& g : groups)
    if (g.current.length()) LOGI(Sys, "Mode %s restored: %s", g.name.c_str(), g.current.c_str());
  LOGI(Sys, "%d mode group(s), %d device(s), %d device group(s) loaded", (int)groups.size(), (int)devices.size(), (int)deviceGroups.size());
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

bool setMode(int g, int s, String& msg) {
  Group& grp = groups[g];
  const String& m = grp.states[s];
  if (grp.current == m) { msg = grp.name + " already " + m; return false; }
  String prev = grp.current;
  mtx.lock();
  grp.current = m;
  ver++;
  mtx.unlock();
  persist();
  msg = grp.name + ": " + m;
  LOGI(Sys, "Mode %s changed: %s -> %s", grp.name.c_str(), prev.length() ? prev.c_str() : "(none)", m.c_str());
  return true;
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

uint32_t version() { return ver; }

void statusJson(JsonObject o) {
  mtx.lock();
  JsonObject m = o["modes"].to<JsonObject>();
  for (auto& g : groups) m[g.name] = g.current;
  if (!groups.empty()) o["mode"] = groups[0].current;  // first group, for simple displays
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
