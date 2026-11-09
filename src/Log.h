#pragma once
#include <Arduino.h>
#include "Config.h"

enum class Lvl : uint8_t { Debug, Info, Warn, Error };
enum class Cat : uint8_t { Sys, Usb, Net, Dmx, ArtNet, Sacn, Show, Trig, Web, Cmd, Pjl, COUNT };

struct LogEntry {
  uint32_t seq;
  uint32_t ms;
  uint32_t epoch;
  Lvl lvl;
  Cat cat;
  char msg[KD_LOG_MSG_LEN];
};

// Thread-safe ring-buffer logger. Entries are kept in RAM (for the live web
// view), mirrored to Serial and appended to a rotating file on the USB stick.
namespace Log {
void begin();
// Lines kept from before a reset (watchdog, crash, restart; not a power cut), and how many
// of them hadn't reached the stick yet (they are written with the next flush).
uint32_t keptFromBefore(uint32_t& notOnStick);
// Why the board started, from the kept log (the bootloader clears the chip's reset flags):
// "power on" (the log was lost), "restart" (markPlannedRestart was called), "new firmware"
// (another build than before: flashed or updated), "USB upload" (the same build flashed
// again) or "unexpected" (watchdog, crash or the reset button). build = an id of this
// firmware. Call once, after begin().
const char* startReason(uint32_t build);
void markPlannedRestart();   // just before the firmware resets the board itself
// Breadcrumbs that survive a reset: slot 0 = main loop, 1 = web thread, 2 = project (re)load. `where` must be a
// string literal. After an "unexpected" start, lastCrumb() says where each one last was.
enum { kCrumbMain = 0, kCrumbWeb = 1, kCrumbLoad = 2 };
void crumb(int slot, const char* where);
const char* lastCrumb(int slot);
void write(Lvl lvl, Cat cat, const char* fmt, ...) __attribute__((format(printf, 3, 4)));

uint32_t lastSeq();
uint32_t firstSeq();
bool get(uint32_t seq, LogEntry& out);

void setLevel(Cat cat, Lvl lvl);
Lvl level(Cat cat);

const char* catName(Cat cat);
const char* lvlName(Lvl lvl);
bool catFromName(const char* name, Cat& out);
bool lvlFromName(const char* name, Lvl& out);

// Writes {"s":..,"t":..,"e":..,"l":..,"c":"..","m":".."} into buf.
size_t toJson(const LogEntry& e, char* buf, size_t len);

// Call from the main loop: drains new entries to Serial and the USB log file.
void flush();
void writeFile();     // new lines -> the stick's log file (the "log" thread once started)
void startWriter();   // from then on the stick is written by its own thread, not flush()

// Lines of the USB log files (old and current) between from and to (epoch) whose text
// contains a or the IP address b (case-insensitive; b may be empty), the last `max` of them, as
// [{"e":..,"l":..,"c":"..","m":".."},...]. For the Monitoring detail view of one device.
void search(const String& a, const String& b, uint32_t from, uint32_t to, size_t max, String& out);
}  // namespace Log

#define LOGD(c, ...) Log::write(Lvl::Debug, Cat::c, __VA_ARGS__)
#define LOGI(c, ...) Log::write(Lvl::Info, Cat::c, __VA_ARGS__)
#define LOGW(c, ...) Log::write(Lvl::Warn, Cat::c, __VA_ARGS__)
#define LOGE(c, ...) Log::write(Lvl::Error, Cat::c, __VA_ARGS__)
