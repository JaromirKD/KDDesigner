# First run on the Portenta - test plan

The firmware compiles but has never run on the board. This is the order to bring it up in:
each step only needs the steps before it, so when something fails we know where to look.
Do it on the bench, not at a venue, with a copy of the show (not the live one).

Who does what: **you** = hands on the hardware. **Claude** = can do from this PC while the board
is plugged in over USB-C (build, flash, read the serial log, call the web API, capture Art-Net /
sACN, compare with the mock, fix code and re-flash).

Hardware: **Portenta Machine Control** (the Portenta H7 inside Arduino's DIN-rail box), so
every build and upload uses the `machine_control` firmware:

```bash
python -m platformio run -e machine_control -t upload
```

Pins checked on 3 Nov 2026 against Arduino's Machine Control library (`pins_mc.h`): DMX goes out
of the RS485 port (UART4, TX `PA_0`), the transceiver setup in `Board.cpp` (RS485 mode, half
duplex, driver on, receiver off, its terminators off) and the USB-A power switch (`PB_14`, on =
low) all match.

## What to have on the bench

- The Machine Control with a **24 V DC supply** (screw terminals). The USB-C alone powers the
  Portenta but not the box's USB-A port or its 24 V I/O, so keep the 24 V on during every step
- USB-C data cable (not a charge-only one) from the Portenta's USB-C into this PC
- Ethernet: controller and this PC on the same switch (a small switch with DHCP router; without
  a DHCP answer the controller falls back to `172.16.1.111`, on the office network)
- FAT32 USB stick with `data/` copied onto it (see README "Prepare the USB stick")
- For DMX: a short cable from the RS485 terminals to a female XLR (**485 TX P** -> pin 3,
  **485 TX N** -> pin 2, **GND** -> pin 1; leave RX P / RX N empty - in half duplex the
  firmware only uses the TX pair), a terminator at the far end, and a DMX tester or one simple fixture (a dimmer
  or RGB par). No extra transceiver chip needed; there is one DMX port
- For the I/O: a switch or push button on a 24 V input, and a lamp / relay / multimeter on a
  24 V output (the outputs also need the 24 V on their own supply terminal)
- Optional: a lighting desk or app that sends Art-Net / sACN (for DMX input triggers)

## Steps

| # | Step | You | Claude | Passes when |
|---|---|---|---|---|
| 0 | **Bootloader** | Upload `STM32H747_manageBootloader` from the Arduino IDE, answer `Y` | - | Bootloader 22 or newer |
| 1 | **Flash + boot log** | Plug in USB-C. If the upload can't find the board: double-tap reset (green LED pulses) | Build, upload, read the serial log | The log reaches "Ready - … KB memory free", no crash / restart loop. Settings later shows "Last start: power on" |
| 2 | **USB stick** | Plug in the stick (before power-on, then once while running) | Read log | Stick mounts, `project.json` loads, `logs/system.log` appears on the stick |
| 3 | **Ethernet + web UI** | Network cable in | Open `http://<ip>/` in the browser pane, click through every page | Every page loads, no console errors, live log runs, Save works (on the test copy) |
| 4 | **Art-Net / sACN out** | - | Capture the packets on this PC and compare with the mock playing the same scene / timeline | Same channel values, steady frame rate (~40 fps), no gaps |
| 5 | **Effects** | - | Same capture for every effect, compared with the mock frame by frame | Matches the mock (this is the real test of `Fx.cpp`, which was only checked by reading) |
| 6 | **DMX on the RS485 port** | Wire 485 TX P / TX N / GND to XLR 3 / 2 / 1, connect tester / fixture | Start a test scene | Fixture follows, no flicker. If it flickers: swap A/B first, then break / MAB timing (`KD_DMX_BREAK_US` / `KD_DMX_MAB_US`) |
| 7a | **Machine Control I/O** | Flip the switch on a 24 V input, watch the lamp on an output, measure the 0-10 V output | Switch outputs from the console, watch the Machine Control tab | Inputs show on the tab and fire `input` triggers (also hold / double press); outputs and 0-10 V follow commands |
| 7b | **Triggers, devices** | Send from a desk / phone app (OSC, UDP, Art-Net in) | Send UDP / OSC / HTTP from this PC, watch the log | Triggers fire as in the mock; projectors / PCs / show devices show online |
| 8 | **Watchdog** | - | Flash a test build with a deliberate hang, then the normal build again | Board restarts by itself, "Last start: watchdog"; a big-rig save does *not* trip it |
| 9 | **Network update** | - | Build with a raised `KD_VERSION`, install it via Settings | Restarts, log says "installed", web UI is the new version. Also check whether the bootloader removes `UPDATE.BIN` |
| 10 | **Long run** | Leave it running overnight / a weekend | Read the log and `/api/status` before and after | No restarts, no memory creep, schedule triggers fired on time (sunrise / sunset) |

Steps 4 and 5 can be done without any DMX wiring: Art-Net is the easiest way to see exactly
what the engine outputs. Step 6 only adds the physical port.

## When something fails

- Board doesn't show up on USB / keeps restarting: double-tap reset and flash again. The firmware
  can't damage the board; the bootloader is separate.
- Crash at start: the serial log is the only clue - leave the USB-C plugged in for steps 1-3.
- Note the step number and what you saw; Claude fixes it, re-flashes, and we repeat from that step.

## Results

Fill in as we go (date, step, result, firmware version).

| Date | Step | Result | Version |
|---|---|---|---|
| 6 Nov 2026 | 0 | Bootloader 25 (OK, needs 22+) | 0.1.0 |
| 6 Nov 2026 | 1 | Flashes over USB-C (COM3, no reset tap needed), boots to "Ready", 46 KB of 190 KB heap free. Serial showed nothing: the boot log was printed before a monitor could open the port. Fixed: the log ring is replayed when a monitor connects (`Log::flush`) | 0.1.0 |
| 6 Nov 2026 | 2 | 2 GB FAT32 stick mounts in ~1.4 s. Stick was empty (no `show/`, `www/`) | 0.1.0 |
| 6 Nov 2026 | 3 | DHCP OK (172.16.1.171), answers ArtPoll and ping. **Web server refuses every connection**: the Arduino core's prebuilt Mbed library allows only **4 sockets in total** (`MBED_CONF_LWIP_SOCKET_MAX` 4, TCP 4, UDP 4) and Art-Net + sACN + UDP port 4000 + the web server use all 4 at boot. With the sACN socket left out (test build) `/api/status` works. NTP: no reply from pool.ntp.org | 0.1.0 |
| 6 Nov 2026 | - | Status also showed: engine 40 fps, DMX 39 fps, Machine Control I/O OK (in/out/io/ai/ao all read), update `ready` | 0.1.0 |
| 6 Nov 2026 | 3 | **Fixed**: core library rebuilt in WSL with 32 sockets (`tools/core/`). Web server answers every request (6 at once + live log OK) | 0.1.0 |
| 6 Nov 2026 | 3 | Web UI installed over the network (www-only update, 1.2 MB in 22 s). With no `project.json` on the stick 7 pages crashed (Map, Effects, Variables, Schedule, Panel, Devices, Monitoring): the empty-project fallback skipped `normalize()`. **Fixed**; all 18 pages open | 0.1.0 |
| 6 Nov 2026 | 3 | Saving a project froze the board, watchdog restart after 15 s: out of memory (34 KB free). **Fixed**: playback buffers + log ring (208 KB) moved to the unused D2 SRAM (`src/D2Ram.*`). Now ~205 KB free, save takes 0.3 s | 0.1.0 |
| 6 Nov 2026 | 4 | Art-Net and sACN packets were cut at 508 bytes (Arduino's UDP buffer). **Fixed** (`WIFI_UDP_BUFFER_SIZE` 1024). Then: Art-Net (2 universes, unicast to the PC) and sACN (multicast) at 39.8 frames/s, full 512 channels, max gap 44 ms | 0.1.0 |
| 6 Nov 2026 | 5 | Static timeline with scenes + 2 effects (Rainbow; "Mix" using sin, smoothstep, fract, noise, rand, clamp, tri, mix, a colour param): **every channel identical to the mock** on Art-Net, sACN and `/api/dmx`. Moving timeline: only differences explained by ~100 ms timing offset between the two | 0.1.0 |
| 6 Nov 2026 | 7b | UDP triggers (`PING*` with variable counting, `SCENE *` starting a scene, non-matching ignored), manual trigger with `sleep`, console command typed in the web UI: all OK | 0.1.0 |
| 6 Nov 2026 | 6 (port only) | DMX port frame rate dropped to 2-6 fps while a browser was open: Arduino's `EthernetClient` reader thread spun at normal priority. **Fixed** (`lib/SocketWrapper`). Now 33-35 fps (40 set): the DMX thread busy-waits per byte and misses its slot when other work runs. No DMX device tested yet | 0.1.0 |
| 6 Nov 2026 | 9 | Network firmware update 0.1.0 -> 0.1.1: upload 48 s, back after 9 s, log "Firmware updated: 0.1.0 -> 0.1.1", check `lastOk` true. Project and web UI kept | 0.1.1 |
| 6 Nov 2026 | - | "Last start" always says `other` (also after power-on and the network update): the reset flags seem to be cleared before the firmware reads them (bootloader?). So `watchdog`/`crash` starts and the safe-mode counter don't work yet. NTP works some of the time ("no reply" on other tries) | 0.1.1 |
| 6 Nov 2026 | 3 | Web UI took > 40 s to open: files came at ~22 KB/s because small/odd-sized writes hit Nagle + Windows delayed ACK (~50 ms per 1 KB). **Fixed** in `Web.cpp` (header + body in whole-segment blocks, `kTxBlock`): 200-340 KB/s, whole UI in 4.5 s in the browser | 0.1.1 |
| 6 Nov 2026 | 3 | Every request waited ~120 ms for its first byte (the socket reader missed the request's signal and slept 100 ms): **fixed** in `lib/SocketWrapper`, now ~23 ms. A full log (`/api/log`, 58 KB) sometimes arrived empty and took 1.1 s: **fixed** (no copy of the body, room reserved), 0.06 s, 6/6. Updates now store the web UI gzipped with ETags: www update 325 KB (was 1.2 MB, installs in 8 s); **UI opens in 1.3 s, reload 0.3 s**; all 18 pages and 28 files OK | 0.1.1 |
| 6 Nov 2026 | all | **Feature test** with `examples/feature-demo` (every device moved to fake devices on the PC: PJLink, TCP, Modbus, HTTP, SMTP, UDP/OSC; Art-Net to the PC, sACN universes +900). Found and fixed: a 75-95 KB show could not load (**out of memory**: project text + JSON now in the 8 MB **SDRAM**, `src/BigRam.*`); saving it again hung on the 3rd-4th save (old + new engine tables: engine tables now in SDRAM too, `BigRam::Vec`; 10/10 saves OK); cut-off / garbled status and log JSON (built in SDRAM; data from SDRAM is copied to internal RAM before sending: sent straight from SDRAM it arrived garbled); `make-demo.js` wrote a raw scene level as `universe` instead of `u` (the controller refused the demo); HTTP replies were "chunked" (`http` now sends HTTP/1.0); Kiss-Box write commands answered "read slot"; a mode linked to a variable linked to a PLC register flipped forever (stale queued change: the mode link now only follows the variable's current value); failed Modbus writes were lost (now re-queued) | 0.1.1 |
| 6 Nov 2026 | all | **Commands**: 139 commands run on controller and mock: 117 same, the rest wording only, plus intended differences (`io in0 on` simulates only in the mock, DiGidot scene names need the device's list). Verified at the fake devices: OSC with typed args, UDP, TCP, HTTP GET/POST with body, Wake-on-LAN packet, PJLink power/mute/input/lamp (also with password), PC shutdown/reboot, email (subject + body), Modbus coil/register writes, BrightSign UDP + plugin, DiGidot login + master, Pharos polls + WebSocket, KNX tunnel request, Kiss-Box frames | 0.1.1 |
| 6 Nov 2026 | 7b | **Triggers**: 20 of 25 stimuli OK (UDP + "from IP", OSC, panel click/double/hold/short press/slider/colour/XY/sequence, variable, mode, Art-Net in, timeline end, manual, repeat, projector alarm, lamp hours, device offline -> email). Not OK: sACN input (`dmx_in` sACN) didn't fire; TCP answer and HTTP response triggers fire seconds late; see NEXT-STEPS 5c | 0.1.1 |
| 6 Nov 2026 | - | **Restarts**: the bootloader clears the chip's reset flags (`RCC->RSR` reads 0), so "Last start" now comes from the log ring kept in D2 SRAM: `power on`, `restart` (planned), `new firmware`, `unexpected` (hang/crash/reset button). After an unexpected restart the log keeps the lines from before it and says where the main loop / web thread / project load were (breadcrumbs). Tested: a save hang showed "web at 'save: Show::parse', project load at 'parse: effects'" | 0.1.1 |
| 6 Nov 2026 | 7b | **I/O thread fixed**: TCP-device answers and HTTP-response triggers fired seconds late and PLC reads timed out (waits up to 43 s while ping stayed fine): the network threads ran at low priority and starved, and Arduino's socket `write()`/`connect()` could block for long. After the fix: PLC polled every 500 ms with the Inloop playing, no slow-job warnings in 3 minutes, trigger test 22/25 (TCP + HTTP OK), TCP and Modbus reconnect after the fake devices restart | 0.1.1 |
| 6 Nov 2026 | 3 | During the final 5-minute run the controller lost its network: "Ethernet cable not connected" after a restart, DHCP failed, IP 0.0.0.0 (no fallback address). To check: cable/switch, and whether it reconnects when the link comes back | 0.1.1 |
| 6 Nov 2026 | 3 | **Network lost = the office router was off**, not the box: a test program reading the PHY chip showed the cable link fine (100 Mbit full duplex) and a fixed address answered ping. The firmware called "no DHCP answer" "cable not connected" (Arduino's `linkStatus()` only means "has an address") and its fallback never took (a second `connect()` during DHCP is ignored). **Fixed** (`Net::begin` / `Net::maintain`): cable link read from the PHY, "No Ethernet link…" vs "Cable OK, but no DHCP answer…", fallback now `172.16.1.111`, cable pulls logged, DHCP DISCOVER every 30 s while on the fallback (switches only when a server answers). Tested: fake DHCP offer from the PC -> switched, no lease, back on the fallback after 10 s; cable out/in while running -> back at once; reset with no cable -> "No Ethernet link", address as soon as it was plugged in | 0.1.1 |
| 6 Nov 2026 | - | "Last start" after reflashing the same build said `unexpected`: **fixed** (build id = hash of the firmware in flash; a USB upload marks itself, shows `USB upload` for the same build). After each flash: `new firmware`; after the reset button: `unexpected` | 0.1.1 |
| 6 Nov 2026 | 10 (5 min) | **Stability run** with "Feature test (HW)" (Inloop playing, fake devices on the PC). First try: everything dropped off the network for 10 s every 70 s - the first DHCP retry design (redone, see above) - and NTP blocked the I/O thread for 17 s every minute without DNS (now backs off 1, 2, 4 … 30 min). Then found the **engine running at ~24 ms per tick**: a timeline started a few ms after the main loop read the clock had its start "in the future", the time difference wrapped, and it re-fired all its cues every tick (**fixed** in `updateTimeline` + main loop reads the clock after taking the engine lock; tick 6-12 ms now). Final run: 0 failed requests, 40 fps, heap 107-115 KB free, PLC polled every 505 ms (one 15 s gap: the single NTP try with no DNS - goes away with the router on), no other I/O-thread warnings | 0.1.1 |
| 6 Nov 2026 | 7b | **Trigger test** 22/25 (as expected: 26 is in its 30 s cooldown, `door` is read-only because it follows the PLC, 52 sACN - see next line) | 0.1.1 |
| 6 Nov 2026 | 7b | **sACN input**: unicast always worked - "changes" DMX triggers log their "fired" line at debug level, so the test didn't see it (grand master followed ch2: 51 -> 20, 255 -> 100). **Multicast** didn't arrive: Mbed's Ethernet driver ignores multicast joins and the chip's MAC filter dropped them (register `MACPFR` = 0). **Fixed**: the group's hash bin is opened in `Net.cpp` (`macAcceptGroup`); multicast 239.255.0.1 now works (153 -> 60). Status/dashboard show `sacnRx` packets per second | 0.1.1 |
| 6 Nov 2026 | - | Recovery tip: when a flash is interrupted the board waits in its bootloader (USB 2341:035B, another COM port) and `pio run -t upload` fails on the port. Flash directly: `%USERPROFILE%\.platformio\packages\tool-dfuutil-arduino\dfu-util.exe --device 0x2341:0x035b -a 0 -s 0x08040000:leave -D .pio\build\machine_control\firmware.bin` | 0.1.1 |
| 6 Nov 2026 | 6 | **DMX with an RGBW fixture** (485 TX P/N/GND -> XLR 3/2/1): the fixture showed blue (its no-signal colour) while every channel was 0: the **break was ~44 µs** (Mbed's `serial_break_set` on STM32), DMX needs >= 88 µs. **Fixed**: break = a 0x00 byte at a low baud rate (~120 µs). Then dark but no response: Universe 1 had the DMX port ticked off on the Patch page (project setting). Then a rainbow looked **steppy**: the DMX thread busy-waited per byte at low priority (33-37 fps, frames late) and ran on its own 40 Hz clock next to the engine's. **Fixed**: slots sent by the UART TX interrupt, thread at AboveNormal, one DMX frame per engine tick (`Dmx::commit`): 40 fps = engine. First try left the fixture dark: frames now follow each other closely and the baud switch for the break came while the UART still had bytes queued; it now waits for "transmission complete" (`waitIdle`). **Rainbow smooth on the fixture** | 0.1.1 |
| 9 Nov 2026 | stress | **Stress test** (`tools/stress/`, 8 universes / 1360 RGB pixels with effects, 108 triggers): Art-Net came out at **8.4 fps** (engine tick 115 ms). Found and fixed: PlatformIO compiled everything with `-mfloat-abi=soft` (all float/double in software: `build_unflags`); **Mbed's Ethernet driver switches the data cache off** at start (`SCB->CCR`), so the whole firmware ran uncached: switched back on, write-through, Ethernet receive buffers uncached through the MPU (`cacheOn` in Net.cpp); SDRAM mapped uncached by Arduino's SDRAM library (now write-back, `BigRam.cpp`); a 390 KB show was refused ("NoMemory": ArduinoJson's 65535-slot limit on 32-bit, now 32-bit slot ids); fixture channel names as heap Strings ran the heap dry on save (now point into the project JSON); slow loading loops (id lookups). Result: **tick 13 ms, Art-Net 38.9 fps on 8 universes, 61-62 fps at 60, + 8 sACN universes** | 0.1.1 |
| 9 Nov 2026 | stress | **Triggers**: 100 UDP messages/s dropped the lights to 13 fps (0.5-3 s stalls). Causes: Mbed's malloc wrappers (stats mutex + tracing + copy-realloc, ~3000 cycles per allocation: replaced, `src/Heap.cpp` + weakened symbols in `libmbed.a`), newlib-nano (full newlib now, +35 KB flash), `String::equalsIgnoreCase("...")` allocating per compare in the command parser, the log written to the stick from the main loop (own thread now), all queued packets handled at once under the engine lock (6 ms budget per loop now). Result: lights stay at 40 fps under 3000 msgs/s, ~370 fires/s. A first try with a critical-section heap lock hung the board at boot (no USB): recovered via bootloader + dfu-util. Numbers in README "Capacity (measured)" | 0.1.1 |
| 9 Nov 2026 | stress | **Second round** (same show): engine frame **13 → 7 ms** (`/api/status` `stats.tickParts`: effects 7.1 → 4.4 ms, fades 1.8 → 0.6, mixing 2.4 → 0.7, sending 1.5 → 1.0). Causes: the firmware is `-Os`, so even `testBit` was a call per channel (hot functions now `O2`, helpers forced inline, `lroundf` → one VCVTA); effects run a per-frame part once (`prepare()` in Fx.cpp, tested bit for bit in WSL with `tools/fxtest`). **Receive thread** (`src/NetRx.cpp`, above the main loop, lwIP thread raised too): evenly spaced 900 UDP messages/s, none lost; the earlier "~440/s" was the PC tool sending in ~50-packet bursts (the Ethernet chip holds ~7). **malloc** 2.8 → 0.43 µs (small-block pool, `HeapPool.h`, ASan-tested in WSL; first try had a constructor that wiped the pool after boot - fixed before anything else ran on it). Per message ~0.1 ms (tokenize per character, debug-log arguments, Vars growth). Hundreds of "fired" log lines/s made frames up to 25 ms (stick writes): max 10 per trigger per second. Bursts (`repeat 500 times`) run 3 ms at a time: lights stay at 40 fps. Triggers in SDRAM: +41 KB heap. Integrity check, ArtPoll, DMX input (Art-Net + sACN), deferred `reload`, 3000-round burst: OK. Ledtest restored byte-identical (frame 0.5 ms, 211 KB free). | 0.1.1 |
| 9 Nov 2026 | 9 | **Network firmware update 0.1.1 -> 0.2.0** (with the second-round changes: receive thread, small-block heap, NTP thread): upload 29 s (was 48 s), back after ~10 s, log "Firmware updated: 0.1.1 -> 0.2.0", `lastOk` true, **Last start `restart`** (said `other` on 6 Nov). Web UI updated with it, project kept byte-identical, integrity check OK. **NTP in its own thread** synced right after boot; an unknown server logs "cannot resolve" and backs off (the no-DNS case itself not reproduced: office DNS answers at once) | 0.2.0 |

**Still to do:** 6 (a DMX tester to measure break/MAB; more than one fixture), 7a (Machine Control I/O by hand), 7b with
real devices, 8 (watchdog: the start reason works now), 10 (long run overnight). Repeat the 5-minute run
once the router is back (DHCP address, NTP working), and check the controller switches from the
fallback to DHCP by itself when the router comes on.
