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
                       {"saw", 1, 1}, {"sq", 1, 1}, {"pulse", 2, 1}, {"hsv", 3, 3}};
constexpr int kFuncCount = sizeof(kFuncs) / sizeof(kFuncs[0]);
enum Op : uint8_t { CONST, LOAD, STORE, ADD, SUB, MUL, DIV, MOD, NEG, NOT, LT, GT, LE, GE, EQ, NE, AND, OR, SEL, CALL };

// Token types: single characters as themselves, plus these.
enum : int { T_NUM = 256, T_ID, T_COLOR, T_LE, T_GE, T_EQ, T_NE, T_AND, T_OR, T_EOF };
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
        if (name.indexOf('.') >= 0 || find(name) >= 0) return error("'" + name + "' can't be used as a parameter name", tk.line);
        if (!expect('=', "'='")) return false;
        Param q;
        q.name = name;
        if (peek().type == T_COLOR) {
          String hex = next().s;
          q.color = true;
          long v = strtol(hex.c_str() + 1, nullptr, 16);
          q.def[0] = ((v >> 16) & 0xff) / 255.0;
          q.def[1] = ((v >> 8) & 0xff) / 255.0;
          q.def[2] = (v & 0xff) / 255.0;
          q.slot = newSlot(name + ".r");
          newSlot(name + ".g");
          newSlot(name + ".b");
          assigned[q.slot] = assigned[q.slot + 1] = assigned[q.slot + 2] = true;
        } else {
          q.color = false;
          if (!number(q.def[0], "a number or #rrggbb")) return false;
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
        if (col && col->color && (peek(1).type == ';' || peek(1).type == T_EOF)) {
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
  bool mulExpr() { return bin(&Compiler::unary, {{'*', MUL}, {'/', DIV}, {'%', MOD}}); }
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
      if (q && q->color) return error("'" + tk.s + "' is a colour: use " + tk.s + ".r, .g or .b, or r, g, b = " + tk.s, tk.line);
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
    for (int k = 0; k < (q.color ? 3 : 1); k++) uni[q.slot + k] = 1;
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
      Val v[3];
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

void setParam(const Param& p, const char* v, double* s) {
  if (p.color) {
    if (v[0] == '#' && strlen(v) == 7) {
      long x = strtol(v + 1, nullptr, 16);
      s[p.slot] = ((x >> 16) & 0xff) / 255.0;
      s[p.slot + 1] = ((x >> 8) & 0xff) / 255.0;
      s[p.slot + 2] = (x & 0xff) / 255.0;
    }
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
  for (const auto& q : prog.params)
    for (int k = 0; k < (q.color ? 3 : 1); k++) s[q.slot + k] = q.def[k];
}

namespace {
// Runs one instruction list (fx.js run(), with the top of the stack kept in `top`). Each
// instruction jumps straight to the next one's code (GCC's labels as values): no switch.
KD_FAST void exec(const Ins* ip, double* s) {
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
#define BIN(name, expr)                                                   \
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
  BIN(ADD_, x + y)
  BIN(SUB_, x - y)
  BIN(MUL_, x * y)
  BIN(DIV_, y ? x / y : 0)
  BIN(MOD_, y ? x - y * floor(x / y) : 0)
  BIN(LT_, x < y)
  BIN(GT_, x > y)
  BIN(LE_, x <= y)
  BIN(GE_, x >= y)
  BIN(EQ_, x == y)
  BIN(NE_, x != y)
  BIN(AND_, x && y)
  BIN(OR_, x || y)
#undef BIN
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

void runFrame(const Program& prog, double* s) { exec(prog.frame.data(), s); }
void run(const Program& prog, double* s) { exec(prog.body.data(), s); }

}  // namespace Fx

