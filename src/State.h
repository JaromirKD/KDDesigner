#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <IPAddress.h>
#include <vector>

// Show-control state that lives outside the light engine:
//  * Modes   - independent mode groups, each with one active state, e.g.
//              Curtains: Open | Closed,  Museum: Closed | Open | Starting up.
//              Like the Pharos "Management Mode" module, but several at once.
//              Each group's state survives a reboot (/usb/show/state.json), unless the group
//              has a "startup" state. "var" links a variable to the group (both ways, Triggers).
//              "stateInfo" (per state: enter / leave actions, colour, icon) is read by
//              Triggers (the actions) and the UI.
//  * Panel   - live state of touch-panel controls by name (labels, buttons, sliders...):
//              text/colour/flash/disabled/locked set by actions, value set by actions or the panel.
//  * Devices - named network endpoints (media servers, PLCs...) for send udp/osc,
//              and device groups to send to several at once.
// All calls need g_engine held, except statusJson/version (own mutex).
namespace State {
void load();                                    // from the loaded project (+ /usb/show/state.json)

int groupCount();
const String& groupName(int g);
int findGroup(const String& ref);               // name or 1-based number, -1 if unknown
int findState(int g, const String& ref);        // name or 1-based number in the group
// Old single-mode syntax ("mode Show"): the state must be unique across groups.
bool findAnyState(const String& ref, int& g, int& s, String& err);
// "mode <group> <state>", or the old form without a group (group = nullptr).
bool findMode(const String* group, const String& state, int& g, int& s, String& err);
const String& current(int g);                  // "" when none set
const String& stateName(int g, int s);
int stateCount(int g);
const String& groupVar(int g);                 // the linked variable, "" = none
// by: who set it, for the log ("trigger 5", "web"...). false if already in that state.
bool setMode(int g, int s, String& msg, const char* by = nullptr);
// "next" / "previous" (wrap around), "toggle" (two states only), "back" (the state before):
// the state to go to, or -1 (err set; also when how is none of these).
int stepState(int g, const String& how, String& err);
uint32_t secondsIn(int g);                      // how long the group has been in its state

// what: text | color | flash ("" off, "on", or a colour) | value | disabled / locked ("1" / "0", "" = as the
// Panel page sets it) | reset (back to the project).
void setControl(const String& name, const String& what, const String& value);

bool findDevice(const String& name, IPAddress& ip, uint16_t& port);
// Device group by name: the address of each of its devices (send udp/osc <group> ...).
bool findDeviceGroup(const String& name, std::vector<std::pair<IPAddress, uint16_t>>& out);
// Group of another kind ("pc", "projector", "tcp", or a show-device type such as "netio"):
// the names of its devices, for "<kind> <group> ..." commands.
bool groupMembers(const char* kind, const String& name, std::vector<String>& out);

// Runs one(name, msg) for every member of a group; the reply counts how many worked and names the first failure.
template <class One>
bool forMembers(const String& group, const std::vector<String>& members, One one, String& msg) {
  if (members.empty()) { msg = "group '" + group + "' has no devices"; return false; }
  int ok = 0;
  String err;
  for (auto& n : members) {
    String m;
    if (one(n, m)) ok++;
    else if (!err.length()) err = n + ": " + m;
  }
  msg = group + ": " + String(ok) + " of " + String((int)members.size()) + " done";
  if (err.length()) msg += " (" + err + ")";
  return ok == (int)members.size();
}

uint32_t version();                             // bumps whenever something in the status changes
// Something the UI shows changed (a command ran, a variable, an input, a device): the web
// thread then pushes the status at once instead of on its 1 s tick. Any thread, no lock needed.
void changed();
void statusJson(JsonObject o);
}  // namespace State
