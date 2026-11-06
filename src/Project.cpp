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

// Each step leaves a breadcrumb (Log::crumb): after a hang during a save, the log says which.
#define STEP(call) do { Log::crumb(Log::kCrumbLoad, #call); call; } while (0)

void loadModules() {
  STEP(State::load());
  STEP(Globals::load());
  STEP(Clock::load());
  STEP(Io::load());
  STEP(Pcs::load());
  STEP(Monitor::load());
  STEP(Mail::load());
  STEP(Projectors::load());
  STEP(Drivers::load());
  STEP(Board::load());       // before triggers: they look up points by name
  STEP(Triggers::load());
  STEP(Triggers::begin());   // UDP ports may have changed
  Log::crumb(Log::kCrumbLoad, "done");
}

}  // namespace Project
