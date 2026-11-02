#pragma once

// After Show has (re)loaded the project: every other module re-reads its part of it
// (modes, variables, clock, TCP/Modbus, PCs, monitoring, e-mail, projectors, triggers)
// and the UDP ports are reopened. Used at boot, by "reload" and by a save from the web UI.
// Caller holds g_engine (at boot nothing else runs yet).
namespace Project {
void loadModules();
}
