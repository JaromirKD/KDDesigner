#pragma once
#include <Arduino.h>
#include <vector>

// Trigger variables, like Pharos trigger captures. A trigger fills them (OSC
// arguments, UDP text, the DMX channel that changed...) and its actions use
// them as {name}. {=expression} evaluates arithmetic:
//   + - * / %  ( )  ceil floor round abs min(a,b) max(a,b)
// e.g.  send udp 10.0.0.9 5000 "{puppet}{motor}P{=ceil(value*range/255)}\r"
struct Vars {
  std::vector<std::pair<String, String>> kv;
  void set(const String& name, const String& value);
  const String* get(const String& name) const;
};

// Replaces {name} and {=expr} in a command line. Trigger variables win over
// user variables (Globals) of the same name. Unknown names stay as-is.
String expandVars(const String& line, const Vars* vars);
