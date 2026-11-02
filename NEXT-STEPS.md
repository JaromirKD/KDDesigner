# Next steps

State on 1 Nov 2026: all features in the README are built and tested in the mock. The firmware
compiles (default build RAM 45 %, flash 67 %; Machine Control RAM 46 %, flash 72 %) but has
**never run on the Portenta**. No version control yet; `backup-before-tidy.zip` in the project
folder is the state before the first tidy-up.

## 1. First: Git

Git isn't installed, so there is no history and no way back from a bad edit. Install it
(git-scm.com), then `git init` and commit everything as it is now. `.gitignore` already skips
`.pio/`, `.vscode/`, `project.bak` and the backup zip. Decide whether `inspiration/`
(a third-party .pd2 project) and `data/show/media/` (the user's floor plan) belong in the repo.

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
- RAM: the big blocks are the 8 playbacks (73 KB, by design: 4 universes x 512 x from/to/cur/track)
  and the 512-line log in RAM (68 KB). Making the log ring smaller would save RAM but show fewer
  log lines in the web UI, so it is left as it is until RAM is actually short.

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

## 6. Later
- **First test on the Portenta**: USB stick mount, Ethernet, DMX timing on the RS485 pins (check `Config.h` against the carrier board), Art-Net/sACN, the web UI from the stick (copy the whole new `www` folder), and effects (`Fx.cpp` has only been checked by reading).
  **Watchdog** (added 1 Nov 2026): after a normal boot "Last start" should say `power on`; a project save with a big rig must not trip it (15 s); a network update must still install (the bootloader runs after a system reset, which stops the watchdog). Test a hang once, e.g. a temporary `while (1) {}` in a command, and check the board comes back with `watchdog`.
- **Network update on hardware** (`src/Update.cpp`, written from Arduino's Portenta OTA library without having run): bootloader version shown on Settings; QSPI partition 2 created/mounted on first boot; a `.kdupdate` with a raised `KD_VERSION` installs and the log says "installed" after the restart. Check whether the bootloader deletes `UPDATE.BIN` itself (then the "installed / NOT installed" check can't run and needs another way). Also watch the engine during the upload: the HTTP thread writes ~1.4 MB to QSPI and the stick.
- Ideas mentioned along the way: more effect templates using `y`, e.g. ripple and radar (see the conversation of 31 Oct).
