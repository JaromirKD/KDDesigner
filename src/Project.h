#pragma once
#include <Arduino.h>

// After Show has (re)loaded the project: every other module re-reads its part of it
// (modes, variables, clock, TCP/Modbus, PCs, monitoring, e-mail, projectors, triggers)
// and the UDP ports are reopened. Used at boot, by "reload" and by a save from the web UI.
// Caller holds g_engine (at boot nothing else runs yet).
namespace Project {
void loadModules();

// Where a load spends its time, for the "Project saved" log line: timeStart() before
// Show::parse, timePart("name") after each step (ms since the previous mark),
// timeText() = "json 820, fixtures 140, ... triggers 90" (steps under 5 ms left out).
void timeStart();
void timePart(const char* name);
String timeText();
}
