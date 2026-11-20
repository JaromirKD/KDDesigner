#pragma once
#include <Arduino.h>
#include <vector>
#include "BigRam.h"

// Effects: a tiny shader-like language, compiled once when the project loads and run
// per fixture per frame. Same language, opcodes and results as data/www/fx.js (the web
// UI's editor, preview and the PC mock) - keep the two in step. See fx.js for the syntax.
namespace Fx {

// Kinds of parameter and how many slots each takes (the first one is the parameter's own):
// number 1; colour 3 (name.r .g .b); colour list 1 + 4 per colour (how many, then r g b and its
// place 0..1 each, in place order, room for kMaxStops); text 2 (where its letters are in the data, name.w); picture 4 (where its
// pixels are, name.w, name.h, name.frames). "Where" = offset in the cue's data + 1 (0 = none).
enum ParamType : uint8_t { PNum, PColor, PGrad, PText, PImage };
constexpr int kMaxStops = 8;
constexpr int kMaxText = 200;        // bytes of a text parameter
constexpr int kMaxImage = 16384;     // pixels of a picture, all frames together

struct Param {
  String name;
  uint8_t type;        // ParamType
  double def[3];       // number: def[0]; colour: r, g, b 0..1
  int slot;
  int defAt = -1;      // text: its default's offset in Program::data
  uint8_t stops = 0;   // colour list: its default colours, r g b place (NAN = none) each
  double grad[kMaxStops * 4];
  int width() const { return type == PColor ? 3 : type == PGrad ? 1 + kMaxStops * 4 : type == PText ? 2 : type == PImage ? 4 : 1; }
};

// One instruction of the controller's own form of the bytecode (built from ops/args by
// compile): an operand can be folded in (mode 1 = the number a, 2 = slot `slot`), which
// halves the instructions of a typical effect. fn = function number for a call.
struct Ins { uint8_t op, mode, fn, na; uint16_t slot; double a; };

// "t * speed" with a number parameter: a hidden slot (the parameter's clock) filled in per frame
// by frameInputs, so a speed change carries on from where the effect is instead of jumping.
struct Clock { uint16_t param, slot; };

struct Program {
  BigRam::Vec<uint8_t> ops;     // the bytecode as fx.js has it
  BigRam::Vec<double> args;
  int slots = 0;                // including the frame part's temporaries
  BigRam::Vec<Param> params;
  BigRam::Vec<Clock> clocks;
  BigRam::Vec<uint8_t> data;    // the default texts; a cue's data starts as a copy of this
  // What actually runs: `frame` once per frame (everything that is the same for every
  // fixture: t, n, parameters, and names set only from those), `body` per fixture.
  BigRam::Vec<Ins> frame, body;
};

// Slots 0..7 are the inputs, 8..12 the outputs (same order as fx.js).
enum Slot { T, I, N, U, X, Y, PI_, TAU, R, G, B, W, DIM, FIRST_FREE };

// Compile; on error returns false with err = "line N: message".
bool compile(const char* src, Program& out, String& err);
// Parse a parameter value ("0.5", "#ff8800", "#ff0000,#0000ff", a text, "img:WxHxF:<base64>")
// into its slot(s); texts and pictures are added to data (which starts as a copy of prog.data).
void setParam(const Param& p, const char* value, double* slots, BigRam::Vec<uint8_t>& data);
// Fresh slots: defaults of outputs and params. Caller then fills the inputs.
void init(const Program& prog, double* slots);
// Per frame: slots hold the parameters, t and n; runs the frame part. Then per fixture: set
// i, u, x, y and the outputs' defaults (r g b w dim from init), and run. The results are the
// same as running the whole bytecode per fixture (fx.js run()), bit for bit. data = the cue's.
void runFrame(const Program& prog, double* slots, const uint8_t* data);
void run(const Program& prog, double* slots, const uint8_t* data);
// grad / txt / img (functions 27..29): v = the arguments (v[0] = the parameter's slot); the
// results go in v[0..]. Returns how many. (Also used by tools/fxtest's plain interpreter.)
int special(int fn, double* v, const double* slots, const uint8_t* data);

// ---- A clip over time (= runner / frame / carry in fx.js) ----
// Automation of a number parameter: a line through points (t s from the clip's start, value,
// e = the exponent of the segment to the next point: value goes as x^e). cum = area from the
// first point to each point, per = over one wrap (a looping timeline's length, 0 = none).
struct LanePt { double t, v, e; };
struct Lane { int slot = 0; BigRam::Vec<LanePt> pts; BigRam::Vec<double> cum; double per = 0; };
// What a live edit left: values gliding from what was shown (gOff per slot, from gT0 for
// kGlide s; gT0 < 0 = none) and the clocks' offsets (cOff) and glide share (cG), per clock.
struct GlideOff { uint16_t slot; double off; };
struct Live { double gT0 = -1; BigRam::Vec<GlideOff> gOff; BigRam::Vec<double> cOff, cG; };
constexpr double kGlide = 0.5;
double curveExp(double c);   // a point's curve -1..1 -> its segment's exponent
// Points as [ms, value, curve] triples (sorted here); false when there are none.
bool makeLane(int slot, const double* tvc, int n, double wrap, Lane& out);
double laneValue(const Lane& l, double tau);
double laneIntegral(const Lane& l, double tau, double wrap);
// s = a copy of the clip's values (base): sets t, the automated parameters, glides and clocks.
void frameInputs(const Program& p, const double* base, const BigRam::Vec<Lane>& lanes, double wrap, const Live& lv, double t, double* s);
// A live edit: so = the old clip's frame slots now, sn = the new one's (frameInputs with an
// empty Live) at its tNew; fills lv so the new clip starts from what the old one showed.
void carry(const Program& p, const double* oldBase, const double* newBase, const double* so, const double* sn, double tNew, Live& lv);

// A timeline effect cue's clip options ("mods", = place() in fx.js): flip / mirror bits 1 = x,
// 2 = y; repeat 1 = off; kaleido 0 = off. Worked out once per fixture when the project loads.
struct Mods { uint8_t flip = 0, mirror = 0, repeat = 1, kaleido = 0; bool invert = false; };
void place(const Mods& m, int& i, int& n, double& x, double& y);
// Mods::invert, after run(): dark becomes light (= invert() in fx.js).
void invert(double* slots);

}  // namespace Fx
