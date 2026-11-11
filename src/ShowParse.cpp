// Reading project.json into the engine tables (see ShowInternal.h).
#include <algorithm>
#include "BigRam.h"
#include "Dmx.h"
#include "Log.h"
#include "Project.h"
#include "ShowInternal.h"
#include "Storage.h"

using namespace ShowImpl;

namespace {

// Channels the grand master, blackout and dimmer curve leave alone. The fixture library
// (data/www/fixture-lib.js, oflName) names control channels so they start with one of these.
bool isExemptChannel(const Slot& n) {
  static const char* const kPrefixes[] = {"pan", "tilt", "zoom", "focus", "gobo", "prism", "cw", "color_wheel", "macro", "ctrl", "speed", "pos", "enable",
                                          "shutter", "strobe", "fx", "sound", "iris", "frost", "blade", "mode", "cto", "cct", "none"};
  for (auto p : kPrefixes) if (n.startsWith(p)) return true;
  return false;
}

uint8_t parseCurve(const char* s) {
  if (!strcmp(s, "square")) return CurveSquare;
  if (!strcmp(s, "nondim")) return CurveNonDim;
  if (!strcmp(s, "preheat5")) return CurvePreheat5;
  if (!strcmp(s, "preheat10")) return CurvePreheat10;
  return CurveLinear;
}

Path parsePath(const char* s) {
  if (!strcmp(s, "accelerated")) return Path::Accelerated;
  if (!strcmp(s, "braked")) return Path::Braked;
  if (!strcmp(s, "damped")) return Path::Damped;
  if (!strcmp(s, "overshoot")) return Path::Overshoot;
  return Path::Linear;
}

// A fixture's dimmer and colour channels, recognised by name (the same names as
// channelRoles() in data/www/model.js). nullptr = the fixture doesn't have it.
struct ColorSlots { const Slot *dim = nullptr, *r = nullptr, *g = nullptr, *b = nullptr, *w = nullptr; };
ColorSlots colorSlots(const Fixture& f) {
  ColorSlots c;
  auto first = [](const Slot*& to, const Slot& s) { if (!to) to = &s; };
  for (const auto& s : f.slots) {
    if (s.is("dim") || s.is("intensity") || s.is("i") || s.is("master")) first(c.dim, s);
    else if (s.is("r") || s.is("red")) first(c.r, s);
    else if (s.is("g") || s.is("green")) first(c.g, s);
    else if (s.is("b") || s.is("blue")) first(c.b, s);
    else if (s.is("w") || s.is("white")) first(c.w, s);
  }
  return c;
}

inline int channelOf(const Fixture& f, const Slot& s) { return f.address - 1 + s.offset; }

// Track preset (Pharos-style "intensity + colour") turned into levels for one fixture.
// dim: 0-100 or -1 (leave intensity alone); colour: RGB, or hasColor false.
// Fixtures without a dimmer channel get their RGB scaled by dim; RGBW takes white = min(r,g,b).
void presetLevels(const Fixture& f, int dim, bool hasColor, uint8_t r, uint8_t g, uint8_t b, BigRam::Vec<Level>& out) {
  const ColorSlots c = colorSlots(f);
  auto put = [&](const Slot* s, int v255) {
    Level l;
    l.u = f.u;
    l.ch = channelOf(f, *s);
    l.wide = s->wide;
    l.v = s->wide ? (uint16_t)(v255 * 257) : (uint16_t)v255;
    out.push_back(l);
  };
  if (c.dim && dim >= 0) put(c.dim, (dim * 255 + 50) / 100);
  bool rgb = c.r && c.g && c.b;
  if (!rgb || (!hasColor && (c.dim || dim < 0))) return;
  int rr = hasColor ? r : 255, gg = hasColor ? g : 255, bb = hasColor ? b : 255;
  if (!c.dim && dim >= 0) { rr = rr * dim / 100; gg = gg * dim / 100; bb = bb * dim / 100; }
  if (c.w) {
    int w = min(rr, min(gg, bb));
    rr -= w; gg -= w; bb -= w;
    put(c.w, w);
  }
  put(c.r, rr);
  put(c.g, gg);
  put(c.b, bb);
}

// Effect target for one fixture of a track: k of n, at its map position (pos: x, y or nullptr).
FxTarget effectTarget(const Fixture& f, size_t k, size_t n, const float* pos) {
  FxTarget x{(uint8_t)f.u, -1, -1, -1, -1, -1, false, (float)k / n, 0.5f};
  if (pos) { x.x = pos[0]; x.y = pos[1]; }
  const ColorSlots c = colorSlots(f);
  if (c.dim) { x.d = channelOf(f, *c.dim); x.dWide = c.dim->wide; }
  if (c.r) x.r = channelOf(f, *c.r);
  if (c.g) x.g = channelOf(f, *c.g);
  if (c.b) x.b = channelOf(f, *c.b);
  if (c.w) x.w = channelOf(f, *c.w);
  return x;
}

int universeRef(const BigRam::Vec<UniverseCfg>& list, JsonVariantConst v) { return indexOfUniverse(list, v | 0); }

// What a timeline's cues are made from. Kept after a load (byId, mapPos, fxIds) so the web UI's
// live editing can send one timeline at a time (Show::liveTimeline) without a reload.
using Groups = std::vector<std::pair<int, std::vector<int>>>;
struct TlCtx {
  const BigRam::Vec<Fixture>& nf;
  const BigRam::Vec<Scene>& ns;
  const Groups& grp;
  const BigRam::Vec<int>& fxIds;
  const BigRam::Vec<Fx::Program>& nfp;
  const BigRam::Vec<float>& mapPos;   // x, y, map aspect per fixture index (NAN = not on a map)
  const BigRam::Vec<int>& byId;       // fixture id -> index (-1 = none)
  const BigRam::Vec<uint8_t>& fxRound;   // per effect (as fxIds): "round on wide maps"
  int fixIdx(int id) const { return id >= 0 && id < (int)byId.size() ? byId[id] : -1; }
  // A fixture's effect x / y into out (nullptr = not on a map). Round: the long side of the
  // map stays 0..1, the short side shrinks around 0.5, so circles stay round on a wide map
  // (= effectXY in model.js).
  const float* posOf(int fi, bool round, float* out) const {
    const float* p = &mapPos[fi * 3];
    if (isnan(p[0])) return nullptr;
    float x = p[0], y = p[1], a = p[2];
    if (round && a > 1) y = 0.5f + (y - 0.5f) / a;
    else if (round && a > 0 && a < 1) x = 0.5f + (x - 0.5f) * a;
    out[0] = x;
    out[1] = y;
    return out;
  }
};
BigRam::Vec<int> keptById, keptFxIds;
BigRam::Vec<float> keptPos;
BigRam::Vec<uint8_t> keptFxRound;

Groups readGroups(JsonArrayConst list) {
  Groups grp;
  for (JsonObjectConst g : list) {
    std::vector<int> ids;
    for (int id : g["fixtures"].as<JsonArrayConst>()) ids.push_back(id);
    grp.push_back({g["id"] | 0, ids});
  }
  return grp;
}

// One timeline: its tracks' fixtures and its cues. Effect cues go to nfc and track presets /
// track-limited scenes to ncs (the cues hold their index there).
bool parseTimeline(JsonObjectConst o, const TlCtx& x, Timeline& t, BigRam::Vec<FxCue>& nfc, BigRam::Vec<Scene>& ncs, String& err) {
  const auto& nf = x.nf;
  t.id = o["id"] | 0;
  t.name = o["name"] | "";
  t.length = o["length"] | 0;
  t.loop = o["loop"] | false;
  t.priority = o["priority"] | 0;
  t.group = o["group"] | "";
  // Tracks: each lists fixtures and/or groups; empty = the whole rig (scenes as they are).
  std::vector<std::vector<int>> tracks;   // fixture indexes per track
  for (JsonObjectConst tr : o["tracks"].as<JsonArrayConst>()) {
    std::vector<int> fx;
    std::vector<bool> in(nf.size());
    auto add = [&](int id) {
      int i = x.fixIdx(id);
      if (i >= 0 && !in[i]) { in[i] = true; fx.push_back(i); }
    };
    for (int id : tr["fixtures"].as<JsonArrayConst>()) add(id);
    for (int gid : tr["groups"].as<JsonArrayConst>())
      for (auto& g : x.grp) if (g.first == gid) for (int id : g.second) add(id);
    tracks.push_back(fx);
  }
  if ((int)tracks.size() > KD_MAX_TRACKS) { err = "Timeline " + String(t.id) + ": too many tracks (max " + String(KD_MAX_TRACKS) + ")"; return false; }
  for (JsonObjectConst c : o["cues"].as<JsonArrayConst>()) {
    // A light cue with a length ("len", ms) ends there, after its fade-out ("out", ms):
    // its release cue lets the track go, so the gap after it is empty.
    auto pushCue = [&](const Cue& cue) {
      t.cues.push_back(cue);
      uint32_t len = c["len"] | 0;
      if (!len) return;
      Cue r = cue;
      r.scene = r.own = r.fx = -1;
      r.release = true;
      r.from = cue.t;
      r.fade = std::min<uint32_t>(c["out"] | 0, len);
      r.t = cue.t + len - r.fade;
      t.cues.push_back(r);
    };
    Cue cue;
    cue.t = c["t"] | 0;
    cue.fade = c["fade"] | 0;
    cue.path = parsePath(c["path"] | "linear");
    cue.scene = cue.own = cue.fx = -1;
    int tr = c["track"] | 0;
    cue.track = tr >= 0 && tr < KD_MAX_TRACKS ? tr : 0;
    if (!c["trigger"].isNull()) {   // trigger cue: "trigger": "Video start" (or a number)
      cue.trigger = c["trigger"].as<String>();
      cue.trigger.trim();
      if (!cue.trigger.length()) { err = "Timeline " + String(t.id) + ": trigger cue without a trigger"; return false; }
      t.cues.push_back(cue);
      continue;
    }
    static const std::vector<int> kAll;
    const std::vector<int>& fx = cue.track < tracks.size() ? tracks[cue.track] : kAll;
    if (!c["effect"].isNull()) {
      // Effect on the track's fixtures: "effect": id, "params": {"speed": 0.5, "color": "#ff0000"}, "dim": level %.
      int eid = c["effect"] | 0;
      auto pi = std::find(x.fxIds.begin(), x.fxIds.end(), eid);
      if (pi == x.fxIds.end()) { err = "Timeline " + String(t.id) + ": unknown effect " + String(eid); return false; }
      if (fx.empty()) { err = "Timeline " + String(t.id) + ": effect cue on a track without fixtures"; return false; }
      FxCue fc;
      fc.prog = pi - x.fxIds.begin();
      const Fx::Program& prog = x.nfp[fc.prog];
      fc.slots.resize(prog.slots);
      Fx::init(prog, fc.slots.data());
      JsonObjectConst pv = c["params"];
      for (const auto& q : prog.params) {
        JsonVariantConst v = pv[q.name];
        if (v.isNull()) continue;
        String s = v.as<String>();
        Fx::setParam(q, s.c_str(), fc.slots.data());
      }
      fc.level = (c["dim"].isNull() ? 100 : clampInt(c["dim"] | 100, 0, 100)) / 100.0;
      const bool round = x.fxRound[fc.prog];
      float pos[2];
      for (size_t k = 0; k < fx.size(); k++) fc.targets.push_back(effectTarget(nf[fx[k]], k, fx.size(), x.posOf(fx[k], round, pos)));
      cue.fx = nfc.size();
      nfc.push_back(fc);
      pushCue(cue);
      continue;
    }
    if (!c["dim"].isNull() || !c["color"].isNull()) {
      // Preset on a track: intensity and/or colour for the track's fixtures.
      if (fx.empty()) { err = "Timeline " + String(t.id) + ": preset cue on a track without fixtures"; return false; }
      int dim = c["dim"].isNull() ? -1 : clampInt(c["dim"] | 0, 0, 100);
      const char* col = c["color"] | "";
      bool hasColor = col[0] == '#' && strlen(col) == 7;
      uint32_t rgb = hasColor ? strtoul(col + 1, nullptr, 16) : 0;
      Scene sc{0, "", {}};
      for (int fi : fx) presetLevels(nf[fi], dim, hasColor, rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, sc.levels);
      cue.own = ncs.size();
      ncs.push_back(sc);
      pushCue(cue);
      continue;
    }
    int sid = c["scene"] | 0;
    auto it = std::find_if(x.ns.begin(), x.ns.end(), [&](const Scene& sc) { return sc.id == sid; });
    if (it == x.ns.end()) { err = "Timeline " + String(t.id) + ": unknown scene " + String(sid); return false; }
    cue.scene = it - x.ns.begin();
    if (!fx.empty()) {
      // A scene on a track only plays the channels of the track's fixtures.
      Scene sc{0, "", {}};
      static uint8_t mine[U][64];   // channels of the track's fixtures (parse runs under g_engine: one at a time)
      memset(mine, 0, sizeof(mine));
      for (int fi : fx) {
        const Fixture& f = nf[fi];
        for (int k = 0; k < f.footprint; k++) setBit(mine[f.u], f.address - 1 + k);
      }
      for (const auto& l : it->levels)
        if (testBit(mine[l.u], l.ch)) sc.levels.push_back(l);
      cue.own = ncs.size();
      ncs.push_back(sc);
    }
    pushCue(cue);
  }
  std::stable_sort(t.cues.begin(), t.cues.end(), [](const Cue& a, const Cue& b) { return a.t < b.t; });
  return true;
}
}  // namespace

namespace Show {

const Settings& settings() { return cfg; }
JsonDocument& projectDoc() { return doc; }

bool parse(const char* json, size_t len, String& err) {
  JsonDocument d(BigRam::json());   // in SDRAM: a big show doesn't fit the heap next to the old one
  Log::crumb(Log::kCrumbLoad, "parse: JSON");
  DeserializationError de = deserializeJson(d, json, len);
  if (de) { err = String("JSON error: ") + de.c_str(); return false; }
  Project::timePart("json");

  Settings s;
  s.name = d["name"] | "Untitled";
  s.tzOffsetMin = d["settings"]["tzOffsetMin"] | 0;
  s.udpPort = d["settings"]["udpPort"] | 4000;
  s.sacnPriority = d["settings"]["sacnPriority"] | 100;
  JsonObjectConst outs = d["settings"]["outputs"];
  s.outDmx = outs["dmx"] | true;
  s.outArtnet = outs["artnet"] | true;
  s.outSacn = outs["sacn"] | true;
  s.dmxFps = constrain((int)(outs["dmxFps"] | 40), 1, 44);
  s.artnetFps = constrain((int)(outs["artnetFps"] | 40), 1, 60);
  s.sacnFps = constrain((int)(outs["sacnFps"] | 40), 1, 60);
  s.artnetChangesOnly = outs["artnetChangesOnly"] | true;
  s.sacnChangesOnly = outs["sacnChangesOnly"] | true;
  JsonObjectConst n = d["network"];
  s.net.dhcp = n["dhcp"] | true;
  // fromString can leave half a bad address behind: parse into a copy (bad / empty = 0.0.0.0,
  // which Net::begin refuses for the address and mask: DHCP then).
  auto addr = [](const char* t) { IPAddress a; return a.fromString(t) ? a : IPAddress(0, 0, 0, 0); };
  s.net.ip = addr(n["ip"] | "172.16.1.111");
  s.net.mask = addr(n["mask"] | "255.255.255.0");
  s.net.gateway = addr(n["gateway"] | "172.16.1.1");
  s.net.dns = addr(n["dns"] | "");
  s.net.dns2 = addr(n["dns2"] | "");

  // Everything is parsed into new tables and only swapped in when valid.
  BigRam::Vec<UniverseCfg> nu;
  for (JsonObjectConst o : d["universes"].as<JsonArrayConst>()) {
    if ((int)nu.size() >= U) { err = "Too many universes (max " + String(U) + ")"; return false; }
    UniverseCfg c;
    c.id = o["id"] | ((int)nu.size() + 1);
    c.name = o["name"] | "";
    c.dmxPort = o["dmxPort"] | 0;
    c.artnet = o["artnet"] | -1;
    c.sacn = o["sacn"] | 0;
    if (!c.artnetDest.fromString(o["artnetDest"] | "255.255.255.255")) c.artnetDest = IPAddress(255, 255, 255, 255);
    // Older projects have no use* flags: derive them from the port fields.
    c.useDmx = o["useDmx"] | (c.dmxPort > 0);
    c.useArtnet = o["useArtnet"] | (c.artnet >= 0);
    c.useSacn = o["useSacn"] | (c.sacn > 0);
    nu.push_back(c);
  }

  BigRam::Vec<Fixture> nf;
  Log::crumb(Log::kCrumbLoad, "parse: fixtures");
  for (JsonObjectConst o : d["fixtures"].as<JsonArrayConst>()) {
    Fixture f;
    f.id = o["id"] | 0;
    f.u = universeRef(nu, o["universe"]);
    f.address = o["address"] | 1;
    f.curve = parseCurve(o["curve"] | "linear");
    f.footprint = 0;
    for (JsonVariantConst c : o["channels"].as<JsonArrayConst>()) {
      const char* name = c | "";
      size_t len = strlen(name);
      bool w = len >= 3 && !strcmp(name + len - 3, ":16");
      if (w) len -= 3;
      f.slots.push_back({name, (uint8_t)std::min(len, (size_t)255), f.footprint, w});
      f.footprint += w ? 2 : 1;
    }
    if (f.u < 0) { err = "Fixture " + String(f.id) + ": unknown universe"; return false; }
    if (f.address < 1 || f.address + f.footprint - 1 > 512) { err = "Fixture " + String(f.id) + ": address out of range"; return false; }
    nf.push_back(f);
  }
  Project::timePart("fixtures");
  // Fixture id -> index: scenes, tracks and maps look fixtures up by id thousands of times
  // (a search through the list each time was ~10 million compares for a 1360-pixel show).
  int maxId = 0;
  for (const auto& f : nf) maxId = std::max(maxId, f.id);
  BigRam::Vec<int> byId(std::min(maxId, 1 << 20) + 1, -1);
  for (size_t i = 0; i < nf.size(); i++)
    if (nf[i].id >= 0 && nf[i].id < (int)byId.size() && byId[nf[i].id] < 0) byId[nf[i].id] = i;
  auto fixIdx = [&](int id) { return id >= 0 && id < (int)byId.size() ? byId[id] : -1; };

  BigRam::Vec<Scene> ns;
  for (JsonObjectConst o : d["scenes"].as<JsonArrayConst>()) {
    Scene sc;
    sc.id = o["id"] | 0;
    sc.name = o["name"] | "";
    for (JsonObjectConst l : o["levels"].as<JsonArrayConst>()) {
      Level lv;
      int v = l["v"] | 0;
      if (l["fixture"].is<int>()) {
        int fid = l["fixture"];
        int fi = fixIdx(fid);
        if (fi < 0) { err = "Scene " + String(sc.id) + ": unknown fixture " + String(fid); return false; }
        const Fixture* it = &nf[fi];
        const Slot* slot = nullptr;
        if (l["ch"].is<int>()) { int i = (int)l["ch"] - 1; if (i >= 0 && i < (int)it->slots.size()) slot = &it->slots[i]; }
        else for (const auto& sl : it->slots) if (sl.is(l["ch"] | "")) slot = &sl;
        if (!slot) { err = "Scene " + String(sc.id) + ": bad channel on fixture " + String(fid); return false; }
        lv.u = it->u;
        lv.ch = channelOf(*it, *slot);
        lv.wide = slot->wide;
      } else {
        int u = universeRef(nu, l["u"]);
        int ch = l["ch"] | 0;
        lv.wide = l["wide"] | false;
        if (u < 0 || ch < 1 || ch > (lv.wide ? 511 : 512)) { err = "Scene " + String(sc.id) + ": bad universe/channel"; return false; }
        lv.u = u;
        lv.ch = ch - 1;
      }
      lv.v = lv.wide ? clampInt(v, 0, 65535) : clampInt(v, 0, 255);
      sc.levels.push_back(lv);
    }
    ns.push_back(sc);
  }

  Project::timePart("scenes");
  // Fixture groups (by id), so a track can follow a group.
  Groups grp = readGroups(d["groups"].as<JsonArrayConst>());
  // Effects: compile them all; a script error rejects the project with its line number.
  Log::crumb(Log::kCrumbLoad, "parse: effects");
  BigRam::Vec<Fx::Program> nfp;
  BigRam::Vec<int> fxIds;
  BigRam::Vec<uint8_t> fxRound;
  // "Round on wide maps" is per effect (`round`); older projects had it per map (`square`): an
  // effect without the setting is round when any map had it (= effectRound in model.js).
  bool anySquare = false;
  for (JsonObjectConst m : d["maps"].as<JsonArrayConst>()) anySquare |= (m["square"] | false);
  size_t maxSlots = 16;
  for (JsonObjectConst o : d["effects"].as<JsonArrayConst>()) {
    Fx::Program prog;
    String e;
    if (!Fx::compile(o["code"] | "", prog, e)) { err = String("Effect '") + (o["name"] | "?") + "': " + e; return false; }
    maxSlots = std::max(maxSlots, (size_t)prog.slots);
    nfp.push_back(prog);
    fxIds.push_back(o["id"] | 0);
    fxRound.push_back(o["round"].isNull() ? anySquare : (o["round"] | false));
  }
  // Map position per fixture index (first map it is on) and that map's shape - the x / y inputs
  // of effects (TlCtx::posOf). NAN = none.
  BigRam::Vec<float> mapPos(nf.size() * 3, NAN);
  for (JsonObjectConst m : d["maps"].as<JsonArrayConst>()) {
    float a = m["aspect"] | 1.6f;   // the web UI's default shape
    for (JsonObjectConst it : m["items"].as<JsonArrayConst>()) {
      int fi = fixIdx(it["fixture"] | 0);
      if (fi < 0 || !isnan(mapPos[fi * 3])) continue;
      mapPos[fi * 3] = it["x"] | 0.5f;
      mapPos[fi * 3 + 1] = it["y"] | 0.5f;
      mapPos[fi * 3 + 2] = a;
    }
  }
  BigRam::Vec<FxCue> nfc;
  Project::timePart("effects");

  BigRam::Vec<Timeline> nt;
  BigRam::Vec<Scene> ncs;
  Log::crumb(Log::kCrumbLoad, "parse: timelines");
  const TlCtx ctx{nf, ns, grp, fxIds, nfp, mapPos, byId, fxRound};
  for (JsonObjectConst o : d["timelines"].as<JsonArrayConst>()) {
    Timeline t;
    if (!parseTimeline(o, ctx, t, nfc, ncs, err)) return false;
    nt.push_back(t);
  }

  Project::timePart("timelines");
  Log::crumb(Log::kCrumbLoad, "parse: commit");
  // Commit.
  stopAllPlaybacks();
  clearOverrides();
  locUntil = 0;   // the fixtures it pointed at may have moved
  memset(locMask, 0, sizeof(locMask));
  memset(gmExempt, 0, sizeof(gmExempt));
  memset(wide, 0, sizeof(wide));
  memset(curveOf, 0, sizeof(curveOf));
  for (const auto& f : nf)
    for (const auto& sl : f.slots) {
      int ch = channelOf(f, sl);
      if (sl.wide) {
        setBit(wide[f.u], ch);
        setBit(gmExempt[f.u], ch);
        setBit(gmExempt[f.u], ch + 1);
      } else if (isExemptChannel(sl)) {
        setBit(gmExempt[f.u], ch);
      } else {
        curveOf[f.u][ch] = f.curve;
      }
    }
  for (const auto* list : {&ns, &ncs})
    for (const auto& sc : *list)
      for (const auto& l : sc.levels)
        if (l.wide) { setBit(wide[l.u], l.ch); setBit(gmExempt[l.u], l.ch); setBit(gmExempt[l.u], l.ch + 1); }
  universes = std::move(nu);
  fixtures = std::move(nf);
  scenes = std::move(ns);
  timelines = std::move(nt);
  cueScenes = std::move(ncs);
  fxProgs = std::move(nfp);
  fxCues = std::move(nfc);
  fxScratch.assign(maxSlots, 0);
  keptById = std::move(byId);
  keptPos = std::move(mapPos);
  keptFxIds = std::move(fxIds);
  keptFxRound = std::move(fxRound);
  cfg = s;
  // Trigger notes are documentation only: they stay in project.json on the stick, not in RAM.
  for (JsonObject o : d["triggers"].as<JsonArray>()) { o.remove("notes"); o.remove("level"); }   // + separator level (main/sub heading)
  // Fixture type, mode and icon are for the web UI; the engine only needs the channels.
  for (JsonObject o : d["fixtures"].as<JsonArray>()) { o.remove("type"); o.remove("mode"); o.remove("icon"); }
  d.remove("fixtureTypes");   // the project's own fixture definitions (web UI only)
  d.remove("triggerColorNames");   // tab names of the trigger colours (web UI only)
  d.remove("colorThemes");   // colour themes for the editor's colour wheels (web UI only)
  d.remove("maps");      // fixture maps are only used by the web UI (positions are copied above)
  d.remove("effects");   // compiled into fxProgs
  // Device drivers: channel names and command buttons are for the web UI only.
  for (JsonObject o : d["drivers"].as<JsonArray>()) { o.remove("names"); o.remove("commands"); }
  Project::timePart("commit");
  Log::crumb(Log::kCrumbLoad, "parse: keep JSON");
  doc = std::move(d);   // frees the previous project's JSON
  Log::crumb(Log::kCrumbLoad, "parse: done");
  Project::timePart("old json");
  Dmx::setEnabled(cfg.outDmx);
  Dmx::setFps(cfg.dmxFps);
  projectVersion++;
  LOGI(Show, "Project '%s' loaded: %d universes, %d fixtures, %d scenes, %d timelines", cfg.name.c_str(),
       (int)universes.size(), (int)fixtures.size(), (int)scenes.size(), (int)timelines.size());
  return true;
}

bool loadFile(const char* path, String& err) {
  BigRam::Buffer json;
  if (!Storage::readFile(path, json)) { err = String("Cannot read ") + path; return false; }
  return parse(json.data, json.len, err);
}

// Live editing in the web UI: one timeline (its project.json object) replaces the loaded one
// with the same id, or is added, without a reload and without touching the stick. It is
// built from the loaded fixtures, scenes and effects: anything new there needs a save first.
// The timeline's effect cues / cue scenes reuse its old places in fxCues / cueScenes (no other
// timeline points at those), so editing all evening doesn't keep growing them.
bool liveTimeline(const char* json, size_t len, String& err) {
  JsonDocument d(BigRam::json());
  DeserializationError de = deserializeJson(d, json, len);
  if (de) { err = String("JSON error: ") + de.c_str(); return false; }
  JsonObjectConst o = d.as<JsonObjectConst>();
  const Groups grp = readGroups(doc["groups"].as<JsonArrayConst>());   // still in the kept JSON
  const TlCtx ctx{fixtures, scenes, grp, keptFxIds, fxProgs, keptPos, keptById, keptFxRound};
  Timeline t;
  BigRam::Vec<FxCue> nfc;
  BigRam::Vec<Scene> ncs;
  if (!parseTimeline(o, ctx, t, nfc, ncs, err)) return false;
  int idx = -1;
  for (size_t i = 0; i < timelines.size(); i++) if (timelines[i].id == t.id) idx = i;
  // Free the old timeline's places, then hand them out again.
  std::vector<int> freeFx, freeSc;
  if (idx >= 0)
    for (const auto& c : timelines[idx].cues) {
      if (c.fx >= 0) freeFx.push_back(c.fx);
      if (c.own >= 0) freeSc.push_back(c.own);
    }
  auto place = [](auto& list, auto& items, std::vector<int>& freeAt) {
    std::vector<int> at(items.size());
    for (size_t k = 0; k < items.size(); k++) {
      if (k < freeAt.size()) { at[k] = freeAt[k]; list[freeAt[k]] = std::move(items[k]); }
      else { at[k] = list.size(); list.push_back(std::move(items[k])); }
    }
    for (size_t k = items.size(); k < freeAt.size(); k++) list[freeAt[k]] = {};   // unused now: empty
    return at;
  };
  std::vector<int> fxAt = place(fxCues, nfc, freeFx), scAt = place(cueScenes, ncs, freeSc);
  for (auto& c : t.cues) {
    if (c.fx >= 0) c.fx = fxAt[c.fx];
    if (c.own >= 0) c.own = scAt[c.own];
  }
  if (idx < 0) { idx = timelines.size(); timelines.push_back(std::move(t)); }
  else timelines[idx] = std::move(t);
  timelineReplaced(idx);
  LOGI(Show, "Timeline %d '%s' changed live (not saved)", timelines[idx].id, timelines[idx].name.c_str());
  return true;
}

// Locate: the dimmer and R/G/B/W channels of these fixtures (only the first channel of one
// without them, so pan/tilt never jump) blink white for ms (tick in Show.cpp). Here because
// it needs the patch tables and colorSlots, like the presets. A new locate replaces the last.
bool locate(const String& ids, uint32_t ms, String& msg) {
  if (!strcasecmp(ids.c_str(), "off")) {
    locUntil = 0;
    memset(locMask, 0, sizeof(locMask));
    msg = "Locate off";
    return true;
  }
  static uint8_t mask[U][64];   // static: off the caller's thread stack (callers hold g_engine)
  memset(mask, 0, sizeof(mask));
  int n = 0, missing = 0;
  const char* s = ids.c_str();
  while (*s) {
    char* end;
    long a = strtol(s, &end, 10), b = a;
    if (end == s) { msg = "expected fixture numbers, e.g. locate 3,5,8-12"; return false; }
    if (*end == '-') { const char* q = end + 1; b = strtol(q, &end, 10); if (end == q || b < a) { msg = "bad range in " + ids; return false; } }
    if (*end && *end != ',') { msg = "expected fixture numbers, e.g. locate 3,5,8-12"; return false; }
    if (b - a > 4096) b = a + 4096;
    for (long id = a; id <= b; id++) {
      const int fi = id >= 0 && id < (long)keptById.size() ? keptById[id] : -1;
      if (fi < 0) { missing++; continue; }
      const Fixture& f = fixtures[fi];
      const ColorSlots c = colorSlots(f);
      const Slot* list[] = {c.dim, c.r, c.g, c.b, c.w};
      bool any = false;
      for (const Slot* sl : list) {
        if (!sl) continue;
        any = true;
        const int ch = channelOf(f, *sl);
        if (ch >= 0 && ch < 512) setBit(mask[f.u], ch);
        if (sl->wide && ch + 1 < 512) setBit(mask[f.u], ch + 1);
      }
      if (!any && !f.slots.empty()) { const int ch = channelOf(f, f.slots[0]); if (ch >= 0 && ch < 512) setBit(mask[f.u], ch); }
      n++;
    }
    s = *end ? end + 1 : end;
  }
  if (!n) { msg = "no such fixture: " + ids; return false; }
  if (ms < 500) ms = 500;
  if (ms > 60000) ms = 60000;
  memcpy(locMask, mask, sizeof(locMask));
  locStart = millis();
  locUntil = locStart + ms;
  if (!locUntil) locUntil = 1;   // 0 means off
  msg = "Locating " + String(n) + " fixture" + (n == 1 ? "" : "s") + " for " + String(ms / 1000.0f, 1) + " s" + (missing ? " (" + String(missing) + " not found)" : "");
  LOGI(Show, "%s", msg.c_str());
  return true;
}

}  // namespace Show
