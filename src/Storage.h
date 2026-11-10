#pragma once
#include <Arduino.h>
#include <stdio.h>
#include <vector>
#include "BigRam.h"

// USB mass-storage (FAT32 stick) mounted at /usb. Hot-plug is detected in poll().
namespace Storage {
void begin(uint32_t waitMs);   // powers the USB-A port and waits for a stick
void poll();                   // call from the main loop
bool mounted();

bool readFile(const char* path, String& out, size_t maxLen = 256 * 1024);
bool readFile(const char* path, BigRam::Buffer& out, size_t maxLen = 4 * 1024 * 1024);   // big files (project)
// buf/bufLen: a caller's buffer in internal RAM for the pieces (default: 8 KB from the heap).
bool writeFile(const char* path, const char* data, size_t len, char* buf = nullptr, size_t bufLen = 0);
bool exists(const char* path);

// project.json is written by its own thread ("save"): a save from the web UI answers as soon
// as the project is loaded, the stick write (~2 s for a big show) runs after. Written like
// before: tmp file, the previous version into the backups, swap - a power cut during the
// write keeps the previous version. A newer save while one is being written waits; one that
// was still waiting is replaced (only the newest gets written).
void beginWriter();
uint32_t saveProject(char* data, size_t len);   // takes the block (BigRam::alloc), returns its number
bool projectBusy();                             // a saved version is not on the stick yet
bool waitProject(uint32_t ms);                  // true = everything written (or failed)
// The newest saved text while it is not on the stick yet (what GET /api/project must serve):
// calls send() with it (under the writer's lock) and returns true; false = read the file.
bool latestProject(void (*send)(const char* data, size_t len, void* ctx), void* ctx);
void saveStatusJson(JsonObject o);              // /api/status "save"

// Project backups (KD_BACKUP_DIR): a save moves the previous project.json there as
// "YYYY-MM-DD_HH-MM-SS.json" (the time it was replaced; a rename, so it costs no write time)
// and keeps the newest KD_BACKUPS. Names sort oldest first.
bool keepBackup(const char* path);
std::vector<String> backups();
bool backupName(const String& name);   // a safe name of one (no paths)

// A file read line by line (fgets) through an 8 KB stdio buffer. stdio's own is 1 KB, so every
// refill was a USB command for two sectors (~70 KB/s): searching the log files took seconds.
// 8 KB goes as one command. Close before the buffer goes: the destructor does both.
struct Reader {
  FILE* f = nullptr;
  explicit Reader(const char* path);
  ~Reader();
  Reader(const Reader&) = delete;
  Reader& operator=(const Reader&) = delete;

 private:
  char* buf = nullptr;
};
}  // namespace Storage
