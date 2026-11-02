#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// Health monitoring of PCs and network devices (ICMP ping) plus the shared
// check interval also used by the PJLink projector poll.
// Project JSON:
//   "settings": {"monitor": {"interval": 60, "timeout": 1000, "failures": 2}}
//   per PC / device: "monitor": false to leave it out.
// State changes ("online"/"offline") are queued for the main loop, which
// fires "device" triggers.
namespace Monitor {
struct Event {
  String kind;    // pc | device | projector
  String name;
  bool online;
};

void begin();                     // starts the worker thread
void load();                      // caller holds g_engine
uint32_t intervalMs();
void setInterval(uint32_t seconds);
void checkNow();

void pushEvent(const char* kind, const String& name, bool online);
bool takeEvent(Event& e);
// Known state of a PC, device or projector by name; false if unknown name.
bool state(const String& name, bool& online, bool& known);

void statusJson(JsonObject o);

// Device history on the stick for the Monitoring detail view: KD_HISTORY_DIR/YYYY-MM-DD.txt
// (UTC day), one "epoch state kind name" line per change. state: online|offline (any
// device), on|off (projector power), p:<key>=1|0 (a show device's on/off reading: Kiss-Box
// digital I/O, NETIO output/input, KNX DPT 1, Pharos timeline/scene). "boot" when the controller starts and "alive" every
// KD_HISTORY_ALIVE_S, so a gap in the file means the controller was off. Each day file
// starts with the state of every device, so it reads on its own.
void record(const char* kind, const String& name, const char* state);   // any thread
void flushHistory();                                                      // main loop
// Lines of one device (plus boot/alive) between from and to (epoch, max 7 days) as
// [[epoch,"state"],...], starting at the first line of from's day file.
void historyJson(const String& name, uint32_t from, uint32_t to, String& out);
}  // namespace Monitor
