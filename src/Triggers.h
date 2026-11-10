#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <IPAddress.h>
#include <vector>
#include "Projectors.h"
#include "Vars.h"

// Triggers fire a list of commands (see Cmd.h) when something happens:
//   startup        once after boot / reload
//   time           at HH:MM[:SS], optionally on given weekdays
//   interval       every N seconds
//   udp            a UDP message matches "match" ("*" suffix = prefix match, rest -> {1}).
//                  Optional "port" (default settings.udpPort) and "fromIp" filter.
//                  "cmd:<command>" on settings.udpPort always runs directly.
//   osc            an OSC message on "port" matches "address" (* and ? wildcards), args -> {1}..{n}
//   input          a digital pin changes (edge rising|falling|both, INPUT_PULLUP), or a
//                  Machine Control point ("io": "in3" / "io5" / "ai0"; analog: crosses "level")
//                  vars {input} {value}
//   timeline_end   a non-looping timeline reaches its end
//   mode           a mode group changes ("group" and/or "mode" = state; empty = any).
//                  vars {group} {mode} {old}
//   panel          a touch-panel control is pressed/released/clicked, or a slider / dial /
//                  colour wheel / toggle "change"s: vars {control} {event} {value}
//                  ({r} {g} {b} 0-255 for a colour wheel's #rrggbb, {x} {y} for an XY pad's "x,y")
//   device         a monitored PC / device / projector goes "offline" or "online"
//                  ("device" = name or empty for any; "state" offline|online|any)
//   projector      a projector's PJLink error status or lamp hours ("projector" = name or
//                  empty; "alarm" any|fan|lamp|temperature|cover|filter|other|lamp_hours;
//                  "level" warning|error|ok; "hours" = lamp-hour limit)
//                  vars {projector} {alarm} {state} {lamp} ({hours} for lamp_hours)
//   dmx_change     an output channel in "channels" (e.g. "1-17") of "universe" changes;
//                  vars {channel} {index} {value} plus per-index "tables" lookups
//   variable       a user variable changes ("variable" = name or empty; optional "value")
//                  vars {variable} {value} {old}
//   tcp            a TCP device sends a line ("device", "match" exact / prefix* / * any)
//                  vars {device} {message} {1}
//   http           an HTTP response arrives ("url" prefix or empty) vars {url} {status} {body}
//   time           also "at": "sunrise" | "sunset" with "offset" minutes
//   manual         only fired by other triggers ("fire trigger"), the UI or the panel
//   calendar       a calendar period ("calendar" = its name) becomes "state" active | inactive
//                  (checked every second; the first reading after power-up is not a change)
//                  vars {calendar} {state}
//   dmx_in         Art-Net / sACN received ("protocol", "universe", "channels"); "when"
//                  change | above | below "level" (0-255). vars {channel} {index} {value} {old}
//   comment        a separator in the trigger list, never fires
// input: "edge" also hold (on for "hold" s) | double (two presses within "within" s);
// panel: "event" also hold | double.
// Every trigger: "cooldown" s (fires that soon after a run are skipped, not by hand) and
// "whileRunning" again | ignore | restart | queue (a fire while its sleep/wait/loop runs), and
// "onlyIn" {"group", "states": [...]} (only fires while the mode group is in one of them; by hand always).
// Actions also: sleep <s> | wait until <condition> [timeout <s>] | repeat <n> times [every <s>] <command> ({i})
// | repeat <trigger> <n> times [every|for <s>] (fires the trigger n times, {i} and {count} = the round).
// Every trigger can have "conditions" (all must hold when it fires):
//   mode <group> is|not <state> | mode <group> is <state> for <duration> (90, 30s, 10m, 2h)
//   timeline <tl> running | timeline <tl> stopped
//   time between <t> <t> (HH:MM, sunrise, sunset-30) | day is mon,tue,... | device <name> is online|offline
//   var <name> =|!=|>|<|>=|<= <value> | calendar <name> active|inactive | date between <DD-MM> <DD-MM>
//   io <point> is on|off | io <point> =|!=|>|<|>=|<= <value>
namespace Triggers {
void load();                 // (re)reads triggers from the loaded project
void begin();                // opens the UDP sockets; call after Net::begin
void startup();
void poll(uint32_t nowMs);   // caller must hold g_engine
void afterTick();            // dmx_change watchers; call right after Show::tick
void onTimelineEnd(int timelineId);
void onTimelineCue(int timelineId, const String& trigger);   // a trigger cue on a timeline was reached
// Sets mode group g to state s (State::setMode) and, if it changed, runs the old state's
// "leave" and the new state's "enter" actions, the mode triggers, and sets the group's variable.
bool changeMode(int g, int s, String& msg, const char* by);
void onDeviceState(const String& kind, const String& name, bool online);
void onProjectorAlarm(const Projectors::Alarm& a);
void onVariable(const String& name, const String& value, const String& old);
void onTcpLine(const String& device, const String& line);
void onHttpResponse(const String& method, const String& url, int status, const String& body);

// A trigger reference is its number or its "name" (separators excluded).
// Returns the id, or -1 with err set (unknown or ambiguous name).
int findId(const String& ref, String& err);
bool fire(int triggerId, String& msg, const Vars* vars = nullptr, uint32_t delayMs = 0);
// "Test" in the web UI: fire by hand and say what each condition / action line did (JSON).
bool test(int triggerId, String& json);
bool cancel(int triggerId, String& msg);
bool repeat(int triggerId, uint32_t everyMs, int times, String& msg);  // times 0 = forever
bool stopRepeat(int triggerId, String& msg);
bool panelEvent(const String& control, const String& event, const String& value, String& msg);

// text supports escapes: \r \n \t \\ \xNN
void sendUdp(const IPAddress& ip, uint16_t port, const String& text);
void sendRaw(const IPAddress& ip, uint16_t port, const uint8_t* data, size_t len);  // no escapes
bool sendOsc(const IPAddress& ip, uint16_t port, const String& address, const std::vector<String>& args);
bool reply(const Vars* vars, const String& text, String& msg);

bool checkCondition(const String& cond, String& err);   // also used to validate in the UI
uint32_t udpReceived();
void statusJson(JsonObject o);
// The last KD_TRIGGER_HISTORY fires, oldest first: {"now":ms,"h":[[ms,id,src],...]}.
// src: 0 its own event, 1-9999 fired by that trigger, 0x8000|n timeline n,
// 65535 by hand, 65534 repeat, 65533 delayed, 65532 queued.
void historyJson(String& out);
// Safe mode (after repeated crash restarts): triggers only run when fired by hand.
void setSafeMode(bool on);
// True while trigger actions run (a reload must wait: it replaces the trigger table).
bool inRun();
}  // namespace Triggers
