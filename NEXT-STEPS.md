# Next steps

State on 9 Nov 2026: all features in the README are built and tested in the mock. **First run on
a Portenta Machine Control** on 6 Nov: boot, stick, network, web UI, saving, Art-Net/sACN output,
effects, UDP triggers and the network update work (see HARDWARE-TEST-PLAN.md for what was found
and fixed). **9 Nov**: stress test and two rounds of speed-ups (README "Capacity (measured)"),
installed as **0.2.0** by network update. Machine Control build: RAM ~28 %, flash ~86 %.
`backup-before-tidy.zip` in the project folder is the state before the first tidy-up.

## 1. Git - done 2 Nov 2026

The project is a Git repository, committed from Sourcetree. Git is Sourcetree's own copy
(`%LOCALAPPDATA%\Atlassian\SourceTree\git_local\bin\git.exe`), not on the PATH, so `git` doesn't
work in a terminal unless Git is installed from git-scm.com. `.gitignore` skips build output
(`.pio/`, `updates/`), what the mock writes (`project.bak`, `data/show/logs/`), the nested
`inspiration/PharosGuiCreator/` repository and the backup zip. The show (`project.json`, `media/`)
is in the repo, so every commit is also a version of the show. The Pharos `.pd2` in
`inspiration/` is someone else's project: take it out before the repo goes anywhere public.

## 2. Tidy-up - done 31 Oct 2026

No change in behaviour, except the small fixes noted below. Firmware RAM unchanged, flash 384 bytes smaller.

### Firmware
- `Show.cpp` split: engine + output in `Show.cpp`, reading project.json in `ShowParse.cpp`,
  shared tables in `ShowInternal.h`. `Show.h` is unchanged.
- One `Project::loadModules()` instead of the same list of `load()` calls in `main.cpp`,
  `Cmd.cpp` (reload) and `Web.cpp` (save). Worker threads now start after everything is loaded.
- `Util.*`: one `isNumber`, `findRef` (id or name) and `unescape` instead of 3-5 copies
  (Show, Pcs, Projectors, State, Triggers, Io). `findRef` is a template, no `std::function`.
- Channel-name recognition once (`colorSlots` in ShowParse.cpp) for presets and effect targets.
- `State::findMode` for "mode <group> <state>" (was written out in Cmd and in Triggers' conditions).
- Smaller duplicates: output name parsing in Cmd, UDP packet sending and sender variables in
  Triggers, track-fade start and channel claiming in the engine, "not running" messages.

### Web UI and mock
- `app.js` split into `app-core / grammar / rig / show / triggers / system / main .js`.
- `model.js` (new) holds the project rules the UI and the mock both had: fixture channels,
  footprint, channel names, track fixtures, map position, fade-path curves.
- One keyboard handler (`views.<page>.keys`), one handler for all "open →" links, one list of
  page animations/polls (`pageAnimation` / `pagePoll`), colour helpers together in app-core.js.
- Dead code removed: `views.patch.after`, `addItem('group')`, the old `.track` CSS.
  (`.ruler` is still used by the timeline ruler and stays.)
- Effect previews work out a fixture's channels once instead of every frame.

### Small fixes that came with it
- The mock ran a track's effect on its fixtures in patch order; it now uses the track's own
  order like the firmware (affects `i` / `u` in effects in the mock only).
- `send tcp` now understands `\xHH` like `send udp` (one shared `unescape`).
- A fixture with two channels of the same role (e.g. two `dim`) now uses the first one
  everywhere; the firmware used the last one, the UI the first.
- Schedule page "open →" now selects only that trigger (it kept an old multi-selection).

## 3. Second tidy-up - done 1 Nov 2026

No change in behaviour, except the small fix noted. Firmware RAM unchanged; flash 344 bytes
smaller (default env 528,152 -> 527,808 bytes, Machine Control 568,072 -> 567,736).

- Firmware: one `rest()` (command words back to text), `httpMethod()` and `epochNow()` in
  `Util.*` instead of copies in Cmd, Drivers and Io; one `takePlayback()` and `putTarget()` in
  Show.cpp; a duplicate bit helper (`clrBit`) removed; in Drivers.cpp one HTTP retry call, one
  UDP send and one device-to-connection copy; in Io.cpp one queue-take and one device-state lookup.
- Web UI: unused `KISS_SLOTS`, `typeUsers` and two unused CSS rules removed; the two "set clock"
  buttons share one function; the date / sunrise maths are in `model.js` once (UI and mock had
  copies).
- Settings page with a big rig: the raw JSON box is filled after the page is drawn instead of
  being escaped into the HTML (215 ms -> 7 ms with 600 fixtures).
- Mock: sections are labelled with the firmware file they mirror (Show, Cmd, State, Triggers...).
- README reordered as a manual: setup -> patch -> fixtures/maps -> scenes/timelines/effects ->
  triggers -> schedule -> devices -> panel -> command reference -> logging -> API.
- **Tests**: `node tools/check-project.js [project.json]` compiles every base and project effect
  (and runs it a few times, checking for errors and NaN) and lists every trigger's red-! problems
  using the real UI grammar.
- Checked: the command and condition words in Cmd.cpp / Triggers.cpp, the mock and the UI grammar
  match. Big rig (600 fixtures, 4 full universes, on a copy): every page draws in < 55 ms, live
  map / DMX monitor / effect preview updates take < 5 ms each.
- Fix: leaving the Log page before the log levels arrived caused a console error.

## 4. Still open
- `Cmd.cpp` is one long if-chain. A table of commands is optional; it reads fine as it is, and
  rewriting it would only risk small differences in error messages.
- `check-project.js` checks that effects run, not their exact output values. Known-value tests
  would be a good guard for `Fx.cpp` once it can be compared on the real board.
- RAM: the big blocks are the 8 playbacks (146 KB, by design: 8 universes x 512 x from/to/cur/track)
  and the 512-line log in RAM (68 KB). Making the log ring smaller would save RAM but show fewer
  log lines in the web UI, so it is left as it is until RAM is actually short.
- More than 8 universes (e.g. a 2048-pixel grid = 12): move the playback buffers to the Portenta's
  8 MB SDRAM (the Machine Control's H7 has it) once the firmware has run on the board, then raise
  `MAX_UNIVERSES` in app-rig.js with `KD_MAX_UNIVERSES`.

## 5. Things noticed in the project data (not code)
- Trigger **#39 "Trigger 39"** now has `knx knx write 1/1/1 on` and an empty second action;
  it looks like a test trigger.
- Trigger **"Test step"** uses `{count}`, which only exists when it runs from `repeat`. Fired from
  the Puppet show timeline cue it logs "unknown scene '{=1+count%2}'".
- `data/show/media/map1-mvw2o056.png` is an unused duplicate of the floor plan (`map1-mvw33urn.png` is the one in use).

## 5b. Trigger features added 1 Nov 2026 (tested in the mock only)
Cooldown, while running (again / ignore / restart / queue), hold and double press (inputs and
panel), sequence triggers, `wait until … [timeout]`, `repeat <n> times [every <s>]`, DMX input
(Art-Net / sACN), templates, find & replace, fire history. Firmware RAM 45 % -> 46.5 %
(history 4 KB, DMX input 2 KB + receive buffer).
- Fixed on the way: on the controller `sleep 0.5` (any non-whole number) was refused as
  "expected: sleep <seconds>" since the tidy-up's shared `isNumber` only takes whole numbers. The mock
  always accepted it.
- Mock fix: delayed/repeated fires logged "from trigger (kind, id) => …" (a local helper in `exec`
  hid the global `running`).
- On hardware, check: Art-Net and sACN input from a real desk (OpDmx parsing, sACN multicast join on
  the output socket via `beginMulticast`), and that reading full Art-Net packets in `Net::poll` (now
  under `g_engine`) doesn't slow the loop with a busy network.

## 5c. First hardware run (6 Nov 2026)
Fixed on the day (details in HARDWARE-TEST-PLAN.md):
- **4-socket limit** of Arduino's prebuilt `libmbed.a`: rebuilt with 32 sockets in WSL
  (`tools/core/`, used through `board_build.variants_dir`; how to rebuild in `tools/core/README.md`).
- **Out of memory** when saving a project: playback buffers and the log ring moved to the unused
  D2 SRAM (`src/D2Ram.*`); heap free went from 34 KB to ~205 KB.
- **UDP packets cut at 508 bytes** (Art-Net / sACN out and in): `-DWIFI_UDP_BUFFER_SIZE=1024`.
- **Every browser connection spun a thread** (Arduino `MbedClient::readSocket`), starving the DMX
  thread: patched copy in `lib/SocketWrapper`.
- Serial log empty when a monitor connects after boot: the log ring is replayed on connect.
- Web UI with no project on the stick: 7 pages crashed (`emptyProject()` without `normalize()`).
- Web UI took > 40 s to open (22 KB/s, Nagle + delayed ACK on small writes): replies now go out in
  whole-segment blocks (`kTxBlock` in Web.cpp); the socket reader no longer sleeps 100 ms before
  reading a request; updates store the UI gzipped with ETags (`serveWww`). Opens in 1.3 s, reload
  0.3 s. The stick (~300 KB/s) is now the limit; a bigger TCP send buffer wouldn't help much.
- `/api/log` with a full ring sometimes arrived empty (a 58 KB body copied once more failed to
  allocate) and took 1.1 s to build: no copy, space reserved, 0.06 s.

Still open:
- ~~I/O worker thread stalls~~ - fixed 6 Nov 2026 (TCP answers / HTTP responses seconds late, PLC
  polls ~1 s, waits of 10-40 s). Causes: the network-bound threads (io, drv-http/udp/push, pjlink,
  monitor, mail) ran at BelowNormal and only got the CPU when every Normal thread (main loop, web,
  socket readers) was idle - now Normal; Arduino's `MbedClient::write` switched the socket to
  blocking, so the reader thread's `recv()` could block holding the lock `read()` needs - the
  socket now stays non-blocking (`lib/SocketWrapper`); `connect()` had no time limit - now
  `setSocketTimeout`. `Io.cpp` logs "I/O thread: <job> took N ms" over 500 ms. Afterwards: PLC
  polled every 500 ms (max gap 506 ms) with the Inloop playing, trigger test 22/25 (the 3 left
  are the test's own expectations and sACN input), TCP + Modbus reconnect after the peer restarts.
  Clean 5-minute run done 6 Nov 2026 (router off, fallback address): PLC every 505 ms, 0 failed
  requests; only the one NTP try (no DNS) still blocked the I/O thread 15 s - see NTP below.
- ~~No network at start-up~~ - fixed 6 Nov 2026. The "lost network" that day was the office
  router (DHCP server) being off, not the cable: Arduino's `Ethernet.linkStatus()` only says
  whether the interface has an address, so "no DHCP answer" was logged as "cable not connected",
  and the fallback never took because `Ethernet.begin(ip…)` was called while the DHCP connect was
  still running (a second `connect()` is ignored). Now (`Net::begin` / `Net::maintain`): the cable
  link is read from the PHY chip on Mbed's shared event queue (the driver's own PHY thread), the
  log says "No Ethernet link…" or "Cable OK, but no DHCP answer…", the interface is disconnected
  before the fallback is set, and cable pulls are logged. While on the fallback a DHCP DISCOVER
  goes out every 30 s from port 68 *keeping the address*; only an OFFER switches the interface
  to DHCP (back to the fallback after 10 s if no lease, then 10 min before the next switch). A
  first version re-ran lwIP's DHCP every minute instead: every device dropped off for 10 s each
  time. Fallback is now `172.16.1.111` (the office network; `KD_FALLBACK_*` can be set per build).
- ~~Start reason after reflashing the same build says `unexpected`~~ - fixed: the build id is a
  hash of the firmware in flash (code + data, `buildId()` in main.cpp) instead of main.cpp's
  `__DATE__ __TIME__`, and a USB upload (the 1200-baud touch, hooked in our `variant.cpp` as
  `kdBeforeBootloader`) is marked, so the same build flashed again shows `USB upload`.
- ~~NTP blocked the I/O thread every minute~~ - fixed: with no DNS answer (router off) a try took
  ~17 s on the I/O thread, which also polls PLCs and TCP devices (PLC gaps of 17 s). Now the
  name is resolved first (Arduino's `beginPacket(host)` "succeeded" without an address) and
  failed tries back off 1, 2, 4 … 30 min. NTP now has its own thread (9 Nov 2026).
- ~~sACN input did not fire~~ - fixed 6 Nov 2026. Unicast always worked: a "changes" `dmx_in`
  trigger logs "fired" at debug level, which the trigger test looks for (`trigtest.js` should
  check the grand master instead). Multicast never arrived: Mbed's STM32 EMAC driver has
  `add_multicast_group` / `set_all_multicast` as no-ops, so the MAC filter (`ETH->MACPFR` 0)
  dropped every multicast frame. `macAcceptGroup` in Net.cpp opens the group's hash bin (re-applied
  every second by `Net::maintain`). Anything else that joins multicast needs the same. `sacnRx`
  (packets/s) is in the status and on the dashboard.
- ~~Engine tick ~24 ms with a looping timeline~~ - fixed 6 Nov 2026: the main loop read `now`
  before waiting for `g_engine`; a timeline started meanwhile (web thread, trigger) had
  `start > now`, `now - start` wrapped, the timeline "looped" every tick (`start += length` kept
  it ahead) and re-fired all its cues 40 times a second, for ever (status `pos` ~3.7e9). Now
  `updateTimeline` uses a signed difference and the loop reads `now` after taking the lock.
  Worth checking the other `now - x.start` fades / effects for the same pattern.
- ~~Engine load with a big show~~ - profiled and sped up 9 Nov 2026 (13 -> 7 ms for 1360 pixels
  with effects; `stats.tickParts` in the status shows the parts). Still to check: the feature
  demo's Inloop with a DMX fixture on the port (it dropped to ~22 fps before).
- ~~NTP in its own thread~~ - done 9 Nov 2026 (the no-DNS case itself not reproduced on the board).
  Small: "Web UI on http://0.0.0.0/" is logged when started without a cable (the address follows later).
- **Long run** with the stress show (hours, traffic on all inputs): the 9 Nov changes (receive
  thread, small-block heap, triggers in SDRAM) were only tested for minutes. Watch free heap, restarts,
  Art-Net gaps.
- Thread stacks with little room (`osThreadGetStackSpace`, 9 Nov): `lwip_tcpip` ~370-410 bytes free
  (its size is set in the rebuilt `libmbed.a`), `USBevt` (Arduino's USB serial) 120 of 256. Fine in
  all tests so far; look there first if the board ever crashes under network load.
- **Heap**: ~196 KB is used with an empty show (thread stacks ~80 KB, network, USB); the feature
  demo leaves ~100 KB free. Trim thread stacks after measuring them (Mbed stack stats are enabled).
- Small: a timeline master set while it is releasing ends the release early in the mock but not
  on the controller (the controller is fine; the mock could match).
- **DMX port at 33-35 fps instead of 40**: `Dmx.cpp` sends byte by byte with a busy-wait at below-normal
  priority (a full frame is 23 of the 25 ms), so any other work makes it miss its slot. Better: UART
  TX interrupt (or DMA) per port, the thread only doing break/MAB. Check with a DMX tester/fixture.
- ~~"Last start" always `other`~~ - fixed: the bootloader clears `RCC->RSR`, so the start reason now
  comes from the log ring kept in D2 SRAM (`Log::startReason`, breadcrumbs `Log::crumb`).
- **Engine tick 17-20 ms (budget 25) while an update is uploaded**: the HTTP thread writing to the
  stick holds the CPU. Uploads run at ~53 KB/s (TCP window 4 × 536 bytes): a 1.8 MB firmware update
  takes ~50 s. Fine outside show hours; raise `lwip.tcp-mss` / `tcp-wnd` if it matters.
- **NTP** answered on some tries, "no reply" on others (pool.ntp.org from the office network). Recheck
  with the router on (6 Nov it was off: no DNS at all).
- Each `EthernetClient` still costs a 4 KB reader-thread stack plus buffers; with ~205 KB free that
  is fine, but watch the heap line with many TCP devices / projectors.

## 5d. Flash layout and faster saving (10 Nov 2026, measured on the Machine Control)
- **All flash to the M7** (`flash_layout = 100_0`, `kAppEnd` 0x08200000): Machine Control build
  702 KB of 1.75 MB (38 %), firmware.bin 720 KB. USB upload tested; a network update with it (and one over 768 KB)
  still to test. Boards on 0.2.0 accept at most 768 KB for the first update.
- **Fixed: a save could restart the board** (watchdog): `Io::load()` waited for the I/O thread
  while holding `g_engine`, and a connect to a TCP / Modbus device that is off takes ~18.4 s
  (Mbed's lwIP `connect()` ignores the socket timeout). The I/O thread now picks up new device
  lists itself. The 18 s connect is still there: while a device is off, the I/O thread's other
  work (HTTP requests, PLC polls, TCP lines) waits that long every retry. Real fix: a
  non-blocking connect in the rebuilt `libmbed.a` (LWIP `socket_connect`), or a thread per device.
- Saving a 399 KB show: 6.1-6.8 s -> ~0.9 s to "Saved" + ~1.5 s stick write in the background.
  Done: string sharing in ArduinoJson (`lib/ArduinoJson`, 1.8 -> 0.6 s), reads straight from the
  socket (`lib/SocketWrapper` `read()`, 2.1 -> 0.1 s), stick in 32 KB pieces from D2 SRAM, the
  stick write in its own thread (`Storage::saveProject`), progress bar in the UI.
- Not done: **gzip upload** (todo 38c) - receiving takes 0.1 s now, so inflating would cost more
  than it saves on a LAN. Reading the JSON (0.6 s) still grows with the number of *different*
  strings (fixture names, trigger lines): each new one is compared with all before it. A hash
  index in `StringPool` would fix that if a big show needs it.

## 6. Later
- **First test on the Portenta** (step by step in [HARDWARE-TEST-PLAN.md](HARDWARE-TEST-PLAN.md); started 6 Nov 2026, see 5c): USB stick mount, Ethernet, DMX timing on the RS485 pins (check `Config.h` against the carrier board), Art-Net/sACN, the web UI from the stick (copy the whole new `www` folder), and effects (`Fx.cpp` has only been checked by reading).
  **Watchdog** (added 1 Nov 2026): after a normal boot "Last start" should say `power on`; a project save with a big rig must not trip it (15 s); a network update must still install (the bootloader runs after a system reset, which stops the watchdog). Test a hang once, e.g. a temporary `while (1) {}` in a command, and check the board comes back with `watchdog`.
- ~~Network update on hardware~~ - works: 0.1.0 -> 0.1.1 on 6 Nov, 0.1.1 -> 0.2.0 on 9 Nov 2026 (HARDWARE-TEST-PLAN). Original notes: (`src/Update.cpp`, written from Arduino's Portenta OTA library without having run): bootloader version shown on Settings; QSPI partition 2 created/mounted on first boot; a `.kdupdate` with a raised `KD_VERSION` installs and the log says "installed" after the restart. Check whether the bootloader deletes `UPDATE.BIN` itself (then the "installed / NOT installed" check can't run and needs another way). Also watch the engine during the upload: the HTTP thread writes ~1.4 MB to QSPI and the stick.
- Ideas mentioned along the way: more effect templates using `y`, e.g. ripple and radar (see the conversation of 31 Oct).
