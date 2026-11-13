#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

// Drivers for show devices that have their own protocol. Commands are queued
// and sent from worker threads (one for HTTP, one for UDP), so a slow or
// offline device never blocks the show engine. Every device is polled for its
// status, which shows on the Monitoring page and can feed variables.
//
//   kissbox     Kiss-Box I/O (IO3/IO8 card frames): UDP, slot + channel bytes ($A0-$A5)
//   knx         KNX IP interface: KNXnet/IP tunnelling (UDP 3671), group addresses + DPTs
//   brightsign  BrightSign player: UDP text to the presentation + local DWS REST API (digest auth)
//   digidot     DiGidot C4: JSON API (POST /ajax.json, SHA-1 framing, HMAC-SHA256 with an account)
//   netio       NETIO power sockets: JSON API (/netio.json, basic auth)
//   pharos      Pharos LPC/TPC/VLC: Controller HTTP API (/api/..., bearer token when a user is set)
//
// Project JSON:
//   "drivers": [{"id":1,"type":"netio","name":"Rack","ip":"10.0.0.40","port":80,
//                "user":"netio","password":"netio","poll":30,"monitor":true,
//                "links":"out1=rackPower, in1=door"}]       point=variable (device -> variable)
//   "vars":{"out1":"rackPower"}                             point -> variable, same as "links"
//   "live":true                                             Pharos: WebSocket; NETIO: MQTT-flex to our broker
//   kissbox:    "frame":"IO8", "cards":["DO4PR","DI8DC",""], "listenPort":9813   (or "slots":"out,in,ain")
//   brightsign: "udpPort":5000, "plugin":true, "pluginPort":5010   (kdlink plugin: zones, user variables, control)
//   knx:        "addresses":[{"ga":"1/1/1","name":"Hall light","dpt":"1","var":"hall"}], "readEvery":0
namespace Drivers {
void begin();                                             // starts the worker threads
void load();                                              // caller holds g_engine
bool isCommand(const String& word);                       // kissbox|knx|brightsign|digidot|netio|pharos
bool command(const std::vector<String>& t, String& msg);  // t[0] is the device type
void statusJson(JsonArray arr);
void pollNow();
// A UDP message arrived on a trigger port: from a BrightSign it becomes its "Player says"
// reading (let the presentation send e.g. "playing Intro" on every state). Returns true for a
// packet of the kdlink plugin (zones, variables), which then fires no UDP triggers.
bool onUdp(const IPAddress& from, const String& text);
void follow(uint32_t now);                                // main loop, caller holds g_engine: BrightSign zones that follow a timeline
bool state(const String& name, bool& online, bool& known);  // false if no driver has this name
}  // namespace Drivers
