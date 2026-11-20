// Runs effects through the firmware's Fx.cpp on a PC (see test.js): per frame / per fixture
// exactly as runEffect() in Show.cpp does, and through a plain interpreter of the same
// bytecode (the firmware's run() before the frame/fixture split). The two must agree bit
// for bit; test.js compares the first against fx.js.
// stdin: one program per line ("\n" written as \n). stdout per fixture:
//   <program> <frame> <fixture> <r g b w dim as hex doubles>   or   <program> E <error>
// After a program, a tab and <name>=<value> per parameter value (as a timeline cue gives them).
// A line "#place <flip> <mirror> <repeat> <kaleido>" prints Fx::place() for 9 fixtures:
//   P <case> <fixture> <i> <n> <x y as hex doubles>
#include <stdio.h>
#include <string.h>
#include <string>
#include <iostream>
#include "Fx.h"

namespace {
const int kArgs[] = {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 1, 1, 1, 1, 1, 2, 3, 2, 3, 4};
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
void reference(const Fx::Program& prog, double* s, const uint8_t* data) {
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
        if (f >= 27) {   // grad / txt / img: the firmware's own code, results in place of the arguments
          sp += Fx::special(f, v, s, data) - na;
          continue;
        }
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
  int prog = 0, mismatches = 0, fixtures = 0, places = 0;
  while (std::getline(std::cin, line)) {
    if (!line.compare(0, 7, "#place ")) {
      Fx::Mods m;
      int fl = 0, mi = 0, re = 1, ka = 0;
      sscanf(line.c_str() + 7, "%d %d %d %d", &fl, &mi, &re, &ka);
      m.flip = fl;
      m.mirror = mi;
      m.repeat = re;
      m.kaleido = ka;
      for (int i = 0; i < n; i++) {
        int pi = i, pn = n;
        double x = i * 0.13, y = 1 - i * 0.11;
        Fx::place(m, pi, pn, x, y);
        printf("P %d %d %d %d %016llx %016llx\n", places, i, pi, pn, (unsigned long long)bits(x), (unsigned long long)bits(y));
      }
      places++;
      continue;
    }
    std::vector<std::string> parts(1);   // the program, then name=value per parameter value
    for (size_t k = 0; k < line.size(); k++) {
      if (line[k] == '\t') { parts.emplace_back(); continue; }
      if (line[k] == '\\' && k + 1 < line.size()) { parts.back() += line[k + 1] == 'n' ? '\n' : line[k + 1]; k++; }
      else parts.back() += line[k];
    }
    Fx::Program p;
    String err;
    if (!Fx::compile(parts[0].c_str(), p, err)) { printf("%d E %s\n", prog++, err.c_str()); continue; }
    std::vector<double> init(p.slots), s(p.slots), ref(p.slots);
    Fx::init(p, init.data());
    std::vector<uint8_t> data = p.data;   // as a timeline cue: the program's texts, then its own values
    // "@auto=<param>:<ms>,<v>,<curve>;..." automation, "@wrap=<s>", "@edit=<param>=<value>": a
    // live edit at 1.5 s (Fx::carry from the values before it to the ones after).
    std::vector<Fx::Lane> lanes;
    double wrap = 0;
    std::vector<std::string> edits;
    for (size_t k = 1; k < parts.size(); k++) {
      const std::string& pt = parts[k];
      if (!pt.compare(0, 6, "@wrap=")) { wrap = atof(pt.c_str() + 6); continue; }
      if (!pt.compare(0, 6, "@edit=")) { edits.push_back(pt.substr(6)); continue; }
      if (!pt.compare(0, 6, "@auto=")) continue;   // after wrap is known
      const size_t eq = pt.find('=');
      for (auto& q : p.params)
        if (q.name == pt.substr(0, eq).c_str()) Fx::setParam(q, pt.c_str() + eq + 1, init.data(), data);
    }
    for (size_t k = 1; k < parts.size(); k++) {
      if (parts[k].compare(0, 6, "@auto=")) continue;
      const std::string a = parts[k].substr(6);
      const size_t colon = a.find(':');
      std::vector<double> tvc;
      for (const char* q = a.c_str() + colon + 1; *q;) {
        double v[3] = {0, 0, 0};
        char* e;
        for (int j = 0; j < 3; j++) { v[j] = strtod(q, &e); q = e; if (*q == ',') q++; }
        tvc.insert(tvc.end(), v, v + 3);
        if (*q == ';') q++;
      }
      for (auto& q : p.params)
        if (q.type == Fx::PNum && q.name == a.substr(0, colon).c_str()) {
          Fx::Lane l;
          if (Fx::makeLane(q.slot, tvc.data(), tvc.size() / 3, wrap, l)) lanes.push_back(l);
        }
    }
    Fx::Live live;
    if (!edits.empty()) {
      std::vector<double> after = init, so(p.slots), sn(p.slots);
      for (const auto& ed : edits) {
        const size_t eq = ed.find('=');
        for (auto& q : p.params)
          if (q.name == ed.substr(0, eq).c_str()) Fx::setParam(q, ed.c_str() + eq + 1, after.data(), data);
      }
      so = init;
      Fx::frameInputs(p, init.data(), lanes, wrap, Fx::Live(), 1.5, so.data());
      sn = after;
      Fx::frameInputs(p, after.data(), lanes, wrap, Fx::Live(), 1.5, sn.data());
      Fx::carry(p, init.data(), after.data(), so.data(), sn.data(), 1.5, live);
      init = after;
    }
    fprintf(stderr, "program %d: %d ops -> frame %d + fixture %d instructions, %d slots\n", prog, (int)p.ops.size(),
            (int)p.frame.size() - 1, (int)p.body.size() - 1, p.slots);
    for (int f = 0; f < (int)(sizeof(times) / sizeof(times[0])); f++) {
      s = init;   // as runEffect: once per frame, then only inputs and outputs per fixture
      Fx::frameInputs(p, init.data(), lanes, wrap, live, times[f], s.data());
      s[Fx::N] = n;
      const std::vector<double> frame = s;
      Fx::runFrame(p, s.data(), data.data());
      for (int i = 0; i < n; i++) {
        for (int k = Fx::R; k <= Fx::DIM; k++) s[k] = init[k];
        s[Fx::I] = i;
        s[Fx::U] = (double)i / n;
        s[Fx::X] = i * 0.13;
        s[Fx::Y] = 1 - i * 0.11;
        Fx::run(p, s.data(), data.data());
        ref = frame;   // the old way: fresh slots (from the frame's inputs) for every fixture
        for (int k = Fx::R; k <= Fx::DIM; k++) ref[k] = init[k];
        ref[Fx::I] = i;
        ref[Fx::U] = (double)i / n;
        ref[Fx::X] = i * 0.13;
        ref[Fx::Y] = 1 - i * 0.11;
        reference(p, ref.data(), data.data());
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
