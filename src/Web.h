#pragma once

// HTTP server for the programming UI (served from /usb/www) and a JSON API.
// Live log + status is pushed to the browser with Server-Sent Events on
// /api/events. Runs in its own threads; engine access goes through g_engine.
namespace Web {
void begin();
}
