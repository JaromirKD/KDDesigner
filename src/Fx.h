#pragma once
#include <Arduino.h>
#include <vector>

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

struct Program {
  std::vector<uint8_t> ops;
  std::vector<double> args;
  int slots = 0;
  std::vector<Param> params;
};

// Slots 0..7 are the inputs, 8..12 the outputs (same order as fx.js).
enum Slot { T, I, N, U, X, Y, PI_, TAU, R, G, B, W, DIM, FIRST_FREE };

// Compile; on error returns false with err = "line N: message".
bool compile(const char* src, Program& out, String& err);
// Parse a parameter value ("0.5" or "#ff8800") into its slot(s).
void setParam(const Param& p, const char* value, double* slots);
// Fresh slots: defaults of outputs and params. Caller then fills the inputs.
void init(const Program& prog, double* slots);
void run(const Program& prog, double* slots);

}  // namespace Fx
