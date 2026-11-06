#pragma once
#include <Arduino.h>
#include <stdio.h>
#include "BigRam.h"

// USB mass-storage (FAT32 stick) mounted at /usb. Hot-plug is detected in poll().
namespace Storage {
void begin(uint32_t waitMs);   // powers the USB-A port and waits for a stick
void poll();                   // call from the main loop
bool mounted();

bool readFile(const char* path, String& out, size_t maxLen = 256 * 1024);
bool readFile(const char* path, BigRam::Buffer& out, size_t maxLen = 4 * 1024 * 1024);   // big files (project)
bool writeFile(const char* path, const char* data, size_t len);
bool exists(const char* path);
}  // namespace Storage
