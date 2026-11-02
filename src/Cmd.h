#pragma once
#include <Arduino.h>
#include <vector>
#include "Vars.h"

// Text command language used by trigger actions, the web console, UDP and the
// touch panel. Keep the grammar in sync with GRAMMAR in data/www/app-grammar.js.
//
//   start timeline <tl>            stop timeline <tl> [fade <s>]
//   pause timeline <tl>            resume timeline <tl>
//   master timeline <tl> <pct> [fade <s>]
//   scene <sc> [fade <s>]          release scene <sc> [fade <s>]
//   release all [fade <s>]
//   set <universe>.<ch>[-<ch>] <0-255>     clear overrides
//   grandmaster <pct>              blackout on|off
//   mode <group> <state>           (old form "mode <state>" if the state is unique)
//   label <name> <text>            label <name> color <color>
//   fire trigger <id|"name"> [after <s>]  cancel trigger <id|"name">
//   repeat trigger <id> every <s> [times <n>]   stop repeat <id>
//   log <text>                     email <to> <subject> <body>
//   send udp <ip> <port> <text>    send udp <device> [<port>] <text>
//   send osc <ip> <port> <address> [args]       send osc <device> [<port>] <address> [args]
//                                  (<device> may be a device group; <port> replaces the devices' own)
//   sleep <s>                      only as its own line in trigger actions: the rest runs <s> later
//   reply <text>                   (answers the sender of the UDP/OSC that fired the trigger)
//   loglevel <category|all> <debug|info|warn|error>
//   output dmx|artnet|sacn on|off  output dmx|artnet|sacn fps <n>
//   projector <pj|all> on|off      projector <pj|all> mute on|off
//   projector <pj|all> input <code>   projector <pj|all> send <raw pjlink body>
//   pc <pc|all> wake|startup|shutdown|reboot   (Wake-on-LAN / UDP text command)
//   monitor check                  monitor interval <seconds>
//   var <name> = <value>           var <name> + <n>   var <name> - <n>   var <name> toggle
//   if <condition> then <command> [else <command>]
//   send tcp <device> <text>       http get|post|put|delete <url> [body]
//   modbus <device> write coil|holding <address> <value>
//   ntp sync
//   io <point> on|off|toggle       io <point> pulse <s>   io <ao> <volts> [fade <s>]   io all off
//   reload
//
// <tl>/<sc> is an id or a "quoted name". {var} and {=expr} are expanded from
// the trigger's variables first (see Vars.h). Caller must hold g_engine.
namespace Cmd {
bool exec(const String& line, String& reply, const char* source, const Vars* vars = nullptr);
std::vector<String> tokenize(const String& line);
}
