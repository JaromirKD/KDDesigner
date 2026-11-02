#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// Show PCs: Wake-on-LAN plus text commands over UDP (default port 7).
// Project JSON:
//   "pcs": [{"id":1,"name":"Media PC","ip":"192.168.1.40","mac":"00:11:22:33:44:55",
//            "port":7,"broadcast":"",            // "" = subnet broadcast
//            "startup":"startup","shutdown":"shutdown","reboot":"reboot"}]
namespace Pcs {
void load();                                   // caller holds g_engine
int find(const String& ref);                   // id or name, -1 if unknown
// action: wake | startup | shutdown | reboot. idx < 0 = all PCs.
bool run(int idx, const String& action, String& msg);
void statusJson(JsonArray arr);
}  // namespace Pcs
