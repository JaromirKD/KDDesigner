#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <mbed.h>
#include <vector>
#include "Config.h"
#include "Net.h"

// Everything that touches the show engine (tick, commands, project reload)
// must hold this mutex: the web server runs in its own thread.
extern rtos::Mutex g_engine;

// u = universe index, ch = 0..511. 16-bit levels use ch (coarse) and ch+1 (fine).
struct Level { uint8_t u; uint16_t ch; uint16_t v; bool wide; };
struct Scene { int id; String name; std::vector<Level> levels; };
// Crossfade path, like Pharos: how a cue moves from the old to the new value.
enum class Path : uint8_t { Linear, Accelerated, Braked, Damped, Overshoot };
// A cue plays a scene (index into scenes), its own levels (a track preset, or a scene
// limited to the track's fixtures: own = index into the cue scenes), or, with neither,
// fires a trigger (name or number), or runs an effect on the track's fixtures until the
// next cue on that track (fx = index into the effect cues). Each track fades on its own.
// A cue with a length ("len") ends: Show::parse adds a release cue (release = true) at its
// end minus its fade-out, which hands the track's channels back to what is underneath,
// unless another cue (from = the start of the cue it ends) took over the track meanwhile.
struct Cue { uint32_t t; uint32_t fade; int scene; int own; int fx; uint8_t track; Path path; String trigger; bool release = false; uint32_t from = 0; };
struct Timeline {
  int id; String name; uint32_t length; bool loop; int priority;
  String group;                      // starting a timeline releases others in the same group
  std::vector<Cue> cues;
};
struct UniverseCfg {
  int id; String name; int dmxPort; int artnet; int sacn; IPAddress artnetDest;
  bool useDmx, useArtnet, useSacn;   // per-universe output selection
};
enum class Output : uint8_t { Dmx, ArtNet, Sacn };
struct Settings {
  String name = "Untitled";
  int tzOffsetMin = 0;
  int udpPort = 4000;
  uint8_t sacnPriority = 100;
  bool outDmx = true, outArtnet = true, outSacn = true;  // global protocol switches
  // Frames per second per protocol. DMX512 tops out around 44 fps for 512 slots.
  uint8_t dmxFps = 40, artnetFps = 40, sacnFps = 40;
  // Network protocols: only send when a universe changed (+1 s keep-alive), or continuously.
  bool artnetChangesOnly = true, sacnChangesOnly = true;
  NetConfig net;
};

namespace Show {
bool loadFile(const char* path, String& err);      // replaces the running project on success
bool parse(const char* json, size_t len, String& err);
const Settings& settings();
JsonDocument& projectDoc();                        // raw project (used by triggers)

void tick(uint32_t nowMs);
void sendOutputs(uint32_t nowMs);                  // DMX / Art-Net / sACN
const uint8_t* output(int uIndex);
int universeCount();
int universeIndex(int id);                         // -1 if unknown

int findTimeline(const String& ref);               // by id or name, -1 if not found
int findScene(const String& ref);
const Timeline& timeline(int idx);
const Scene& scene(int idx);
int timelineCount();
bool timelineRunning(int idx);                     // active and not releasing

bool startTimeline(int idx, String& msg, uint32_t atMs = 0);   // atMs: start part-way
bool stopTimeline(int idx, uint32_t fadeMs, String& msg);
bool pauseTimeline(int idx, bool pause, String& msg);
bool setMaster(int idx, float level, uint32_t fadeMs, String& msg);
bool playScene(int idx, uint32_t fadeMs, String& msg, Path path = Path::Linear);
bool releaseScene(int idx, uint32_t fadeMs, String& msg);
void releaseAll(uint32_t fadeMs);
void setOverride(int uIndex, int ch, int value);   // value < 0 clears
void clearOverrides();
void setOutput(Output o, bool on);                 // runtime switch, not saved
bool setFps(Output o, int fps, String& msg);       // runtime, not saved
uint32_t engineHz();                               // engine rate: max(40, network fps), <= 60
void setGrandMaster(float level);
void setBlackout(bool on);

bool takeEndedTimeline(int& timelineId);           // timeline-end events for triggers
bool takeTimelineCue(int& timelineId, String& trigger);  // trigger cues that were reached
void statusJson(JsonObject obj);
}  // namespace Show
