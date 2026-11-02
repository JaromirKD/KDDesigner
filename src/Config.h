#pragma once
#include <Arduino.h>

#ifndef KD_VERSION
#define KD_VERSION "dev"
#endif

// ---- Engine ----------------------------------------------------------------
#define KD_MAX_UNIVERSES 8        // internal universes (each 512 channels, ~20 KB RAM each)
#define KD_MAX_PLAYBACKS 8        // concurrently running timelines/scenes
#define KD_MAX_TRACKS 16          // tracks per timeline, each with its own fade
// The engine runs at 40 Hz, or faster (max 60) when an Art-Net/sACN fps above 40 is set.

// ---- DMX (physical RS485 ports) --------------------------------------------
// TX pins of the UARTs that drive the RS485 transceivers (MAX485 / ISO3082...).
// Tie the transceiver DE/RE pins high (transmit only) or set a DE pin below.
// Verify these against your carrier's pinout before wiring.
#ifdef KD_BOARD_PMC
// Machine Control: its one RS485 port (UART4). Board::begin switches the
// transceiver to RS485 half duplex, transmit only; PA_9/PG_14 are its control pins.
#define KD_DMX_PORTS 1
static const PinName KD_DMX_TX[KD_DMX_PORTS] = {PA_0};
static const int KD_DMX_DE[KD_DMX_PORTS] = {-1};
#else
#define KD_DMX_PORTS 2
static const PinName KD_DMX_TX[KD_DMX_PORTS] = {PA_9, PG_14};  // UART1, UART6
static const int KD_DMX_DE[KD_DMX_PORTS] = {-1, -1};           // -1 = not used
#endif
#define KD_DMX_BREAK_US 120
#define KD_DMX_MAB_US 16
#define KD_DMX_FRAME_MS 25        // ~40 fps

// ---- Storage ---------------------------------------------------------------
#define KD_USB_ROOT "/usb"
#define KD_PROJECT_PATH "/usb/show/project.json"
#define KD_PROJECT_TMP "/usb/show/project.tmp"
#define KD_PROJECT_BAK "/usb/show/project.bak"
#define KD_WWW_ROOT "/usb/www"
#define KD_MEDIA_DIR "/usb/show/media"     // uploaded images (map backgrounds), served at /media/
#define KD_MAX_UPLOAD (4UL * 1024 * 1024)
#define KD_LOG_PATH "/usb/logs/system.log"   // older ones: system.1.log (newest) .. system.4.log
#define KD_LOG_FILES 5                        // system.log + 4 older files
#define KD_LOG_MAX_BYTES (8UL * 1024 * 1024)  // per file: ~90 000 lines, so ~450 000 kept in all
#define KD_HISTORY_DIR "/usb/logs/history"   // device on/off history, one file per UTC day
#define KD_HISTORY_DAYS 400                  // older day files are deleted
#define KD_HISTORY_ALIVE_S 600               // "alive" line at least this often, so a gap = controller off
#ifdef KD_BOARD_PMC
#define KD_USB_POWER_PIN PB_14    // Machine Control USB-A VBUS switch (active low)
#define KD_USB_POWER_ON LOW
#else
#define KD_USB_POWER_PIN PA_15    // enables VBUS on the breakout's USB-A port
#define KD_USB_POWER_ON HIGH
#endif

// ---- Logging ---------------------------------------------------------------
#define KD_LOG_RING 512           // entries kept in RAM for the web UI
#define KD_LOG_MSG_LEN 120

// ---- Triggers / devices ----------------------------------------------------
#define KD_MAX_UDP_PORTS 6        // distinct UDP/OSC listen ports (global + per trigger)
#define KD_MAX_PROJECTORS 16
#define KD_PJLINK_POLL_MS 30000   // power-state poll interval per projector
#define KD_PJLINK_TIMEOUT_MS 3000
// Feedback guard: a trigger that fires more often than this in one second is
// caught in a loop (it fires itself through a variable, an echo, a timeline...)
// and is paused. dmx_change triggers are not counted (one fire per channel per tick).
#define KD_TRIGGER_MAX_PER_S 100
#define KD_TRIGGER_PAUSE_MS 10000
#define KD_MAX_SCHEDULED 100      // waiting "sleep"s, "wait until"s, loops, delayed fires and repeats together
#define KD_TRIGGER_HISTORY 512    // last fires kept for the history strip on the Triggers page (8 bytes each)
#define KD_MAX_DMX_IN 4           // Art-Net / sACN universes received for "DMX input" triggers (512 bytes each)
#define KD_WAIT_CHECK_MS 100      // how often "wait until <condition>" is checked

// ---- Watchdog --------------------------------------------------------------
// The main loop must come round within this time, or the board restarts. Long
// enough for a project save (the loop waits for g_engine meanwhile) and a slow
// USB stick; the hardware maximum on the H7 is ~32 s.
#define KD_WATCHDOG_MS 15000
// Safe mode: after this many watchdog/crash restarts in a row, triggers don't run
// by themselves (no Startup either) until the project is saved or the board is
// restarted normally. Running this long without a crash clears the count.
#define KD_SAFE_MODE_CRASHES 3
#define KD_SAFE_MODE_OK_MS 300000

// ---- Web -------------------------------------------------------------------
#define KD_HTTP_PORT 80
#define KD_MAX_SSE 4              // simultaneous live-log browser tabs

// ---- Network fallback (when the project has no network block / no USB) ------
#define KD_FALLBACK_IP 192, 168, 1, 50
#define KD_FALLBACK_MASK 255, 255, 255, 0
#define KD_FALLBACK_GW 192, 168, 1, 1
