#include "Storage.h"
#include <Arduino_USBHostMbed5.h>
#include <FATFileSystem.h>
#include <sys/stat.h>
#include "Config.h"
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
    out.len = fread(out.data, 1, size, f);
    out.data[out.len] = 0;
    ok = out.len == (size_t)size;
  }
  fclose(f);
  return ok;
}

bool writeFile(const char* path, const char* data, size_t len) {
  if (!isMounted) return false;
  FILE* f = fopen(path, "wb");
  if (!f) return false;
  size_t n = fwrite(data, 1, len, f);
  fclose(f);
  return n == len;
}

}  // namespace Storage
