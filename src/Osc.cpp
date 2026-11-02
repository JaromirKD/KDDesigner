#include "Osc.h"
#include <math.h>

namespace {
size_t pad4(size_t n) { return (n + 3) & ~(size_t)3; }

bool putString(const String& s, uint8_t* buf, size_t cap, size_t& pos) {
  size_t n = pad4(s.length() + 1);
  if (pos + n > cap) return false;
  memset(buf + pos, 0, n);
  memcpy(buf + pos, s.c_str(), s.length());
  pos += n;
  return true;
}

bool put32(uint32_t v, uint8_t* buf, size_t cap, size_t& pos) {
  if (pos + 4 > cap) return false;
  buf[pos++] = v >> 24; buf[pos++] = v >> 16; buf[pos++] = v >> 8; buf[pos++] = v;
  return true;
}

uint32_t get32(const uint8_t* p) { return ((uint32_t)p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]; }

bool isInt(const String& s) {
  if (!s.length()) return false;
  for (size_t i = 0; i < s.length(); i++)
    if (!isdigit(s[i]) && !(i == 0 && s[i] == '-' && s.length() > 1)) return false;
  return true;
}

bool isFloat(const String& s, float& f) {
  if (s == "inf" || s == "+inf") { f = INFINITY; return true; }
  if (s == "-inf") { f = -INFINITY; return true; }
  char* end;
  f = strtof(s.c_str(), &end);
  return s.length() && *end == 0;
}
}  // namespace

namespace Osc {

size_t encode(const String& address, const std::vector<String>& args, uint8_t* buf, size_t cap) {
  size_t pos = 0;
  String tags = ",";
  for (auto& a : args) {
    float f;
    tags += isInt(a) ? 'i' : isFloat(a, f) ? 'f' : 's';
  }
  if (!putString(address, buf, cap, pos) || !putString(tags, buf, cap, pos)) return 0;
  for (size_t i = 0; i < args.size(); i++) {
    char t = tags[i + 1];
    float f;
    if (t == 'i') { if (!put32((uint32_t)args[i].toInt(), buf, cap, pos)) return 0; }
    else if (t == 'f') { isFloat(args[i], f); uint32_t u; memcpy(&u, &f, 4); if (!put32(u, buf, cap, pos)) return 0; }
    else if (!putString(args[i], buf, cap, pos)) return 0;
  }
  return pos;
}

bool decode(const uint8_t* buf, size_t len, String& address, std::vector<String>& args) {
  args.clear();
  if (len < 4 || buf[0] != '/') return false;
  size_t alen = strnlen((const char*)buf, len);
  if (alen >= len) return false;
  address = String((const char*)buf).substring(0, alen);
  size_t pos = pad4(alen + 1);
  if (pos >= len || buf[pos] != ',') return pos >= len;  // no type tag string: no args
  size_t tlen = strnlen((const char*)buf + pos, len - pos);
  String tags = String((const char*)buf + pos).substring(0, tlen);
  pos += pad4(tlen + 1);
  for (size_t i = 1; i < tags.length(); i++) {
    char t = tags[i];
    if (t == 'i' || t == 'f') {
      if (pos + 4 > len) return false;
      uint32_t u = get32(buf + pos);
      pos += 4;
      if (t == 'i') args.push_back(String((int32_t)u));
      else { float f; memcpy(&f, &u, 4); args.push_back(isinf(f) ? String(f < 0 ? "-inf" : "inf") : String(f, 3)); }
    } else if (t == 's') {
      size_t n = strnlen((const char*)buf + pos, len - pos);
      if (pos + n >= len) return false;
      args.push_back(String((const char*)buf + pos).substring(0, n));
      pos += pad4(n + 1);
    } else if (t == 'T' || t == 'F') {
      args.push_back(t == 'T' ? "1" : "0");
    } else {
      return true;  // unsupported type: keep what we have
    }
  }
  return true;
}

bool match(const char* p, const char* a) {
  while (*p) {
    if (*p == '*') {
      p++;
      // '*' never crosses a '/'
      for (const char* s = a;; s++) {
        if (match(p, s)) return true;
        if (!*s || *s == '/') return false;
      }
    }
    if (!*a || (*p != '?' && *p != *a)) return false;
    p++;
    a++;
  }
  return !*a;
}

}  // namespace Osc
