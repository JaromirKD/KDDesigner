#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// User variables, like Medialon variables.
// Project JSON:
//   "variables": [{"name":"visitors","type":"number","initial":0,"persist":true},
//                 {"name":"door","type":"bool","modbus":{"device":"plc","table":"coil","address":5}}]
// type: number | text | bool. Values are readable in every command as {name}.
// A variable linked to a Modbus point follows the PLC (polled) and setting it
// writes back to the PLC (coils / holding registers only).
// Changes are queued and fire "variable" triggers from the main loop.
namespace Globals {
struct Change { String name, value, old; };
struct ModbusLink { String name, device, table; uint16_t address; };

void load();                                       // caller holds g_engine
bool exists(const String& name);
bool get(const String& name, String& value);       // thread-safe
// fromDevice = value read from a PLC (no write-back).
bool set(const String& name, const String& value, String& msg, bool fromDevice = false);
bool add(const String& name, double delta, String& msg);
bool toggle(const String& name, String& msg);
// op: = != > < >= <= ; numeric when both sides are numbers.
bool compare(const String& name, const String& op, const String& rhs, String& err);
bool takeChange(Change& c);
size_t modbusLinks(ModbusLink* out, size_t max);   // variables bound to Modbus points
void flush();                                      // writes persistent values (main loop)
void statusJson(JsonObject o);
}  // namespace Globals
