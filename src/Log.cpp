#include "Log.h"
#include <mbed.h>
#include <stdarg.h>
#include <time.h>
#include <vector>
#include "D2Ram.h"
#include "Storage.h"

namespace {
const char* const kCatNames[] = {"SYS", "USB", "NET", "DMX", "ARTNET", "SACN", "SHOW", "TRIG", "WEB", "CMD", "PJLINK"};
const char* const kLvlNames[] = {"DEBUG", "INFO", "WARN", "ERROR"};

// The ring (~68 KB) lives in D2 SRAM and survives a reset (D2Ram::keep): after a watchdog or
// crash restart the last lines before it are still there, and the ones that never reached
// the stick are written then. After power-on the magic doesn't match and it starts empty.
struct Store {
  uint32_t magic, size;
  uint32_t nextSeq;   // seq of the next entry to be written
  uint32_t fileSeq;   // next seq to append to the USB file
  uint32_t build;     // firmware that wrote it (Log::setBuild)
  uint32_t planned;   // kPlanned: the firmware restarted on purpose (Log::markPlannedRestart)
  const char* crumbs[3];   // where the main loop / web thread / project load last were (Log::crumb)
  LogEntry ring[KD_LOG_RING];
};
const uint32_t kMagic = 0x4B444C47;   // "KDLG"
const uint32_t kPlanned = 0x504C4E44;
const uint32_t kUpload = 0x55534255;   // reset into the bootloader for a USB upload
bool wasKept = false, wasPlanned = false, wasUpload = false;
uint32_t prevBuild = 0;
Store& st = *static_cast<Store*>(D2Ram::keep(sizeof(Store)));
LogEntry* const ring = st.ring;
uint32_t& nextSeq = st.nextSeq;
uint32_t& fileSeq = st.fileSeq;
uint32_t serialSeq = 1;          // next seq to print on Serial
bool serialOpen = false;         // a serial monitor has the USB port open
uint32_t keptLines = 0, keptUnsaved = 0;
Lvl levels[(int)Cat::COUNT];
rtos::Mutex mtx;
bool writerRunning = false;      // the "log" thread writes the stick (startWriter)
}  // namespace

namespace Log {

void begin() {
  for (auto& l : levels) l = Lvl::Info;
  bool kept = st.magic == kMagic && st.size == sizeof(Store) && st.nextSeq >= 1 && st.nextSeq < 0x7FFFFFFF &&
              st.fileSeq >= 1 && st.fileSeq <= st.nextSeq;
  if (!kept) {
    memset(&st, 0, sizeof(st));
    st.magic = kMagic;
    st.size = sizeof(Store);
    st.nextSeq = st.fileSeq = 1;
    return;
  }
  for (int i = 0; i < KD_LOG_RING; i++) ring[i].msg[KD_LOG_MSG_LEN - 1] = 0;   // never read past a line
  keptLines = lastSeq() - firstSeq() + 1;
  keptUnsaved = nextSeq - max(fileSeq, firstSeq());
  wasKept = true;
  wasPlanned = st.planned == kPlanned;
  wasUpload = st.planned == kUpload;
  prevBuild = st.build;
  st.planned = 0;
}

uint32_t keptFromBefore(uint32_t& notOnStick) { notOnStick = keptUnsaved; return keptLines; }

const char* startReason(uint32_t build) {
  bool newFirmware = wasKept && prevBuild != build;
  st.build = build;
  if (!wasKept) return "power on";
  if (wasPlanned) return "restart";
  if (newFirmware) return "new firmware";
  if (wasUpload) return "USB upload";
  return "unexpected";
}

void markPlannedRestart() { st.planned = kPlanned; }
}  // namespace Log

// Called by the core (our variant.cpp) on the 1200-baud touch, just before it resets into
// the bootloader: a USB upload, even of the same build, is not an unexpected restart.
// Runs in the USB thread: only a word is written.
void kdBeforeBootloader() { st.planned = kUpload; }

namespace Log {

void crumb(int slot, const char* where) { st.crumbs[slot] = where; }

// String literals of the same build (startReason checked the build), else nothing.
const char* lastCrumb(int slot) {
  const char* c = wasKept && prevBuild == st.build ? st.crumbs[slot] : nullptr;
  return c && (uintptr_t)c >= 0x08000000 && (uintptr_t)c < 0x08200000 ? c : "?";
}

void write(Lvl lvl, Cat cat, const char* fmt, ...) {
  if (lvl < levels[(int)cat]) return;
  mtx.lock();
  LogEntry& e = ring[nextSeq % KD_LOG_RING];
  e.seq = nextSeq++;
  e.ms = millis();
  e.epoch = (uint32_t)time(nullptr);
  e.lvl = lvl;
  e.cat = cat;
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(e.msg, sizeof(e.msg), fmt, ap);
  va_end(ap);
  mtx.unlock();
}

uint32_t lastSeq() { return nextSeq - 1; }

uint32_t firstSeq() {
  uint32_t last = lastSeq();
  return last >= KD_LOG_RING ? last - KD_LOG_RING + 1 : 1;
}

bool get(uint32_t seq, LogEntry& out) {
  mtx.lock();
  bool ok = seq >= firstSeq() && seq <= lastSeq();
  if (ok) out = ring[seq % KD_LOG_RING];
  mtx.unlock();
  return ok;
}

void setLevel(Cat cat, Lvl lvl) {
  levels[(int)cat] = lvl;
}
Lvl level(Cat cat) { return levels[(int)cat]; }

const char* catName(Cat cat) { return kCatNames[(int)cat]; }
const char* lvlName(Lvl lvl) { return kLvlNames[(int)lvl]; }

bool catFromName(const char* name, Cat& out) {
  for (int i = 0; i < (int)Cat::COUNT; i++)
    if (strcasecmp(name, kCatNames[i]) == 0) { out = (Cat)i; return true; }
  return false;
}

bool lvlFromName(const char* name, Lvl& out) {
  for (int i = 0; i < 4; i++)
    if (strcasecmp(name, kLvlNames[i]) == 0) { out = (Lvl)i; return true; }
  return false;
}

size_t toJson(const LogEntry& e, char* buf, size_t len) {
  int n = snprintf(buf, len, "{\"s\":%lu,\"t\":%lu,\"e\":%lu,\"l\":%d,\"c\":\"%s\",\"m\":\"",
                   (unsigned long)e.seq, (unsigned long)e.ms, (unsigned long)e.epoch, (int)e.lvl,
                   catName(e.cat));
  if (n < 0 || (size_t)n >= len) return 0;
  size_t p = n;
  for (const char* s = e.msg; *s && p + 8 < len; s++) {
    char c = *s;
    if (c == '"' || c == '\\') { buf[p++] = '\\'; buf[p++] = c; }
    else if ((uint8_t)c < 0x20) p += snprintf(buf + p, len - p, "\\u%04x", c);
    else buf[p++] = c;
  }
  if (p + 3 > len) return 0;
  buf[p++] = '"';
  buf[p++] = '}';
  buf[p] = 0;
  return p;
}

static void formatLine(const LogEntry& e, char* line, size_t len) {
  char ts[24];
  if (e.epoch > 1600000000UL) {
    time_t t = e.epoch;
    struct tm tmv;
    gmtime_r(&t, &tmv);
    strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", &tmv);
  } else {
    snprintf(ts, sizeof(ts), "+%lu.%03lu", (unsigned long)(e.ms / 1000), (unsigned long)(e.ms % 1000));
  }
  snprintf(line, len, "%s [%-5s] %-6s %s\n", ts, lvlName(e.lvl), catName(e.cat), e.msg);
}

// Log file n: 0 = system.log (being written), 1 = system.1.log (newest old one) ...
static String oldPath(int n) {
  if (!n) return KD_LOG_PATH;
  String p = KD_LOG_PATH;
  return p.substring(0, p.length() - 4) + "." + n + ".log";
}

void flush() {
  LogEntry e;
  char line[KD_LOG_MSG_LEN + 48];

  // Serial: entries that fell out of the ring are skipped. USB serial drops what is
  // printed while no monitor is open (the boot log, usually), so when one opens the
  // port it gets the whole ring again.
  bool open = (bool)Serial;
  if (open && !serialOpen) serialSeq = firstSeq();
  serialOpen = open;
  if (serialSeq < firstSeq()) serialSeq = firstSeq();
  while (open && serialSeq <= lastSeq()) {
    if (get(serialSeq++, e)) {
      formatLine(e, line, sizeof(line));
      Serial.print(line);
    }
  }

  if (!writerRunning) writeFile();
}

// USB file (only while a stick is mounted; anything older than the ring is lost). Runs in its
// own thread once startWriter() was called: opening, appending and closing a file on the stick
// takes several ms (more with a big log), and in the main loop that delayed the engine - 50
// trigger fires a second dropped the lights from 40 to 17 fps.
void writeFile() {
  LogEntry e;
  char line[KD_LOG_MSG_LEN + 48];
  if (!Storage::mounted()) return;
  if (fileSeq > lastSeq()) return;
  if (fileSeq < firstSeq()) fileSeq = firstSeq();

  FILE* f = fopen(KD_LOG_PATH, "a");
  if (!f) return;
  while (fileSeq <= lastSeq()) {
    if (get(fileSeq++, e)) {
      formatLine(e, line, sizeof(line));
      fputs(line, f);
    }
  }
  long size = ftell(f);
  fclose(f);
  if (size > (long)KD_LOG_MAX_BYTES) {
    // system.log -> system.1.log -> ... -> system.4.log, the oldest is dropped.
    remove(oldPath(KD_LOG_FILES - 1).c_str());
    for (int i = KD_LOG_FILES - 2; i >= 0; i--) rename(oldPath(i).c_str(), oldPath(i + 1).c_str());
  }
}

void startWriter() {
  // Below the main loop: the USB stick is driven by the CPU (no DMA), so writing takes CPU time
  // that would otherwise come out of engine ticks. It runs in the main loop's 1 ms sleeps.
  static rtos::Thread writer(osPriorityBelowNormal, 4096, nullptr, "log");
  if (writerRunning) return;
  writerRunning = true;
  writer.start([] {
    for (;;) {
      writeFile();
      rtos::ThisThread::sleep_for(std::chrono::milliseconds(200));   // batches lines: one open/close per 200 ms at most
    }
  });
}

// Epoch of a file line ("2026-11-01 12:00:00 [INFO ] ..."), 0 for "+12.345" (no clock yet).
static uint32_t lineEpoch(const char* s) {
  int y, mo, d, h, mi, sec;
  if (sscanf(s, "%4d-%2d-%2d %2d:%2d:%2d", &y, &mo, &d, &h, &mi, &sec) != 6) return 0;
  // days since 1970 for a civil date (H. Hinnant), as in Clock.cpp
  y -= mo <= 2;
  long era = (y >= 0 ? y : y - 399) / 400;
  long yoe = y - era * 400;
  long doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  long days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
  return (uint32_t)(days * 86400L + h * 3600L + mi * 60L + sec);
}

// w in s as a whole word, ignoring case: device "io" is not in "connection", IP 10.0.0.5 not
// in 10.0.0.50. In place: two lower-cased Strings per line cost more than reading the line.
static bool hasWord(const char* s, const char* w, size_t wl) {
  if (!wl) return false;
  const int w0 = tolower((unsigned char)w[0]);
  for (const char* p = s; *p; p++) {
    if (tolower((unsigned char)*p) != w0 || strncasecmp(p, w, wl)) continue;
    char before = p > s ? p[-1] : ' ', after = p[wl];   // p[wl] exists: wl chars matched
    if (!isalnum((unsigned char)before) && !isalnum((unsigned char)after)) return true;
  }
  return false;
}

// Epoch of the first line with a clock time in a log file, 0 if none in its first lines (or no file).
static uint32_t firstEpoch(const char* path, bool& exists) {
  FILE* f = fopen(path, "r");   // stdio's small buffer: one short read
  exists = f != nullptr;
  if (!f) return 0;
  char line[KD_LOG_MSG_LEN + 48];
  uint32_t e = 0;
  for (int i = 0; i < 20 && !e && fgets(line, sizeof(line), f); i++) e = lineEpoch(line);
  fclose(f);
  return e;
}

// Opening one device in Monitoring took many seconds: up to 5 x 8 MB of log files, read in
// stdio's 1 KB pieces, two Strings per line, and a heap String for the reply. Now files wholly
// outside the window are not opened, reading goes in 8 KB pieces (Storage::Reader), lines are
// matched in place and the hits are kept in SDRAM.
void search(const String& a, const String& b, uint32_t from, uint32_t to, size_t max, BigRam::Text& out) {
  out.add('[');
  if (!a.length() || !Storage::mounted() || !max) { out.add(']'); return; }
  BigRam::Vec<LogEntry> hits;   // the last `max`, as a ring from `next`
  hits.reserve(max);
  size_t next = 0;
  char line[KD_LOG_MSG_LEN + 48];

  // Each file starts where the older one ends (system.4.log oldest ... system.log being
  // written), so file n covers start[n] .. start[newer one].
  uint32_t start[KD_LOG_FILES];
  bool exists[KD_LOG_FILES];
  for (int n = 0; n < KD_LOG_FILES; n++) start[n] = firstEpoch(oldPath(n).c_str(), exists[n]);

  for (int n = KD_LOG_FILES - 1; n >= 0; n--) {   // oldest first
    if (!exists[n]) continue;
    if (start[n] && start[n] > to) break;          // this one and the newer ones start after the window
    int newer = n - 1;
    while (newer >= 0 && !exists[newer]) newer--;
    if (newer >= 0 && start[newer] && start[newer] < from) continue;   // all of it is before the window

    Storage::Reader r(oldPath(n).c_str());
    FILE* f = r.f;
    if (!f) continue;
    // The lines are in time order: find the start of the window by halving, not by reading it all.
    // Every seek costs one buffer (8 KB) read, so stop halving at that size.
    fseek(f, 0, SEEK_END);
    long lo = 0, hi = ftell(f);
    while (hi - lo > 8192) {
      long mid = (lo + hi) / 2;
      fseek(f, mid, SEEK_SET);
      fgets(line, sizeof(line), f);   // the rest of a cut line
      if (!fgets(line, sizeof(line), f) || lineEpoch(line) >= from) hi = mid;
      else lo = mid;
    }
    fseek(f, lo, SEEK_SET);
    if (lo) fgets(line, sizeof(line), f);
    while (fgets(line, sizeof(line), f)) {
      uint32_t e = lineEpoch(line);
      if (e > to) break;
      if (e < from) continue;
      // "YYYY-MM-DD HH:MM:SS [LEVEL] CAT    message" (formatLine): fixed columns.
      if (line[19] != ' ' || line[20] != '[' || line[26] != ']' || strlen(line) < 35) continue;
      char* msg = line + 35;
      size_t ml = strlen(msg);
      while (ml && (unsigned char)msg[ml - 1] <= ' ') msg[--ml] = 0;
      if (!hasWord(msg, a.c_str(), a.length()) && !hasWord(msg, b.c_str(), b.length())) continue;
      LogEntry le;
      le.seq = 0;
      le.ms = 0;
      le.epoch = e;
      char lvl[6] = "", cat[7] = "";
      sscanf(line + 21, "%5[A-Z]", lvl);
      sscanf(line + 28, "%6[A-Z]", cat);
      le.lvl = Lvl::Info;
      lvlFromName(lvl, le.lvl);
      le.cat = Cat::Sys;
      catFromName(cat, le.cat);
      strncpy(le.msg, msg, sizeof(le.msg) - 1);
      le.msg[sizeof(le.msg) - 1] = 0;
      if (hits.size() < max) hits.push_back(le);
      else hits[next] = le;
      next = (next + 1) % max;
    }
  }
  char buf[KD_LOG_MSG_LEN * 2 + 96];
  size_t count = hits.size(), first = count < max ? 0 : next;
  for (size_t i = 0; i < count; i++) {
    size_t k = toJson(hits[(first + i) % count], buf, sizeof(buf));
    if (!k) continue;
    if (out.len > 1) out.add(',');
    out.add(buf, k);
  }
  out.add(']');
}

}  // namespace Log
