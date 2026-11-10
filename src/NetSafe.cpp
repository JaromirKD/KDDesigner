#include "NetSafe.h"
#include "BigRam.h"
#include "Config.h"
#include "Log.h"
#include "Storage.h"

namespace {
String addrText(IPAddress a) { return a == IPAddress(0, 0, 0, 0) ? String("") : a.toString(); }

// The "network" object of project.json for a setting.
String cfgJson(const NetConfig& c) {
  JsonDocument d;
  d["dhcp"] = c.dhcp;
  d["ip"] = addrText(c.ip);
  d["mask"] = addrText(c.mask);
  d["gateway"] = addrText(c.gateway);
  d["dns"] = addrText(c.dns);
  d["dns2"] = addrText(c.dns2);
  String s;
  serializeJson(d, s);
  return s;
}

// End (exclusive) of the string starting at t[i] == '"'.
size_t skipString(const char* t, size_t n, size_t i) {
  for (i++; i < n && t[i] != '"'; i++)
    if (t[i] == '\\') i++;
  return i < n ? i + 1 : n;
}
// End (exclusive) of the JSON value starting at t[i].
size_t skipValue(const char* t, size_t n, size_t i) {
  if (i >= n) return n;
  if (t[i] == '"') return skipString(t, n, i);
  if (t[i] != '{' && t[i] != '[') {
    while (i < n && t[i] != ',' && t[i] != '}' && t[i] != ']') i++;
    return i;
  }
  int depth = 0;
  for (; i < n; i++) {
    if (t[i] == '"') { i = skipString(t, n, i) - 1; continue; }
    if (t[i] == '{' || t[i] == '[') depth++;
    else if ((t[i] == '}' || t[i] == ']') && --depth == 0) return i + 1;
  }
  return n;
}
// The value of a top-level key: [vs, ve). The text is only scanned, never parsed whole, so
// the rest of the file stays byte for byte as the editor saved it.
bool findTop(const char* t, size_t n, const char* key, size_t& vs, size_t& ve) {
  size_t klen = strlen(key);
  int depth = 0;
  for (size_t i = 0; i < n; i++) {
    char ch = t[i];
    if (ch == '"') {
      size_t e = skipString(t, n, i);
      bool match = depth == 1 && e - i - 2 == klen && !memcmp(t + i + 1, key, klen);
      i = e - 1;
      if (!match) continue;
      size_t k = e;
      while (k < n && isspace((unsigned char)t[k])) k++;
      if (k >= n || t[k] != ':') continue;
      for (k++; k < n && isspace((unsigned char)t[k]); k++) {}
      vs = k;
      ve = skipValue(t, n, k);
      return true;
    }
    if (ch == '{' || ch == '[') depth++;
    else if (ch == '}' || ch == ']') depth--;
  }
  return false;
}

// Replaces project.json's "network" (or, setDhcp, only switches it to DHCP), written like a
// save: tmp file, the previous version as .bak, swap.
bool rewriteNetwork(const String* obj, bool setDhcp) {
  BigRam::Buffer f;
  if (!Storage::readFile(KD_PROJECT_PATH, f) || !f.len) return false;
  size_t vs = 0, ve = 0;
  bool found = findTop(f.data, f.len, "network", vs, ve);
  String now;
  if (setDhcp) {
    JsonDocument d;
    if (found) deserializeJson(d, f.data + vs, ve - vs);
    if (!d.is<JsonObject>()) d.to<JsonObject>();
    d["dhcp"] = true;
    serializeJson(d, now);
  } else now = *obj;
  BigRam::Text out;
  if (found) {
    out.add(f.data, vs);
    out.add(now);
    out.add(f.data + ve, f.len - ve);
  } else {
    // No network yet: add it before the closing brace of the project.
    size_t end = f.len;
    while (end > 0 && f.data[end - 1] != '}') end--;
    if (!end) return false;
    size_t open = 0;
    while (open < end && f.data[open] != '{') open++;
    bool empty = true;
    for (size_t i = open + 1; i < end - 1; i++) if (!isspace((unsigned char)f.data[i])) { empty = false; break; }
    out.add(f.data, end - 1);
    out.add(empty ? "\"network\":" : ",\"network\":");
    out.add(now);
    out.add(f.data + end - 1, f.len - end + 1);
  }
  if (out.failed || !Storage::writeFile(KD_PROJECT_TMP, out.data, out.len)) return false;
  remove(KD_PROJECT_BAK);
  rename(KD_PROJECT_PATH, KD_PROJECT_BAK);
  rename(KD_PROJECT_TMP, KD_PROJECT_PATH);
  return true;
}
}  // namespace

namespace NetSafe {
void bootCheck() {
  if (!Storage::mounted()) return;
  String back;
  if (Storage::exists(KD_NET_TRIAL_PATH) && Storage::readFile(KD_NET_TRIAL_PATH, back, 1024) && back.length()) {
    if (rewriteNetwork(&back, false))
      LOGW(Net, "A network test was not confirmed before the restart: the previous setting is back (%s)", back.c_str());
    else LOGE(Net, "A network test was not confirmed before the restart, but project.json could not be changed back");
    remove(KD_NET_TRIAL_PATH);
  }
  if (Storage::exists(KD_NET_RESET_PATH)) {
    if (rewriteNetwork(nullptr, true))
      LOGW(Net, "network-reset.txt on the stick: the network setting is now DHCP (fallback 172.16.1.111 without a DHCP server). The file was removed.");
    else LOGE(Net, "network-reset.txt on the stick, but project.json could not be changed (no project?) - using DHCP this time");
    remove(KD_NET_RESET_PATH);
  }
}

bool startTry(const NetConfig& cfg, String& msg) {
  NetConfig old;
  if (!Net::requestTry(cfg, old, msg)) return false;
  String j = cfgJson(old);
  if (!Storage::writeFile(KD_NET_TRIAL_PATH, j.c_str(), j.length()))
    LOGW(Net, "Network test: could not write %s (a restart during the test would keep the new setting)", KD_NET_TRIAL_PATH);
  msg = "Switching; back after " + String(KD_NET_TRIAL_MS / 1000) + " s unless confirmed";
  return true;
}

bool confirm(String& msg) {
  bool ok = Net::confirm();
  if (ok) remove(KD_NET_TRIAL_PATH);
  msg = ok ? "Network setting kept" : "Nothing to confirm (no network test running, or it only just started)";
  return ok;
}

void idle() {
  NetConfig old;
  // A save still being written would swap in its own project.json after this rewrite (and
  // this one would read the file before it): next time round.
  if (Storage::projectBusy()) return;
  if (!Net::takeRevert(old)) return;
  String j = cfgJson(old);
  if (!rewriteNetwork(&j, false)) LOGE(Net, "Network test went back, but project.json could not be changed back: check Settings > Network");
  remove(KD_NET_TRIAL_PATH);
}
}  // namespace NetSafe
