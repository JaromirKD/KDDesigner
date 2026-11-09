#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <time.h>

// Real clock for scheduling, like the Medialon scheduler:
//  * NTP time sync ("settings.time.ntp", default pool.ntp.org) at boot and every 6 h
//  * time zone + automatic summer time ("settings.tzOffsetMin", "settings.time.dst": eu | us | none)
//  * sunrise / sunset from "settings.location": {"lat": 52.16, "lon": 4.49}
//  * calendar periods ("calendar": [{"name":"Closed","from":"12-24","to":"12-26"}]);
//    MM-DD repeats every year, YYYY-MM-DD is a one-off.
namespace Clock {
void load();                               // caller holds g_engine
void begin();                              // starts the NTP thread (after Net::begin)
void syncNow();

bool localTime(struct tm& out);            // false while the clock is not set
// Minutes after local midnight for "HH:MM", "sunrise", "sunset", "sunset-30", "sunrise+15".
bool parseClock(const String& tok, int& minutes, String& err);
int sunMinutes(bool rise);                 // today, local; -1 if the sun doesn't rise/set
bool calendarActive(const String& name, bool& known);
bool dateBetween(const String& from, const String& to, String& err);   // MM-DD or YYYY-MM-DD

void statusJson(JsonObject o);
}  // namespace Clock
