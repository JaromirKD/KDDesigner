#pragma once
#include <Arduino.h>

// Physical DMX512 output on RS485 ports. A high-priority thread starts a frame on all
// ports as soon as the engine has one (commit); the slots go out by UART interrupt.
namespace Dmx {
void begin();
void setFrame(int port, const uint8_t* data512);  // port is 1-based
void commit();                                     // after all setFrame()s of an engine tick
void setEnabled(bool on);                          // off = lines go idle (no frames)
void setFps(int fps);                              // 1-44; a full 512-slot frame takes ~23 ms
uint32_t framesSent();
}  // namespace Dmx
