#include "Clock.h"
#include <EthernetUdp.h>
#include <math.h>
#include <mbed.h>
#include <vector>
#include "Log.h"
#include "Net.h"
#include "Show.h"

namespace {
struct Date { int y, m, d; };  // y = 0: every year
struct Period { String name; Date from, to; };

int tzMin = 60;
String dstRule = "eu";
String ntpServer = "pool.ntp.org";
bool ntpEnabled = true;
bool hasLocation = false;
double lat = 0, lon = 0;
std::vector<Period> calendar;
rtos::Mutex mtx;

uint32_t lastSync = 0;          // epoch of the last good NTP sync
int32_t lastOffset = 0;         // seconds the clock was off at that sync
uint32_t lastTryMs = 0;
bool syncedOnce = false, forceSync = false;
String lastError;

// Days since 1970-01-01 for a civil date (H. Hinnant's algorithm).
long daysFromCivil(int y, int m, int d) {
  y -= m <= 2;
  long era = (y >= 0 ? y : y - 399) / 400;
  unsigned yoe = (unsigned)(y - era * 400);
  unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long)doe - 719468;
}
int weekday(long days) { return (int)((days % 7 + 11) % 7); }  // 0 = Sunday
int daysInMonth(int y, int m) {
  static const int k[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  return m == 2 && ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0) ? 29 : k[m - 1];
}
// Day of month of the n-th Sunday (n = -1: last Sunday).
int sunday(int y, int m, int n) {
  if (n < 0) {
    int last = daysInMonth(y, m);
    return last - weekday(daysFromCivil(y, m, last));
  }
  int first = 1 + (7 - weekday(daysFromCivil(y, m, 1))) % 7;
  return first + (n - 1) * 7;
}

// Summer-time offset in minutes for a UTC moment.
int dstMinutes(time_t utc) {
  struct tm t;
  gmtime_r(&utc, &t);
  int y = t.tm_year + 1900;
  long s, e;  // UTC seconds of the switch moments
  if (dstRule == "eu") {
    s = daysFromCivil(y, 3, sunday(y, 3, -1)) * 86400L + 3600;     // 01:00 UTC
    e = daysFromCivil(y, 10, sunday(y, 10, -1)) * 86400L + 3600;
  } else if (dstRule == "us") {
    s = daysFromCivil(y, 3, sunday(y, 3, 2)) * 86400L + 7200 - tzMin * 60L;   // 02:00 local standard
    e = daysFromCivil(y, 11, sunday(y, 11, 1)) * 86400L + 3600 - tzMin * 60L; // 02:00 local summer
  } else {
    return 0;
  }
  return (long)utc >= s && (long)utc < e ? 60 : 0;
}

time_t toLocal(time_t utc) { return utc + (tzMin + dstMinutes(utc)) * 60; }

bool today(Date& d) {
  struct tm t;
  if (!Clock::localTime(t)) return false;
  d = {t.tm_year + 1900, t.tm_mon + 1, t.tm_mday};
  return true;
}

// "MM-DD" or "YYYY-MM-DD"
bool parseDate(const String& s, Date& out) {
  int a = 0, b = 0, c = 0;
  if (sscanf(s.c_str(), "%d-%d-%d", &a, &b, &c) == 3 && a > 1900) out = {a, b, c};
  else if (sscanf(s.c_str(), "%d-%d", &a, &b) == 2 && a <= 12) out = {0, a, b};
  else return false;
  return out.m >= 1 && out.m <= 12 && out.d >= 1 && out.d <= 31;
}

bool inPeriod(const Date& t, const Date& a, const Date& b) {
  if (a.y && b.y) {  // one-off range
    long x = daysFromCivil(t.y, t.m, t.d);
    return x >= daysFromCivil(a.y, a.m, a.d) && x <= daysFromCivil(b.y, b.m, b.d);
  }
  int x = t.m * 100 + t.d, from = a.m * 100 + a.d, to = b.m * 100 + b.d;  // yearly, may wrap new year
  return from <= to ? (x >= from && x <= to) : (x >= from || x <= to);
}

// NOAA approximation: minutes after UTC midnight of sunrise/sunset; -1 if none.
int sunUtcMinutes(int y, int m, int d, bool rise) {
  long n = daysFromCivil(y, m, d) - daysFromCivil(y, 1, 1) + 1;
  double g = 2 * M_PI / 365.0 * (n - 1);
  double eq = 229.18 * (0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g) - 0.014615 * cos(2 * g) - 0.040849 * sin(2 * g));
  double decl = 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g) - 0.006758 * cos(2 * g) + 0.000907 * sin(2 * g) -
                0.002697 * cos(3 * g) + 0.00148 * sin(3 * g);
  double la = lat * M_PI / 180;
  double x = cos(90.833 * M_PI / 180) / (cos(la) * cos(decl)) - tan(la) * tan(decl);
  if (x < -1 || x > 1) return -1;  // midnight sun / polar night
  double ha = acos(x) * 180 / M_PI;
  return (int)lround(720 - 4 * (lon + (rise ? ha : -ha)) - eq);
}

// Failed tries in a row: the next one waits 1, 2, 4, ... 30 minutes. A try can take ~17 s when
// no DNS server answers (router off). It runs in its own thread ("ntp"): on the I/O thread it
// held up the PLC polls and TCP devices for that long.
uint8_t ntpFails = 0;
rtos::EventFlags wake;          // syncNow(): try now instead of at the next check
void setError(const String& e) { mtx.lock(); lastError = e; mtx.unlock(); }   // statusJson reads it in the web thread
uint32_t retryMs() { return ntpFails >= 5 ? 30UL * 60000 : 60000UL << ntpFails; }

void ntpSync() {
  lastTryMs = millis();
  ntpFails = min(ntpFails + 1, 10);   // cleared when a reply arrives
  mtx.lock();
  String name = ntpServer;            // a project reload may change it meanwhile
  mtx.unlock();
  // Resolve first: Arduino's beginPacket(host) "succeeds" without an address and sends to 0.0.0.0.
  IPAddress server;
  if (!server.fromString(name) && !Ethernet.hostByName(name.c_str(), server)) {
    setError("cannot resolve " + name + " (no DNS answer: router / internet off?)");
    LOGW(Sys, "NTP: cannot resolve %s (no DNS answer: router / internet off?) - next try in %lu min", name.c_str(), (unsigned long)(retryMs() / 60000));
    return;
  }
  EthernetUDP u;
  if (!u.begin(2390)) { setError("no UDP socket"); return; }
  uint8_t pkt[48] = {0};
  pkt[0] = 0x23;  // LI 0, version 4, client mode
  u.beginPacket(server, 123);
  u.write(pkt, sizeof(pkt));
  u.endPacket();
  uint32_t t0 = millis();
  bool got = false;
  while (millis() - t0 < 2000) {
    if (u.parsePacket() >= 48) { u.read(pkt, 48); got = true; break; }
    rtos::ThisThread::sleep_for(std::chrono::milliseconds(20));
  }
  u.stop();
  if (!got) { setError("no reply from " + name); LOGW(Sys, "NTP: no reply from %s - next try in %lu min", name.c_str(), (unsigned long)(retryMs() / 60000)); return; }
  ntpFails = 0;
  uint32_t secs = ((uint32_t)pkt[40] << 24) | (pkt[41] << 16) | (pkt[42] << 8) | pkt[43];
  uint32_t unix = secs - 2208988800UL;
  if (unix < 1600000000UL) { setError("bad time from server"); return; }
  int32_t off = (int32_t)(unix - (uint32_t)time(nullptr));
  set_time(unix);
  lastSync = unix;
  lastOffset = off;
  setError("");
  if (!syncedOnce || abs(off) > 2) LOGI(Sys, "Clock synced via NTP %s (was %+ld s off)", name.c_str(), (long)off);
  syncedOnce = true;
}
}  // namespace

namespace Clock {

void load() {
  JsonDocument& doc = Show::projectDoc();
  JsonObjectConst s = doc["settings"];
  std::vector<Period> cal;
  for (JsonObjectConst o : doc["calendar"].as<JsonArrayConst>()) {
    Period p;
    p.name = o["name"] | "";
    if (!p.name.length() || !parseDate(o["from"] | "", p.from) || !parseDate(o["to"] | (o["from"] | ""), p.to)) {
      LOGW(Sys, "Calendar '%s': bad date", p.name.c_str());
      continue;
    }
    cal.push_back(p);
  }
  mtx.lock();
  tzMin = s["tzOffsetMin"] | 60;
  dstRule = s["time"]["dst"] | "eu";
  ntpServer = s["time"]["ntp"] | "pool.ntp.org";
  ntpEnabled = s["time"]["ntpEnabled"] | true;
  hasLocation = !s["location"]["lat"].isNull();
  lat = s["location"]["lat"] | 0.0;
  lon = s["location"]["lon"] | 0.0;
  calendar = std::move(cal);
  mtx.unlock();
}

void begin() {
  static rtos::Thread thread(osPriorityNormal, 4096, nullptr, "ntp");   // DNS + UDP: needs some stack
  thread.start([] {
    rtos::ThisThread::sleep_for(std::chrono::seconds(3));   // let the network come up
    for (;;) {
      uint32_t now = millis();
      bool due = forceSync || (!syncedOnce && (!lastTryMs || now - lastTryMs > retryMs())) ||
                 (syncedOnce && now - lastTryMs > 6UL * 3600 * 1000);
      if (due && ntpEnabled && Net::up() && ntpServer.length()) {
        forceSync = false;
        ntpSync();
      }
      wake.wait_any_for(1, std::chrono::seconds(1));
    }
  });
}

void syncNow() { forceSync = true; wake.set(1); }

bool localTime(struct tm& out) {
  time_t utc = time(nullptr);
  if (utc < 1600000000) return false;
  time_t l = toLocal(utc);
  gmtime_r(&l, &out);
  return true;
}

int sunMinutes(bool rise) {
  Date d;
  if (!hasLocation || !today(d)) return -1;
  int utcMin = sunUtcMinutes(d.y, d.m, d.d, rise);
  if (utcMin < 0) return -1;
  time_t noon = daysFromCivil(d.y, d.m, d.d) * 86400L + 12 * 3600;
  int local = utcMin + tzMin + dstMinutes(noon);
  return ((local % 1440) + 1440) % 1440;
}

bool parseClock(const String& tok, int& minutes, String& err) {
  String t = tok;
  t.toLowerCase();
  if (t.startsWith("sunrise") || t.startsWith("sunset")) {
    bool rise = t.startsWith("sunrise");
    String rest = t.substring(rise ? 7 : 6);
    int off = rest.length() ? rest.toInt() : 0;  // "+15" / "-30"
    if (rest.length() && rest[0] != '+' && rest[0] != '-') { err = "use sunset-30 or sunrise+15"; return false; }
    if (!hasLocation) { err = "set the location (Schedule page) for sunrise/sunset"; return false; }
    int m = sunMinutes(rise);
    if (m < 0) { err = "no sunrise/sunset today (or clock not set)"; return false; }
    minutes = ((m + off) % 1440 + 1440) % 1440;
    return true;
  }
  int h = -1, m = -1;
  if (sscanf(t.c_str(), "%d:%d", &h, &m) != 2 || h < 0 || h > 23 || m < 0 || m > 59) { err = "expected HH:MM, sunrise or sunset"; return false; }
  minutes = h * 60 + m;
  return true;
}

bool calendarActive(const String& name, bool& known) {
  Date t;
  known = false;
  bool active = false;
  bool haveDate = today(t);
  mtx.lock();
  for (auto& p : calendar)
    if (p.name.equalsIgnoreCase(name)) {
      known = true;
      if (haveDate && inPeriod(t, p.from, p.to)) active = true;  // several periods may share a name
    }
  mtx.unlock();
  return active;
}

bool dateBetween(const String& from, const String& to, String& err) {
  Date a, b, t;
  if (!parseDate(from, a) || !parseDate(to, b)) { err = "dates are MM-DD or YYYY-MM-DD"; return false; }
  if (!today(t)) return false;
  return inPeriod(t, a, b);
}

void statusJson(JsonObject o) {
  struct tm t;
  bool set = localTime(t);
  o["set"] = set;
  if (set) {
    char buf[24];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &t);
    o["local"] = buf;
    o["dst"] = dstMinutes(time(nullptr)) > 0;
  }
  o["tzOffsetMin"] = tzMin;
  o["dstRule"] = dstRule;
  JsonObject n = o["ntp"].to<JsonObject>();
  n["enabled"] = ntpEnabled;
  n["server"] = ntpServer;
  n["lastSync"] = lastSync;
  n["offset"] = lastOffset;
  mtx.lock();
  String err = lastError;
  mtx.unlock();
  if (err.length()) n["error"] = err;
  if (hasLocation) {
    o["lat"] = lat;
    o["lon"] = lon;
    int r = sunMinutes(true), s = sunMinutes(false);
    char buf[16];
    if (r >= 0) { snprintf(buf, sizeof(buf), "%02d:%02d", r / 60, r % 60); o["sunrise"] = buf; }
    if (s >= 0) { snprintf(buf, sizeof(buf), "%02d:%02d", s / 60, s % 60); o["sunset"] = buf; }
  }
  JsonArray act = o["calendar"].to<JsonArray>();
  Date d;
  if (today(d)) {
    mtx.lock();
    for (auto& p : calendar)
      if (inPeriod(d, p.from, p.to)) {
        bool dup = false;
        for (JsonVariant v : act) if (p.name == v.as<const char*>()) dup = true;
        if (!dup) act.add(p.name);
      }
    mtx.unlock();
  }
}

}  // namespace Clock
