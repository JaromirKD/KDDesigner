// KD Designer - DMX / Art-Net / sACN show controller for the Arduino Portenta H7.
#include <Arduino.h>
#include <malloc.h>
#include <mbed.h>
#include <mbed_boot.h>
#include <drivers/ResetReason.h>
#include <drivers/Watchdog.h>
#include "BigRam.h"
#include "Board.h"
#include "Clock.h"
#include "Cmd.h"
#include "Config.h"
#include "Dmx.h"
#include "Drivers.h"
#include "Log.h"
#include "Mail.h"
#include "Globals.h"
#include "Heap.h"
#include "Io.h"
#include "Monitor.h"
#include "Net.h"
#include "NetRx.h"
#include "NetSafe.h"
#include "Project.h"
#include "Projectors.h"
#include "Show.h"
#include "State.h"
#include "Stats.h"
#include "Storage.h"
#include "Triggers.h"
#include "Update.h"
#include "Web.h"

using namespace std::chrono_literals;

Stats g_stats;
#define CRUMB(where) Log::crumb(Log::kCrumbMain, where)   // where the loop is, kept through a reset

namespace {
uint32_t nextTick = 0;
uint32_t lastStats = 0;
uint32_t ticks = 0, lastDmxFrames = 0;
Net::Counters lastNet = {};
uint32_t lastUdp = 0;
uint32_t tickUsMax = 0, loopUsMax = 0;
uint32_t trigUs = 0, busyUs = 0;   // time in Triggers::poll / in the loop (not sleeping), summed per second
uint32_t lastLowMemWarn = 0;
// Per part of the loop: summed and worst us this second (Stats::loopPartUs, order as kLoopPart in Web.cpp).
uint32_t partUs[Stats::kLoopParts] = {}, partMax[Stats::kLoopParts] = {};
uint32_t rounds = 0, gapUsMax = 0, sleepUsMax = 0, lastLoopStart = 0;
inline void part(int k, uint32_t& mark) {
  uint32_t t = micros(), d = t - mark;
  mark = t;
  partUs[k] += d;
  if (d > partMax[k]) partMax[k] = d;
}

// Identifies this build (Log::startReason tells a restart after flashing from a hang): a
// hash of the firmware in flash (code + initial data, ~10 ms). __DATE__/__TIME__ only
// changed when main.cpp itself was recompiled, so other changes looked like the same build.
extern "C" uint32_t __etext, __data_start__, __data_end__;
uint32_t buildId() {
  const uint32_t* p = (const uint32_t*)0x08040000;
  const uint32_t* end = (const uint32_t*)((uintptr_t)&__etext + ((uintptr_t)&__data_end__ - (uintptr_t)&__data_start__));
  uint32_t h = 2166136261u;
  while (p < end) h = (h ^ *p++) * 16777619u;
  return h;
}

// Watchdog/crash restarts in a row, kept in an RTC backup register: it survives a
// reset (not a power loss without the backup battery). BKP0-3 belong to the
// bootloader (Update.cpp); the last one is free. The magic tells it from junk.
const uint32_t kCrashMagic = 0x5AFE0000;
bool crashesCleared = false;

void backupAccess() {
  (void)time(nullptr);   // makes sure Mbed has started the RTC (holds the backup registers)
  PWR->CR1 |= PWR_CR1_DBP;
  while (!(PWR->CR1 & PWR_CR1_DBP)) {}
}

int countCrash(bool crashed) {
  backupAccess();
  uint32_t v = RTC->BKP31R;
  int n = (v & 0xFFFF0000) == kCrashMagic ? (int)(v & 0xFFFF) : 0;
  n = crashed ? min(n + 1, 0xFFFF) : 0;
  RTC->BKP31R = kCrashMagic | n;
  return n;
}

// Free heap = never-claimed part of the heap region + free chunks inside it.
void updateHeap(uint32_t now) {
  struct mallinfo mi = mallinfo();
  uint32_t size = mbed_heap_size;
  uint32_t free = (size > (uint32_t)mi.arena ? size - mi.arena : 0) + mi.fordblks + Heap::poolFree();
  g_stats.heapSize = size;
  g_stats.heapUsed = mi.uordblks - Heap::poolFree();
  g_stats.heapFree = free;
  if (!g_stats.heapMinFree || free < g_stats.heapMinFree) g_stats.heapMinFree = free;
  if (free < 32 * 1024 && (!lastLowMemWarn || now - lastLowMemWarn > 60000)) {
    lastLowMemWarn = now;
    LOGW(Sys, "Low memory: %lu KB free of %lu KB", (unsigned long)(free / 1024), (unsigned long)(size / 1024));
  }
}

void updateStats(uint32_t now) {
  if (now - lastStats < 1000) return;
  lastStats = now;
  updateHeap(now);
  g_stats.engineFps = ticks;
  uint32_t parts[Show::kParts];
  Show::takeTiming(parts);
  for (int k = 0; k < Show::kParts; k++) g_stats.tickPartUs[k] = ticks ? parts[k] / ticks : 0;
  ticks = 0;
  uint32_t frames = Dmx::framesSent();
  g_stats.dmxFps = frames - lastDmxFrames;
  lastDmxFrames = frames;
  g_stats.artTxPs = Net::counters.artTx - lastNet.artTx;
  g_stats.artRxPs = Net::counters.artRx - lastNet.artRx;
  g_stats.sacnTxPs = Net::counters.sacnTx - lastNet.sacnTx;
  lastNet.artTx = Net::counters.artTx;
  lastNet.artRx = Net::counters.artRx;
  g_stats.sacnRxPs = Net::counters.sacnRx - lastNet.sacnRx;
  lastNet.sacnRx = Net::counters.sacnRx;
  lastNet.sacnTx = Net::counters.sacnTx;
  g_stats.udpRxPs = Triggers::udpReceived() - lastUdp;
  g_stats.udpDropped = NetRx::dropped();
  lastUdp = Triggers::udpReceived();
  g_stats.trigUs = trigUs;
  g_stats.busyUs = busyUs;
  trigUs = busyUs = 0;
  g_stats.tickUsMax = tickUsMax;
  g_stats.loopUsMax = loopUsMax;
  tickUsMax = loopUsMax = 0;
  for (int k = 0; k < Stats::kLoopParts; k++) { g_stats.loopPartUs[k] = partUs[k]; g_stats.loopPartMax[k] = partMax[k]; partUs[k] = partMax[k] = 0; }
  g_stats.loopRounds = rounds;
  g_stats.loopGapUs = gapUsMax;
  g_stats.loopSleepUs = sleepUsMax;
  rounds = gapUsMax = sleepUsMax = 0;
  uint32_t budgetUs = 1000000 / Show::engineHz();
  if (g_stats.tickUsMax > budgetUs / 2)
    LOGW(Show, "Engine tick took %lu us (budget %lu us)", (unsigned long)g_stats.tickUsMax, (unsigned long)budgetUs);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Log::begin();
  g_stats.resetReason = Log::startReason(buildId());
  bool crashed = !strcmp(g_stats.resetReason, "unexpected");
  uint32_t unsaved, kept = Log::keptFromBefore(unsaved);
  if (kept) LOGI(Sys, "---- restart: the %lu lines above are from before it (%lu weren't on the stick yet) ----", (unsigned long)kept, (unsigned long)unsaved);
  if (crashed) {
    LOGW(Sys, "KD Designer %s booting - unexpected restart: the firmware hung or crashed (or the reset button was pressed). The lines above show what happened before.", KD_VERSION);
    LOGW(Sys, "Before the restart: main loop at '%s', web at '%s', project load at '%s'", Log::lastCrumb(Log::kCrumbMain),
         Log::lastCrumb(Log::kCrumbWeb), Log::lastCrumb(Log::kCrumbLoad));
  } else
    LOGI(Sys, "KD Designer %s booting (%s)", KD_VERSION, g_stats.resetReason);
  // A project that crashes the board (often from its Startup trigger) would do it
  // again on every start, and the web UI would never stay up long enough to fix it.
  int crashes = countCrash(crashed);
  if (crashes >= KD_SAFE_MODE_CRASHES) {
    Triggers::setSafeMode(true);
    LOGE(Sys, "SAFE MODE: %d crash restarts in a row - triggers only run when fired by hand (no Startup). Fix the project and save it, or restart the controller.", crashes);
  }

  // The project (text + parsed JSON) is loaded in the 8 MB SDRAM: it doesn't fit the heap.
  if (BigRam::begin()) LOGI(Sys, "SDRAM: %lu KB for project loading", (unsigned long)(BigRam::freeBytes() / 1024));
  else LOGW(Sys, "No SDRAM on this Portenta: big projects may not load");
  Storage::begin(5000);
  Update::begin();          // logs whether a firmware update was just installed
  // A save writes project.tmp in full, then moves project.json to the backups and renames the
  // tmp. No project.json but a project.tmp = the power went between those two steps: the tmp
  // is the complete new version (without this the board started empty).
  if (Storage::mounted() && !Storage::exists(KD_PROJECT_PATH) && Storage::exists(KD_PROJECT_TMP)) {
    bool ok = rename(KD_PROJECT_TMP, KD_PROJECT_PATH) == 0;
    LOGW(Show, "A save was cut off: %s project.tmp", ok ? "using" : "could not rename");
  }
  NetSafe::bootCheck();    // an unconfirmed network test / network-reset.txt: fix project.json first

  String err;
  if (Storage::mounted() && Storage::exists(KD_PROJECT_PATH)) {
    if (!Show::loadFile(KD_PROJECT_PATH, err)) {
      LOGE(Show, "Project load failed: %s", err.c_str());
      // A network rewrite's .bak (NetSafe), else the newest backup that loads.
      bool done = Show::loadFile(KD_PROJECT_BAK, err);
      if (done) LOGW(Show, "Loaded backup project instead");
      std::vector<String> all = Storage::backups();
      for (size_t i = all.size(); !done && i-- > 0;)
        if ((done = Show::loadFile((String(KD_BACKUP_DIR "/") + all[i]).c_str(), err))) LOGW(Show, "Loaded backup %s instead", all[i].c_str());
    }
  } else {
    LOGW(Show, "No project on the storage device - starting empty");
    Show::parse("{}", 2, err);
  }

  Net::begin(Show::settings().net);
  NetRx::begin();           // the network receive thread (UDP triggers, DMX input, ArtPoll)
  Board::begin();           // before Dmx: on the Machine Control it switches on the RS485 port
  Dmx::begin();
  Project::loadModules();   // after Net::begin: opens the UDP ports
  // Worker threads start once everything is loaded.
  Io::begin();
  Clock::begin();           // NTP in its own thread: a slow DNS answer must not hold up the I/O thread
  Monitor::begin();
  Mail::begin();
  Projectors::begin();
  Drivers::begin();
  Storage::beginWriter();   // project.json written after a save (before Web: a save needs it)
  Web::begin();
  Log::startWriter();

  g_engine.lock();
  Triggers::startup();
  g_engine.unlock();
  nextTick = millis();
  updateHeap(millis());
  // Started last: mounting the stick and preparing the QSPI flash can take a while.
  mbed::Watchdog::get_instance().start(KD_WATCHDOG_MS);
  LOGI(Sys, "Ready - %lu KB of %lu KB memory free", (unsigned long)(g_stats.heapFree / 1024), (unsigned long)(g_stats.heapSize / 1024));
#ifdef KD_TEST_PAD
  extern void testPadCheck();   // TestPad.cpp: the over-768 KB test build checks its padding
  testPadCheck();
#endif
}

void loop() {
  uint32_t t0 = micros();
  if (lastLoopStart) gapUsMax = max(gapUsMax, t0 - lastLoopStart);
  lastLoopStart = t0;
  rounds++;
  uint32_t pm = t0;
  uint32_t now = millis();
  mbed::Watchdog::get_instance().kick();   // a hung loop or a stuck g_engine restarts the board
  if (!crashesCleared && now > KD_SAFE_MODE_OK_MS) { crashesCleared = true; countCrash(false); }   // runs fine: not crashing any more

  CRUMB("Storage::poll");
  Storage::poll();
  part(0, pm);
  CRUMB("Net::maintain");
  Net::maintain(now);
  part(1, pm);

  CRUMB("waiting for g_engine");
  g_engine.lock();
  part(2, pm);
  // Read again: while we waited the web thread may have started a timeline at a later
  // millis(), and the engine must not see a start time in its future.
  now = millis();
  CRUMB("Net::poll");
  Net::poll();   // ArtPoll answers, sACN group for DMX input (set up by a project (re)load)
  part(3, pm);
  CRUMB("Triggers::poll");
  uint32_t tp = micros();
  Triggers::poll(now);
  trigUs += micros() - tp;
  part(4, pm);
  if ((int32_t)(now - nextTick) >= 0) {
    nextTick += 1000 / Show::engineHz();
    if ((int32_t)(now - nextTick) > 200) nextTick = now;  // don't try to catch up after a stall
    uint32_t tt = micros();
    // Read once more: a trigger that just ran in Triggers::poll started its fade or release at
    // its own, later millis(). With the older `now` the frame saw a start time in its future,
    // "now - start" wrapped and the fade was over at once.
    now = millis();
    CRUMB("Show::tick");
    Show::tick(now);
    CRUMB("Show::sendOutputs");
    Show::sendOutputs(now);
    Triggers::afterTick();
    tickUsMax = max(tickUsMax, micros() - tt);
    ticks++;
    part(5, pm);
    CRUMB("engine events");
    int id;
    // Only the events queued so far: a trigger that starts or stops a timeline queues more, and
    // a "started" trigger that restarts its own timeline would otherwise never let go of the loop.
    Show::TimelineEvent tev;
    for (int n = Show::timelineEventCount(); n > 0 && Show::takeTimelineEvent(tev); n--) Triggers::onTimelineEvent(tev);
    String cueTrig;
    while (Show::takeTimelineCue(id, cueTrig)) Triggers::onTimelineCue(id, cueTrig);
    Drivers::follow(now);
    Monitor::Event ev;
    while (Monitor::takeEvent(ev)) Triggers::onDeviceState(ev.kind, ev.name, ev.online);
    Projectors::Alarm al;
    while (Projectors::takeAlarm(al)) Triggers::onProjectorAlarm(al);
    // Variable changes may cause more changes; handle at most 32 per tick so a
    // trigger loop (a -> b -> a) can't freeze the engine.
    Globals::Change ch;
    Board::poll();   // board readings -> linked variables
    for (int i = 0; i < 32 && Globals::takeChange(ch); i++) {
      Board::onVariable(ch.name, ch.value);
      Triggers::onVariable(ch.name, ch.value, ch.old);
    }
    Tcp::Line line;
    while (Tcp::takeLine(line)) Triggers::onTcpLine(line.device, line.text);
    Http::Response resp;
    while (Http::takeResponse(resp)) Triggers::onHttpResponse(resp.method, resp.url, resp.status, resp.body);
  }
  Cmd::reloadDue();
  g_engine.unlock();
  part(6, pm);

  CRUMB("Log::flush");
  Log::flush();
  part(7, pm);
  CRUMB("history / variables / update");
  Monitor::flushHistory();
  part(8, pm);
  Globals::flush();
  part(9, pm);
  Update::poll();
  part(10, pm);
  CRUMB("stats / sleep");
  updateStats(now);
  loopUsMax = max(loopUsMax, micros() - t0);
  part(11, pm);
  busyUs += micros() - t0;
  uint32_t ts = micros();
  rtos::ThisThread::sleep_for(1ms);
  sleepUsMax = max(sleepUsMax, micros() - ts);
}
