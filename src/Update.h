#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Ethernet.h>

// Software update over the network: a .kdupdate file (tools/make_update.py) holds the
// firmware and/or the web UI. The web UI goes to /usb/www, the firmware to the QSPI
// flash (partition 2, FAT, /ota/UPDATE.BIN); the Arduino bootloader (version 22 or
// newer) copies it into the processor's flash on the next restart.
namespace Update {
void begin();   // mounts the QSPI update partition, reports how the last update went
void poll();    // main loop: restarts once an update is armed
// PUT /api/update: streams the package from the client, checks it and installs it.
// restart = the firmware is armed and the controller restarts in a moment.
bool receive(EthernetClient& c, size_t len, String& msg, bool& restart);
void statusJson(JsonObject o);
}  // namespace Update
