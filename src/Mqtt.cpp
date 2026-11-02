#include "Mqtt.h"
#include <Ethernet.h>
#include <vector>
#include "Log.h"

namespace {

const size_t kMaxClients = 6;
const size_t kMaxPacket = 6 * 1024;   // NETIO's full status JSON is ~2-3 KB

struct Peer {
  EthernetClient c;
  IPAddress ip;
  String id;
  std::vector<uint8_t> rx;
  std::vector<String> filters;        // subscriptions
  uint32_t lastRx = 0, keepAliveMs = 0, since = 0;
  uint32_t messages = 0;
};

EthernetServer* server = nullptr;
uint16_t port = 0;
bool wanted = false;
std::vector<Peer> clients;
uint32_t total = 0;
String lastTopic, lastPayload;
rtos::Mutex mtx;   // guards clients + last message: service() runs in the push thread, statusJson in the web thread

void put(std::vector<uint8_t>& p, const String& s) {
  p.push_back(s.length() >> 8);
  p.push_back(s.length() & 0xff);
  for (size_t i = 0; i < s.length(); i++) p.push_back(s[i]);
}
void sendRaw(Peer& cl, const std::vector<uint8_t>& p) { cl.c.write(p.data(), p.size()); }
std::vector<uint8_t> fixed(uint8_t type, size_t len) {
  std::vector<uint8_t> p = {type};
  do { uint8_t b = len % 128; len /= 128; p.push_back(len ? b | 0x80 : b); } while (len);
  return p;
}

// MQTT topic filter: + = one level, # = the rest.
bool topicMatch(const String& filter, const String& topic) {
  size_t f = 0, t = 0;
  while (f < filter.length()) {
    if (filter[f] == '#') return true;
    if (filter[f] == '+') {
      while (t < topic.length() && topic[t] != '/') t++;
      f++;
      continue;
    }
    if (t >= topic.length() || filter[f] != topic[t]) return false;
    f++;
    t++;
  }
  return t == topic.length();
}

void forward(const String& topic, const String& payload, const Peer* from) {
  for (auto& cl : clients) {
    if (&cl == from) continue;
    for (auto& flt : cl.filters)
      if (topicMatch(flt, topic)) {
        std::vector<uint8_t> body;
        put(body, topic);
        for (size_t i = 0; i < payload.length(); i++) body.push_back(payload[i]);
        std::vector<uint8_t> p = fixed(0x30, body.size());
        p.insert(p.end(), body.begin(), body.end());
        sendRaw(cl, p);
        break;
      }
  }
}

String str(const uint8_t* p, size_t n) {
  String s;
  s.reserve(n);
  for (size_t i = 0; i < n; i++) s += (char)p[i];
  return s;
}

// One complete packet. Returns false to drop the client.
bool handle(Peer& cl, uint8_t hdr, const uint8_t* b, size_t n) {
  uint8_t type = hdr >> 4;
  switch (type) {
    case 1: {   // CONNECT: protocol name, level, flags, keep-alive, client id
      if (n < 10) return false;
      size_t at = 2 + (b[0] << 8 | b[1]);
      if (at + 6 > n) return false;
      cl.keepAliveMs = (uint32_t)(b[at + 2] << 8 | b[at + 3]) * 1000;
      size_t idLen = b[at + 4] << 8 | b[at + 5];
      cl.id = at + 6 + idLen <= n ? str(b + at + 6, idLen) : String("?");
      sendRaw(cl, {0x20, 0x02, 0x00, 0x00});   // CONNACK, accepted
      LOGI(Sys, "MQTT: %s connected as '%s'", cl.ip.toString().c_str(), cl.id.c_str());
      if (Mqtt::onClient) Mqtt::onClient(cl.ip, true);
      return true;
    }
    case 3: {   // PUBLISH
      if (n < 2) return false;
      size_t tl = b[0] << 8 | b[1];
      uint8_t qos = (hdr >> 1) & 3;
      size_t at = 2 + tl;
      if (at + (qos ? 2 : 0) > n) return false;
      String topic = str(b + 2, tl);
      uint16_t pid = qos ? (b[at] << 8 | b[at + 1]) : 0;
      if (qos) at += 2;
      String payload = str(b + at, n - at);
      if (qos == 1) sendRaw(cl, {0x40, 0x02, (uint8_t)(pid >> 8), (uint8_t)pid});        // PUBACK
      else if (qos == 2) sendRaw(cl, {0x50, 0x02, (uint8_t)(pid >> 8), (uint8_t)pid});   // PUBREC
      cl.messages++;
      total++;
      lastTopic = topic;
      lastPayload = payload.substring(0, 120);
      LOGD(Sys, "MQTT %s <- %s: %s", cl.id.c_str(), topic.c_str(), payload.substring(0, 80).c_str());
      if (Mqtt::onPublish) Mqtt::onPublish(cl.ip, topic, payload);
      forward(topic, payload, &cl);
      return true;
    }
    case 6:     // PUBREL -> PUBCOMP
      if (n >= 2) sendRaw(cl, {0x70, 0x02, b[0], b[1]});
      return true;
    case 8: {   // SUBSCRIBE: packet id, then (filter, qos)...
      if (n < 2) return false;
      std::vector<uint8_t> acks = {b[0], b[1]};
      for (size_t at = 2; at + 2 <= n;) {
        size_t fl = b[at] << 8 | b[at + 1];
        if (at + 2 + fl + 1 > n) break;
        String f = str(b + at + 2, fl);
        if (cl.filters.size() < 16) cl.filters.push_back(f);
        acks.push_back(0x00);   // granted QoS 0
        at += 2 + fl + 1;
      }
      std::vector<uint8_t> p = fixed(0x90, acks.size());
      p.insert(p.end(), acks.begin(), acks.end());
      sendRaw(cl, p);
      return true;
    }
    case 10:    // UNSUBSCRIBE
      if (n >= 2) sendRaw(cl, {0xB0, 0x02, b[0], b[1]});
      cl.filters.clear();
      return true;
    case 12: sendRaw(cl, {0xD0, 0x00}); return true;   // PINGREQ -> PINGRESP
    case 14: return false;                             // DISCONNECT
    default: return true;
  }
}

void drop(size_t i, const char* why) {
  LOGI(Sys, "MQTT: %s ('%s') disconnected: %s", clients[i].ip.toString().c_str(), clients[i].id.c_str(), why);
  IPAddress ip = clients[i].ip;
  clients[i].c.stop();
  clients.erase(clients.begin() + i);
  if (Mqtt::onClient) Mqtt::onClient(ip, false);
}

}  // namespace

namespace Mqtt {

void (*onPublish)(const IPAddress&, const String&, const String&) = nullptr;
void (*onClient)(const IPAddress&, bool) = nullptr;

void setEnabled(bool on, uint16_t p) {
  wanted = on;
  if (on && !port) port = p;
}

void service() {
  if (wanted && !server) {
    server = new EthernetServer(port);
    server->begin();
    LOGI(Sys, "MQTT broker listening on port %u", port);
  }
  if (!server) return;
  mtx.lock();
  for (EthernetClient c = server->accept(); c; c = server->accept()) {
    if (clients.size() >= kMaxClients) { c.stop(); LOGW(Sys, "MQTT: too many clients"); continue; }
    Peer cl;
    cl.c = c;
    cl.ip = c.remoteIP();
    cl.lastRx = cl.since = millis();
    clients.push_back(cl);
  }
  uint32_t now = millis();
  for (size_t i = 0; i < clients.size();) {
    Peer& cl = clients[i];
    int a = cl.c.available();
    if (a > 0) {
      uint8_t buf[256];
      int n = cl.c.read(buf, min(a, (int)sizeof buf));
      cl.rx.insert(cl.rx.end(), buf, buf + max(n, 0));
      cl.lastRx = now;
    }
    bool ok = true;
    // Complete packets: header byte, remaining length (1-4 bytes), body.
    while (ok && cl.rx.size() >= 2) {
      size_t len = 0, mul = 1, at = 1;
      bool full = false;
      while (at < cl.rx.size() && at < 5) {
        len += (cl.rx[at] & 0x7f) * mul;
        mul *= 128;
        if (!(cl.rx[at++] & 0x80)) { full = true; break; }
      }
      if (!full) break;
      if (len > kMaxPacket) { ok = false; break; }
      if (cl.rx.size() < at + len) break;
      ok = handle(cl, cl.rx[0], cl.rx.data() + at, len);
      cl.rx.erase(cl.rx.begin(), cl.rx.begin() + at + len);
    }
    if (!ok) { drop(i, "closed by client"); continue; }
    if (!cl.c.connected() && !cl.c.available()) { drop(i, "connection lost"); continue; }
    if (cl.keepAliveMs && now - cl.lastRx > cl.keepAliveMs * 3 / 2) { drop(i, "keep-alive timeout"); continue; }
    i++;
  }
  mtx.unlock();
}

void statusJson(JsonObject o) {
  o["enabled"] = server != nullptr;
  o["port"] = port;
  o["messages"] = total;
  mtx.lock();
  if (lastTopic.length()) { o["lastTopic"] = lastTopic; o["lastPayload"] = lastPayload; }
  JsonArray a = o["clients"].to<JsonArray>();
  for (auto& cl : clients) {
    JsonObject j = a.add<JsonObject>();
    j["ip"] = cl.ip.toString();
    j["id"] = cl.id;
    j["messages"] = cl.messages;
    j["since"] = (millis() - cl.since) / 1000;
  }
  mtx.unlock();
}

}  // namespace Mqtt
