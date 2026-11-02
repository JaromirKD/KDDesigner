#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

// Inputs and outputs of the board the Portenta sits in. Only the Portenta
// Machine Control has them (build env machine_control, KD_BOARD_PMC); on other
// boards there are no points and every io command says so.
// Points are named like the labels on the Machine Control:
//   in0-in7    24 V digital inputs
//   out0-out7  24 V digital outputs (high side, 0.5 A each)
//   io0-io11   programmable 24 V I/O, each set to "in" or "out"
//   ai0-ai2    analog inputs: "0-10V" (volts), "4-20mA" (mA) or "NTC" (ohms)
//   ao0-ao3    analog outputs 0-10 V
// Project JSON (points left out keep their defaults: io = in, ai = 0-10V):
//   "machineControl": {"io3": {"mode":"out", "name":"Door release", "var":"door"},
//                      "ai0": {"mode":"4-20mA", "name":"Tank level"}}
// A linked variable follows its point; for an output, setting the variable
// also switches the output.
// Commands: io <point> on|off|toggle | io <point> pulse <s> | io <ao> <volts> [fade <s>] | io all off
// <point> is the key (out3) or the name.
namespace Board {
void begin();                    // before Dmx::begin: sets up the RS485 transceiver
void load();                     // caller holds g_engine
void poll();                     // main loop, holds g_engine: pushes changes to linked variables
bool present();                  // this build has board I/O
// "out3" or a point's name -> key; err when unknown.
bool find(const String& ref, String& key, String& err);
bool value(const String& key, float& v);     // latest value; false if there is no such point
bool command(const std::vector<String>& t, String& msg);   // t[0] == "io"
void onVariable(const String& name, const String& value);  // a variable changed
void statusJson(JsonObject o);
}  // namespace Board
