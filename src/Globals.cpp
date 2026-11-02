#include "Globals.h"
#include <mbed.h>
#include <deque>
#include <vector>
#include "Config.h"
#include "Io.h"
#include "Log.h"
#include "Show.h"
#include "Storage.h"

namespace {
enum class Type { Number, Text, Bool };

struct Var {
  String name;
  Type type = Type::Number;
  String value;
  bool persist = false;
  bool hasLink = false;
  Globals::ModbusLink link;
};

std::vector<Var> vars;
std::deque<Globals::Change> changes;
rtos::Mutex mtx;
bool dirty = false;
uint32_t dirtySince = 0;
const char kPath[] = KD_USB_ROOT "/show/vars.json";

Var* find(const String& name) {
  for (auto& v : vars) if (v.name.equalsIgnoreCase(name)) return &v;
  return nullptr;
}

bool isNumber(const String& s, double& d) {
  if (!s.length()) return false;
  char* end;
  d = strtod(s.c_str(), &end);
  return *end == 0;
}

String formatNumber(double d) {
  if (fabs(d - round(d)) < 1e-9) return String((long)round(d));
  String s(d, 4);
  while (s.endsWith("0")) s.remove(s.length() - 1);
  return s;
}

// Coerces a value to the variable's type; false if it doesn't fit.
bool coerce(Type t, const String& in, String& out) {
  double d;
  switch (t) {
    case Type::Number:
      if (!isNumber(in, d)) return false;
      out = formatNumber(d);
      return true;
    case Type::Bool: {
      String s = in;
      s.toLowerCase();
      if (s == "1" || s == "on" || s == "true" || s == "yes") out = "1";
      else if (s == "0" || s == "off" || s == "false" || s == "no") out = "0";
      else return false;
      return true;
    }
    default:
      out = in;
      return true;
  }
}

const char* typeName(Type t) { return t == Type::Number ? "number" : t == Type::Bool ? "bool" : "text"; }
}  // namespace

namespace Globals {

void load() {
  JsonDocument& doc = Show::projectDoc();
  std::vector<Var> nv;
  for (JsonObjectConst o : doc["variables"].as<JsonArrayConst>()) {
    Var v;
    v.name = o["name"] | "";
    if (!v.name.length()) continue;
    String t = o["type"] | "number";
    v.type = t == "text" ? Type::Text : t == "bool" ? Type::Bool : Type::Number;
    String init = o["initial"].is<const char*>() ? String(o["initial"].as<const char*>())
                  : o["initial"].is<bool>() ? String(o["initial"].as<bool>() ? "1" : "0")
                  : o["initial"].isNull() ? String("") : String(o["initial"].as<double>());
    if (!coerce(v.type, init, v.value)) v.value = v.type == Type::Text ? "" : "0";
    v.persist = o["persist"] | false;
    JsonObjectConst m = o["modbus"];
    if (!m.isNull() && (m["device"] | "")[0]) {
      v.hasLink = true;
      v.link = {v.name, m["device"] | "", m["table"] | "holding", (uint16_t)(m["address"] | 0)};
    }
    // Keep the live value of a variable that survives a reload.
    if (Var* old = find(v.name)) if (old->type == v.type) v.value = old->value;
    nv.push_back(v);
  }
  // Restore persistent values from the last run (first load only matters, later ones keep live values).
  String saved;
  JsonDocument s;
  if (Storage::readFile(kPath, saved, 8192) && !deserializeJson(s, saved)) {
    for (auto& v : nv) {
      if (!v.persist || s[v.name].isNull()) continue;
      String raw = s[v.name].as<String>(), val;
      if (coerce(v.type, raw, val)) v.value = val;
    }
  }
  mtx.lock();
  vars = std::move(nv);
  changes.clear();
  mtx.unlock();
  LOGI(Sys, "%d variable(s) loaded", (int)vars.size());
}

bool exists(const String& name) {
  mtx.lock();
  bool e = find(name) != nullptr;
  mtx.unlock();
  return e;
}

bool get(const String& name, String& value) {
  mtx.lock();
  Var* v = find(name);
  if (v) value = v->value;
  mtx.unlock();
  return v != nullptr;
}

bool set(const String& name, const String& value, String& msg, bool fromDevice) {
  mtx.lock();
  Var* v = find(name);
  if (!v) { mtx.unlock(); msg = "unknown variable '" + name + "'"; return false; }
  if (!fromDevice && v->hasLink && (v->link.table == "discrete" || v->link.table == "input")) {
    msg = v->name + " follows PLC " + v->link.table + " " + v->link.address + " and is read-only";
    mtx.unlock();
    return false;
  }
  String val;
  if (!coerce(v->type, value, val)) {
    msg = "'" + value + "' is not a valid " + typeName(v->type) + " for " + v->name;
    mtx.unlock();
    return false;
  }
  String old = v->value;
  bool changed = old != val;
  v->value = val;
  bool link = v->hasLink && !fromDevice;
  ModbusLink l = v->link;
  if (changed) {
    if (changes.size() < 64) changes.push_back({v->name, val, old});
    if (v->persist) { dirty = true; dirtySince = millis(); }
  }
  String n = v->name;
  mtx.unlock();
  if (changed) LOGD(Sys, "var %s = %s%s", n.c_str(), val.c_str(), fromDevice ? " (from PLC)" : "");
  if (link) {
    String err;
    if (!Modbus::writeLink(l, val, err)) LOGW(Sys, "var %s: %s", n.c_str(), err.c_str());
  }
  msg = n + " = " + val;
  return true;
}

bool add(const String& name, double delta, String& msg) {
  String cur;
  if (!get(name, cur)) { msg = "unknown variable '" + name + "'"; return false; }
  double d;
  if (!isNumber(cur, d)) { msg = name + " is not a number"; return false; }
  return set(name, formatNumber(d + delta), msg);
}

bool toggle(const String& name, String& msg) {
  String cur;
  if (!get(name, cur)) { msg = "unknown variable '" + name + "'"; return false; }
  return set(name, cur == "1" ? "0" : "1", msg);
}

bool compare(const String& name, const String& op, const String& rhs, String& err) {
  String cur;
  if (!get(name, cur)) { err = "unknown variable '" + name + "'"; return false; }
  double a, b;
  // Bools compare against on/off/true/1 as well.
  String r = rhs, c = cur;
  r.toLowerCase();
  if (r == "on" || r == "true" || r == "yes") r = "1";
  if (r == "off" || r == "false" || r == "no") r = "0";
  if (isNumber(c, a) && isNumber(r, b)) {
    if (op == "=" || op == "==") return a == b;
    if (op == "!=") return a != b;
    if (op == ">") return a > b;
    if (op == "<") return a < b;
    if (op == ">=") return a >= b;
    if (op == "<=") return a <= b;
  } else {
    if (op == "=" || op == "==") return c.equalsIgnoreCase(rhs) || c == r;
    if (op == "!=") return !(c.equalsIgnoreCase(rhs) || c == r);
    if (op == ">" || op == "<" || op == ">=" || op == "<=") { err = "'" + op + "' needs numbers"; return false; }
  }
  err = "unknown operator '" + op + "'";
  return false;
}

bool takeChange(Change& c) {
  mtx.lock();
  bool have = !changes.empty();
  if (have) { c = changes.front(); changes.pop_front(); }
  mtx.unlock();
  return have;
}

size_t modbusLinks(ModbusLink* out, size_t max) {
  mtx.lock();
  size_t n = 0;
  for (auto& v : vars)
    if (v.hasLink && n < max) out[n++] = v.link;
  mtx.unlock();
  return n;
}

void flush() {
  // Write at most every 2 s, so a fast-changing counter doesn't wear the stick.
  if (!dirty || millis() - dirtySince < 2000 || !Storage::mounted()) return;
  JsonDocument d;
  mtx.lock();
  for (auto& v : vars) if (v.persist) d[v.name] = v.value;
  dirty = false;
  mtx.unlock();
  String s;
  serializeJson(d, s);
  Storage::writeFile(kPath, s.c_str(), s.length());
}

void statusJson(JsonObject o) {
  mtx.lock();
  for (auto& v : vars) o[v.name] = v.value;
  mtx.unlock();
}

}  // namespace Globals
