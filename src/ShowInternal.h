#pragma once
// Show engine internals shared by Show.cpp (playback engine, output) and
// ShowParse.cpp (reading project.json into the tables below). Not for other modules:
// they use Show.h.
#include <vector>
#include "Fx.h"
#include "Show.h"

namespace ShowImpl {
constexpr int U = KD_MAX_UNIVERSES;

// A fixture channel: "dim" is 8-bit, "pos:16" is a 16-bit pair (coarse + fine). The name
// points into the project JSON (doc, SDRAM; kept as long as these tables), without ":16":
// an Arduino String per channel put ~100 bytes per fixture on the small heap, and a
// 1360-fixture show ran it dry while a save held the old and new tables.
struct Slot {
  const char* name; uint8_t len; int offset; bool wide;
  bool is(const char* s) const { return strlen(s) == len && !strncmp(name, s, len); }
  bool startsWith(const char* p) const { size_t n = strlen(p); return n <= len && !strncmp(name, p, n); }
};
struct Fixture { int id; int u; int address; BigRam::Vec<Slot> slots; int footprint; uint8_t curve; };

enum Curve : uint8_t { CurveLinear, CurveSquare, CurveNonDim, CurvePreheat5, CurvePreheat10 };

// Effects: compiled programs, and per effect cue its parameter values and fixtures.
// A target is one fixture: its dimmer/R/G/B/W channels (-1 = none) and map position.
struct FxTarget { uint8_t u; int16_t d, r, g, b, w; bool dWide; float x, y; };
struct FxCue { int prog; BigRam::Vec<double> slots; double level; BigRam::Vec<FxTarget> targets; };

// The loaded project (replaced as a whole by Show::parse).
extern Settings cfg;
extern JsonDocument doc;
extern BigRam::Vec<UniverseCfg> universes;
extern BigRam::Vec<Fixture> fixtures;
extern BigRam::Vec<Scene> scenes;
extern BigRam::Vec<Timeline> timelines;
extern BigRam::Vec<Scene> cueScenes;   // levels of track presets / track-limited scenes
extern BigRam::Vec<Fx::Program> fxProgs;
extern BigRam::Vec<FxCue> fxCues;
extern BigRam::Vec<double> fxScratch;
extern uint32_t projectVersion;        // bumps on every successful load, so open panels can refresh

// Per channel, from the patch (bit masks are 64 bytes = 512 channels).
extern uint8_t gmExempt[U][64];        // position/beam channels the grand master leaves alone
extern uint8_t wide[U][64];            // coarse channel of a 16-bit pair
extern uint8_t curveOf[U][512];        // dimmer curve per channel

void stopAllPlaybacks();               // before a new project is swapped in

inline bool testBit(const uint8_t* m, int i) { return m[i >> 3] & (1 << (i & 7)); }
inline void setBit(uint8_t* m, int i) { m[i >> 3] |= (1 << (i & 7)); }
inline void clearBit(uint8_t* m, int i) { m[i >> 3] &= ~(1 << (i & 7)); }
inline int clampInt(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

inline int indexOfUniverse(const BigRam::Vec<UniverseCfg>& list, int id) {
  for (size_t i = 0; i < list.size(); i++) if (list[i].id == id) return i;
  return -1;
}
}  // namespace ShowImpl
