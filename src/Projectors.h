#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// PJLink (class 1) projector control over TCP 4352, with optional password
// (MD5 auth). Commands are queued and sent from a worker thread so a slow or
// offline projector never blocks the show engine. Power state is polled.
//
// Project JSON: "projectors": [{"id":1,"name":"PJ left","ip":"10.0.0.21","port":4352,"password":""}]
namespace Projectors {
void begin();                                     // starts the worker thread
void load();                                      // (re)reads the project; caller holds g_engine
int find(const String& ref);                      // id, name or -1
// Queues a PJLink command body without the "%1" prefix, e.g. "POWR 1".
// idx < 0 sends to every projector.
bool queue(int idx, const String& body, String& msg);
void statusJson(JsonArray arr);
void pollNow();                                   // poll every projector right away
bool state(const String& name, bool& online, bool& known);  // false if unknown name

// A change in a projector's error status (ERST) or lamp hours, for projector
// triggers. part 0-5 = fan lamp temperature cover filter other (from/to 0 ok,
// 1 warning, 2 error); part kLampHours = lamp hours (from -1 = first reading).
// The first poll after boot compares against "all ok / no reading", so an alarm
// that is already there fires once after every boot (but not after a save).
constexpr int kLampHours = 6;
struct Alarm {
  String projector;
  int part, from, to;
  int lamp;                                       // lamp hours, -1 unknown
};
bool takeAlarm(Alarm& a);                         // main loop: queued alarms
const char* partName(int part);                   // "filter", "lamp hours"
}  // namespace Projectors
