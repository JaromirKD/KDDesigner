#include "Dmx.h"
#include <mbed.h>
#include "Config.h"
#include "Log.h"

namespace {

using namespace std::chrono_literals;

rtos::EventFlags slotsDone;   // bit per port: the TX interrupt has queued the last slot
rtos::EventFlags frameReady;  // bit 0: the engine has a new frame (Dmx::commit)

// SerialBase subclass with access to the HAL TX functions. The 513 slots of a frame are
// sent from the UART's TX interrupt, so the CPU is free while they go out (a busy-wait per
// byte took ~23 ms of every 25 and, at low priority, got stretched by every web request).
class DmxUart : public mbed::SerialBase {
 public:
  DmxUart(PinName tx, int index) : SerialBase(tx, NC, 250000), mask(1u << index) {
    format(8, SerialBase::None, 2);
    attach(mbed::callback(this, &DmxUart::onTx), TxIrq);   // installs the handler (and enables it:
    serial_irq_set(&_serial, ::TxIrq, 0);                     // the first call just signals "done")
  }
  // The break is a 0x00 byte sent at a lower baud rate: start bit + 8 data bits low = the break,
  // the 2 stop bits = the mark after break. Mbed's serial_break_set() on STM32 only sends a
  // hardware break of ~11 bit times (~44 us at 250k), too short for DMX (>= 88 us): fixtures
  // never saw a frame start.
  void slow() { baud(kBreakBaud); }
  void fast() { baud(250000); }
  void put(uint8_t c) { serial_putc(&_serial, c); }
  // Wait until the last bit has left the line ("transmission complete"). A baud switch while
  // bytes are still queued (the H7 UART can hold several) garbles the end of a frame and the
  // next break: the fixture then drops every frame. A fixed wait wasn't enough once frames
  // started right after each other.
  void waitIdle() {
    auto* u = (USART_TypeDef*)_serial.uart;
    wait_us(2);   // TC drops a moment after a write
    uint32_t t0 = us_ticker_read();
    while (!(u->ISR & USART_ISR_TC) && us_ticker_read() - t0 < 2000) {}
  }
  void load(const uint8_t* d) { data = d; next = 0; }
  void startSlots(const uint8_t* d) {
    load(d);
    serial_irq_set(&_serial, ::TxIrq, 1);
  }
  static const int kBreakBaud = 9000000 / KD_DMX_BREAK_US;

 private:
  void onTx() {   // interrupt: the transmit register is free
    irqs++;
    if (next <= 512) {
      serial_putc(&_serial, next == 0 ? 0 : data[next - 1]);   // slot 0 = start code
      next++;
    } else {
      serial_irq_set(&_serial, ::TxIrq, 0);
      slotsDone.set(mask);
    }
  }
  const uint8_t* data = nullptr;
  volatile int next = 513;
  const uint32_t mask;

 public:
  static volatile uint32_t irqs;
  // Fallback: send what the interrupt didn't (busy-wait per byte).
  void finishByPolling() {
    serial_irq_set(&_serial, ::TxIrq, 0);
    for (; next <= 512; next++) {
      while (!serial_writable(&_serial)) {}
      serial_putc(&_serial, next == 0 ? 0 : data[next - 1]);
    }
  }
};
volatile uint32_t DmxUart::irqs = 0;

DmxUart* ports[KD_DMX_PORTS];
uint8_t pending[KD_DMX_PORTS][512];
uint8_t sending[KD_DMX_PORTS][512];
rtos::Mutex mtx;
// Above the main loop and the network threads: it sleeps nearly all the time (the slots go out
// by interrupt), and a late frame start is what makes fades and effects look steppy.
rtos::Thread thread(osPriorityAboveNormal, 4096, nullptr, "dmx");
volatile uint32_t frames = 0;
uint32_t timeouts = 0;
bool useIrq = true;
volatile bool enabled = true;
volatile uint32_t frameMs = KD_DMX_FRAME_MS;

void run() {
  const uint32_t allPorts = (1u << KD_DMX_PORTS) - 1;
  auto last = rtos::Kernel::Clock::now();
  for (;;) {
    if (!enabled) {
      rtos::ThisThread::sleep_for(std::chrono::milliseconds(frameMs));
      continue;
    }
    // Send each engine frame once, as soon as it is ready: a DMX clock of its own beats against
    // the engine's (some steps sent twice, some never). Without new frames, refresh every 100 ms.
    frameReady.wait_any_for(1, 100ms);
    // Frame-rate limit from the settings; 3/4 of the period so engine jitter doesn't skip frames.
    auto earliest = last + std::chrono::milliseconds(frameMs * 3 / 4);
    if (rtos::Kernel::Clock::now() < earliest) rtos::ThisThread::sleep_until(earliest);
    last = rtos::Kernel::Clock::now();

    mtx.lock();
    memcpy(sending, pending, sizeof(sending));
    mtx.unlock();

    // Break + MAB: one slow 0x00 byte (11 bits); wait until it has left the shift register
    // (the UART only reports "buffer free"), then back to 250k. The baud switch itself just
    // lengthens the MAB (line idle high).
    slotsDone.clear(allPorts);
    for (auto* p : ports) { p->waitIdle(); p->slow(); p->put(0); }
    for (auto* p : ports) { p->waitIdle(); p->fast(); }
    wait_us(KD_DMX_MAB_US);

    if (useIrq) {
      for (int i = 0; i < KD_DMX_PORTS; i++) ports[i]->startSlots(sending[i]);
      uint32_t r = slotsDone.wait_all_for(allPorts, 50ms);
      if ((r & osFlagsError) || (r & allPorts) != allPorts) {
        // The TX interrupt didn't send the frame: finish it and switch to polling at low priority
        // (a busy-wait above the network threads would starve them).
        timeouts++;
        useIrq = false;
        LOGW(Dmx, "TX interrupt not working (%lu interrupts): sending by polling", (unsigned long)DmxUart::irqs);
        thread.set_priority(osPriorityBelowNormal);
        for (auto* p : ports) p->finishByPolling();
      }
    } else {
      for (int i = 0; i < KD_DMX_PORTS; i++) { ports[i]->load(sending[i]); ports[i]->finishByPolling(); }
    }
    wait_us(60);  // let the last byte leave the shift register before the next break
    frames++;
    if (frames == 400) LOGI(Dmx, "%s: %lu frames, %lu TX interrupts", useIrq ? "interrupt" : "polling",
                            (unsigned long)frames, (unsigned long)DmxUart::irqs);
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
    ports[i] = new DmxUart(KD_DMX_TX[i], i);
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

void commit() { frameReady.set(1); }

uint32_t framesSent() { return frames; }

void setEnabled(bool on) { enabled = on; }

void setFps(int fps) { frameMs = 1000 / constrain(fps, 1, 44); }

}  // namespace Dmx
