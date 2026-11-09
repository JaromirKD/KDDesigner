// Runs effects through the firmware's Fx.cpp on a PC (see test.js): per frame / per fixture
// exactly as runEffect() in Show.cpp does, and through a plain interpreter of the same
// bytecode (the firmware's run() before the frame/fixture split). The two must agree bit
// for bit; test.js compares the first against fx.js.
// stdin: one program per line ("\n" written as \n). stdout per fixture:
//   <program> <frame> <fixture> <r g b w dim as hex doubles>   or   <program> E <error>
#include <stdio.h>
#include <string.h>
#include <string>
#include <iostream>
#include "Fx.h"

namespace {
const int kArgs[] = {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 1, 1, 1, 1, 1, 2, 3};
double fract(double x) { return x - floor(x); }
double rnd(double x) {
  uint32_t h = (uint32_t)(int64_t)floor(x * 4096.0);
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h ^= h >> 16;
  return (h >> 8) / 16777216.0;
}
double noise(double x) {
  double i = floor(x), f = x - i, k = f * f * (3 - 2 * f);
  double a = rnd(i / 4096.0), b = rnd((i + 1) / 4096.0);
  return a + (b - a) * k;
}
double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }

// The old run(), op by op.
void reference(const Fx::Program& prog, double* s) {
  double st[72];
  int sp = 0;
  for (size_t k = 0; k < prog.ops.size(); k++) {
    const double a = prog.args[k];
    switch (prog.ops[k]) {
      case 0: st[sp++] = a; break;
      case 1: st[sp++] = s[(int)a]; break;
      case 2: s[(int)a] = st[--sp]; break;
      case 8: st[sp - 1] = -st[sp - 1]; break;
      case 9: st[sp - 1] = st[sp - 1] ? 0 : 1; break;
      case 18: { double z = st[--sp], y = st[--sp], x = st[--sp]; st[sp++] = x ? y : z; break; }
      case 19: {
        int f = (int)a, na = kArgs[f];
        double* v = &st[sp - na];
        double r = 0;
        switch (f) {
          case 0: r = sin(v[0]); break;
          case 1: r = cos(v[0]); break;
          case 2: r = tan(v[0]); break;
          case 3: r = fabs(v[0]); break;
          case 4: r = floor(v[0]); break;
          case 5: r = ceil(v[0]); break;
          case 6: r = fract(v[0]); break;
          case 7: r = v[0] > 0 ? sqrt(v[0]) : 0; break;
          case 8: r = exp(v[0]); break;
          case 9: r = v[0] > 0 ? log(v[0]) : 0; break;
          case 10: r = v[0] > 0 ? 1 : v[0] < 0 ? -1 : 0; break;
          case 11: r = (v[0] < 0 && v[1] != floor(v[1])) ? 0 : pow(v[0], v[1]); break;
          case 12: r = v[0] < v[1] ? v[0] : v[1]; break;
          case 13: r = v[0] > v[1] ? v[0] : v[1]; break;
          case 14: r = v[1] ? v[0] - v[1] * floor(v[0] / v[1]) : 0; break;
          case 15: r = atan2(v[0], v[1]); break;
          case 16: r = v[1] < v[0] ? 0 : 1; break;
          case 17: r = clampd(v[0], v[1], v[2]); break;
          case 18: r = v[0] + (v[1] - v[0]) * v[2]; break;
          case 19: {
            double k2 = v[0] == v[1] ? (v[2] < v[0] ? 0 : 1) : clampd((v[2] - v[0]) / (v[1] - v[0]), 0, 1);
            r = k2 * k2 * (3 - 2 * k2);
            break;
          }
          case 20: r = rnd(v[0]); break;
          case 21: r = noise(v[0]); break;
          case 22: r = 1 - fabs(fract(v[0]) * 2 - 1); break;
          case 23: r = fract(v[0]); break;
          case 24: r = fract(v[0]) < 0.5 ? 1 : 0; break;
          case 25: r = fract(v[0]) < v[1] ? 1 : 0; break;
          case 26: {
            double h = fract(v[0]) * 6, sat = clampd(v[1], 0, 1), val = v[2];
            int i = (int)floor(h) % 6;
            double f2 = h - floor(h), p = val * (1 - sat), q = val * (1 - sat * f2), t = val * (1 - sat * (1 - f2));
            const double rgb[6][3] = {{val, t, p}, {q, val, p}, {p, val, t}, {p, q, val}, {t, p, val}, {val, p, q}};
            v[0] = rgb[i][0]; v[1] = rgb[i][1]; v[2] = rgb[i][2];
            continue;
          }
        }
        if (!isfinite(r)) r = 0;
        sp -= na;
        st[sp++] = r;
        break;
      }
      default: {
        double y = st[--sp], x = st[sp - 1], r;
        switch (prog.ops[k]) {
          case 3: r = x + y; break;
          case 4: r = x - y; break;
          case 5: r = x * y; break;
          case 6: r = y ? x / y : 0; break;
          case 7: r = y ? x - y * floor(x / y) : 0; break;
          case 10: r = x < y; break;
          case 11: r = x > y; break;
          case 12: r = x <= y; break;
          case 13: r = x >= y; break;
          case 14: r = x == y; break;
          case 15: r = x != y; break;
          case 16: r = x && y; break;
          default: r = x || y; break;
        }
        st[sp - 1] = r;
      }
    }
  }
}

uint64_t bits(double d) { uint64_t u; memcpy(&u, &d, 8); return u; }
}  // namespace

int main() {
  const double times[] = {0, 0.37, 1.5, 12.25, 333.333, 3600.1, 259200.7};
  const int n = 9;
  std::string line;
  int prog = 0, mismatches = 0, fixtures = 0;
  while (std::getline(std::cin, line)) {
    std::string src;
    for (size_t k = 0; k < line.size(); k++) {
      if (line[k] == '\\' && k + 1 < line.size()) { src += line[k + 1] == 'n' ? '\n' : line[k + 1]; k++; }
      else src += line[k];
    }
    Fx::Program p;
    String err;
    if (!Fx::compile(src.c_str(), p, err)) { printf("%d E %s\n", prog++, err.c_str()); continue; }
    std::vector<double> init(p.slots), s(p.slots), ref(p.slots);
    Fx::init(p, init.data());
    fprintf(stderr, "program %d: %d ops -> frame %d + fixture %d instructions, %d slots\n", prog, (int)p.ops.size(),
            (int)p.frame.size() - 1, (int)p.body.size() - 1, p.slots);
    for (int f = 0; f < (int)(sizeof(times) / sizeof(times[0])); f++) {
      s = init;   // as runEffect: once per frame, then only inputs and outputs per fixture
      s[Fx::T] = times[f];
      s[Fx::N] = n;
      Fx::runFrame(p, s.data());
      for (int i = 0; i < n; i++) {
        for (int k = Fx::R; k <= Fx::DIM; k++) s[k] = init[k];
        s[Fx::I] = i;
        s[Fx::U] = (double)i / n;
        s[Fx::X] = i * 0.13;
        s[Fx::Y] = 1 - i * 0.11;
        Fx::run(p, s.data());
        ref = init;   // the old way: fresh slots for every fixture
        ref[Fx::T] = times[f];
        ref[Fx::N] = n;
        ref[Fx::I] = i;
        ref[Fx::U] = (double)i / n;
        ref[Fx::X] = i * 0.13;
        ref[Fx::Y] = 1 - i * 0.11;
        reference(p, ref.data());
        printf("%d %d %d", prog, f, i);
        for (int k = Fx::R; k <= Fx::DIM; k++) {
          printf(" %016llx", (unsigned long long)bits(s[k]));
          if (bits(s[k]) != bits(ref[k])) {
            mismatches++;
            fprintf(stderr, "MISMATCH program %d frame %d fixture %d slot %d: %.17g vs %.17g\n", prog, f, i, k, s[k], ref[k]);
          }
        }
        printf("\n");
        fixtures++;
      }
    }
    prog++;
  }
  fprintf(stderr, "%d programs, %d fixtures, %d mismatches against the plain interpreter\n", prog, fixtures, mismatches);
  return mismatches ? 1 : 0;
}
