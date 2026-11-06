#include "Mail.h"
#include <Ethernet.h>
#include <mbed.h>
#include <deque>
#include "Log.h"
#include "Show.h"

using namespace std::chrono_literals;

namespace {
struct Smtp { String server, user, password, from; uint16_t port = 25; };
struct Message { String to, subject, body; };

Smtp cfg;
std::deque<Message> outbox;
rtos::Mutex mtx;
rtos::Thread thread(osPriorityNormal, 8 * 1024, nullptr, "mail");   // Normal: it mostly waits on the network; BelowNormal starved it for seconds

String base64(const String& in) {
  static const char* t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out;
  size_t i = 0, n = in.length();
  while (i < n) {
    uint32_t v = (uint8_t)in[i] << 16;
    if (i + 1 < n) v |= (uint8_t)in[i + 1] << 8;
    if (i + 2 < n) v |= (uint8_t)in[i + 2];
    out += t[(v >> 18) & 63];
    out += t[(v >> 12) & 63];
    out += i + 1 < n ? t[(v >> 6) & 63] : '=';
    out += i + 2 < n ? t[v & 63] : '=';
    i += 3;
  }
  return out;
}

// Reads one (possibly multi-line) SMTP reply and returns its code.
int reply(EthernetClient& c, String& text) {
  text = "";
  uint32_t t0 = millis();
  String line;
  while (millis() - t0 < 10000) {
    while (c.available()) {
      char ch = c.read();
      if (ch == '\n') {
        text = line;
        if (line.length() >= 4 && line[3] == '-') { line = ""; continue; }  // continuation
        return line.toInt();
      }
      if (ch != '\r') line += ch;
    }
    if (!c.connected()) break;
    rtos::ThisThread::sleep_for(10ms);
  }
  return 0;
}

bool step(EthernetClient& c, const String& cmd, int expect, String& err) {
  if (cmd.length()) { c.print(cmd); c.print("\r\n"); }
  String text;
  int code = reply(c, text);
  if (code != expect) { err = (cmd.startsWith("AUTH") || cmd.length() > 40 ? String("(auth)") : cmd) + " -> " + (code ? text : String("timeout")); return false; }
  return true;
}

bool send(const Smtp& s, const Message& m, String& err) {
  IPAddress ip;
  EthernetClient c;
  c.setSocketTimeout(5000);
  int ok = ip.fromString(s.server) ? c.connect(ip, s.port) : c.connect(s.server.c_str(), s.port);
  if (!ok) { err = "cannot connect to " + s.server; return false; }
  bool r = step(c, "", 220, err) && step(c, "EHLO kd-designer", 250, err);
  if (r && s.user.length())
    r = step(c, "AUTH LOGIN", 334, err) && step(c, base64(s.user), 334, err) && step(c, base64(s.password), 235, err);
  r = r && step(c, "MAIL FROM:<" + s.from + ">", 250, err) && step(c, "RCPT TO:<" + m.to + ">", 250, err) &&
      step(c, "DATA", 354, err);
  if (r) {
    c.print("From: KD Designer <" + s.from + ">\r\nTo: <" + m.to + ">\r\nSubject: " + m.subject +
            "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n");
    String body = m.body;
    body.replace("\n.", "\n..");  // dot-stuffing
    c.print(body);
    r = step(c, "\r\n.", 250, err);
    step(c, "QUIT", 221, err);
  }
  c.stop();
  return r;
}

void run() {
  for (;;) {
    mtx.lock();
    bool have = !outbox.empty();
    Message m;
    if (have) { m = outbox.front(); outbox.pop_front(); }
    Smtp s = cfg;
    mtx.unlock();
    if (!have) { rtos::ThisThread::sleep_for(200ms); continue; }
    String err;
    if (send(s, m, err)) LOGI(Sys, "Email '%s' sent to %s", m.subject.c_str(), m.to.c_str());
    else LOGE(Sys, "Email '%s' to %s failed: %s", m.subject.c_str(), m.to.c_str(), err.c_str());
  }
}
}  // namespace

namespace Mail {

void begin() { thread.start(run); }

void load() {
  JsonObjectConst e = Show::projectDoc()["email"];
  mtx.lock();
  cfg.server = e["server"] | "";
  cfg.port = e["port"] | 25;
  cfg.user = e["user"] | "";
  cfg.password = e["password"] | "";
  cfg.from = e["from"] | "kd-designer@localhost";
  mtx.unlock();
}

bool queue(const String& to, const String& subject, const String& body, String& msg) {
  mtx.lock();
  bool configured = cfg.server.length() > 0;
  if (configured && outbox.size() < 16) outbox.push_back({to, subject, body});
  mtx.unlock();
  if (!configured) { msg = "no SMTP server configured (Devices page)"; return false; }
  msg = "Email to " + to + " queued";
  return true;
}

}  // namespace Mail
