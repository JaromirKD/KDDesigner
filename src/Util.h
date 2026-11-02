#pragma once
#include <Arduino.h>
#include <algorithm>
#include <vector>

// Small helpers used by several modules.

// Command words t[from..] joined back into free text.
String rest(const std::vector<String>& t, size_t from);

// "get" -> "GET"; false (with the message in err) unless GET, POST, PUT or DELETE.
bool httpMethod(const String& word, String& method, String& err);

inline uint32_t epochNow() { return (uint32_t)time(nullptr); }   // Unix seconds (0 until NTP)

// True for "12" (digits only): references by number, otherwise by name.
inline bool isNumber(const String& s) { return s.length() && std::all_of(s.c_str(), s.c_str() + s.length(), ::isdigit); }

// Index of the item a command refers to: its id when ref is a number, else its name
// (case-insensitive). -1 when not found.
template <class Id, class Name>
int findRef(const String& ref, int count, Id idOf, Name nameOf) {
  bool numeric = isNumber(ref);
  for (int i = 0; i < count; i++)
    if (numeric ? idOf(i) == ref.toInt() : nameOf(i).equalsIgnoreCase(ref)) return i;
  return -1;
}

// "\r", "\n", "\t" and "\xHH" in command text become the real characters.
String unescape(const String& s);

String toHex(const uint8_t* d, size_t n);      // lower-case hex
void md5(const uint8_t* msg, size_t len, uint8_t out[16]);
String md5hex(const String& s);               // PJLink and HTTP digest auth
