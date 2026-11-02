#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// A small MQTT 3.1.1 broker on the controller (TCP 1883), so devices that can
// only publish to a broker (NETIO "MQTT-flex") report changes straight to us
// instead of being polled. QoS 0/1/2 publishes are accepted (and acknowledged),
// subscriptions with + and # work, so other MQTT clients can listen in too.
// Retained messages and authentication are not supported.
// Runs from the drivers' push thread (Drivers.cpp) via service().
namespace Mqtt {
void setEnabled(bool on, uint16_t port = 1883);
void service();                                   // accept, read, answer; never blocks long
void statusJson(JsonObject o);
// Set by Drivers: called for every PUBLISH and when a client (dis)connects.
extern void (*onPublish)(const IPAddress& from, const String& topic, const String& payload);
extern void (*onClient)(const IPAddress& from, bool connected);
}  // namespace Mqtt
