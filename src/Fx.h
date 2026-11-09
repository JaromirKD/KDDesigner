#pragma once
#include <Arduino.h>
#include <vector>
#include "BigRam.h"

// Effects: a tiny shader-like language, compiled once when the project loads and run
// per fixture per frame. Same language, opcodes and results as data/www/fx.js (the web
// UI's editor, preview and the PC mock) - keep the two in step. See fx.js for the syntax.
namespace Fx {

struct Param {
  String name;
  bool color;          // colour: three slots name.r/.g/.b from "#rrggbb"
  double def[3];       // number: def[0]; colour: r, g, b 0..1
  int slot;
};

// One instruction of the controller's own form of the bytecode (built from ops/args by
// compile): an operand can be folded in (mode 1 = the number a, 2 = slot `slot`), which
// halves the instructions of a typical effect. fn = function number for a call.
struct Ins { uint8_t op, mode, fn, na; uint16_t slot; double a; };

struct Program {
  BigRam::Vec<uint8_t> ops;     // the bytecode as fx.js has it
  BigRam::Vec<double> args;
  int slots = 0;                // including the frame part's temporaries
  BigRam::Vec<Param> params;
  // What actually runs: `frame` once per frame (everything that is the same for every
  // fixture: t, n, parameters, and names set only from those), `body` per fixture.
  BigRam::Vec<Ins> frame, body;
};

// Slots 0..7 are the inputs, 8..12 the outputs (same order as fx.js).
enum Slot { T, I, N, U, X, Y, PI_, TAU, R, G, B, W, DIM, FIRST_FREE };

// Compile; on error returns false with err = "line N: message".
bool compile(const char* src, Program& out, String& err);
// Parse a parameter value ("0.5" or "#ff8800") into its slot(s).
void setParam(const Param& p, const char* value, double* slots);
// Fresh slots: defaults of outputs and params. Caller then fills the inputs.
void init(const Program& prog, double* slots);
// Per frame: slots hold the parameters, t and n; runs the frame part. Then per fixture: set
// i, u, x, y and the outputs' defaults (r g b w dim from init), and run. The results are the
// same as running the whole bytecode per fixture (fx.js run()), bit for bit.
void runFrame(const Program& prog, double* slots);
void run(const Program& prog, double* slots);

}  // namespace Fx
