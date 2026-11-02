#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <IPAddress.h>
#include <vector>

// Show-control state that lives outside the light engine:
//  * Modes   - independent mode groups, each with one active state, e.g.
//              Curtains: Open | Closed,  Museum: Closed | Open | Starting up.
//              Like the Pharos "Management Mode" module, but several at once.
//              Each group's state survives a reboot (/usb/show/state.json).
//  * Panel   - live state of touch-panel controls by name (labels, buttons, sliders...):
//              text/colour/flash/disabled set by actions, value set by actions or the panel.
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
bool setMode(int g, int s, String& msg);        // false if already in that state

// what: text | color | flash ("" off, "on", or a colour) | value | disabled ("1"/"") | reset (back to the project).
void setControl(const String& name, const String& what, const String& value);

bool findDevice(const String& name, IPAddress& ip, uint16_t& port);
// Device group by name: the address of each of its devices (send udp/osc <group> ...).
bool findDeviceGroup(const String& name, std::vector<std::pair<IPAddress, uint16_t>>& out);

uint32_t version();                             // bumps whenever modes/labels change
void statusJson(JsonObject o);
}  // namespace State
