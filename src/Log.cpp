#include "Log.h"
#include <mbed.h>
#include <stdarg.h>
#include <time.h>
#include <vector>
#include "Storage.h"

namespace {
const char* const kCatNames[] = {"SYS", "USB", "NET", "DMX", "ARTNET", "SACN", "SHOW", "TRIG", "WEB", "CMD", "PJLINK"};
const char* const kLvlNames[] = {"DEBUG", "INFO", "WARN", "ERROR"};

LogEntry ring[KD_LOG_RING];
uint32_t nextSeq = 1;            // seq of the next entry to be written
uint32_t serialSeq = 1;          // next seq to print on Serial
uint32_t fileSeq = 1;            // next seq to append to the USB file
Lvl levels[(int)Cat::COUNT];
rtos::Mutex mtx;
}  // namespace

namespace Log {

void begin() {
  for (auto& l : levels) l = Lvl::Info;
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

  // Serial: entries that fell out of the ring are skipped.
  if (serialSeq < firstSeq()) serialSeq = firstSeq();
  while (serialSeq <= lastSeq()) {
    if (get(serialSeq++, e)) {
      formatLine(e, line, sizeof(line));
      Serial.print(line);
    }
  }

  // USB file (only while a stick is mounted; anything older than the ring is lost).
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

// w in s as a whole word: device "io" is not in "connection", IP 10.0.0.5 not in 10.0.0.50.
static bool hasWord(const String& s, const String& w) {
  for (int i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) {
    char before = i ? s[i - 1] : ' ', after = s[i + w.length()];
    if (!isalnum((unsigned char)before) && !isalnum((unsigned char)after)) return true;
  }
  return false;
}

void search(const String& a, const String& b, uint32_t from, uint32_t to, size_t max, String& out) {
  out = "[]";
  if (!a.length()) return;
  std::vector<String> hits;
  String la = a, lb = b;
  la.toLowerCase();
  lb.toLowerCase();
  char line[KD_LOG_MSG_LEN + 48];
  for (int n = KD_LOG_FILES - 1; n >= 0; n--) {   // oldest first
    FILE* f = Storage::mounted() ? fopen(oldPath(n).c_str(), "r") : nullptr;
    if (!f) continue;
    // The lines are in time order: find the start of the window by halving, not by reading it all.
    fseek(f, 0, SEEK_END);
    long lo = 0, hi = ftell(f);
    while (hi - lo > 4096) {
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
      // "<date> <time> [LEVEL] CAT    message"
      char lvl[8] = "", cat[8] = "";
      int used = 0;
      if (sscanf(line + 19, " [%7[^] ] ] %7s %n", lvl, cat, &used) < 2 || !used) continue;
      String msg = String(line + 19 + used);
      msg.trim();
      String lm = msg;
      lm.toLowerCase();
      if (!hasWord(lm, la) && !(lb.length() && hasWord(lm, lb))) continue;
      Lvl l = Lvl::Info;
      lvlFromName(lvl, l);
      LogEntry le;
      le.seq = 0;
      le.ms = 0;
      le.epoch = e;
      le.lvl = l;
      le.cat = Cat::Sys;
      catFromName(cat, le.cat);
      strncpy(le.msg, msg.c_str(), sizeof(le.msg) - 1);
      le.msg[sizeof(le.msg) - 1] = 0;
      char buf[KD_LOG_MSG_LEN * 2 + 96];
      if (!toJson(le, buf, sizeof(buf))) continue;
      hits.push_back(buf);
      if (hits.size() > max) hits.erase(hits.begin());
    }
    fclose(f);
  }
  out = "[";
  for (size_t i = 0; i < hits.size(); i++) { if (i) out += ','; out += hits[i]; }
  out += "]";
}

}  // namespace Log
