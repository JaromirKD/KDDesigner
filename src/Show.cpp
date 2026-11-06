// The light engine: playbacks, crossfades, effects and the DMX / Art-Net / sACN output.
// Reading project.json is in ShowParse.cpp; both share the tables in ShowInternal.h.
#include <algorithm>
#include "BigRam.h"
#include "D2Ram.h"
#include "Dmx.h"
#include "Fx.h"
#include "Log.h"
#include "ShowInternal.h"
#include "State.h"
#include "Util.h"

rtos::Mutex g_engine;

namespace ShowImpl {
Settings cfg;
JsonDocument doc(BigRam::json());   // the loaded project, in SDRAM (BigRam.h)
BigRam::Vec<UniverseCfg> universes;
BigRam::Vec<Fixture> fixtures;
BigRam::Vec<Scene> scenes;
BigRam::Vec<Timeline> timelines;
BigRam::Vec<Scene> cueScenes;
BigRam::Vec<Fx::Program> fxProgs;
BigRam::Vec<FxCue> fxCues;
BigRam::Vec<double> fxScratch;
uint32_t projectVersion = 0;
uint8_t gmExempt[U][64];
uint8_t wide[U][64];
uint8_t curveOf[U][512];
}  // namespace ShowImpl

using namespace ShowImpl;

namespace {

struct Playback {
  bool active = false;
  bool isScene = false;
  int ref = -1;                 // timeline or scene index
  uint32_t start = 0, pausedAt = 0;
  bool paused = false, ended = false;
  size_t nextCue = 0;
  uint32_t catchUp = 0;         // started part-way: cues before this time jump in without fades
  // Each track fades on its own; every owned channel belongs to the track that last set it.
  // fx >= 0: an effect cue is running on the track (its channels change every frame).
  // A track whose cue ended (rel) fades its opacity op to 0, then lets go of its channels.
  // lastT = start of the last cue on the track, so a release only ends that cue.
  struct TrackFade {
    uint32_t start = 0, len = 0; Path path = Path::Linear; bool fading = false; int fx = -1; uint32_t fxStart = 0;
    float op = 1; bool rel = false; uint32_t rStart = 0, rLen = 0, lastT = UINT32_MAX;
  };
  TrackFade tf[KD_MAX_TRACKS];
  uint8_t chTrack[U][512];
  float master = 1, mFrom = 1, mTo = 1;
  uint32_t mStart = 0, mLen = 0;
  bool releasing = false;
  int priority = 0;
  uint32_t order = 0;
  uint8_t from[U][512], to[U][512], cur[U][512], mask[U][64];
};

// ~140 KB: in D2 SRAM, not the heap's RAM (D2Ram.h).
Playback (&pbs)[KD_MAX_PLAYBACKS] = D2Ram::array<Playback, KD_MAX_PLAYBACKS>();
uint8_t out[U][512];
// Per network protocol: what was last sent and when (each has its own rate).
struct Pace { uint8_t sent[U][512]; uint32_t at[U]; };
Pace artPace, sacnPace;
uint8_t ovr[U][512], ovrMask[U][64];
float gm = 1;
bool blackout = false;
uint32_t orderCounter = 0;
std::vector<int> endedQueue;
struct CueEvent { int timeline; String trigger; };
std::vector<CueEvent> cueQueue;

const char* const kOutputNames[] = {"DMX", "Art-Net", "sACN"};   // by Output

uint8_t applyCurve(uint8_t c, uint8_t v) {
  switch (c) {
    case CurveSquare: return (uint16_t)v * v / 255;
    case CurveNonDim: return v >= 128 ? 255 : 0;
    case CurvePreheat5: return 13 + (uint16_t)v * 242 / 255;
    case CurvePreheat10: return 26 + (uint16_t)v * 229 / 255;
    default: return v;
  }
}

float ease(Path p, float k) {
  switch (p) {
    case Path::Accelerated: return k * k;
    case Path::Braked: return 1 - (1 - k) * (1 - k);
    case Path::Damped: return k * k * (3 - 2 * k);
    case Path::Overshoot: { const float c1 = 1.70158f, c3 = c1 + 1; float x = k - 1; return 1 + c3 * x * x * x + c1 * x * x; }
    default: return k;
  }
}

Playback* findPlayback(bool isScene, int ref) {
  for (auto& p : pbs) if (p.active && p.isScene == isScene && p.ref == ref) return &p;
  return nullptr;
}

// The playback already running this timeline/scene, else a free one (nullptr + msg when full).
Playback* takePlayback(bool isScene, int ref, String& msg) {
  if (Playback* p = findPlayback(isScene, ref)) return p;
  for (auto& p : pbs) if (!p.active) return &p;
  msg = "No free playback slot";
  LOGW(Show, "%s", msg.c_str());
  return nullptr;
}

void resetPlayback(Playback& p, bool isScene, int ref, int priority, uint32_t now) {
  p.active = true;
  p.isScene = isScene;
  p.ref = ref;
  p.start = now;
  p.paused = p.ended = p.releasing = false;
  for (auto& f : p.tf) { f.fading = false; f.fx = -1; f.rel = false; f.op = 1; f.lastT = UINT32_MAX; }
  p.nextCue = 0;
  p.catchUp = 0;
  p.master = p.mFrom = p.mTo = 1;
  p.mLen = 0;
  p.priority = priority;
  p.order = ++orderCounter;
  memset(p.mask, 0, sizeof(p.mask));
}

// A track takes a channel for its next fade: a channel the playback already owns
// fades on from where it is now; a new one starts from the live output, so the
// crossfade is seamless.
void claimChannel(Playback& p, int u, int ch, uint8_t track) {
  if (testBit(p.mask[u], ch)) {
    p.from[u][ch] = p.cur[u][ch];
  } else {
    setBit(p.mask[u], ch);
    p.from[u][ch] = p.cur[u][ch] = out[u][ch];
  }
  p.chTrack[u][ch] = track;
}

void startTrackFade(Playback& p, uint8_t track, uint32_t now, uint32_t fadeMs, Path path, int fx) {
  auto& f = p.tf[track];
  f.start = now;
  f.len = fadeMs;
  f.path = path;
  f.fading = true;
  f.fx = fx;   // a scene/preset (-1) ends the effect on this track
  if (fx >= 0) f.fxStart = now;
}

// A 16-bit value goes into the coarse channel and the fine one after it.
void putTarget(Playback& p, int u, int ch, bool wide, int v) {
  if (wide) { p.to[u][ch] = v >> 8; p.to[u][ch + 1] = v & 0xff; }
  else p.to[u][ch] = v;
}

void fireScene(Playback& p, const Scene& s, uint32_t fadeMs, Path path, uint32_t now, uint8_t track = 0) {
  // Channels this track already owns keep fading from where they are now.
  for (int u = 0; u < U; u++)
    for (int i = 0; i < 512; i++)
      if (testBit(p.mask[u], i) && p.chTrack[u][i] == track) p.from[u][i] = p.cur[u][i];
  for (const auto& l : s.levels) {
    for (int k = 0; k < (l.wide ? 2 : 1); k++) claimChannel(p, l.u, l.ch + k, track);
    putTarget(p, l.u, l.ch, l.wide, l.v);
  }
  startTrackFade(p, track, now, fadeMs, path, -1);
}

void setTarget(Playback& p, int u, int ch, bool wide, double v01) {
  putTarget(p, u, ch, wide, (int)lround(v01 * (wide ? 65535 : 255)));
}

// One frame of the effect on a track: run the program per fixture into p.to.
// Same mapping as toFixture() in fx.js.
void runEffect(Playback& p, int track, uint32_t now) {
  const FxCue& fc = fxCues[p.tf[track].fx];
  const Fx::Program& prog = fxProgs[fc.prog];
  double* s = fxScratch.data();
  const int n = fc.targets.size();
  const double t = (now - p.tf[track].fxStart) / 1000.0;
  for (int i = 0; i < n; i++) {
    const FxTarget& x = fc.targets[i];
    memcpy(s, fc.slots.data(), sizeof(double) * prog.slots);
    s[Fx::T] = t;
    s[Fx::I] = i;
    s[Fx::N] = n;
    s[Fx::U] = (double)i / n;
    s[Fx::X] = x.x;
    s[Fx::Y] = x.y;
    Fx::run(prog, s);
    auto cl = [](double v) { return v < 0 ? 0.0 : v > 1 ? 1.0 : v; };
    double dim = cl(s[Fx::DIM]) * fc.level;
    double r = cl(s[Fx::R]), g = cl(s[Fx::G]), b = cl(s[Fx::B]), w = s[Fx::W] >= 0 ? cl(s[Fx::W]) : -1;
    if (x.r < 0 || x.g < 0 || x.b < 0) {
      if (x.d >= 0) setTarget(p, x.u, x.d, x.dWide, dim * std::max(r, std::max(g, b)));
      continue;
    }
    if (x.d >= 0) setTarget(p, x.u, x.d, x.dWide, dim);
    else { r *= dim; g *= dim; b *= dim; if (w >= 0) w *= dim; }
    if (x.w >= 0) {
      if (w < 0) { w = std::min(r, std::min(g, b)); r -= w; g -= w; b -= w; }
      setTarget(p, x.u, x.w, false, w);
    }
    setTarget(p, x.u, x.r, false, r);
    setTarget(p, x.u, x.g, false, g);
    setTarget(p, x.u, x.b, false, b);
  }
}

// Effect cue: the track's fixtures crossfade (over the cue's fade) into the running effect.
// at = when the cue was due (its fade and the effect's time count from there).
void startEffect(Playback& p, const Cue& c, uint32_t at, uint32_t now) {
  const FxCue& fc = fxCues[c.fx];
  for (const auto& x : fc.targets)
    for (int ch : {(int)x.d, (int)x.r, (int)x.g, (int)x.b, (int)x.w}) {
      if (ch < 0) continue;
      for (int k = 0; k < ((ch == x.d && x.dWide) ? 2 : 1); k++) claimChannel(p, x.u, ch + k, c.track);
    }
  startTrackFade(p, c.track, at, c.fade, c.path, c.fx);
  runEffect(p, c.track, now);
}

void updateFade(Playback& p, uint32_t now) {
  float e[KD_MAX_TRACKS];
  bool any = false;
  for (int t = 0; t < KD_MAX_TRACKS; t++) {
    auto& f = p.tf[t];
    e[t] = -1;   // not fading: leave its channels alone
    if (!f.fading) {
      if (f.fx >= 0) { e[t] = 1; any = true; }   // effect running: follow it every frame
      continue;
    }
    float k = f.len ? (float)(now - f.start) / f.len : 1.0f;
    if (k >= 1) { k = 1; f.fading = false; }
    e[t] = ease(f.path, k);
    any = true;
  }
  if (!any) return;
  for (int u = 0; u < U; u++)
    for (int i = 0; i < 512; i++) {
      if (!testBit(p.mask[u], i)) continue;
      float ek = e[p.chTrack[u][i]];
      if (ek < 0) continue;
      if (testBit(wide[u], i) && i < 511) {
        int a = (p.from[u][i] << 8) | p.from[u][i + 1], b = (p.to[u][i] << 8) | p.to[u][i + 1];
        int v = clampInt(a + lroundf((b - a) * ek), 0, 65535);
        p.cur[u][i] = v >> 8;
        p.cur[u][i + 1] = v & 0xff;
        i++;
      } else {
        p.cur[u][i] = clampInt(p.from[u][i] + lroundf((p.to[u][i] - p.from[u][i]) * ek), 0, 255);
      }
    }
}

// The track lets go of its channels: they show what is underneath again (lower
// timelines, or 0). A new cue then starts from the live output.
void endRelease(Playback& p, uint8_t track) {
  for (int u = 0; u < U; u++)
    for (int i = 0; i < 512; i++)
      if (testBit(p.mask[u], i) && p.chTrack[u][i] == track) clearBit(p.mask[u], i);
  auto& f = p.tf[track];
  f.rel = f.fading = false;
  f.op = 1;
  f.fx = -1;
}

void updateRelease(Playback& p, uint32_t now) {
  for (int t = 0; t < KD_MAX_TRACKS; t++) {
    auto& f = p.tf[t];
    if (!f.rel) continue;
    float k = f.rLen ? (float)(now - f.rStart) / f.rLen : 1.0f;
    if (k >= 1) endRelease(p, t);
    else f.op = 1 - k;
  }
}

void updateMaster(Playback& p, uint32_t now) {
  if (!p.mLen && p.master == p.mTo) return;
  float k = p.mLen ? (float)(now - p.mStart) / p.mLen : 1.0f;
  if (k >= 1) { k = 1; p.mLen = 0; }
  p.master = p.mFrom + (p.mTo - p.mFrom) * k;
  if (p.releasing && k >= 1) { p.active = false; State::changed(); }   // faded out: gone from the dashboard now
}

void fadeMasterTo(Playback& p, float target, uint32_t fadeMs, uint32_t now) {
  p.mFrom = p.master;
  p.mTo = target;
  p.mStart = now;
  p.mLen = fadeMs;
  if (!fadeMs) p.master = target;
}

// A light cue (scene, preset or effect) on this track at 0 s: after a loop it takes the track over.
bool trackStartsAtZero(const Timeline& t, uint8_t track) {
  for (const auto& c : t.cues) {   // sorted by time
    if (c.t > 0) break;
    if (c.track == track && !c.release && !c.trigger.length()) return true;
  }
  return false;
}

void updateTimeline(Playback& p, uint32_t now) {
  const Timeline& t = timelines[p.ref];
  // Signed: a timeline started (millis()) after this tick's `now` was read must count as 0,
  // not wrap to ~49 days - that "looped" it on every tick (start += length kept it in the
  // future), firing all its cues 40 times a second (seen on the board: tick ~24 ms).
  int32_t e = (int32_t)((p.paused ? p.pausedAt : now) - p.start);
  uint32_t elapsed = e > 0 ? (uint32_t)e : 0;
  if (p.paused || p.ended) return;
  while (p.nextCue < t.cues.size() && t.cues[p.nextCue].t <= elapsed) {
    const Cue& c = t.cues[p.nextCue++];
    // Fades and effects count from when the cue was due, not when this tick saw it.
    // Started part-way, that picks them up where they would be: a fade half done, an
    // effect mid-way. Trigger cues before that point are skipped (the video etc. was
    // not meant to start now).
    const bool past = c.t < p.catchUp;
    const uint32_t at = now - (elapsed - c.t);
    auto& f = p.tf[c.track];
    if (c.release) {
      if (f.lastT != c.from || f.rel) continue;   // another cue took over the track meanwhile
      // A clip that runs to the end of a looping timeline, with no fade-out, is not let go
      // when the track starts again at 0 s: letting go showed one frame of black at the loop.
      if (!c.fade && t.loop && t.length && c.t >= t.length && trackStartsAtZero(t, c.track)) continue;
      f.rel = true;
      f.rStart = at;
      f.rLen = c.fade;
      if (!c.fade) endRelease(p, c.track);
      continue;
    }
    // Looped round to an effect cue that is still running on its track (nothing else took the
    // track over): it runs on, so its time and phase carry on seamlessly instead of restarting.
    if (c.fx >= 0 && f.fx == c.fx && f.lastT == c.t && !f.rel) continue;
    if (!c.trigger.length()) {
      if (f.rel) endRelease(p, c.track);   // a new cue during a fade-out starts from the live output
      f.lastT = c.t;
    }
    if (c.fx >= 0) startEffect(p, c, at, now);
    else if (c.own >= 0) fireScene(p, cueScenes[c.own], c.fade, c.path, at, c.track);
    else if (c.scene >= 0) fireScene(p, scenes[c.scene], c.fade, c.path, at, c.track);
    else if (c.trigger.length() && !past && !p.releasing && cueQueue.size() < 32) cueQueue.push_back({t.id, c.trigger});  // not while fading out
    // Catching up: bring the levels to this cue's look now, so the next cue fades from it.
    if (past && !c.trigger.length()) updateFade(p, now);
  }
  p.catchUp = 0;
  if (t.length && elapsed >= t.length) {
    if (t.loop) {
      p.start += t.length;
      p.nextCue = 0;
      LOGD(Show, "Timeline %d '%s' looped", t.id, t.name.c_str());
    } else {
      p.ended = true;
      endedQueue.push_back(t.id);
      State::changed();
      LOGI(Show, "Timeline %d '%s' reached end (holding)", t.id, t.name.c_str());
    }
  }
}

void releasePlayback(Playback& p, uint32_t fadeMs) {
  p.releasing = true;
  fadeMasterTo(p, 0, fadeMs, millis());
  if (!fadeMs) p.active = false;
}

// The running playback of a timeline, or nullptr with "Timeline 3 is not running" in msg.
Playback* runningTimeline(int idx, String& msg) {
  Playback* p = findPlayback(false, idx);
  if (!p) msg = "Timeline " + String(timelines[idx].id) + " is not running";
  return p;
}

// True when a universe is due on a network protocol: its frame period has
// passed and either it changed, sending is continuous, or the 1 s keep-alive is due.
bool due(Pace& p, int u, uint32_t now, uint8_t fps, bool changesOnly) {
  uint32_t period = 1000 / fps;
  uint32_t since = now - p.at[u];
  if (since + 2 < period) return false;  // 2 ms slack so engine ticks don't alias the rate
  if (changesOnly && since < 1000 && memcmp(out[u], p.sent[u], 512) == 0) return false;
  memcpy(p.sent[u], out[u], 512);
  p.at[u] = now;
  return true;
}
}  // namespace

void ShowImpl::stopAllPlaybacks() {
  for (auto& p : pbs) p.active = false;
}

namespace Show {

void tick(uint32_t now) {
  for (auto& p : pbs) {
    if (!p.active) continue;
    if (!p.isScene) updateTimeline(p, now);
    if (!p.paused)
      for (int t = 0; t < KD_MAX_TRACKS; t++) if (p.tf[t].fx >= 0) runEffect(p, t, now);
    updateFade(p, now);
    updateRelease(p, now);
    updateMaster(p, now);
  }

  // Compose: lowest priority first, then by start order (latest takes precedence).
  Playback* order[KD_MAX_PLAYBACKS];
  int n = 0;
  for (auto& p : pbs) if (p.active) order[n++] = &p;
  std::sort(order, order + n, [](Playback* a, Playback* b) {
    return a->priority != b->priority ? a->priority < b->priority : a->order < b->order;
  });

  memset(out, 0, sizeof(out));
  for (int k = 0; k < n; k++) {
    Playback& p = *order[k];
    for (int u = 0; u < U; u++)
      for (int i = 0; i < 512; i++) {
        if (!testBit(p.mask[u], i)) continue;
        const float m = p.master * p.tf[p.chTrack[u][i]].op;   // a track fading out after its cue ended
        if (testBit(wide[u], i) && i < 511) {
          int under = (out[u][i] << 8) | out[u][i + 1], v = (p.cur[u][i] << 8) | p.cur[u][i + 1];
          int r = under + lroundf((v - under) * m);
          out[u][i] = r >> 8;
          out[u][i + 1] = r & 0xff;
          i++;
        } else {
          out[u][i] = out[u][i] + lroundf((p.cur[u][i] - out[u][i]) * m);
        }
      }
  }
  for (int u = 0; u < U; u++)
    for (int i = 0; i < 512; i++) {
      if (testBit(ovrMask[u], i)) out[u][i] = ovr[u][i];
      if (testBit(gmExempt[u], i)) continue;
      out[u][i] = blackout ? 0 : applyCurve(curveOf[u][i], (uint8_t)(out[u][i] * gm));
    }
}

void sendOutputs(uint32_t now) {
  // DMX first and all ports together: commit() starts the frame on every port at once.
  for (size_t u = 0; u < universes.size(); u++) {
    const UniverseCfg& c = universes[u];
    if (cfg.outDmx && c.useDmx && c.dmxPort > 0) Dmx::setFrame(c.dmxPort, out[u]);
  }
  Dmx::commit();
  for (size_t u = 0; u < universes.size(); u++) {
    const UniverseCfg& c = universes[u];
    if (cfg.outArtnet && c.useArtnet && c.artnet >= 0 && due(artPace, u, now, cfg.artnetFps, cfg.artnetChangesOnly))
      Net::sendArtDmx(c.artnet, out[u], c.artnetDest);
    if (cfg.outSacn && c.useSacn && c.sacn > 0 && due(sacnPace, u, now, cfg.sacnFps, cfg.sacnChangesOnly))
      Net::sendSacn(c.sacn, out[u], cfg.sacnPriority);
  }
}

uint32_t engineHz() {
  uint32_t hz = 40;
  if (cfg.outArtnet) hz = max(hz, (uint32_t)cfg.artnetFps);
  if (cfg.outSacn) hz = max(hz, (uint32_t)cfg.sacnFps);
  return min(hz, (uint32_t)60);
}

bool setFps(Output o, int fps, String& msg) {
  int maxFps = o == Output::Dmx ? 44 : 60;
  if (fps < 1 || fps > maxFps) { msg = String(kOutputNames[(int)o]) + " fps must be 1-" + maxFps; return false; }
  if (o == Output::Dmx) { cfg.dmxFps = fps; Dmx::setFps(fps); }
  else if (o == Output::ArtNet) cfg.artnetFps = fps;
  else cfg.sacnFps = fps;
  msg = String(kOutputNames[(int)o]) + " " + fps + " fps";
  LOGI(Show, "%s", msg.c_str());
  return true;
}

const uint8_t* output(int u) { return out[u]; }
int universeCount() { return universes.size(); }
int universeIndex(int id) { return indexOfUniverse(universes, id); }

int findTimeline(const String& ref) {
  return findRef(ref, timelines.size(), [](int i) { return timelines[i].id; }, [](int i) -> const String& { return timelines[i].name; });
}
int findScene(const String& ref) {
  return findRef(ref, scenes.size(), [](int i) { return scenes[i].id; }, [](int i) -> const String& { return scenes[i].name; });
}
const Timeline& timeline(int idx) { return timelines[idx]; }
const Scene& scene(int idx) { return scenes[idx]; }
int timelineCount() { return timelines.size(); }
bool timelineRunning(int idx) {
  Playback* p = findPlayback(false, idx);
  return p && !p->releasing;
}

bool startTimeline(int idx, String& msg, uint32_t atMs) {
  const Timeline& t = timelines[idx];
  // Exclusive group: release the others, crossfading over the first cue's fade.
  if (t.group.length()) {
    uint32_t fade = t.cues.empty() ? 0 : t.cues[0].fade;
    for (auto& p : pbs)
      if (p.active && !p.isScene && p.ref != idx && !p.releasing && timelines[p.ref].group == t.group) {
        releasePlayback(p, fade);
        LOGI(Show, "Timeline %d '%s' released by group %s", timelines[p.ref].id, timelines[p.ref].name.c_str(), t.group.c_str());
      }
  }
  Playback* p = takePlayback(false, idx, msg);
  if (!p) return false;
  bool restart = p->active;
  // Keep cur values on restart so the first cue fades from the current look.
  resetPlayback(*p, false, idx, t.priority, millis());
  if (t.length && atMs >= t.length) atMs = t.length - 1;
  p->start -= atMs;
  p->catchUp = atMs;
  msg = String(restart ? "Restarted" : "Started") + " timeline " + t.id + " '" + t.name + "'" + (atMs ? " at " + String(atMs / 1000.0f, 1) + "s" : "");
  LOGI(Show, "%s", msg.c_str());
  return true;
}

bool stopTimeline(int idx, uint32_t fadeMs, String& msg) {
  Playback* p = runningTimeline(idx, msg);
  if (!p) return false;
  const Timeline& t = timelines[idx];
  releasePlayback(*p, fadeMs);
  msg = "Released timeline " + String(t.id) + " '" + t.name + "' (fade " + String(fadeMs / 1000.0f, 1) + "s)";
  LOGI(Show, "%s", msg.c_str());
  return true;
}

bool pauseTimeline(int idx, bool pause, String& msg) {
  Playback* p = runningTimeline(idx, msg);
  if (!p) return false;
  const Timeline& t = timelines[idx];
  uint32_t now = millis();
  if (pause && !p->paused) { p->paused = true; p->pausedAt = now; }
  else if (!pause && p->paused) {
    p->paused = false;
    p->start += now - p->pausedAt;
    for (auto& f : p->tf) f.fxStart += now - p->pausedAt;   // effects carry on where they were
  }
  msg = String(pause ? "Paused" : "Resumed") + " timeline " + t.id + " '" + t.name + "'";
  LOGI(Show, "%s", msg.c_str());
  return true;
}

bool setMaster(int idx, float level, uint32_t fadeMs, String& msg) {
  Playback* p = runningTimeline(idx, msg);
  if (!p) return false;
  fadeMasterTo(*p, constrain(level, 0.0f, 1.0f), fadeMs, millis());
  msg = "Timeline " + String(timelines[idx].id) + " master -> " + String((int)(level * 100)) + "%";
  LOGI(Show, "%s", msg.c_str());
  return true;
}

bool playScene(int idx, uint32_t fadeMs, String& msg, Path path) {
  Playback* p = takePlayback(true, idx, msg);
  if (!p) return false;
  uint32_t now = millis();
  resetPlayback(*p, true, idx, 0, now);
  fireScene(*p, scenes[idx], fadeMs, path, now);
  msg = "Scene " + String(scenes[idx].id) + " '" + scenes[idx].name + "' (fade " + String(fadeMs / 1000.0f, 1) + "s)";
  LOGI(Show, "%s", msg.c_str());
  return true;
}

bool releaseScene(int idx, uint32_t fadeMs, String& msg) {
  Playback* p = findPlayback(true, idx);
  if (!p) { msg = "Scene " + String(scenes[idx].id) + " is not active"; return false; }
  releasePlayback(*p, fadeMs);
  msg = "Released scene " + String(scenes[idx].id);
  LOGI(Show, "%s", msg.c_str());
  return true;
}

void releaseAll(uint32_t fadeMs) {
  for (auto& p : pbs) if (p.active) releasePlayback(p, fadeMs);
  LOGI(Show, "Release all (fade %.1fs)", fadeMs / 1000.0f);
}

void setOverride(int u, int ch, int value) {
  if (u < 0 || u >= U || ch < 0 || ch > 511) return;
  if (value < 0) clearBit(ovrMask[u], ch);
  else { setBit(ovrMask[u], ch); ovr[u][ch] = value; }
}

void clearOverrides() { memset(ovrMask, 0, sizeof(ovrMask)); }
bool isOverride(int u, int ch) { return u >= 0 && u < U && ch >= 0 && ch < 512 && testBit(ovrMask[u], ch); }
void setOutput(Output o, bool on) {
  if (o == Output::Dmx) { cfg.outDmx = on; Dmx::setEnabled(on); }
  else if (o == Output::ArtNet) cfg.outArtnet = on;
  else cfg.outSacn = on;
  LOGW(Show, "%s output %s", kOutputNames[(int)o], on ? "enabled" : "DISABLED");
}

void setGrandMaster(float level) { gm = constrain(level, 0.0f, 1.0f); LOGI(Show, "Grand master %d%%", (int)(gm * 100)); }
void setBlackout(bool on) { blackout = on; LOGW(Show, "Blackout %s", on ? "ON" : "off"); }

bool takeEndedTimeline(int& id) {
  if (endedQueue.empty()) return false;
  id = endedQueue.front();
  endedQueue.erase(endedQueue.begin());
  return true;
}

bool takeTimelineCue(int& id, String& trigger) {
  if (cueQueue.empty()) return false;
  id = cueQueue.front().timeline;
  trigger = cueQueue.front().trigger;
  cueQueue.erase(cueQueue.begin());
  return true;
}

void statusJson(JsonObject o) {
  o["project"] = cfg.name;
  o["projectVersion"] = projectVersion;
  o["gm"] = (int)(gm * 100 + 0.5f);
  o["blackout"] = blackout;
  JsonObject outs = o["outputs"].to<JsonObject>();
  outs["dmx"] = cfg.outDmx;
  outs["artnet"] = cfg.outArtnet;
  outs["sacn"] = cfg.outSacn;
  outs["dmxFps"] = cfg.dmxFps;
  outs["artnetFps"] = cfg.artnetFps;
  outs["sacnFps"] = cfg.sacnFps;
  outs["artnetChangesOnly"] = cfg.artnetChangesOnly;
  outs["sacnChangesOnly"] = cfg.sacnChangesOnly;
  JsonArray arr = o["playbacks"].to<JsonArray>();
  uint32_t now = millis();
  for (auto& p : pbs) {
    if (!p.active) continue;
    JsonObject j = arr.add<JsonObject>();
    if (p.isScene) {
      j["kind"] = "scene";
      j["id"] = scenes[p.ref].id;
      j["name"] = scenes[p.ref].name;
    } else {
      const Timeline& t = timelines[p.ref];
      j["kind"] = "timeline";
      j["id"] = t.id;
      j["name"] = t.name;
      j["pos"] = max((int32_t)((p.paused ? p.pausedAt : now) - p.start), (int32_t)0);
      j["length"] = t.length;
      j["paused"] = p.paused;
      j["ended"] = p.ended;
      if (t.group.length()) j["group"] = t.group;
    }
    j["master"] = (int)(p.master * 100 + 0.5f);
    j["releasing"] = p.releasing;
  }
}

}  // namespace Show
