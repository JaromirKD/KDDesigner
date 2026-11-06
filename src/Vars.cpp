#include "Vars.h"
#include <math.h>
#include "Globals.h"
#include "State.h"

void Vars::set(const String& name, const String& value) {
  for (auto& p : kv) if (p.first == name) { p.second = value; return; }
  kv.push_back({name, value});
}

const String* Vars::get(const String& name) const {
  for (auto& p : kv) if (p.first == name) return &p.second;
  return nullptr;
}

namespace {

// Small recursive-descent evaluator over doubles.
struct Expr {
  const char* s;
  const Vars* vars;
  bool ok = true;

  void ws() { while (*s == ' ') s++; }

  double primary() {
    ws();
    if (*s == '(') { s++; double v = sum(); ws(); if (*s == ')') s++; else ok = false; return v; }
    if (*s == '-') { s++; return -primary(); }
    if (isdigit(*s) || *s == '.') { char* end; double v = strtod(s, &end); s = end; return v; }
    if (isalpha(*s) || *s == '_') {
      String name;
      while (isalnum(*s) || *s == '_') name += *s++;
      ws();
      if (*s == '(') {
        s++;
        double a = sum(), b = 0;
        ws();
        if (*s == ',') { s++; b = sum(); ws(); }
        if (*s == ')') s++; else ok = false;
        if (name == "ceil") return ceil(a);
        if (name == "floor") return floor(a);
        if (name == "round") return round(a);
        if (name == "abs") return fabs(a);
        if (name == "min") return a < b ? a : b;
        if (name == "max") return a > b ? a : b;
        ok = false;
        return 0;
      }
      const String* v = vars ? vars->get(name) : nullptr;
      if (v) return v->toDouble();
      String g;  // fall back to a user variable
      if (Globals::get(name, g)) return g.toDouble();
      ok = false;
      return 0;
    }
    ok = false;
    return 0;
  }

  double product() {
    double v = primary();
    for (;;) {
      ws();
      char op = *s;
      if (op != '*' && op != '/' && op != '%') return v;
      s++;
      double r = primary();
      if (op == '*') v *= r;
      else if (r == 0) { ok = false; v = 0; }
      else v = op == '/' ? v / r : fmod(v, r);
    }
  }

  double sum() {
    double v = product();
    for (;;) {
      ws();
      char op = *s;
      if (op != '+' && op != '-') return v;
      s++;
      double r = product();
      v = op == '+' ? v + r : v - r;
    }
  }
};

String formatNumber(double v) {
  if (fabs(v - round(v)) < 1e-9) return String((long)round(v));
  return String(v, 3);
}
}  // namespace

String expandVars(const String& line, const Vars* vars) {
  if (line.indexOf('{') < 0) return line;
  String out;
  size_t i = 0;
  while (i < line.length()) {
    int close = line[i] == '{' ? line.indexOf('}', i) : -1;
    if (close < 0) { out += line[i++]; continue; }
    String body = line.substring(i + 1, close);
    if (body.startsWith("=")) {
      Expr e{body.c_str() + 1, vars};
      double v = e.sum();
      e.ws();
      if (*e.s) e.ok = false;  // trailing garbage
      out += e.ok ? formatNumber(v) : String("{" + body + "}");
    } else if (const String* v = vars ? vars->get(body) : nullptr) {
      out += *v;
    } else if (body.startsWith("mode.") && State::findGroup(body.substring(5)) >= 0) {
      out += State::current(State::findGroup(body.substring(5)));   // {mode.Museum}: the group's state
    } else {
      String g;
      if (Globals::get(body, g)) out += g;  // user variable
      else out += "{" + body + "}";
    }
    i = close + 1;
  }
  return out;
}
