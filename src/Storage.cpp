#include "Storage.h"
#include <Arduino_USBHostMbed5.h>
#include <FATFileSystem.h>
#include <mbed.h>   // opendir/readdir (mbed_retarget.h)
#include <sys/stat.h>
#include <algorithm>
#include "Clock.h"
#include "Config.h"
#include "D2Ram.h"
#include "Log.h"

namespace {
USBHostMSD msd;
mbed::FATFileSystem usbfs("usb");
bool isMounted = false;
uint32_t lastPoll = 0;

void tryMount() {
  if (!msd.connect()) return;
  int err = usbfs.mount(&msd);
  if (err) {
    LOGE(Usb, "Mount failed (%d). Is the storage device FAT32?", err);
    return;
  }
  isMounted = true;
  mkdir("/usb/show", 0777);
  mkdir(KD_MEDIA_DIR, 0777);
  mkdir(KD_BACKUP_DIR, 0777);
  mkdir("/usb/logs", 0777);
  mkdir("/usb/www", 0777);
  LOGI(Usb, "Storage device mounted at /usb");
}
}  // namespace

namespace Storage {

void begin(uint32_t waitMs) {
  pinMode(KD_USB_POWER_PIN, OUTPUT);
  digitalWrite(KD_USB_POWER_PIN, KD_USB_POWER_ON);
  uint32_t t0 = millis();
  while (!isMounted && millis() - t0 < waitMs) {
    tryMount();
    if (!isMounted) delay(250);
  }
  if (!isMounted) LOGW(Usb, "No storage device found - running without storage");
}

void poll() {
  if (millis() - lastPoll < 1000) return;
  lastPoll = millis();
  if (isMounted && !msd.connected()) {
    usbfs.unmount();
    isMounted = false;
    LOGW(Usb, "Storage device removed");
  } else if (!isMounted) {
    tryMount();
  }
}

bool mounted() { return isMounted; }

bool exists(const char* path) {
  struct stat st;
  return isMounted && stat(path, &st) == 0;
}

bool readFile(const char* path, String& out, size_t maxLen) {
  if (!isMounted) return false;
  FILE* f = fopen(path, "rb");
  if (!f) return false;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (size < 0 || (size_t)size > maxLen) {
    fclose(f);
    LOGE(Usb, "%s too large (%ld bytes)", path, size);
    return false;
  }
  out = "";
  out.reserve(size + 1);
  char buf[512];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), f)) > 0) out.concat(buf, n);
  fclose(f);
  return true;
}

bool readFile(const char* path, BigRam::Buffer& out, size_t maxLen) {
  if (!isMounted) return false;
  FILE* f = fopen(path, "rb");
  if (!f) return false;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  bool ok = size >= 0 && (size_t)size <= maxLen && out.reserve(size);
  if (!ok) LOGE(Usb, "%s too large (%ld bytes)", path, size);
  else {
    // Through internal RAM: the buffer is in cached SDRAM (BigRam), and a big fread may let
    // the USB controller's DMA write it directly, behind the cache.
    char buf[512];
    size_t n;
    out.len = 0;
    while (out.len < (size_t)size && (n = fread(buf, 1, min(sizeof(buf), (size_t)size - out.len), f)) > 0) {
      memcpy(out.data + out.len, buf, n);
      out.len += n;
    }
    out.data[out.len] = 0;
    ok = out.len == (size_t)size;
  }
  fclose(f);
  return ok;
}

bool writeFile(const char* path, const char* data, size_t len, char* given, size_t givenLen) {
  if (!isMounted) return false;
  FILE* f = fopen(path, "wb");
  if (!f) return false;
  // In blocks through internal RAM: data may be in cached SDRAM (see readFile). Big blocks:
  // every write is a USB command to the stick with its own round trip, so 512-byte pieces
  // (one sector each) made a save crawl at ~36 KB/s. 16 sectors at a time go as one command
  // (the project writer gives 64, KD_MSD_BLOCKS). Unbuffered, so stdio doesn't cut them up
  // again into its own 1 KB pieces.
  setvbuf(f, nullptr, _IONBF, 0);
  static const size_t kBig = 8192;
  char small[512];
  char* buf = given ? given : (char*)malloc(kBig);
  size_t size = given ? givenLen : buf ? kBig : sizeof(small);
  if (!buf) buf = small;
  size_t n = 0;
  while (n < len) {
    size_t k = min(size, len - n);
    memcpy(buf, data + n, k);
    if (fwrite(buf, 1, k, f) != k) break;
    n += k;
  }
  if (buf != small && buf != given) free(buf);
  bool closed = fclose(f) == 0;   // the last FAT and directory updates happen here
  return n == len && closed;
}

bool backupName(const String& n) {
  if (n.length() < 6 || n.length() > 40 || !n.endsWith(".json")) return false;
  for (size_t i = 0; i < n.length(); i++)
    if (!isdigit(n[i]) && n[i] != '-' && n[i] != '_' && n[i] != '.' && !isalpha(n[i])) return false;
  return n.indexOf("..") < 0;
}

std::vector<String> backups() {
  std::vector<String> names;
  if (!isMounted) return names;
  DIR* d = opendir(KD_BACKUP_DIR);
  if (!d) return names;
  struct dirent* e;
  while ((e = readdir(d)) != nullptr) {
    String n = e->d_name;
    if (backupName(n)) names.push_back(n);
  }
  closedir(d);
  std::sort(names.begin(), names.end(), [](const String& a, const String& b) { return strcmp(a.c_str(), b.c_str()) < 0; });
  return names;
}

bool keepBackup(const char* path) {
  if (!isMounted || !exists(path)) return false;
  mkdir(KD_BACKUP_DIR, 0777);   // a stick from before backups existed
  struct tm t;
  char name[48];
  // Without a clock (no NTP yet) the name says so, and sorts before the dated ones (oldest).
  if (Clock::localTime(t))
    snprintf(name, sizeof(name), KD_BACKUP_DIR "/%04d-%02d-%02d_%02d-%02d-%02d.json", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
  else snprintf(name, sizeof(name), KD_BACKUP_DIR "/0000-noclock-%08lu.json", (unsigned long)(millis() / 1000));
  if (exists(name)) {   // two saves in one second
    size_t k = strlen(name) - 5;
    snprintf(name + k, sizeof(name) - k, "-2.json");
  }
  if (rename(path, name) != 0) { LOGW(Usb, "Backup %s failed", name); return false; }
  std::vector<String> all = backups();
  for (size_t i = 0; i + KD_BACKUPS < all.size(); i++) remove((String(KD_BACKUP_DIR "/") + all[i]).c_str());
  return true;
}

// ---- project.json in the background --------------------------------------------------
namespace {
struct SaveJob { char* data = nullptr; size_t len = 0; uint32_t seq = 0; };
rtos::Mutex smtx;                  // guards the jobs and the state below
rtos::EventFlags wake;
rtos::Thread saver(osPriorityNormal, 6 * 1024, nullptr, "save");   // like the http thread that did this before
SaveJob writing, waiting;          // writing.data is read by the save thread without the lock
uint32_t lastSeq = 0, writtenSeq = 0, failedSeq = 0, lastMs = 0;
String lastError;
char* piece = nullptr;             // 32 KB in D2 SRAM: 64 sectors = one USB command (KD_MSD_BLOCKS)
size_t pieceLen = 0;

bool writeProjectNow(const char* data, size_t len, String& err) {
  if (!isMounted) { err = "No storage device"; return false; }
  if (!writeFile(KD_PROJECT_TMP, data, len, piece, pieceLen)) { err = "Write to the storage device failed (full or removed?)"; return false; }
  // A stale .bak (only NetSafe still writes one) would win over the backups at boot: gone.
  remove(KD_PROJECT_BAK);
  if (!keepBackup(KD_PROJECT_PATH)) rename(KD_PROJECT_PATH, KD_PROJECT_BAK);
  if (rename(KD_PROJECT_TMP, KD_PROJECT_PATH) != 0) { err = "Could not replace project.json on the storage device"; return false; }
  return true;
}

void saverRun() {
  for (;;) {
    wake.wait_any(1);
    for (;;) {
      smtx.lock();
      if (!waiting.data) { smtx.unlock(); break; }
      writing = waiting;
      waiting = SaveJob();
      smtx.unlock();
      Log::crumb(Log::kCrumbWeb, "save: writing the stick");
      uint32_t t0 = millis();
      String err;
      bool ok = writeProjectNow(writing.data, writing.len, err);
      uint32_t ms = millis() - t0;
      smtx.lock();
      char* done = writing.data;
      size_t len = writing.len;
      if (ok) writtenSeq = writing.seq;
      else { failedSeq = writing.seq; lastError = err; }
      lastMs = ms;
      writing = SaveJob();
      smtx.unlock();
      BigRam::release(done);
      if (ok) LOGI(Usb, "Project written to the stick (%u bytes, %lu ms)", (unsigned)len, (unsigned long)ms);
      else LOGE(Usb, "Project NOT written to the stick: %s - it runs, but is lost at the next restart. Save again", err.c_str());
    }
  }
}
}  // namespace

void beginWriter() {
  // D2 SRAM if it has room (the playback buffers and the log ring come first), else 8 KB pieces.
  if (D2Ram::freeBytes() >= 32 * 1024 + 4096) { piece = (char*)D2Ram::alloc(32 * 1024, 32); pieceLen = 32 * 1024; }
  saver.start(saverRun);
}

uint32_t saveProject(char* data, size_t len) {
  smtx.lock();
  if (waiting.data) BigRam::release(waiting.data);   // never started: the newer one replaces it
  waiting = {data, len, ++lastSeq};
  uint32_t seq = lastSeq;
  smtx.unlock();
  wake.set(1);
  return seq;
}

bool projectBusy() {
  smtx.lock();
  bool busy = waiting.data || writing.data;
  smtx.unlock();
  return busy;
}

bool waitProject(uint32_t ms) {
  uint32_t t0 = millis();
  while (projectBusy()) {
    if (millis() - t0 >= ms) return false;
    rtos::ThisThread::sleep_for(std::chrono::milliseconds(20));
  }
  return true;
}

bool latestProject(void (*send)(const char*, size_t, void*), void* ctx) {
  smtx.lock();
  const SaveJob& j = waiting.data ? waiting : writing;
  bool have = j.data != nullptr;
  if (have) send(j.data, j.len, ctx);
  smtx.unlock();
  return have;
}

void saveStatusJson(JsonObject o) {
  smtx.lock();
  o["seq"] = lastSeq;          // the newest save
  o["written"] = writtenSeq;   // the newest one on the stick
  o["busy"] = waiting.data || writing.data;
  o["ms"] = lastMs;
  if (failedSeq > writtenSeq) { o["failed"] = failedSeq; o["error"] = lastError; }
  smtx.unlock();
}

Reader::Reader(const char* path) {
  if (!isMounted || !(f = fopen(path, "r"))) return;
  // Internal RAM (heap), like writeFile's buffer; the stick is driven by the CPU, no DMA.
  // No memory: stdio's own 1 KB buffer, slower but it works.
  if ((buf = (char*)malloc(8192))) setvbuf(f, buf, _IOFBF, 8192);
}

Reader::~Reader() {
  if (f) fclose(f);
  free(buf);
}

}  // namespace Storage
