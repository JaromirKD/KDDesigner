#include "Board.h"
#include <mbed.h>
#include <deque>
#include "Config.h"     // KD_BOARD_PMC may be defined there (Arduino IDE) instead of by the build
#include "Globals.h"
#include "Log.h"
#include "Show.h"
#include "State.h"
#ifdef KD_BOARD_PMC
#include <Arduino_PortentaMachineControl.h>
#include <Wire.h>
#endif

using namespace std::chrono_literals;

namespace {

enum Kind : uint8_t { In, Out, Io, Ai, Ao };
enum AiMode : uint8_t { Volt, MilliAmp, Ntc };
const char* const kPrefix[] = {"in", "out", "io", "ai", "ao"};

struct Pt {
  Kind kind;
  uint8_t ch;
  String key, name, var;
  bool output = false;            // out, ao, or io set to "out"
  AiMode aiMode = Volt;
  // Live state, guarded by mtx (the board thread reads and writes it).
  float value = 0, target = 0, from = 0;
  uint32_t fadeAt = 0, fadeMs = 0, pulseUntil = 0;
  bool raw = false;               // digital input: last raw level and since when (debounce)
  uint32_t rawAt = 0;
  bool known = false;
  // Main loop only: what the linked variable was last set to.
  String reported;
  std::deque<String> echo;        // values we set the variable to that will come back as changes
};

std::vector<Pt> pts;
rtos::Mutex mtx;
bool boardOk = false;
const uint32_t kDebounceMs = 30;

String fmt(const Pt& p) {
  if (p.kind == In || p.kind == Out || p.kind == Io) return p.value >= 0.5f ? "1" : "0";
  if (p.kind == Ai && p.aiMode == Ntc) return String((long)p.value);
  return String(p.value, 2);
}
bool isDigital(const Pt& p) { return p.kind != Ai && p.kind != Ao; }
// Smallest analog change that is passed on to a linked variable, so noise doesn't flood the triggers.
float deadband(const Pt& p) {
  if (p.kind == Ai && p.aiMode == Ntc) return max(1.0f, p.value * 0.01f);
  return p.kind == Ai && p.aiMode == MilliAmp ? 0.1f : 0.05f;
}

Pt* byKey(const String& k) {
  for (auto& p : pts) if (p.key.equalsIgnoreCase(k)) return &p;
  return nullptr;
}

void build() {
  pts.clear();
  const uint8_t counts[] = {8, 8, 12, 3, 4};
  for (int k = 0; k < 5; k++)
    for (uint8_t c = 0; c < counts[k]; c++) {
      Pt p;
      p.kind = (Kind)k;
      p.ch = c;
      p.key = String(kPrefix[k]) + c;
      p.output = k == Out || k == Ao;
      p.known = p.output;
      pts.push_back(p);
    }
}

// Starts a change of an output (caller holds mtx).
void setTarget(Pt& p, float v, float fadeSec) {
  p.pulseUntil = 0;
  if (isDigital(p)) v = v >= 0.5f ? 1 : 0;
  else v = constrain(v, 0.0f, 10.0f);
  p.from = p.value;
  p.target = v;
  p.fadeAt = millis();
  p.fadeMs = fadeSec > 0 ? (uint32_t)(fadeSec * 1000) : 0;
  if (!p.fadeMs) p.value = v;
}

#ifdef KD_BOARD_PMC
// Expander pin of each programmable channel's output and input side.
const uint8_t kIoWrite[12] = {IO_WRITE_CH_PIN_00, IO_WRITE_CH_PIN_01, IO_WRITE_CH_PIN_02, IO_WRITE_CH_PIN_03, IO_WRITE_CH_PIN_04, IO_WRITE_CH_PIN_05,
                              IO_WRITE_CH_PIN_06, IO_WRITE_CH_PIN_07, IO_WRITE_CH_PIN_08, IO_WRITE_CH_PIN_09, IO_WRITE_CH_PIN_10, IO_WRITE_CH_PIN_11};
const uint8_t kIoRead[12] = {IO_READ_CH_PIN_00, IO_READ_CH_PIN_01, IO_READ_CH_PIN_02, IO_READ_CH_PIN_03, IO_READ_CH_PIN_04, IO_READ_CH_PIN_05,
                             IO_READ_CH_PIN_06, IO_READ_CH_PIN_07, IO_READ_CH_PIN_08, IO_READ_CH_PIN_09, IO_READ_CH_PIN_10, IO_READ_CH_PIN_11};
const uint8_t kDinRead[8] = {DIN_READ_CH_PIN_00, DIN_READ_CH_PIN_01, DIN_READ_CH_PIN_02, DIN_READ_CH_PIN_03,
                             DIN_READ_CH_PIN_04, DIN_READ_CH_PIN_05, DIN_READ_CH_PIN_06, DIN_READ_CH_PIN_07};
const PinName kAiPin[3] = {MC_AI_AI0_PIN, MC_AI_AI1_PIN, MC_AI_AI2_PIN};
// Each analog input has 4 switches that pick its circuit (see AnalogInClass::begin).
const PinName kAiCfg[3][4] = {{MC_AI_CH0_IN1_PIN, MC_AI_CH0_IN2_PIN, MC_AI_CH0_IN3_PIN, MC_AI_CH0_IN4_PIN},
                              {MC_AI_CH1_IN1_PIN, MC_AI_CH1_IN2_PIN, MC_AI_CH1_IN3_PIN, MC_AI_CH1_IN4_PIN},
                              {MC_AI_CH2_IN1_PIN, MC_AI_CH2_IN2_PIN, MC_AI_CH2_IN3_PIN, MC_AI_CH2_IN4_PIN}};
const uint8_t kAiLevels[3][4] = {{1, 1, 0, 1}, {1, 0, 1, 0}, {0, 0, 1, 1}};   // 0-10V, 4-20mA, NTC
const float kRef = 3.0f;          // ADC reference (V)

rtos::Thread thread(osPriorityBelowNormal, 2048, nullptr, "board");
uint8_t aiModeSet[3] = {255, 255, 255};

void configAi(int ch, AiMode m) {
  if (aiModeSet[ch] == m) return;
  aiModeSet[ch] = m;
  for (int i = 0; i < 4; i++) digitalWrite(kAiCfg[ch][i], kAiLevels[m][i] ? HIGH : LOW);
}

// ADC counts -> volts / mA / ohms, as in the library's examples.
float aiConvert(uint16_t raw, AiMode m) {
  float v = raw * kRef / 65535.0f;
  if (m == Volt) return v / 0.28057f;
  if (m == MilliAmp) return v / 120.0f * 1000.0f;
  return v >= kRef - 0.001f ? 9999999.0f : 100000.0f * v / (kRef - v);   // NTC/PTC against 100 kΩ
}

void run() {
  uint8_t lastOut = 0xff;
  uint32_t lastIo = 0xffffffff;
  float lastAo[4] = {-1, -1, -1, -1};
  uint32_t nextAi = 0;
  for (;;) {
    uint32_t now = millis();
    uint8_t outMask = 0;
    uint32_t ioMask = 0;
    float ao[4] = {0, 0, 0, 0};
    AiMode aiModes[3] = {Volt, Volt, Volt};
    mtx.lock();
    for (auto& p : pts) {
      if (p.output) {
        if (p.pulseUntil && (int32_t)(now - p.pulseUntil) >= 0) { p.pulseUntil = 0; p.value = p.target = 0; p.fadeMs = 0; State::changed(); }
        if (p.fadeMs) {
          float f = min(1.0f, (now - p.fadeAt) / (float)p.fadeMs);
          p.value = p.from + (p.target - p.from) * f;
          if (f >= 1) p.fadeMs = 0;
        }
        if (p.kind == Out && p.value >= 0.5f) outMask |= 1 << p.ch;
        if (p.kind == Io && p.value >= 0.5f) ioMask |= 1UL << kIoWrite[p.ch];
        if (p.kind == Ao) ao[p.ch] = p.value;
      }
      if (p.kind == Ai) aiModes[p.ch] = p.aiMode;
    }
    mtx.unlock();

    for (int c = 0; c < 8; c++)
      if (((outMask ^ lastOut) >> c) & 1) MachineControl_DigitalOutputs.write(c, (outMask >> c) & 1 ? HIGH : LOW);
    lastOut = outMask;
    if (ioMask != lastIo) { MachineControl_DigitalProgrammables.writeAll(ioMask); lastIo = ioMask; }
    for (int c = 0; c < 4; c++)
      if (fabsf(ao[c] - lastAo[c]) > 0.001f) { MachineControl_AnalogOut.write(c, ao[c]); lastAo[c] = ao[c]; }

    uint32_t ioIn = MachineControl_DigitalProgrammables.readAll() & 0xffffff;
    uint32_t din = MachineControl_DigitalInputs.readAll() & 0xffffff;
    float aiNow[3] = {0, 0, 0};
    bool aiDue = (int32_t)(now - nextAi) >= 0;
    if (aiDue) {
      nextAi = now + 20;
      for (int c = 0; c < 3; c++) { configAi(c, aiModes[c]); aiNow[c] = aiConvert(analogRead(kAiPin[c]), aiModes[c]); }
    }

    mtx.lock();
    for (auto& p : pts) {
      bool digitalIn = p.kind == In || (p.kind == Io && !p.output);
      if (digitalIn) {
        bool r = p.kind == In ? (din >> kDinRead[p.ch]) & 1 : (ioIn >> kIoRead[p.ch]) & 1;
        if (r != p.raw || !p.known) { p.raw = r; p.rawAt = now; }
        if (!p.known || (now - p.rawAt >= kDebounceMs && (p.value >= 0.5f) != r)) { p.value = r ? 1 : 0; p.known = true; State::changed(); }
      } else if (p.kind == Ai && aiDue) {
        // A little smoothing: the inputs are noisy at 16 bits.
        p.value = p.known ? p.value + (aiNow[p.ch] - p.value) * 0.3f : aiNow[p.ch];
        p.known = true;
      }
    }
    mtx.unlock();
    rtos::ThisThread::sleep_for(10ms);
  }
}

void setupRs485ForDmx() {
  // SP335 transceiver: on, RS485 (not 232), half duplex, fast slew, driver on, receiver off, no termination.
  const struct { PinName pin; PinStatus level; } kPins[] = {
      {MC_RS485_EN_PIN, HIGH}, {MC_RS485_RS232_PIN, HIGH}, {MC_RS485_HF_PIN, HIGH}, {MC_RS485_SLEW_PIN, HIGH},
      {MC_RS485_DE_PIN, HIGH}, {MC_RS485_RE_PIN, HIGH}, {MC_RS485_TERM_PIN, LOW}, {MC_RS485_FDTERM_PIN, LOW}};
  for (auto& p : kPins) { pinMode(p.pin, OUTPUT); digitalWrite(p.pin, p.level); }
}
#endif

bool truthy(const String& s, float& v) {
  if (s.equalsIgnoreCase("on") || s.equalsIgnoreCase("true")) { v = 1; return true; }
  if (s.equalsIgnoreCase("off") || s.equalsIgnoreCase("false")) { v = 0; return true; }
  char* end;
  v = strtof(s.c_str(), &end);
  return s.length() && !*end;
}

}  // namespace

namespace Board {

bool present() {
#ifdef KD_BOARD_PMC
  return true;
#else
  return false;
#endif
}

void begin() {
#ifdef KD_BOARD_PMC
  setupRs485ForDmx();
  if (pts.empty()) build();
  Wire.begin();
  bool dio = MachineControl_DigitalProgrammables.begin();
  bool din = MachineControl_DigitalInputs.begin();
  MachineControl_DigitalOutputs.begin(true);   // latch: a shorted output stays off until switched again
  MachineControl_AnalogOut.begin();
  analogReadResolution(16);
  for (int c = 0; c < 3; c++) for (int i = 0; i < 4; i++) pinMode(kAiCfg[c][i], OUTPUT);
  // readAll() of the library reports nothing when an expander doesn't answer; check it once here.
  boardOk = dio && din && (bool)MachineControl_DigitalProgrammables && (bool)MachineControl_DigitalInputs;
  if (boardOk) LOGI(Sys, "Machine Control I/O ready");
  else LOGE(Sys, "Machine Control I/O expanders not found (I2C)");
  thread.start(run);
#endif
}

void load() {
  if (!present()) return;
  if (pts.empty()) build();
  JsonObjectConst cfg = Show::projectDoc()["machineControl"].as<JsonObjectConst>();
  mtx.lock();
  for (auto& p : pts) {
    JsonObjectConst o = cfg[p.key];
    p.name = o["name"] | "";
    p.var = o["var"] | "";
    String mode = o["mode"] | "";
    if (p.kind == Io) {
      bool out = mode == "out";
      if (out != p.output) { p.output = out; p.value = p.target = 0; p.fadeMs = p.pulseUntil = 0; p.known = out; }
    }
    if (p.kind == Ai) {
      AiMode m = mode == "4-20mA" ? MilliAmp : mode == "NTC" ? Ntc : Volt;
      if (m != p.aiMode) { p.aiMode = m; p.known = false; }
    }
    // Outputs keep their state over a reload (saving the project must not switch anything).
    p.reported = "";
    p.echo.clear();
  }
  mtx.unlock();
}

void poll() {
  if (!present()) return;
  std::vector<std::pair<String, String>> sets;
  mtx.lock();
  for (auto& p : pts) {
    if (!p.var.length() || !p.known) continue;
    String v = fmt(p);
    if (v == p.reported) continue;
    if (!isDigital(p) && p.reported.length() && fabsf(v.toFloat() - p.reported.toFloat()) < deadband(p)) continue;
    p.reported = v;
    String cur;
    if (Globals::get(p.var, cur) && cur != v && p.echo.size() < 4) p.echo.push_back(v);
    sets.push_back({p.var, v});
  }
  mtx.unlock();
  for (auto& s : sets) { String msg; Globals::set(s.first, s.second, msg, true); }
}

bool find(const String& ref, String& key, String& err) {
  if (!present()) { err = "this controller has no board I/O (Machine Control firmware only)"; return false; }
  for (auto& p : pts)
    if (p.key.equalsIgnoreCase(ref) || (p.name.length() && p.name.equalsIgnoreCase(ref))) { key = p.key; return true; }
  err = "unknown I/O point '" + ref + "' (in0-7, out0-7, io0-11, ai0-2, ao0-3 or a name)";
  return false;
}

bool value(const String& key, float& v) {
  mtx.lock();
  Pt* p = byKey(key);
  bool ok = p && p->known;
  if (ok) v = p->value;
  mtx.unlock();
  return ok;
}

bool command(const std::vector<String>& t, String& msg) {
  auto is = [&](size_t i, const char* w) { return t.size() > i && t[i].equalsIgnoreCase(w); };
  if (!present()) { msg = "this controller has no board I/O (Machine Control firmware only)"; return false; }
  if (t.size() == 3 && is(1, "all") && is(2, "off")) {
    mtx.lock();
    for (auto& p : pts) if (p.output) setTarget(p, 0, 0);
    mtx.unlock();
    msg = "All board outputs off";
    return true;
  }
  if (t.size() < 3) { msg = "expected: io <point> on|off|toggle, io <point> pulse <s>, io <ao> <volts> [fade <s>] or io all off"; return false; }
  String key;
  if (!find(t[1], key, msg)) return false;
  mtx.lock();
  Pt& p = *byKey(key);
  String label = p.name.length() ? key + " (" + p.name + ")" : key;
  bool ok = false;
  if (!p.output) msg = label + (p.kind == Io ? " is set as an input (Devices → Machine Control)" : " is an input");
  else if (t.size() == 3 && is(2, "toggle")) { setTarget(p, p.value >= 0.5f ? 0 : (p.kind == Ao ? 10 : 1), 0); msg = label + " toggled"; ok = true; }
  else if (t.size() == 4 && is(2, "pulse")) {
    float s = t[3].toFloat();
    if (s <= 0 || s > 3600) msg = "pulse length must be 0.01-3600 s";
    else {
      setTarget(p, p.kind == Ao ? 10 : 1, 0);
      p.pulseUntil = millis() + (uint32_t)(s * 1000);
      if (!p.pulseUntil) p.pulseUntil = 1;
      msg = label + " pulse " + t[3] + " s";
      ok = true;
    }
  } else {
    float v, fade = 0;
    bool fadeOk = t.size() == 3 || (t.size() == 5 && is(3, "fade"));
    if (t.size() == 5) fade = t[4].toFloat();
    if (!fadeOk || !truthy(t[2], v)) msg = p.kind == Ao ? "expected: io " + key + " <0-10 volts> [fade <s>]" : "expected: io " + key + " on|off|toggle|pulse <s>";
    else if (fade > 0 && p.kind != Ao) msg = "fade only works on analog outputs (ao0-ao3)";
    else {
      if (p.kind == Ao && (is(2, "on") || is(2, "true"))) v = 10;
      setTarget(p, v, fade);
      msg = label + " = " + (p.kind == Ao ? String(p.target, 2) + " V" : String(p.target >= 0.5f ? "on" : "off")) + (fade > 0 ? " in " + t[4] + " s" : "");
      ok = true;
    }
  }
  mtx.unlock();
  return ok;
}

void onVariable(const String& name, const String& value) {
  if (!present()) return;
  mtx.lock();
  for (auto& p : pts) {
    if (!p.output || !p.var.equalsIgnoreCase(name)) continue;
    // Our own update coming back: not a request to switch.
    if (!p.echo.empty() && p.echo.front() == value) { p.echo.pop_front(); continue; }
    p.echo.clear();
    float v;
    if (!truthy(value, v)) continue;
    setTarget(p, v, 0);
    p.reported = fmt(p);
  }
  mtx.unlock();
}

void statusJson(JsonObject o) {
  o["type"] = "machineControl";
  o["ok"] = boardOk;
  JsonArray arr = o["points"].to<JsonArray>();
  mtx.lock();
  for (auto& p : pts) {
    JsonObject j = arr.add<JsonObject>();
    j["k"] = p.key;
    j["v"] = p.known ? fmt(p) : String("");
    if (p.output) j["out"] = true;
    if (p.pulseUntil) j["pulse"] = true;
  }
  mtx.unlock();
}

}  // namespace Board
