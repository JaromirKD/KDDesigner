// Just enough of Arduino's String for Fx.cpp to build on a PC (tools/fxtest).
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <string>

class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& x) : s(x) {}
  String(char c) : s(1, c) {}
  String(int v) : s(std::to_string(v)) {}
  String(unsigned v) : s(std::to_string(v)) {}
  String(long v) : s(std::to_string(v)) {}
  const char* c_str() const { return s.c_str(); }
  unsigned length() const { return s.size(); }
  String substring(unsigned a) const { return a >= s.size() ? String() : String(s.substr(a)); }
  String substring(unsigned a, unsigned b) const { if (b > s.size()) b = s.size(); return a >= b ? String() : String(s.substr(a, b - a)); }
  void toLowerCase() { for (auto& c : s) c = tolower((unsigned char)c); }
  bool startsWith(const String& p) const { return s.compare(0, p.s.size(), p.s) == 0; }
  int indexOf(char c) const { auto k = s.find(c); return k == std::string::npos ? -1 : (int)k; }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator==(const char* o) const { return s == o; }
  bool operator!=(const String& o) const { return s != o.s; }
  char operator[](unsigned i) const { return s[i]; }
  String& operator+=(const String& o) { s += o.s; return *this; }
};
inline String operator+(const String& a, const String& b) { return String(a.s + b.s); }
inline String operator+(const String& a, const char* b) { return String(a.s + b); }
inline String operator+(const char* a, const String& b) { return String(a + b.s); }
inline String operator+(const String& a, char b) { return String(a.s + b); }
