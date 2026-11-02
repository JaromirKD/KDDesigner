#pragma once
#include <Arduino.h>

// Email notifications over plain SMTP (port 25/587, optional AUTH LOGIN, no TLS).
// Use a local relay or a provider that accepts unencrypted submission.
// Project JSON: "email": {"server":"10.0.0.5","port":25,"user":"","password":"","from":"show@site.nl"}
// Mails are queued and sent from a worker thread.
namespace Mail {
void begin();
void load();   // caller holds g_engine
bool queue(const String& to, const String& subject, const String& body, String& msg);
}  // namespace Mail
