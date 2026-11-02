#include "Pcs.h"
#include <algorithm>
#include <vector>
#include "Log.h"
#include "Net.h"
#include "Show.h"
#include "Triggers.h"
#include "Util.h"

namespace {
struct Pc {
  int id = 0;
  String name;
  IPAddress ip, broadcast;
  bool hasMac = false, hasBroadcast = false;
  uint8_t mac[6];
  uint16_t port = 7;
  String startup, shutdown, reboot;
  String last;                  // last action + time, for the UI
};

std::vector<Pc> pcs;

bool parseMac(const char* s, uint8_t out[6]) {
  // Accepts 00:11:22:33:44:55, 00-11-22-33-44-55 or 001122334455.
  int n = 0;
  for (const char* p = s; *p && n < 12;) {
    if (isxdigit(*p) && isxdigit(p[1])) {
      char hex[3] = {p[0], p[1], 0};
      out[n / 2] = strtol(hex, nullptr, 16);
      n += 2;
      p += 2;
    } else if (*p == ':' || *p == '-' || *p == '.' || *p == ' ') {
      p++;
    } else {
      return false;
    }
  }
  return n == 12;
}

IPAddress subnetBroadcast() {
  IPAddress ip = Net::localIP(), mask = Ethernet.subnetMask();
  return IPAddress(ip[0] | ~mask[0], ip[1] | ~mask[1], ip[2] | ~mask[2], ip[3] | ~mask[3]);
}

String stamp(const String& what) {
  uint32_t s = millis() / 1000;
  char t[16];
  snprintf(t, sizeof(t), "%lu:%02lu:%02lu", (unsigned long)(s / 3600), (unsigned long)(s / 60 % 60), (unsigned long)(s % 60));
  return what + " @ " + t + " uptime";
}

bool wake(Pc& pc, String& err) {
  if (!pc.hasMac) { err = pc.name + ": no MAC address"; return false; }
  // Magic packet: 6 x 0xFF followed by the MAC 16 times.
  uint8_t pkt[102];
  memset(pkt, 0xff, 6);
  for (int i = 0; i < 16; i++) memcpy(pkt + 6 + i * 6, pc.mac, 6);
  IPAddress to = pc.hasBroadcast ? pc.broadcast : subnetBroadcast();
  Triggers::sendRaw(to, 9, pkt, sizeof(pkt));  // the usual WoL port
  Triggers::sendRaw(to, 7, pkt, sizeof(pkt));  // some NICs listen on 7
  LOGI(Sys, "Wake-on-LAN sent to %s (%02X:%02X:%02X:%02X:%02X:%02X via %s)", pc.name.c_str(), pc.mac[0], pc.mac[1],
       pc.mac[2], pc.mac[3], pc.mac[4], pc.mac[5], to.toString().c_str());
  pc.last = stamp("wake");
  return true;
}

bool command(Pc& pc, const String& action, String& err) {
  const String& text = action == "startup" ? pc.startup : action == "shutdown" ? pc.shutdown : pc.reboot;
  if (!text.length()) { err = pc.name + ": no '" + action + "' command"; return false; }
  Triggers::sendRaw(pc.ip, pc.port, (const uint8_t*)text.c_str(), text.length());
  LOGI(Sys, "PC %s: '%s' sent to %s:%u", pc.name.c_str(), text.c_str(), pc.ip.toString().c_str(), pc.port);
  pc.last = stamp(action);
  return true;
}
}  // namespace

namespace Pcs {

void load() {
  pcs.clear();
  for (JsonObjectConst o : Show::projectDoc()["pcs"].as<JsonArrayConst>()) {
    Pc pc;
    pc.id = o["id"] | 0;
    pc.name = o["name"] | "";
    if (!pc.ip.fromString(o["ip"] | "")) { LOGW(Sys, "PC %d '%s': invalid IP", pc.id, pc.name.c_str()); continue; }
    pc.hasMac = parseMac(o["mac"] | "", pc.mac);
    if (!pc.hasMac) LOGW(Sys, "PC %d '%s': no valid MAC, Wake-on-LAN disabled", pc.id, pc.name.c_str());
    pc.hasBroadcast = pc.broadcast.fromString(o["broadcast"] | "");
    pc.port = o["port"] | 7;
    pc.startup = o["startup"] | "startup";
    pc.shutdown = o["shutdown"] | "shutdown";
    pc.reboot = o["reboot"] | "reboot";
    pcs.push_back(pc);
  }
  LOGI(Sys, "%d PC(s) loaded", (int)pcs.size());
}

int find(const String& ref) {
  return findRef(ref, pcs.size(), [](int i) { return pcs[i].id; }, [](int i) -> const String& { return pcs[i].name; });
}

bool run(int idx, const String& action, String& msg) {
  String a = action;
  a.toLowerCase();
  if (a != "wake" && a != "startup" && a != "shutdown" && a != "reboot") { msg = "action must be wake|startup|shutdown|reboot"; return false; }
  if (pcs.empty()) { msg = "no PCs configured"; return false; }
  bool ok = true;
  int n = 0;
  for (size_t i = 0; i < pcs.size(); i++) {
    if (idx >= 0 && (int)i != idx) continue;
    String err;
    if (a == "wake" ? wake(pcs[i], err) : command(pcs[i], a, err)) n++;
    else { ok = false; msg = err; LOGW(Sys, "%s", err.c_str()); }
  }
  if (ok) msg = String(a == "wake" ? "Wake-on-LAN" : "'" + a + "'") + " sent to " + (idx >= 0 ? pcs[idx].name : String(n) + " PC(s)");
  return ok;
}

void statusJson(JsonArray arr) {
  for (auto& pc : pcs) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = pc.id;
    o["last"] = pc.last;
  }
}

}  // namespace Pcs
