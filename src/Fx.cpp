#include "Fx.h"
#include <math.h>
#include <algorithm>
#include <ctype.h>

namespace Fx {
namespace {

const char* const kInputs[] = {"t", "i", "n", "u", "x", "y", "pi", "tau"};
const char* const kOutputs[] = {"r", "g", "b", "w", "dim"};
struct Func { const char* name; uint8_t args, rets; };
// Index = function number in the bytecode (same list as FUNCS in fx.js).
const Func kFuncs[] = {{"sin", 1, 1}, {"cos", 1, 1}, {"tan", 1, 1}, {"abs", 1, 1}, {"floor", 1, 1}, {"ceil", 1, 1},
                       {"fract", 1, 1}, {"sqrt", 1, 1}, {"exp", 1, 1}, {"log", 1, 1}, {"sign", 1, 1}, {"pow", 2, 1},
                       {"min", 2, 1}, {"max", 2, 1}, {"mod", 2, 1}, {"atan", 2, 1}, {"step", 2, 1}, {"clamp", 3, 1},
                       {"mix", 3, 1}, {"smoothstep", 3, 1}, {"rand", 1, 1}, {"noise", 1, 1}, {"tri", 1, 1},
                       {"saw", 1, 1}, {"sq", 1, 1}, {"pulse", 2, 1}, {"hsv", 3, 3}, {"grad", 2, 3}, {"txt", 3, 1},
                       {"img", 4, 3}};
constexpr int kFuncCount = sizeof(kFuncs) / sizeof(kFuncs[0]);
constexpr int kFirstSpecial = 27;   // grad, txt, img: the first argument is a parameter's slot
const uint8_t kSpecialKind[] = {PGrad, PText, PImage};
const char* const kKindWord[] = {"", "", "colour list", "text", "picture"};
const char* const kKindExample[] = {"", "", "pal, k", "msg, px, py", "pic, x, y, 0"};
enum Op : uint8_t { CONST, LOAD, STORE, ADD, SUB, MUL, DIV, MOD, NEG, NOT, LT, GT, LE, GE, EQ, NE, AND, OR, SEL, CALL };

// Token types: single characters as themselves, plus these.
enum : int { T_NUM = 256, T_ID, T_COLOR, T_STR, T_LE, T_GE, T_EQ, T_NE, T_AND, T_OR, T_EOF };
struct Tok { int type; String s; double v; int line; };

struct Fail { String msg; int line; };

bool tokenize(const char* src, std::vector<Tok>& out, Fail& f) {
  int line = 1, depth = 0;
  const char* p = src;
  auto push = [&](int type, const String& s = String(), double v = 0) { out.push_back({type, s, v, line}); };
  while (*p) {
    char c = *p;
    if (c == '/' && p[1] == '/') { while (*p && *p != '\n') p++; continue; }
    if (c == '\n') { if (!depth) push(';'); line++; p++; continue; }
    if (isspace((unsigned char)c)) { p++; continue; }
    if (isdigit((unsigned char)c) || (c == '.' && isdigit((unsigned char)p[1]))) {
      char* end;
      double v = strtod(p, &end);
      push(T_NUM, String(), v);
      p = end;
      continue;
    }
    if (isalpha((unsigned char)c) || c == '_') {
      const char* s = p;
      while (isalnum((unsigned char)*p) || *p == '_' || *p == '.') p++;
      push(T_ID, String(s).substring(0, p - s));
      continue;
    }
    if (c == '#') {
      int k = 1;
      while (k <= 6 && isxdigit((unsigned char)p[k])) k++;
      if (k == 7 && !isalnum((unsigned char)p[7])) {
        String h = String(p).substring(0, 7);
        h.toLowerCase();
        push(T_COLOR, h);
        p += 7;
        continue;
      }
    }
    if (c == '"') {   // "text" on one line, no quotes inside (only for a text parameter)
      const char* e = p + 1;
      while (*e && *e != '"' && *e != '\n') e++;
      if (*e != '"') { f = {"text needs a closing \"", line}; return false; }
      String t;
      t.concat(p + 1, e - p - 1);
      push(T_STR, t);
      p = e + 1;
      continue;
    }
    int two = 0;
    if (c == '<' && p[1] == '=') two = T_LE;
    else if (c == '>' && p[1] == '=') two = T_GE;
    else if (c == '=' && p[1] == '=') two = T_EQ;
    else if (c == '!' && p[1] == '=') two = T_NE;
    else if (c == '&' && p[1] == '&') two = T_AND;
    else if (c == '|' && p[1] == '|') two = T_OR;
    if (two) { push(two); p += 2; continue; }
    if (strchr("+-*/%(),=;?:<>![]", c)) {
      if (c == '(' || c == '[') depth++;
      if ((c == ')' || c == ']') && depth) depth--;
      push(c);
      p++;
      continue;
    }
    f = {String("unexpected '") + c + "'", line};
    return false;
  }
  push(';');
  push(T_EOF);
  return true;
}

class Compiler {
 public:
  Compiler(std::vector<Tok>& t, Program& out) : toks(t), prog(out) {
    for (auto n : kInputs) { names.push_back(n); assigned.push_back(true); }
    for (auto n : kOutputs) { names.push_back(n); assigned.push_back(true); }
  }

  bool program(Fail& f) {
    if (!statements()) { f = fail; return false; }
    if (maxDepth > 64) { f = {"expression too complex", 0}; return false; }
    prog.slots = names.size();
    return true;
  }

 private:
  std::vector<Tok>& toks;
  Program& prog;
  std::vector<String> names;
  std::vector<bool> assigned;
  size_t p = 0;
  int depth = 0, maxDepth = 0;
  Fail fail;

  const Tok& peek(size_t k = 0) { return toks[std::min(p + k, toks.size() - 1)]; }
  const Tok& next() { return toks[std::min(p++, toks.size() - 1)]; }
  bool error(const String& m, int line) { fail = {m, line}; return false; }
  bool expect(int t, const char* what) {
    if (peek().type != t) return error(String("expected ") + what, peek().line);
    next();
    return true;
  }
  void emit(Op op, double arg = 0, int d = 0) {
    prog.ops.push_back(op);
    prog.args.push_back(arg);
    depth += d;
    if (depth > maxDepth) maxDepth = depth;
  }
  int find(const String& n) {
    for (size_t k = 0; k < names.size(); k++) if (names[k] == n) return k;
    return -1;
  }
  int newSlot(const String& n) {
    int k = find(n);
    if (k >= 0) return k;
    names.push_back(n);
    assigned.push_back(false);
    return names.size() - 1;
  }
  const Param* paramNamed(const String& n) {
    for (auto& q : prog.params) if (q.name == n) return &q;
    return nullptr;
  }
  bool isParamSlot(const String& n) {
    for (auto& q : prog.params) if (q.name == n || n.startsWith(q.name + ".")) return true;
    return false;
  }
  bool number(double& v, const char* what) {
    double sign = 1;
    if (peek().type == '-') { next(); sign = -1; }
    if (peek().type != T_NUM) return error(String("expected ") + what, peek().line);
    v = sign * next().v;
    return true;
  }

  bool statements() {
    while (peek().type != T_EOF) {
      if (peek().type == ';') { next(); continue; }
      const Tok tk = peek();
      if (tk.type == T_ID && tk.s == "param") {
        next();
        if (peek().type != T_ID) return error("expected a parameter name", peek().line);
        String name = next().s;
        bool taken = name.indexOf('.') >= 0 || find(name) >= 0;
        for (auto& n : names) taken = taken || n.startsWith(name + ".");
        if (taken) return error("'" + name + "' can't be used as a parameter name", tk.line);
        if (!expect('=', "'='")) return false;
        Param q;
        q.name = name;
        if (peek().type == T_COLOR && (peek(1).type == ',' || peek(1).type == T_NUM)) {
          // Colour list: slot = how many colours, then r g b and place per colour (hidden names).
          q.type = PGrad;
          int cnt = 0;
          for (;;) {
            if (peek().type != T_COLOR) return error("expected a colour (#rrggbb)", peek().line);
            long v = strtol(next().s.c_str() + 1, nullptr, 16);
            double at = NAN;   // no place: spread evenly (fillStops)
            if (peek().type == T_NUM) {
              at = next().v;
              if (at > 1) return error("a place in a colour list is 0 to 1", tk.line);
            }
            if (cnt >= kMaxStops) return error("a colour list has at most " + String(kMaxStops) + " colours", tk.line);
            q.grad[cnt * 4] = ((v >> 16) & 0xff) / 255.0;
            q.grad[cnt * 4 + 1] = ((v >> 8) & 0xff) / 255.0;
            q.grad[cnt * 4 + 2] = (v & 0xff) / 255.0;
            q.grad[cnt * 4 + 3] = at;
            cnt++;
            if (peek().type != ',') break;
            next();
          }
          q.stops = cnt;
          q.slot = newSlot(name);
          assigned[q.slot] = true;
          for (int k = 0; k < kMaxStops * 4; k++) newSlot(name + ":" + String(k));
        } else if (peek().type == T_STR) {
          String def = next().s;
          if ((int)def.length() > kMaxText) return error("a text has at most " + String(kMaxText) + " characters", tk.line);
          q.type = PText;
          q.defAt = prog.data.size();
          for (size_t k = 0; k < def.length(); k++) prog.data.push_back((uint8_t)def[k]);
          q.def[0] = def.length();
          q.slot = newSlot(name);
          assigned[newSlot(name + ".w")] = true;
        } else if (peek().type == T_ID && peek().s == "image") {
          next();
          q.type = PImage;
          q.slot = newSlot(name);
          for (const char* sfx : {".w", ".h", ".frames"}) assigned[newSlot(name + sfx)] = true;
        } else if (peek().type == T_COLOR) {
          String hex = next().s;
          q.type = PColor;
          long v = strtol(hex.c_str() + 1, nullptr, 16);
          q.def[0] = ((v >> 16) & 0xff) / 255.0;
          q.def[1] = ((v >> 8) & 0xff) / 255.0;
          q.def[2] = (v & 0xff) / 255.0;
          q.slot = newSlot(name + ".r");
          newSlot(name + ".g");
          newSlot(name + ".b");
          assigned[q.slot] = assigned[q.slot + 1] = assigned[q.slot + 2] = true;
        } else {
          q.type = PNum;
          if (!number(q.def[0], "a number, #rrggbb, \"text\" or image")) return false;
          if (peek().type == '[') {   // [min, max] only matters to the UI
            next();
            double lo, hi;
            if (!number(lo, "a minimum") || !expect(',', "','") || !number(hi, "a maximum") || !expect(']', "']'")) return false;
          }
          q.slot = newSlot(name);
          assigned[q.slot] = true;
        }
        prog.params.push_back(q);
        if (!expect(';', "end of line")) return false;
        continue;
      }
      if (tk.type == T_ID && tk.s == "let") next();
      std::vector<String> targets;
      if (peek().type != T_ID) return error("expected a name to assign to", peek().line);
      targets.push_back(next().s);
      while (peek().type == ',') {
        next();
        if (peek().type != T_ID) return error("expected a name", peek().line);
        targets.push_back(next().s);
      }
      if (!expect('=', "'='")) return false;
      for (auto& n : targets) {
        for (auto in : kInputs) if (n == in) return error("'" + n + "' is an input and can't be changed", tk.line);
        if (isParamSlot(n)) return error("'" + n + "' is a parameter and can't be changed", tk.line);
      }
      if (targets.size() == 1) {
        if (!expr()) return false;
        if (depth != 1) return error("this gives 3 values: assign it to three names, like r, g, b = ...", tk.line);
        int s = newSlot(targets[0]);
        assigned[s] = true;
        emit(STORE, s, -1);
      } else {
        if (targets.size() != 3) return error("assign one value, or three (r, g, b = ...)", tk.line);
        const Param* col = peek().type == T_ID ? paramNamed(peek().s) : nullptr;
        if (col && col->type == PColor && (peek(1).type == ';' || peek(1).type == T_EOF)) {
          next();
          for (int k = 0; k < 3; k++) emit(LOAD, col->slot + k, 1);
        } else {
          if (!expr()) return false;
          if (depth != 3) return error("three names need a colour: hsv(...) or a colour parameter", tk.line);
        }
        for (int k = 2; k >= 0; k--) {
          int s = newSlot(targets[k]);
          assigned[s] = true;
          emit(STORE, s, -1);
        }
      }
      if (peek().type != ';' && peek().type != T_EOF) return error("unexpected token - one statement per line", peek().line);
    }
    return true;
  }

  bool expr() {
    if (!orExpr()) return false;
    if (peek().type == '?') {
      next();
      if (!expr() || !expect(':', "':'") || !expr()) return false;
      emit(SEL, 0, -2);
    }
    return true;
  }
  template <typename Sub>
  bool bin(Sub sub, std::initializer_list<std::pair<int, Op>> ops) {
    if (!(this->*sub)()) return false;
    for (;;) {
      Op op = CONST;
      bool hit = false;
      for (auto& o : ops) if (peek().type == o.first) { op = o.second; hit = true; }
      if (!hit) return true;
      next();
      if (!(this->*sub)()) return false;
      emit(op, 0, -1);
    }
  }
  bool orExpr() { return bin(&Compiler::andExpr, {{T_OR, OR}}); }
  bool andExpr() { return bin(&Compiler::cmpExpr, {{T_AND, AND}}); }
  bool cmpExpr() { return bin(&Compiler::addExpr, {{'<', LT}, {'>', GT}, {T_LE, LE}, {T_GE, GE}, {T_EQ, EQ}, {T_NE, NE}}); }
  bool addExpr() { return bin(&Compiler::mulExpr, {{'+', ADD}, {'-', SUB}}); }
  // "t * speed" / "speed * t" with a number parameter -> the parameter's clock (= mulExpr in fx.js).
  bool mulExpr() {
    const size_t k0 = prog.ops.size();
    if (!unary()) return false;
    for (;;) {
      const int ty = peek().type;
      const Op op = ty == '*' ? MUL : ty == '/' ? DIV : ty == '%' ? MOD : CONST;
      if (op == CONST) return true;
      next();
      if (!unary()) return false;
      if (op == MUL && clockPair(k0)) continue;
      emit(op, 0, -1);
    }
  }
  bool clockPair(size_t k0) {
    if (prog.ops.size() != k0 + 2 || prog.ops[k0] != LOAD || prog.ops[k0 + 1] != LOAD) return false;
    const int a = (int)prog.args[k0], b = (int)prog.args[k0 + 1], ps = a == T ? b : b == T ? a : -1;
    const Param* q = nullptr;
    for (auto& x : prog.params) if (ps > 0 && x.type == PNum && x.slot == ps) q = &x;
    if (!q) return false;
    const String name = "t*" + q->name;
    const bool fresh = find(name) < 0;
    const int cs = newSlot(name);
    if (fresh) prog.clocks.push_back({(uint16_t)ps, (uint16_t)cs});
    prog.ops.resize(k0);
    prog.args.resize(k0);
    depth -= 2;
    emit(LOAD, cs, 1);
    return true;
  }
  bool unary() {
    if (peek().type == '-') { next(); if (!unary()) return false; emit(NEG); return true; }
    if (peek().type == '!') { next(); if (!unary()) return false; emit(NOT); return true; }
    if (peek().type == '+') { next(); return unary(); }
    return primary();
  }
  bool primary() {
    const Tok tk = next();
    if (tk.type == T_NUM) { emit(CONST, tk.v, 1); return true; }
    if (tk.type == '(') return expr() && expect(')', "')'");
    if (tk.type == T_ID) {
      if (peek().type == '(') {
        next();
        int f = -1;
        for (int k = 0; k < kFuncCount; k++) if (tk.s == kFuncs[k].name) f = k;
        if (f < 0) return error("unknown function '" + tk.s + "'", tk.line);
        int got = 0;
        if (f >= kFirstSpecial) {   // first argument: a parameter of that kind, passed as its slot number
          const uint8_t kind = kSpecialKind[f - kFirstSpecial];
          const Param* q = peek().type == T_ID ? paramNamed(peek().s) : nullptr;
          if (!q || q->type != kind)
            return error(tk.s + "() needs a " + kKindWord[kind] + " parameter first, like " + tk.s + "(" + kKindExample[kind] + ")", tk.line);
          next();
          emit(CONST, q->slot, 1);
          got++;
          if (peek().type != ')' && !expect(',', "','")) return false;
        }
        if (peek().type != ')') {
          for (;;) {
            int d0 = depth;
            if (!expr()) return false;
            if (depth - d0 != 1) return error("a colour can't be an argument of " + tk.s + "()", tk.line);
            got++;
            if (peek().type != ',') break;
            next();
          }
        }
        if (!expect(')', "')'")) return false;
        if (got != kFuncs[f].args)
          return error(tk.s + "() takes " + String(kFuncs[f].args) + " argument" + (kFuncs[f].args > 1 ? "s" : "") + ", not " + String(got), tk.line);
        emit(CALL, f, kFuncs[f].rets - kFuncs[f].args);
        return true;
      }
      const Param* q = paramNamed(tk.s);
      if (q && q->type == PColor) return error("'" + tk.s + "' is a colour: use " + tk.s + ".r, " + tk.s + ".g or " + tk.s + ".b, or r, g, b = " + tk.s, tk.line);
      if (q && q->type == PGrad) return error("'" + tk.s + "' is a colour list: use r, g, b = grad(" + tk.s + ", k)", tk.line);
      if (q && q->type == PText) return error("'" + tk.s + "' is a text: use txt(" + tk.s + ", px, py) or " + tk.s + ".w", tk.line);
      if (q && q->type == PImage)
        return error("'" + tk.s + "' is a picture: use img(" + tk.s + ", x, y, frame), " + tk.s + ".w, " + tk.s + ".h or " + tk.s + ".frames", tk.line);
      int s = find(tk.s);
      if (s < 0 || !assigned[s]) return error("unknown name '" + tk.s + "'", tk.line);
      emit(LOAD, s, 1);
      return true;
    }
    return error(tk.type == ';' || tk.type == T_EOF ? "line ends too early" : "unexpected token", tk.line);
  }
};

// What runs per fixture per frame is built for speed, not size (the firmware is -Os); the compiler part isn't.
#define KD_FAST __attribute__((optimize("O2")))

inline __attribute__((always_inline)) double fract(double x) { return x - floor(x); }
// Same integer hash as fx.js, so the controller and the browser preview agree.
KD_FAST double rnd(double x) {
  // The low 32 bits of the whole number (JS: | 0). Within int32 range one instruction does
  // it; the 64-bit conversion is a library call (~4x slower), only needed beyond that.
  double v = floor(x * 4096.0);
  uint32_t h = (v >= -2147483648.0 && v < 2147483648.0) ? (uint32_t)(int32_t)v : (uint32_t)(int64_t)v;
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h ^= h >> 16;
  return (h >> 8) / 16777216.0;
}
KD_FAST double noise(double x) {
  double i = floor(x), f = x - i, k = f * f * (3 - 2 * f);
  double a = rnd(i / 4096.0), b = rnd((i + 1) / 4096.0);
  return a + (b - a) * k;
}
inline __attribute__((always_inline)) double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }

// Letters for txt(): 5 x 7 pixels, ASCII 32..126, one byte per column (bit 0 = top row). The
// same bytes are FONT in fx.js. Other characters show as '?'.
const uint8_t kFont[95 * 5] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5f, 0x00, 0x00, 0x00, 0x07, 0x00, 0x07, 0x00, 0x14, 0x7f, 0x14, 0x7f, 0x14,
    0x24, 0x2a, 0x7f, 0x2a, 0x12, 0x23, 0x13, 0x08, 0x64, 0x62, 0x36, 0x49, 0x55, 0x22, 0x50, 0x00, 0x05, 0x03, 0x00, 0x00,
    0x00, 0x1c, 0x22, 0x41, 0x00, 0x00, 0x41, 0x22, 0x1c, 0x00, 0x14, 0x08, 0x3e, 0x08, 0x14, 0x08, 0x08, 0x3e, 0x08, 0x08,
    0x00, 0x50, 0x30, 0x00, 0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x60, 0x60, 0x00, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02,
    0x3e, 0x51, 0x49, 0x45, 0x3e, 0x00, 0x42, 0x7f, 0x40, 0x00, 0x42, 0x61, 0x51, 0x49, 0x46, 0x21, 0x41, 0x45, 0x4b, 0x31,
    0x18, 0x14, 0x12, 0x7f, 0x10, 0x27, 0x45, 0x45, 0x45, 0x39, 0x3c, 0x4a, 0x49, 0x49, 0x30, 0x01, 0x71, 0x09, 0x05, 0x03,
    0x36, 0x49, 0x49, 0x49, 0x36, 0x06, 0x49, 0x49, 0x29, 0x1e, 0x00, 0x36, 0x36, 0x00, 0x00, 0x00, 0x56, 0x36, 0x00, 0x00,
    0x08, 0x14, 0x22, 0x41, 0x00, 0x14, 0x14, 0x14, 0x14, 0x14, 0x00, 0x41, 0x22, 0x14, 0x08, 0x02, 0x01, 0x51, 0x09, 0x06,
    0x32, 0x49, 0x79, 0x41, 0x3e, 0x7e, 0x11, 0x11, 0x11, 0x7e, 0x7f, 0x49, 0x49, 0x49, 0x36, 0x3e, 0x41, 0x41, 0x41, 0x22,
    0x7f, 0x41, 0x41, 0x22, 0x1c, 0x7f, 0x49, 0x49, 0x49, 0x41, 0x7f, 0x09, 0x09, 0x09, 0x01, 0x3e, 0x41, 0x49, 0x49, 0x7a,
    0x7f, 0x08, 0x08, 0x08, 0x7f, 0x00, 0x41, 0x7f, 0x41, 0x00, 0x20, 0x40, 0x41, 0x3f, 0x01, 0x7f, 0x08, 0x14, 0x22, 0x41,
    0x7f, 0x40, 0x40, 0x40, 0x40, 0x7f, 0x02, 0x0c, 0x02, 0x7f, 0x7f, 0x04, 0x08, 0x10, 0x7f, 0x3e, 0x41, 0x41, 0x41, 0x3e,
    0x7f, 0x09, 0x09, 0x09, 0x06, 0x3e, 0x41, 0x51, 0x21, 0x5e, 0x7f, 0x09, 0x19, 0x29, 0x46, 0x46, 0x49, 0x49, 0x49, 0x31,
    0x01, 0x01, 0x7f, 0x01, 0x01, 0x3f, 0x40, 0x40, 0x40, 0x3f, 0x1f, 0x20, 0x40, 0x20, 0x1f, 0x3f, 0x40, 0x38, 0x40, 0x3f,
    0x63, 0x14, 0x08, 0x14, 0x63, 0x07, 0x08, 0x70, 0x08, 0x07, 0x61, 0x51, 0x49, 0x45, 0x43, 0x00, 0x7f, 0x41, 0x41, 0x00,
    0x02, 0x04, 0x08, 0x10, 0x20, 0x00, 0x41, 0x41, 0x7f, 0x00, 0x04, 0x02, 0x01, 0x02, 0x04, 0x40, 0x40, 0x40, 0x40, 0x40,
    0x00, 0x01, 0x02, 0x04, 0x00, 0x20, 0x54, 0x54, 0x54, 0x78, 0x7f, 0x48, 0x44, 0x44, 0x38, 0x38, 0x44, 0x44, 0x44, 0x20,
    0x38, 0x44, 0x44, 0x48, 0x7f, 0x38, 0x54, 0x54, 0x54, 0x18, 0x08, 0x7e, 0x09, 0x01, 0x02, 0x0c, 0x52, 0x52, 0x52, 0x3e,
    0x7f, 0x08, 0x04, 0x04, 0x78, 0x00, 0x44, 0x7d, 0x40, 0x00, 0x20, 0x40, 0x44, 0x3d, 0x00, 0x7f, 0x10, 0x28, 0x44, 0x00,
    0x00, 0x41, 0x7f, 0x40, 0x00, 0x7c, 0x04, 0x18, 0x04, 0x78, 0x7c, 0x08, 0x04, 0x04, 0x78, 0x38, 0x44, 0x44, 0x44, 0x38,
    0x7c, 0x14, 0x14, 0x14, 0x08, 0x08, 0x14, 0x14, 0x18, 0x7c, 0x7c, 0x08, 0x04, 0x04, 0x08, 0x48, 0x54, 0x54, 0x54, 0x20,
    0x04, 0x3f, 0x44, 0x40, 0x20, 0x3c, 0x40, 0x40, 0x20, 0x7c, 0x1c, 0x20, 0x40, 0x20, 0x1c, 0x3c, 0x40, 0x30, 0x40, 0x3c,
    0x44, 0x28, 0x10, 0x28, 0x44, 0x0c, 0x50, 0x50, 0x50, 0x3c, 0x44, 0x64, 0x54, 0x4c, 0x44, 0x00, 0x08, 0x36, 0x41, 0x00,
    0x00, 0x00, 0x7f, 0x00, 0x00, 0x00, 0x41, 0x36, 0x08, 0x00, 0x08, 0x04, 0x08, 0x10, 0x08,
};

// ---- What runs on the controller (the bytecode itself is fx.js's) -------------------------
// An effect runs for every fixture every frame (1360 fixtures x 40 fps in the stress test), so
// compile() rearranges the bytecode, without changing a single result:
// 1. Work that is the same for every fixture moves to a part that runs once per frame:
//    statements like "a = angle / 360 * tau" (a name set once, only from t, n, parameters or
//    such names), and pieces like "t * speed" or "cos(a)" inside a per-fixture expression
//    (worked out into a temporary slot the fixture part then reads).
// 2. A number or a name right before an operator becomes part of that instruction.
// Same operations on the same values in the same order: bit-for-bit the same output.
struct Val { int start, end; bool uni; };   // a value on the stack: made by ops [start, end)
struct Cut { int start, end, n, tmp; };   // ops [start, end) go to the frame part; n values -> tmp (n 0: a whole statement)

bool isBinary(uint8_t op) { return (op >= ADD && op <= MOD) || (op >= LT && op <= OR); }
const int kEnd = 60;   // dispatch number of the end marker; others are op * 3 + mode

void emitIns(BigRam::Vec<Ins>& out, uint8_t op, double a) {
  if (isBinary(op) && !out.empty() && out.back().mode == 0 && (out.back().op == CONST * 3 || out.back().op == LOAD * 3)) {
    Ins& prev = out.back();   // its value is the right-hand operand: fold it in
    prev.mode = prev.op == CONST * 3 ? 1 : 2;
    prev.op = op * 3 + prev.mode;
    return;
  }
  Ins x = {(uint8_t)(op * 3), 0, 0, 0, (uint16_t)(op == LOAD || op == STORE ? (int)a : 0), a};
  if (op == CALL) { x.fn = (uint8_t)(int)a; x.na = kFuncs[x.fn].args; }
  out.push_back(x);
}

void prepare(Program& p) {
  const int nOps = p.ops.size();
  std::vector<uint8_t> uni(p.slots, 0), stores(p.slots, 0);
  uni[T] = uni[N] = uni[PI_] = uni[TAU] = 1;
  for (auto& q : p.params)
    for (int k = 0; k < q.width(); k++) uni[q.slot + k] = 1;
  for (auto& c : p.clocks) uni[c.slot] = 1;   // filled in per frame (frameInputs)
  for (int k = 0; k < nOps; k++)
    if (p.ops[k] == STORE && stores[(int)p.args[k]] < 2) stores[(int)p.args[k]]++;
  std::vector<Val> st;
  std::vector<Cut> cuts;
  int slots = p.slots;
  // A value that is the same for every fixture, used by something that is not: worked out
  // per frame (unless it is a lone number or name: nothing to save).
  auto hoist = [&](const Val& v, int n) {
    if (!v.uni || v.end - v.start < 2) return;
    cuts.push_back({v.start, v.end, n, slots});
    slots += n;
  };
  auto pop = [&]() { Val v = st.back(); st.pop_back(); return v; };
  for (int k = 0; k < nOps; k++) {
    const uint8_t op = p.ops[k];
    const int a = (int)p.args[k];
    if (op == CONST) st.push_back({k, k + 1, true});
    else if (op == LOAD) st.push_back({k, k + 1, uni[a] != 0});
    else if (op == NEG || op == NOT) st.back().end = k + 1;   // same kind of value
    else if (op == STORE) {
      Val v = pop();
      // A name set once, from frame values only: the whole statement runs per frame.
      if (v.uni && a >= FIRST_FREE && stores[a] == 1) { cuts.push_back({v.start, k + 1, 0, -1}); uni[a] = 1; }
      else hoist(v, 1);
    } else if (op == SEL) {
      Val z = pop(), y = pop(), x = pop();
      bool all = x.uni && y.uni && z.uni;
      if (!all) { hoist(x, 1); hoist(y, 1); hoist(z, 1); }
      st.push_back({x.start, k + 1, all});
    } else if (op == CALL) {
      const int na = kFuncs[a].args, nr = kFuncs[a].rets;
      Val v[4];   // most arguments: img()
      for (int j = na - 1; j >= 0; j--) v[j] = pop();
      bool all = true;
      for (int j = 0; j < na; j++) all = all && v[j].uni;
      if (nr == 1) {
        if (!all) for (int j = 0; j < na; j++) hoist(v[j], 1);
        st.push_back({v[0].start, k + 1, all});
      } else {
        // hsv(): three values. Taken per frame only in the plain "r, g, b = hsv(...)" form;
        // otherwise its arguments can still be. The three are never treated as frame values.
        bool plain = k + 3 < nOps && p.ops[k + 1] == STORE && p.ops[k + 2] == STORE && p.ops[k + 3] == STORE;
        if (all && plain) hoist({v[0].start, k + 1, true}, nr);
        else if (!all) for (int j = 0; j < na; j++) hoist(v[j], 1);
        for (int j = 0; j < nr; j++) st.push_back({k, k + 1, false});
      }
    } else {   // binary
      Val y = pop(), x = pop();
      if (x.uni != y.uni) { hoist(x, 1); hoist(y, 1); }
      st.push_back({x.start, k + 1, x.uni && y.uni});
    }
  }
  std::sort(cuts.begin(), cuts.end(), [](const Cut& x, const Cut& y) { return x.start < y.start; });
  p.frame.clear();
  p.body.clear();
  size_t c = 0;
  for (int k = 0; k < nOps;) {
    if (c < cuts.size() && cuts[c].start == k) {
      const Cut& x = cuts[c++];
      for (int j = x.start; j < x.end; j++) emitIns(p.frame, p.ops[j], p.args[j]);
      for (int j = x.n - 1; j >= 0; j--) emitIns(p.frame, STORE, x.tmp + j);
      for (int j = 0; j < x.n; j++) emitIns(p.body, LOAD, x.tmp + j);
      k = x.end;
      continue;
    }
    emitIns(p.body, p.ops[k], p.args[k]);
    k++;
  }
  Ins end = {kEnd, 0, 0, 0, 0, 0};
  p.frame.push_back(end);
  p.body.push_back(end);
  p.slots = slots;
}

}  // namespace

bool compile(const char* src, Program& out, String& err) {
  out = Program();
  std::vector<Tok> toks;
  Fail f;
  if (!tokenize(src, toks, f)) { err = "line " + String(f.line) + ": " + f.msg; return false; }
  Compiler c(toks, out);
  if (!c.program(f)) { err = (f.line ? "line " + String(f.line) + ": " : String()) + f.msg; return false; }
  prepare(out);
  return true;
}

namespace {
int hexVal(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
// "#rrggbb" (exactly) -> r g b 0..1; false when it isn't one.
bool hexColor(const char* v, size_t len, double* rgb) {
  if (len != 7 || v[0] != '#') return false;
  int d[6];
  for (int k = 0; k < 6; k++) if ((d[k] = hexVal(v[1 + k])) < 0) return false;
  for (int k = 0; k < 3; k++) rgb[k] = (d[k * 2] * 16 + d[k * 2 + 1]) / 255.0;
  return true;
}
// Base64 as the browser's atob() takes it (padding optional) -> bytes appended to out.
bool unbase64(const char* in, BigRam::Vec<uint8_t>& out) {
  uint32_t acc = 0;
  int bits = 0, pad = 0;
  size_t len = strlen(in);
  while (len && in[len - 1] == '=' && pad < 2) { len--; pad++; }
  if (len % 4 == 1) return false;
  for (size_t k = 0; k < len; k++) {
    char c = in[k];
    int v = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '+' ? 62 : c == '/' ? 63 : -1;
    if (v < 0) return false;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push_back((acc >> bits) & 0xff); }
  }
  return true;
}
// Whole number from digits at *p (moves p on); -1 when there are none or too many.
long digits(const char*& p) {
  long v = 0;
  int n = 0;
  while (isdigit((unsigned char)*p) && n < 9) { v = v * 10 + (*p++ - '0'); n++; }
  return n && !isdigit((unsigned char)*p) ? v : -1;
}
}  // namespace

namespace {
// Colours (r g b place, place NAN = none) -> a colour list's slots: no place = spread evenly by
// the colour's number (k / (n - 1)), then sorted by place, keeping the list order on equal places
// (= fillStops in fx.js).
void fillStops(const double* in, int n, double* s) {
  double st[kMaxStops * 4];
  for (int k = 0; k < n * 4; k++) st[k] = in[k];
  for (int k = 0; k < n; k++)
    if (isnan(st[k * 4 + 3])) st[k * 4 + 3] = n > 1 ? (double)k / (n - 1) : 0;
  for (int i = 1; i < n; i++) {   // insertion sort: stable
    double x[4];
    memcpy(x, st + i * 4, sizeof(x));
    int j = i - 1;
    while (j >= 0 && st[j * 4 + 3] > x[3]) { memcpy(st + (j + 1) * 4, st + j * 4, sizeof(x)); j--; }
    memcpy(st + (j + 1) * 4, x, sizeof(x));
  }
  s[0] = n;
  for (int k = 0; k < n * 4; k++) s[1 + k] = st[k];
}
}  // namespace

void setParam(const Param& p, const char* v, double* s, BigRam::Vec<uint8_t>& data) {
  if (p.type == PColor) {
    hexColor(v, strlen(v), s + p.slot);
  } else if (p.type == PGrad) {
    // "#rrggbb,#rrggbb 0.9,...": 1 to kMaxStops colours, each with an optional place 0..1 (digits
    // with an optional decimal part, after a space), spaces around them allowed; else the default stays.
    double st[kMaxStops * 4];
    int cnt = 0;
    for (const char* q = v;;) {
      while (*q == ' ') q++;
      const char* e = q;
      while (*e && *e != ',') e++;
      const char* t = e;
      while (t > q && t[-1] == ' ') t--;
      if (cnt >= kMaxStops || t - q < 7 || !hexColor(q, 7, st + cnt * 4)) return;
      double at = NAN;
      const char* r = q + 7;
      if (r < t) {
        if (*r != ' ') return;
        while (*r == ' ') r++;
        const char* n0 = r;
        int before = 0, after = 0;
        while (r < t && isdigit((unsigned char)*r)) { r++; before++; }
        if (r < t && *r == '.') { r++; while (r < t && isdigit((unsigned char)*r)) { r++; after++; } if (!after) return; }
        if (r != t || (!before && !after)) return;
        at = strtod(n0, nullptr);
        if (at > 1) return;
      }
      st[cnt * 4 + 3] = at;
      cnt++;
      if (!*e) break;
      q = e + 1;
    }
    fillStops(st, cnt, s + p.slot);
  } else if (p.type == PText) {
    const size_t len = std::min(strlen(v), (size_t)kMaxText);
    s[p.slot] = data.size() + 1;
    s[p.slot + 1] = len * 6.0;
    for (size_t k = 0; k < len; k++) data.push_back((uint8_t)v[k]);
  } else if (p.type == PImage) {
    // "img:<w>x<h>x<frames>:<base64 of r g b bytes>"; anything else = no picture.
    for (int k = 0; k < 4; k++) s[p.slot + k] = 0;
    if (strncmp(v, "img:", 4)) return;
    const char* q = v + 4;
    const long w = digits(q);
    if (*q++ != 'x') return;
    const long h = digits(q);
    if (*q++ != 'x') return;
    const long f = digits(q);
    if (*q++ != ':' || w < 1 || h < 1 || f < 1 || w * h * f > kMaxImage) return;
    const size_t at = data.size();
    if (!unbase64(q, data) || data.size() - at != (size_t)(w * h * f * 3)) { data.resize(at); return; }
    s[p.slot] = at + 1;
    s[p.slot + 1] = w;
    s[p.slot + 2] = h;
    s[p.slot + 3] = f;
  } else {
    s[p.slot] = atof(v);
  }
}

void init(const Program& prog, double* s) {
  for (int k = 0; k < prog.slots; k++) s[k] = 0;
  s[PI_] = M_PI;
  s[TAU] = 2 * M_PI;
  s[W] = -1;
  s[DIM] = 1;
  for (const auto& q : prog.params) {
    if (q.type == PGrad) {
      fillStops(q.grad, q.stops, s + q.slot);
    } else if (q.type == PText) {
      s[q.slot] = q.defAt + 1;
      s[q.slot + 1] = q.def[0] * 6;
    } else if (q.type != PImage) {
      for (int k = 0; k < q.width(); k++) s[q.slot + k] = q.def[k];
    }
  }
}

// grad / txt / img: the same steps as special() in fx.js.
KD_FAST int special(int fn, double* v, const double* s, const uint8_t* data) {
  const int at = (int)v[0];
  if (fn == 27) {   // grad(list, k): straight blends between the colours at their places
    const int cnt = (int)s[at];
    double k = v[1];
    if (!(k > 0)) k = 0;
    if (k > 1) k = 1;
    if (cnt < 1) {
      v[0] = v[1] = v[2] = 0;
      return 3;
    }
    const double* first = s + at + 1;
    const double* last = s + at + 1 + (cnt - 1) * 4;
    if (cnt < 2 || k <= first[3]) { for (int e = 0; e < 3; e++) v[e] = first[e]; return 3; }
    if (k >= last[3]) { for (int e = 0; e < 3; e++) v[e] = last[e]; return 3; }
    int j = 0;
    while (j < cnt - 2 && k >= s[at + 1 + (j + 1) * 4 + 3]) j++;
    const double* c = s + at + 1 + j * 4;
    const double span = c[7] - c[3], q = span > 0 ? (k - c[3]) / span : 1;
    for (int e = 0; e < 3; e++) v[e] = c[e] + (c[e + 4] - c[e]) * q;
    return 3;
  }
  if (fn == 28) {   // txt(text, px, py)
    const double px = v[1], py = v[2];
    v[0] = 0;
    if (!s[at] || !(px >= 0 && py >= 0 && py < 7 && px < s[at + 1])) return 1;
    const int X = (int)floor(px), ci = X / 6, col = X - ci * 6;
    if (col >= 5) return 1;
    int ch = data[(int)s[at] - 1 + ci];
    if (ch < 32 || ch > 126) ch = 63;
    v[0] = (kFont[(ch - 32) * 5 + col] >> (int)floor(py)) & 1;
    return 1;
  }
  // img(picture, x, y, frame): the nearest pixel, black outside 0..1
  const double x = v[1], y = v[2], f3 = v[3];
  v[0] = v[1] = v[2] = 0;
  if (!s[at] || !(x >= 0 && x < 1 && y >= 0 && y < 1)) return 3;
  const double w = s[at + 1], h = s[at + 2], frames = s[at + 3];
  double fr = floor(isfinite(f3) ? f3 : 0);
  fr = fr - frames * floor(fr / frames);
  if (!(fr >= 0 && fr < frames)) fr = 0;
  const uint8_t* px = data + (int)s[at] - 1 + (((int)fr * (int)h + (int)floor(y * h)) * (int)w + (int)floor(x * w)) * 3;
  for (int e = 0; e < 3; e++) v[e] = px[e] / 255.0;
  return 3;
}

// ---- A clip over time: the same steps as laneFor / laneValue / laneArea / frame / carry in fx.js.
double curveExp(double c) { return c ? pow(2.0, -2 * clampd(c, -1, 1)) : 1; }

namespace {
double laneArea(const Lane& l, double tau) {
  const LanePt* p = l.pts.data();
  const int n = l.pts.size();
  if (tau <= p[0].t) return p[0].v * tau;
  const double before = p[0].v * p[0].t;
  if (tau >= p[n - 1].t) return before + l.cum[n - 1] + p[n - 1].v * (tau - p[n - 1].t);
  int j = 0;
  while (tau >= p[j + 1].t) j++;
  const LanePt &a = p[j], &b = p[j + 1];
  const double len = b.t - a.t, x = (tau - a.t) / len;
  return before + l.cum[j] + len * (a.v * x + ((b.v - a.v) * pow(x, a.e + 1)) / (a.e + 1));
}
}  // namespace

bool makeLane(int slot, const double* tvc, int n, double wrap, Lane& out) {
  out = Lane();
  out.slot = slot;
  for (int k = 0; k < n; k++) {
    const double t = tvc[k * 3], v = tvc[k * 3 + 1];
    if (!isfinite(t) || !isfinite(v)) continue;
    out.pts.push_back({std::max(0.0, t) / 1000, v, curveExp(isfinite(tvc[k * 3 + 2]) ? tvc[k * 3 + 2] : 0)});
  }
  if (out.pts.empty()) return false;
  std::stable_sort(out.pts.begin(), out.pts.end(), [](const LanePt& a, const LanePt& b) { return a.t < b.t; });
  out.cum.push_back(0);
  for (size_t j = 0; j + 1 < out.pts.size(); j++) {
    const LanePt &a = out.pts[j], &b = out.pts[j + 1];
    out.cum.push_back(out.cum[j] + (b.t - a.t) * (a.v + (b.v - a.v) / (a.e + 1)));
  }
  if (wrap > 0) out.per = laneArea(out, wrap);
  return true;
}

double laneValue(const Lane& l, double tau) {
  const LanePt* p = l.pts.data();
  const int n = l.pts.size();
  if (tau <= p[0].t) return p[0].v;
  if (tau >= p[n - 1].t) return p[n - 1].v;
  int j = 0;
  while (tau >= p[j + 1].t) j++;
  const LanePt &a = p[j], &b = p[j + 1];
  const double x = (tau - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * (a.e == 1 ? x : pow(x, a.e));
}

double laneIntegral(const Lane& l, double tau, double wrap) {
  if (!(wrap > 0)) return laneArea(l, tau);
  const double q = floor(tau / wrap);
  return q * l.per + laneArea(l, tau - q * wrap);
}

void frameInputs(const Program& p, const double* base, const BigRam::Vec<Lane>& lanes, double wrap, const Live& lv, double t, double* s) {
  s[T] = t;
  const double tw = wrap > 0 ? t - wrap * floor(t / wrap) : t;
  for (const auto& l : lanes) s[l.slot] = laneValue(l, tw);
  double k = -1;
  if (lv.gT0 >= 0) {
    k = clampd((t - lv.gT0) / kGlide, 0, 1);
    const double w = (1 - k) * (1 - k);
    for (const auto& g : lv.gOff) s[g.slot] += g.off * w;
  }
  for (size_t j = 0; j < p.clocks.size(); j++) {
    const Clock& c = p.clocks[j];
    const Lane* l = nullptr;
    for (const auto& x : lanes) if (x.slot == c.param) l = &x;
    double v = l ? laneIntegral(*l, t, wrap) : t * base[c.param];
    if (j < lv.cOff.size() && lv.cOff[j]) v += lv.cOff[j];
    if (k >= 0 && j < lv.cG.size() && lv.cG[j]) v += (lv.cG[j] * kGlide * (1 - (1 - k) * (1 - k) * (1 - k))) / 3;
    s[c.slot] = v;
  }
}

void carry(const Program& p, const double* oldBase, const double* newBase, const double* so, const double* sn, double tNew, Live& lv) {
  lv = Live();
  auto add = [&](int slot) {
    const double d = so[slot] - sn[slot];
    if (d && isfinite(d)) lv.gOff.push_back({(uint16_t)slot, d});
  };
  // Which slots glide (= glideSlots in fx.js): numbers, colours, a colour list's colours while it has as many.
  for (const auto& q : p.params) {
    if (q.type == PNum) add(q.slot);
    else if (q.type == PColor) for (int k = 0; k < 3; k++) add(q.slot + k);
    else if (q.type == PGrad && oldBase[q.slot] == newBase[q.slot])
      for (int k = 1; k <= (int)oldBase[q.slot] * 4; k++) add(q.slot + k);
  }
  if (!lv.gOff.empty()) lv.gT0 = tNew;
  for (const auto& c : p.clocks) {
    const double d = so[c.slot] - sn[c.slot];
    lv.cOff.push_back(isfinite(d) ? d : 0);
    double g = 0;
    for (const auto& x : lv.gOff) if (x.slot == c.param) { g = x.off; break; }
    lv.cG.push_back(g);
  }
}

void place(const Mods& m, int& i, int& n, double& x, double& y) {
  if (m.flip & 1) { x = 1 - x; i = n - 1 - i; }
  if (m.flip & 2) y = 1 - y;
  if (m.repeat > 1) {
    const int k = m.repeat;
    const double seg = std::min(floor(x * k), (double)(k - 1));
    const int per = (n + k - 1) / k;
    x = x * k - seg;
    i %= per;
    n = per;
  }
  if (m.mirror & 1) {
    const int h = (n + 1) / 2;
    x = 1 - fabs(2 * x - 1);
    i = i < h ? i : n - 1 - i;
    n = h;
  }
  if (m.mirror & 2) y = 1 - fabs(2 * y - 1);
  if (m.kaleido >= 2) {
    const double dx = x - 0.5, dy = y - 0.5, r = sqrt(dx * dx + dy * dy), seg = (2 * M_PI) / m.kaleido;
    double a = atan2(dy, dx);
    a -= seg * floor(a / seg);
    if (a > seg / 2) a = seg - a;
    x = 0.5 + r * cos(a);
    y = 0.5 + r * sin(a);
  }
}

void invert(double* s) {
  auto cl = [](double v) { return v < 0 ? 0.0 : v > 1 ? 1.0 : v; };
  const double d = cl(s[DIM]);
  for (int k = R; k <= B; k++) s[k] = 1 - cl(s[k]) * d;
  if (s[W] >= 0) s[W] = 1 - cl(s[W]) * d;
  s[DIM] = 1;
}

namespace {
// Runs one instruction list (fx.js run(), with the top of the stack kept in `top`). Each
// instruction jumps straight to the next one's code (GCC's labels as values): no switch.
KD_FAST void exec(const Ins* ip, double* s, const uint8_t* data) {
  double st[72], top = 0;
  int sp = 0;   // st[0] takes the empty stack's dummy top
#define K3(name) &&name##0, &&name##1, &&name##2
#define K1(name) &&name, &&bad, &&bad
  static const void* const L[kEnd + 1] = {
      K1(CONST_), K1(LOAD_), K1(STORE_), K3(ADD_), K3(SUB_), K3(MUL_), K3(DIV_), K3(MOD_), K1(NEG_), K1(NOT_),
      K3(LT_), K3(GT_), K3(LE_), K3(GE_), K3(EQ_), K3(NE_), K3(AND_), K3(OR_), K1(SEL_), K1(CALL_), &&END_};
#undef K3
#undef K1
#define NEXT goto* L[(++ip)->op]
// y = the right-hand operand: below the top (mode 0), the folded number (1) or slot (2).
#define BINOP(name, expr)                                               \
  name##0 : { double y = top, x = st[--sp]; top = (expr); NEXT; }       \
  name##1 : { double y = ip->a, x = top; top = (expr); NEXT; }          \
  name##2 : { double y = s[ip->slot], x = top; top = (expr); NEXT; }
  goto* L[ip->op];
CONST_: st[sp++] = top; top = ip->a; NEXT;
LOAD_: st[sp++] = top; top = s[ip->slot]; NEXT;
STORE_: s[ip->slot] = top; top = st[--sp]; NEXT;
NEG_: top = -top; NEXT;
NOT_: top = top ? 0 : 1; NEXT;
SEL_: { double z = top, y = st[--sp], x = st[--sp]; top = x ? y : z; NEXT; }
  BINOP(ADD_, x + y)
  BINOP(SUB_, x - y)
  BINOP(MUL_, x * y)
  BINOP(DIV_, y ? x / y : 0)
  BINOP(MOD_, y ? x - y * floor(x / y) : 0)
  BINOP(LT_, x < y)
  BINOP(GT_, x > y)
  BINOP(LE_, x <= y)
  BINOP(GE_, x >= y)
  BINOP(EQ_, x == y)
  BINOP(NE_, x != y)
  BINOP(AND_, x && y)
  BINOP(OR_, x || y)
#undef BINOP
CALL_: {
    st[sp++] = top;
    double* v = &st[sp - ip->na];
    double r = 0;
    switch (ip->fn) {
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
      case 26: {   // hsv -> r, g, b in place of the 3 arguments
        double h = fract(v[0]) * 6, sat = clampd(v[1], 0, 1), val = v[2];
        int i = (int)floor(h) % 6;
        double f2 = h - floor(h), p = val * (1 - sat), q = val * (1 - sat * f2), t = val * (1 - sat * (1 - f2));
        const double rgb[6][3] = {{val, t, p}, {q, val, p}, {p, val, t}, {p, q, val}, {t, p, val}, {val, p, q}};
        v[0] = rgb[i][0];
        v[1] = rgb[i][1];
        v[2] = rgb[i][2];
        top = st[--sp];
        NEXT;
      }
      case 27:
      case 29:   // grad / img: 3 results in place of the arguments
        special(ip->fn, v, s, data);
        sp += 3 - ip->na;
        top = st[--sp];
        NEXT;
      case 28: special(ip->fn, v, s, data); r = v[0]; break;
    }
    if (!isfinite(r)) r = 0;
    sp -= ip->na;
    top = r;
    NEXT;
  }
#undef NEXT
bad:
END_:
  return;
}
}  // namespace

void runFrame(const Program& prog, double* s, const uint8_t* data) { exec(prog.frame.data(), s, data); }
void run(const Program& prog, double* s, const uint8_t* data) { exec(prog.body.data(), s, data); }

}  // namespace Fx

