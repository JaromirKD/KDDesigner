#pragma once
#include "Net.h"

// Getting the controller back after a wrong network setting.
// - Network test (Settings > Network): a new setting is switched to at once and goes back after
//   KD_NET_TRIAL_MS unless a browser confirms from the new address (Net::requestTry/confirm).
//   The setting to go back to is kept on the stick (KD_NET_TRIAL_PATH), so a restart or power
//   cut during the test goes back too.
// - KD_NET_RESET_PATH (network-reset.txt, any content) put on the stick by hand: DHCP at start.
// Going back / the reset rewrite only the "network" part of project.json, nothing else.
namespace NetSafe {
// At start, after Storage::begin and before the project loads.
void bootCheck();
// Web thread: POST /api/network/try (cfg = the loaded project's setting) and /confirm.
bool startTry(const NetConfig& cfg, String& msg);
bool confirm(String& msg);
// Web thread, between requests: puts the old setting back in project.json after a test that
// went back (the same thread as project saves, so the two never write the file at once).
void idle();
}  // namespace NetSafe
