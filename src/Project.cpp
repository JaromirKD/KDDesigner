#include "Project.h"
#include "Board.h"
#include "Clock.h"
#include "Drivers.h"
#include "Globals.h"
#include "Io.h"
#include "Mail.h"
#include "Monitor.h"
#include "Pcs.h"
#include "Projectors.h"
#include "State.h"
#include "Triggers.h"

namespace Project {

void loadModules() {
  State::load();
  Globals::load();
  Clock::load();
  Io::load();
  Pcs::load();
  Monitor::load();
  Mail::load();
  Projectors::load();
  Drivers::load();
  Board::load();       // before triggers: they look up points by name
  Triggers::load();
  Triggers::begin();   // UDP ports may have changed
}

}  // namespace Project
