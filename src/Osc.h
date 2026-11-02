#pragma once
#include <Arduino.h>
#include <vector>

// Minimal OSC 1.0 message encoding/decoding (no bundles):
//   /cue/199/start      /cue/*/level 0 0 -inf
namespace Osc {
// Arguments are typed from their text: 12 -> int32, 1.5 / -inf -> float32,
// anything else -> string. Returns the packet size, 0 if it does not fit.
size_t encode(const String& address, const std::vector<String>& args, uint8_t* buf, size_t cap);

// Decodes a message; args are returned as text. False if not valid OSC.
bool decode(const uint8_t* buf, size_t len, String& address, std::vector<String>& args);

// OSC-style address match: '*' matches within one path segment, '?' one char.
bool match(const char* pattern, const char* address);
}  // namespace Osc
