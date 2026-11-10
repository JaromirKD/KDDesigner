#include "Project.h"
#include "Board.h"
#include "Clock.h"
#include "Drivers.h"
#include "Globals.h"
#include "Io.h"
#include "Log.h"
#include "Mail.h"
#include "Monitor.h"
#include "Pcs.h"
#include "Projectors.h"
#include "State.h"
#include "Triggers.h"

namespace Project {

namespace {
struct Part { const char* name; uint32_t ms; };
Part parts[24];
int nParts = 0;
uint32_t markAt = 0;
}  // namespace

void timeStart() { nParts = 0; markAt = millis(); }

void timePart(const char* name) {
  uint32_t now = millis();
  if (nParts < (int)(sizeof(parts) / sizeof(parts[0]))) parts[nParts++] = {name, now - markAt};
  markAt = now;
}

String timeText() {
  String s;
  uint32_t small = 0;
  for (int i = 0; i < nParts; i++) {
    if (parts[i].ms < 5) { small += parts[i].ms; continue; }
    if (s.length()) s += ", ";
    s += String(parts[i].name) + " " + parts[i].ms;
  }
  if (small) s += String(s.length() ? ", " : "") + "rest " + small;
  return s;
}

// Each step leaves a breadcrumb (Log::crumb): after a hang during a save, the log says which.
#define STEP(name, call) do { Log::crumb(Log::kCrumbLoad, #call); call; timePart(name); } while (0)

void loadModules() {
  STEP("modes", State::load());
  STEP("variables", Globals::load());
  STEP("clock", Clock::load());
  STEP("tcp", Io::load());
  STEP("pcs", Pcs::load());
  STEP("monitor", Monitor::load());
  STEP("mail", Mail::load());
  STEP("projectors", Projectors::load());
  STEP("devices", Drivers::load());
  STEP("board", Board::load());       // before triggers: they look up points by name
  STEP("triggers", Triggers::load());
  STEP("ports", Triggers::begin());   // UDP ports may have changed
  Log::crumb(Log::kCrumbLoad, "done");
}

}  // namespace Project
