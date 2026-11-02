#pragma once
#include <Arduino.h>

// Physical DMX512 output on RS485 ports. A low-priority thread sends all ports
// in parallel (byte-interleaved), so frame timing never blocks the show engine.
namespace Dmx {
void begin();
void setFrame(int port, const uint8_t* data512);  // port is 1-based
void setEnabled(bool on);                          // off = lines go idle (no frames)
void setFps(int fps);                              // 1-44; a full 512-slot frame takes ~23 ms
uint32_t framesSent();
}  // namespace Dmx
