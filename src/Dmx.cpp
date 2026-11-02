#include "Dmx.h"
#include <mbed.h>
#include "Config.h"
#include "Log.h"

namespace {

// SerialBase subclass with access to the HAL break and raw TX functions.
class DmxUart : public mbed::SerialBase {
 public:
  explicit DmxUart(PinName tx) : SerialBase(tx, NC, 250000) {
    format(8, SerialBase::None, 2);
  }
  void breakOn() { serial_break_set(&_serial); }
  void breakOff() { serial_break_clear(&_serial); }
  bool txReady() { return serial_writable(&_serial); }
  void put(uint8_t c) { serial_putc(&_serial, c); }
};

DmxUart* ports[KD_DMX_PORTS];
uint8_t pending[KD_DMX_PORTS][512];
uint8_t sending[KD_DMX_PORTS][512];
rtos::Mutex mtx;
rtos::Thread thread(osPriorityBelowNormal, 4096, nullptr, "dmx");
volatile uint32_t frames = 0;
volatile bool enabled = true;
volatile uint32_t frameMs = KD_DMX_FRAME_MS;

void run() {
  auto next = rtos::Kernel::Clock::now();
  for (;;) {
    if (!enabled) {
      rtos::ThisThread::sleep_for(std::chrono::milliseconds(frameMs));
      next = rtos::Kernel::Clock::now();
      continue;
    }
    mtx.lock();
    memcpy(sending, pending, sizeof(sending));
    mtx.unlock();

    for (auto* p : ports) p->breakOn();
    wait_us(KD_DMX_BREAK_US);
    for (auto* p : ports) p->breakOff();
    wait_us(KD_DMX_MAB_US);

    for (int slot = 0; slot <= 512; slot++) {
      for (int i = 0; i < KD_DMX_PORTS; i++) {
        while (!ports[i]->txReady()) {}
        ports[i]->put(slot == 0 ? 0 : sending[i][slot - 1]);
      }
    }
    wait_us(60);  // let the last byte leave the shift register before the next break
    frames++;

    next += std::chrono::milliseconds(frameMs);
    auto now = rtos::Kernel::Clock::now();
    if (next < now) next = now;
    rtos::ThisThread::sleep_until(next);
  }
}
}  // namespace

namespace Dmx {

void begin() {
  memset(pending, 0, sizeof(pending));
  for (int i = 0; i < KD_DMX_PORTS; i++) {
    if (KD_DMX_DE[i] >= 0) {
      pinMode(KD_DMX_DE[i], OUTPUT);
      digitalWrite(KD_DMX_DE[i], HIGH);
    }
    ports[i] = new DmxUart(KD_DMX_TX[i]);
  }
  thread.start(run);
  LOGI(Dmx, "%d DMX port(s) running at %lu ms/frame", KD_DMX_PORTS, (unsigned long)frameMs);
}

void setFrame(int port, const uint8_t* data512) {
  if (port < 1 || port > KD_DMX_PORTS) return;
  mtx.lock();
  memcpy(pending[port - 1], data512, 512);
  mtx.unlock();
}

uint32_t framesSent() { return frames; }

void setEnabled(bool on) { enabled = on; }

void setFps(int fps) { frameMs = 1000 / constrain(fps, 1, 44); }

}  // namespace Dmx
