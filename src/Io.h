#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "Globals.h"

// Generic network I/O, like Medialon's generic TCP/IP and Modbus devices,
// plus an HTTP client. Everything runs in one "io" thread
// (also NTP), so a slow device never blocks the show engine.

namespace Io {
void begin();       // starts the io thread
void load();        // caller holds g_engine: (re)reads tcp/modbus devices
void statusJson(JsonObject o);
}  // namespace Io

// TCP devices kept connected (auto-reconnect).
// "tcp": [{"name":"watchout","ip":"10.0.0.20","port":3039,"eol":"\r\n"}]
// Received lines fire "tcp" triggers.
namespace Tcp {
struct Line { String device, text; };
bool send(const String& device, const String& text, String& msg);   // adds the device's eol
bool takeLine(Line& l);
bool state(const String& name, bool& online, bool& known);
}  // namespace Tcp

// HTTP/1.0 requests (plain http, no https; 1.0 so replies are never chunked). Responses fire "http" triggers.
namespace Http {
struct Response { String method, url, body; int status; };
bool request(const String& method, const String& url, const String& body, String& msg);
bool takeResponse(Response& r);
}  // namespace Http

// Modbus TCP client. Points are variables with a "modbus" link (see Globals.h).
// "modbus": [{"name":"plc","ip":"10.0.0.30","port":502,"unit":1,"pollMs":500}]
// table: coil | discrete | holding | input  (coil/holding are writable)
namespace Modbus {
bool writeLink(const Globals::ModbusLink& l, const String& value, String& err);
bool write(const String& device, const String& table, uint16_t address, uint16_t value, String& msg);
bool state(const String& name, bool& online, bool& known);
}  // namespace Modbus
