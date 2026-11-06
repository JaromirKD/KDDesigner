#include "Update.h"
#include <BlockDevice.h>
#include <FATFileSystem.h>
#include <MBRBlockDevice.h>
#include <mbed.h>   // also opendir/readdir (mbed_retarget.h)
#include <sys/stat.h>
#include <time.h>
#include <vector>
#include "Config.h"
#include "Log.h"
#include "Storage.h"

using namespace std::chrono_literals;

namespace {

#ifdef KD_BOARD_PMC
const char kTarget[] = "machine_control";
#else
const char kTarget[] = "portenta";
#endif

// Same place and flags as Arduino's Portenta OTA library: QSPI partition 2, FAT,
// file UPDATE.BIN. The bootloader reads them from the RTC backup registers.
const int kPart = 2;
const uint32_t kBootFlag = 0x07AA;
const uint32_t kStorageQspiFatMbr = (1 << 2) | (1 << 5) | (1 << 7);
const char kFw[] = "/ota/UPDATE.BIN";
const char kFwTmp[] = "/ota/UPDATE.TMP";
const char kInfo[] = "/ota/KDUPD.TXT";     // "<old version>\n<new version>\n", for the log after the restart
const char kWwwNew[] = "/usb/www_new";
const char kWwwOld[] = "/usb/www_old";
// The M7 program: after the 256 KB bootloader, up to the 1 MB M7 half of the flash
// (the build's "Flash: ... from 786432 bytes").
const uint32_t kAppStart = 0x08040000, kAppEnd = 0x08100000;

mbed::BlockDevice* raw = nullptr;
mbed::MBRBlockDevice* part = nullptr;
mbed::FATFileSystem otafs("ota");
bool mounted = false;
uint8_t bootloader = 0;
String problem;            // why a firmware update can't be done, shown on Settings
String last;               // "0.1.0 -> 0.2.0" after an update
bool lastOk = false;
uint32_t restartAt = 0;

bool bootloaderOk() { return bootloader >= 22 && bootloader != 0xFF; }

uint32_t crc32(uint32_t crc, const uint8_t* p, size_t n) {
  while (n--) {
    crc ^= *p++;
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320 & (0 - (crc & 1)));
  }
  return crc;
}

void backupAccess() {
  (void)time(nullptr);   // makes sure Mbed has started the RTC (holds the backup registers)
  PWR->CR1 |= PWR_CR1_DBP;
  while (!(PWR->CR1 & PWR_CR1_DBP)) {}
}

// Tells the bootloader to install UPDATE.BIN on the next restart.
void arm(uint32_t size) {
  backupAccess();
  RTC->BKP0R = kBootFlag;
  RTC->BKP1R = kStorageQspiFatMbr;
  RTC->BKP2R = kPart;
  RTC->BKP3R = size;
}

void removeTree(const String& path) {
  DIR* d = opendir(path.c_str());
  if (!d) { remove(path.c_str()); return; }
  // Collect first: deleting while reading the folder skips entries.
  std::vector<String> names;
  struct dirent* e;
  while ((e = readdir(d)) != nullptr) {
    String n = e->d_name;
    if (n != "." && n != "..") names.push_back(n);
  }
  closedir(d);
  for (auto& n : names) removeTree(path + "/" + n);
  remove(path.c_str());
}

void makeDirs(const String& file) {
  for (int i = strlen(kWwwNew) + 1; i < (int)file.length(); i++)
    if (file[i] == '/') mkdir(file.substring(0, i).c_str(), 0777);
}

// "www/<path>": letters, digits, . - _ and / only, no "..".
bool wwwName(const String& n) {
  if (!n.startsWith("www/") || n.length() < 5 || n.length() > 100 || n.endsWith("/")) return false;
  if (n.indexOf("..") >= 0 || n.indexOf("//") >= 0) return false;
  for (size_t i = 0; i < n.length(); i++)
    if (!isalnum(n[i]) && n[i] != '.' && n[i] != '-' && n[i] != '_' && n[i] != '/') return false;
  return true;
}

// Reads exactly the request body, with the same 10 s stall timeout as media uploads.
struct Reader {
  EthernetClient& c;
  size_t left;
  size_t read(uint8_t* buf, size_t n) {
    n = min(n, left);
    size_t got = 0;
    uint32_t t0 = millis();
    while (got < n && millis() - t0 < 10000) {
      int r = c.read(buf + got, n - got);
      if (r > 0) { got += r; t0 = millis(); }
      else if (!c.connected()) break;
      else rtos::ThisThread::sleep_for(1ms);
    }
    left -= got;
    return got;
  }
  bool line(String& out, size_t max) {
    out = "";
    uint8_t ch;
    while (out.length() < max) {
      if (read(&ch, 1) != 1) return false;
      if (ch == '\n') return true;
      out += (char)ch;
    }
    return false;
  }
  // The rest of the body, so the browser gets the error instead of a reset connection.
  void drain() {
    uint8_t buf[512];
    while (left && read(buf, sizeof(buf))) {}
  }
};

// After a restart: did the bootloader install what we left in UPDATE.BIN?
void checkLast() {
  backupAccess();
  if (RTC->BKP0R == kBootFlag) RTC->BKP0R = 0;   // not picked up: don't try again on every boot
  FILE* f = fopen(kFw, "rb");
  if (!f) return;
  uint8_t buf[512];
  uint32_t crc = 0xFFFFFFFF, size = 0;
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), f)) > 0) { crc = crc32(crc, buf, n); size += n; }
  fclose(f);
  bool same = size && size <= kAppEnd - kAppStart &&
              crc32(0xFFFFFFFF, (const uint8_t*)kAppStart, size) == crc;
  String from, to;
  FILE* i = fopen(kInfo, "r");
  if (i) {
    char l[40];
    if (fgets(l, sizeof(l), i)) { from = l; from.trim(); }
    if (fgets(l, sizeof(l), i)) { to = l; to.trim(); }
    fclose(i);
  }
  last = (from.length() ? from : "?") + " -> " + (to.length() ? to : "?");
  lastOk = same;
  if (same) LOGI(Sys, "Firmware updated: %s", last.c_str());
  else LOGE(Sys, "Firmware update %s was NOT installed (still running %s) - try again, or update over USB", last.c_str(), KD_VERSION);
  remove(kFw);
  remove(kInfo);
}

bool install(Reader& in, String& msg, bool& restart) {
  if (restartAt) { msg = "An update is already waiting for the restart"; return false; }
  String line;
  if (!in.line(line, 32) || line != "KDUPDATE 1") { msg = "Not a KD Designer update file (.kdupdate)"; return false; }
  JsonDocument d;
  if (!in.line(line, 16384) || deserializeJson(d, line)) { msg = "Damaged update file (header)"; return false; }
  String version = d["version"] | "", target = d["target"] | "";
  JsonArray files = d["files"];
  size_t total = 0;
  bool hasFw = false, hasWww = false;
  for (JsonObject f : files) {
    String n = f["name"] | "";
    if (n == "firmware.bin") hasFw = true;
    else if (wwwName(n)) hasWww = true;
    else { msg = "Bad file name in the update: " + n; return false; }
    total += f["size"].as<uint32_t>();
  }
  if (!hasFw && !hasWww) { msg = "The update file is empty"; return false; }
  if (total != in.left) { msg = "Upload incomplete or damaged (size)"; return false; }
  if ((hasFw || target != "any") && target != kTarget) {
    msg = "This update is for a " + target + " controller, this one is " + kTarget;
    return false;
  }
  if (hasFw && !(mounted && bootloaderOk())) { msg = "Firmware update not possible here: " + problem; return false; }
  if (hasWww && !Storage::mounted()) { msg = "No storage device (the web UI lives on it)"; return false; }
  LOGI(Sys, "Receiving update %s (%u KB)", version.c_str(), (unsigned)(total / 1024));

  if (hasWww) { removeTree(kWwwNew); mkdir(kWwwNew, 0777); }
  if (hasFw) { remove(kFwTmp); remove(kFw); }
  uint8_t buf[1024];
  uint32_t fwSize = 0;
  for (JsonObject f : files) {
    String name = f["name"] | "";
    size_t size = f["size"].as<uint32_t>();
    bool fw = name == "firmware.bin";
    String path = fw ? String(kFwTmp) : String(kWwwNew) + name.substring(3);   // www/x -> /usb/www_new/x
    if (!fw) makeDirs(path);
    FILE* out = fopen(path.c_str(), "wb");
    if (!out) { msg = "Cannot write " + name + (fw ? " to the QSPI flash" : " to the storage device"); return false; }
    uint32_t crc = 0xFFFFFFFF, vec[2] = {0, 0};
    size_t got = 0;
    bool written = true;
    while (got < size) {
      size_t n = in.read(buf, min(sizeof(buf), size - got));
      if (!n) break;
      if (fw && got == 0 && n >= sizeof(vec)) memcpy(vec, buf, sizeof(vec));
      crc = crc32(crc, buf, n);
      if (fwrite(buf, 1, n, out) != n) { written = false; break; }
      got += n;
    }
    fclose(out);
    if (!written) { msg = "Writing " + name + " failed (storage full?)"; return false; }
    if (got != size) { msg = "Upload incomplete"; return false; }
    if ((crc ^ 0xFFFFFFFF) != f["crc"].as<uint32_t>()) { msg = "Damaged update file (" + name + " checksum)"; return false; }
    if (fw) {
      // Vector table: stack in RAM, start address inside the M7 program area.
      bool ramStack = (vec[0] >> 24) == 0x24 || (vec[0] >> 24) == 0x20;
      if (size > kAppEnd - kAppStart || !ramStack || vec[1] < kAppStart || vec[1] >= kAppEnd) {
        msg = "firmware.bin is not a Portenta H7 (M7) program";
        return false;
      }
      fwSize = size;
    }
  }

  // Everything arrived intact: now swap the web UI folder and arm the firmware.
  if (hasWww) {
    removeTree(kWwwOld);
    rename(KD_WWW_ROOT, kWwwOld);
    if (rename(kWwwNew, KD_WWW_ROOT) != 0) {
      rename(kWwwOld, KD_WWW_ROOT);
      msg = "Could not replace the web UI folder";
      return false;
    }
    removeTree(kWwwOld);
    LOGI(Sys, "Web UI updated (%s)", version.c_str());
  }
  if (hasFw) {
    if (rename(kFwTmp, kFw) != 0) { msg = "Could not store the firmware"; return false; }
    FILE* i = fopen(kInfo, "w");
    if (i) { fprintf(i, "%s\n%s\n", KD_VERSION, version.c_str()); fclose(i); }
    arm(fwSize);
    restartAt = millis() + 2000;   // time for the reply to reach the browser
    restart = true;
    LOGI(Sys, "Firmware %s stored - restarting to install it", version.c_str());
    msg = "Firmware " + version + " stored, restarting to install it";
  } else {
    msg = "Web UI updated";
  }
  return true;
}

}  // namespace

namespace Update {

void begin() {
  bootloader = ((const uint8_t*)0x0801F000)[1];
  if (!bootloaderOk()) problem = "the bootloader (version " + String(bootloader) + ") is too old - update it once over USB (see README)";
  raw = mbed::BlockDevice::get_default_instance();
  if (!raw || raw->init() != 0) { problem = "no QSPI flash found"; return; }
  part = new mbed::MBRBlockDevice(raw, kPart);
  if (part->init() != 0) {
    // A board whose QSPI flash was never prepared: add partition 2 only (1-15 MB),
    // as Arduino's QSPIFormat does, leaving room for the WiFi firmware partition 1.
    if (raw->size() < 16UL * 1024 * 1024 ||
        mbed::MBRBlockDevice::partition(raw, kPart, 0x0B, 1UL * 1024 * 1024, 15UL * 1024 * 1024) != 0 ||
        part->init() != 0) {
      problem = "cannot prepare the QSPI flash";
      LOGE(Sys, "Update: %s", problem.c_str());
      return;
    }
    LOGI(Sys, "Update: made partition 2 on the QSPI flash");
  }
  if (otafs.mount(part) != 0) {
    LOGW(Sys, "Update: formatting partition 2 of the QSPI flash (FAT)");
    if (otafs.reformat(part) != 0) {
      problem = "cannot format the QSPI flash";
      LOGE(Sys, "Update: %s", problem.c_str());
      return;
    }
  }
  mounted = true;
  checkLast();
  if (!bootloaderOk()) LOGW(Sys, "Update: %s", problem.c_str());
}

void poll() {
  if (!restartAt || (int32_t)(millis() - restartAt) < 0) return;
  Log::flush();
  otafs.unmount();
  Log::markPlannedRestart();   // "Last start: restart", not "unexpected"
  NVIC_SystemReset();
}

bool receive(EthernetClient& c, size_t len, String& msg, bool& restart) {
  restart = false;
  Reader in{c, len};
  bool ok = install(in, msg, restart);
  if (!ok) {
    in.drain();
    removeTree(kWwwNew);
    if (mounted) remove(kFwTmp);
    LOGW(Sys, "Update rejected: %s", msg.c_str());
  }
  return ok;
}

void statusJson(JsonObject o) {
  o["target"] = kTarget;
  o["ready"] = mounted && bootloaderOk();
  o["bootloader"] = bootloader;
  if (problem.length()) o["problem"] = problem;
  if (last.length()) { o["last"] = last; o["lastOk"] = lastOk; }
  if (restartAt) o["restarting"] = true;
}

}  // namespace Update
