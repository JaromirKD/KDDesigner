# KD Designer

A stand-alone DMX / Art-Net / sACN show controller for the **Arduino Portenta H7**, inspired by Pharos Designer 2.
You program it from a browser, and everything (the show, the web UI and the logs) lives on a USB storage device (stick or SSD).

```
            ┌──────────────── Portenta H7 (M7 core) ─────────────────┐
 USB stick ─┤ Storage   /usb/show/project.json, /usb/www, /usb/logs  │
            │   │                                                    │
            │ Show engine 40 Hz ── timelines · scenes · overrides ── GM│── DMX thread ── UART ─ RS485 ─ DMX 1..n
            │   ▲         ▲                                         │── Art-Net (UDP 6454, ArtPoll reply)
            │ Triggers   Cmd language  ◄── web console / UDP "cmd:"  │── sACN E1.31 (multicast 239.255.x.y)
            │   ▲                                                    │
            │ time · interval · UDP · GPIO · startup · timeline end   │
            │                                                        │
            │ Web threads: HTTP (UI + JSON API) · SSE live log/status │── Ethernet
            └────────────────────────────────────────────────────────┘
```

## Hardware

| Part | Notes |
|---|---|
| Portenta H7 | The M7 core runs everything. The M4 is free for future work, e.g. DMA-driven DMX. |
| Portenta Breakout or Mid Carrier | Provides Ethernet RJ45 and a USB-A host port. The breakout's USB-A VBUS is switched on via `PA_15`. |
| **or** Portenta Machine Control | The Portenta H7 inside Arduino's industrial box: Ethernet, USB-A, **one** RS485 port (used for DMX 1) and 24 V / 0-10 V I/O you can use in the show (see **Machine Control I/O** below). Needs its own firmware build (`machine_control`). |
| RS485 transceiver per DMX port | MAX485 works for a start. Use isolated parts (ISO3082/ADM2587E) for real installs. |
| USB storage device | A stick or SSD, FAT32. |

DMX wiring (per port): UART TX → transceiver DI, DE and /RE tied to 3.3 V (transmit only), A/B → XLR pins 3/2, GND → pin 1. Add a 120 Ω terminator at the end of the line.
Default TX pins are in [src/Config.h](src/Config.h) (`PA_9` = UART1, `PG_14` = UART6). **Check these against your carrier's pinout** before wiring.
On the **Machine Control** there is no extra transceiver: DMX 1 comes out of its RS485 terminals (half duplex: **485 TX P → XLR 3, 485 TX N → XLR 2, GND → 1**; RX P / RX N stay empty; its own terminator is switched off). There is no DMX 2; use Art-Net/sACN for more universes.

## Build & flash

The code is in `src/` (`main.cpp` has `setup()`/`loop()`). Use either tool:

**PlatformIO** (recommended, used for all builds so far)
1. Install [PlatformIO](https://platformio.org/): the VS Code extension or `pip install platformio`.
2. Connect the Portenta over USB-C, then build and upload. If the upload can't find the board, double-tap the reset button; the green LED then pulses.

```bash
python -m platformio run -t upload
```

   For a Portenta in a **Machine Control**, build and upload the `machine_control` firmware instead (it adds Arduino's Machine Control library and uses the box's RS485 port and USB-A):

```bash
python -m platformio run -e machine_control -t upload
```

3. Watch the serial log (it starts with the recent log lines, so the boot log shows even when you connect later):

```bash
python -m platformio device monitor
```

The build uses a rebuilt copy of Arduino's core library for the Portenta (`tools/core/`): Arduino's own allows only 4 network connections in total, too few for the web UI next to Art-Net, sACN and the trigger ports. Nothing to do for normal builds; only rebuild it when moving to a new Arduino core version (needs WSL, see `tools/core/README.md`). `lib/SocketWrapper` is a patched copy of one Arduino library (see `lib/README.md`).

**Arduino IDE 2**
1. Boards Manager: install **Arduino Mbed OS Portenta Boards**.
2. Library Manager: install **ArduinoJson** (Benoit Blanchon, v7) and **Arduino_USBHostMbed5**. For the Machine Control also **Arduino_PortentaMachineControl**, and add `#define KD_BOARD_PMC` at the top of `src/Config.h`.
3. Open `KDDesigner.ino` (the folder must stay named `KDDesigner`). The IDE compiles `src/` automatically.
4. Tools → Board → **Arduino Portenta H7 (M7 core)**, pick the port, then Upload.

## Prepare the storage device

Copy the contents of [data/](data) to the root of a FAT32 stick:

```
/www/index.html, app-*.js, fx.js,     web UI (copy the whole www folder:
     model.js, style.css              the page needs every file)
/www/panel.html, panel-ui.js,         touch panel (http://<ip>/panel)
     panel.css
/show/project.json                    the show (written by the UI on Save)
/logs/                                created automatically (system.log + system.1-4.log, 8 MB each; history/)
```

Boot the controller and open `http://<ip>/`. The IP appears in the serial log; DHCP is the default, with `172.16.1.111` as the fallback.

**When DHCP doesn't answer** (router off, or a network without DHCP) the controller uses `172.16.1.111` (mask 255.255.255.0) and keeps asking for DHCP: every minute for the first 10 minutes, then every 10 minutes, and at once when the cable is plugged back in. Each try takes up to 10 s without network, so on a network without DHCP set a fixed address in Settings. The log tells the two problems apart: "No Ethernet link: check the cable…" (no cable / switch port off) or "Cable OK, but no DHCP answer…" (router / DHCP server). Pulling and plugging the cable is logged too.
If `/www` is missing, the controller still serves a minimal page with the live log.

## Updating over the network (no USB cable, no stick swap)

The show and map images are always saved over the network (Save, image upload). New **firmware** and a new **web UI** can go that way too, once the controller has been set up over USB-C one time.

**Once, on the bench (USB-C):**
1. Update the Portenta's bootloader. Network updates need bootloader version 22 or newer. Arduino IDE → File → Examples → **STM32H747_System → STM32H747_manageBootloader**, upload it, open the Serial Monitor and answer `Y`. Settings → Software update shows the bootloader version if it's too old.
2. Upload the KD Designer firmware and prepare the stick as above.

The controller prepares the QSPI flash itself on the first start (it adds partition 2 if it's missing; that's where Arduino's own update tools keep updates too).

**Every update after that:**
1. Every firmware build also writes an update file: `updates/KD-Designer-<version>-portenta.kdupdate` (or `-machine_control`). It holds the firmware **and** the whole web UI. Raise `KD_VERSION` in `platformio.ini` for each update you hand out.
2. In the web UI: Settings → **Software update → Install update file…**, pick the file and confirm.
3. The controller checks the whole file first (checksums, right board, a real M7 program). Only then does it replace the `www` folder on the stick and store the firmware in its QSPI flash. It restarts, the bootloader installs the firmware, and the page reloads with the new version. **No light output for about half a minute**, so update outside show hours. The project, images, state and logs are kept.
4. After the restart the controller checks that its flash really holds the new firmware. The log and Settings then show "last update 0.1.0 -> 0.2.0: installed" or **NOT installed**.

If the upload is cut off or the file is damaged, nothing changes. A file for the other board type (Portenta vs. Machine Control) is refused. Only if a new firmware has a bug that breaks the network do you need the USB-C cable once to put the old version back, so try each update on the bench first.

A web-UI-only update (no restart, any controller): `python tools/make_update.py --www-only`.

An update stores the web UI on the stick **compressed** (`app-core.js.gz` etc., about a quarter of the size) with a list of versions (`www/etags.txt`). The web UI then opens in about 1.3 s, and a reload takes about 0.3 s because the browser only checks whether files changed. A stick filled by hand from `data/www` works too (plain files, no list), it just opens slower (about 4.5 s). Browsers always accept the compressed files; a plain `curl` needs `--compressed`.

## Developing the UI without hardware

```bash
node tools/mock-server.js
```

Then open http://localhost:8080. The mock serves `data/www`, simulates playback, DMX output, triggers and the live log, and **saves to `data/show/project.json`** (the previous version is kept as `project.bak`).

## Show files: working on a PC, moving shows to and from the controller

Settings → **Project file** works like "Save as" / "Open":
- **Export show file…** downloads the project as it is in the editor (unsaved changes included) plus its map images, as one file `<name>-<date>.kdshow`. Use it as a backup, or to take a show home.
- **Open show file…** loads a `.kdshow` (or a plain `project.json`) into the editor and uploads its map images. Nothing changes on the controller until you press **Save**; **Undo** goes back to the previous project. If the file has other network settings than the controller, you're asked which to keep, so a show made on a PC doesn't move the controller to another IP.
- **New project** starts empty (keeping the controller's network settings).

### The launcher

To make or edit a show on your PC, double-click **`KD Designer (PC).cmd`** in the project folder (needs [Node.js](https://nodejs.org), nothing else to install). The launcher page opens in your browser (http://localhost:8079). The black window that opens with it is the launcher itself: **closing it stops every show it opened**, so save in the browser first. Double-clicking the file again just brings the page back. You can also drop a show folder onto the file to open it at once.

- **Shows**: everything in `Documents\KD Shows`, the shows you opened from somewhere else, and the examples (the sample project, the feature demo and the museum examples). Tabs: All, Recent, Pinned, Open now, Examples. Search with `/`, pick with the arrow keys, Enter or double-click to open.
  - **Open** starts the show in its own tab, on the first free port from 8080. Several shows can be open at once; an open show gets a green *open · port* badge and a **Close** button.
  - **Check** lists the problems in the show (the same as `check-project.js`). **Backup** saves a `.kdshow` in `KD Shows\Backups`. You can also **Duplicate**, **Rename**, **Show in Explorer**, **Pin** (keeps it at the top) and **Delete** (moves it to the Recycle Bin). The examples can be copied but not renamed or deleted.
  - **+ New show** (Ctrl+N) starts an empty show. **Open…** (Ctrl+O) picks a `project.json` anywhere, or a `.kdshow` file, which becomes a new show folder.
- **Controllers on the network**: controllers are found by Art-Net poll (they answer as "KD Designer"), so they must be in the same subnet as the PC. Otherwise add one by address; addresses are remembered. Each card shows the show, firmware, uptime and online state, with these buttons:
  - **Open web UI** and **Touch panel**.
  - **Copy show to PC**: copies the show with its map images into a new show folder.
  - **Send show**: replaces the controller's show with a PC show. Its old show is saved in Backups first, and it keeps its own network settings.
  - **Install update**: sends the newest matching `.kdupdate` from `updates/`.
- **USB**: Arduino boards on USB (a Portenta H7 with its COM port, or "bootloader" after a double-tap on reset) and storage devices (USB sticks and USB disks/SSDs). A KD storage device (one with `www` or `show`) shows its show. Buttons: **Copy show to PC**, **Put show on device** (old show to Backups, network settings kept), **Copy/Update web UI** (copies `data/www` to the device's `www`).
- **Other Art-Net devices**: other nodes that answered the poll (gateways, consoles, media servers), with a link to each one's web page.
- **This PC**: the PC's IP addresses (handy to set up the controller's network), the shows and backups folders, and the update files.

The first network search may bring up the Windows Firewall question for Node.js: allow it on private networks, or controllers can only be added by address. If another program (a lighting console app) already uses Art-Net port 6454, the page says so and finds controllers by address only. Settings (recent, pinned, controllers) are in `%APPDATA%\KD Designer\launcher.json`.

Without the launcher:

```bash
node tools/mock-server.js 8080 C:\Shows\MyShow
```

In the browser, build the show (or open a `.kdshow` exported from the controller), press Save to keep it in that folder, and **Export show file…** when it's ready. On the controller: **Open show file…** → **Save**.

Check a project without the browser: `node tools/check-project.js [project.json]` compiles every effect and lists the triggers that would get a red **!** (bad actions or conditions, missing references).

**Feature demo**: [examples/feature-demo](examples/feature-demo) is a show that uses every feature once, to look around or to show the system to someone: fixtures on 3 universes (16-bit movers and winch, a pixel grid, pars in a circle), 3 maps, all base effects, timelines with clips, effect and trigger cues, 71 triggers of every type in coloured sections with notes, a two-page touch panel (Technician PIN `1234`), and every kind of device and show device. Some devices are offline on purpose so Monitoring has something to show. Open it with `node tools/mock-server.js 8080 examples/feature-demo` (or drop the folder onto `KD Designer (PC).cmd`); work on a copy if you don't want the mock's logs and state files in the repo. Try `dmxin artnet 0 1 255`, `projector "PJ left" send LAMP=4100` or `io in0 off` in the console. `node tools/make-demo.js` rebuilds it: add new features there too.

**Museum examples**: ready-made starting points for typical museum jobs, each with notes on its triggers and a touch panel. In the launcher they are under **Examples**: **Duplicate** one, then change the addresses, IPs and names to your installation.

| Example | What it shows |
|---|---|
| [museum-gallery](examples/museum-gallery) | A permanent exhibition: cleaning light 08:30, opening 09:45 (power, PCs, projectors, then the light), closing 17:00 and Thursdays 21:00, closed on Mondays and holidays, night light, weekly PC reboot, emails when something drops out. All in one **Museum** mode group: the clock and the front-desk buttons only change the mode. |
| [immersive-room](examples/immersive-room) | A 6-minute projection show with light in 4 chapters (sea, forest, storm, sunrise), synced to the media server and audio by OSC. Started by a big button (Kiss-Box input) or every 15 minutes; inloop in between; fire alarm and door contact; shows-per-day counter; technician page (PIN `1234`) to jump to a chapter. |
| [hands-on-exhibit](examples/hands-on-exhibit) | 6 buttons on a table: each plays its video on a BrightSign and lights its object, LED rings in the buttons; back to the attract loop after the video; a presence sensor puts it to sleep after 5 minutes; out-of-order switch and press counters per button. |
| [story-diorama](examples/story-diorama) | A diorama with narration in Dutch, English and German: one timeline per language with the same light cues timed to its own audio (spots on the objects, sunset sky, fire, stars, water). Language buttons with LEDs and a staff key switch on the **Machine Control** inputs (needs that build). |
| [auditorium](examples/auditorium) | A lecture hall with presets (walk-in, lecture, film, break, cleaning, off) on a lectern panel. Each preset sets light, projector, projection screen (NETIO relays), blinds (KNX); fire alarm from KNX; room booking system over UDP (`HALL LECTURE`). |
| [building-startup](examples/building-startup) | The whole museum on and off in the right order: power (NETIO per floor), then PCs, then projectors; at night the other way round with time for the projectors to cool down. A start-up report emails every device that didn't come up. Device groups per floor, front-desk panel per floor, evening-event mode, façade on a Pharos controller at sunset. |
| [brightsign-players](examples/brightsign-players) | 8 BrightSign players, each used in a different way: **lobby** with plain UDP commands and *Player says* (no plugin); **cinema** where the house light follows the film because the KD plugin reports the Video zone; **corridor** with a motion sensor on the player's GPIO that plays a welcome clip and lights the corridor; **audio guide** whose language is a user variable set from the panel; **signage** that reports a visitor count back to KD; **vitrine** with a climate probe on the player's serial port; **kiosk** where KD only counts the chapters visitors watch; **video wall** with a show at 11, 13 and 15 h (a Plugin Message) plus wall-wash light. A device group `screens` sends day/night/emergency to all 8 and reboots them on Monday. Staff panel with a test pattern per player (Technician PIN `1234`). The notes on each section say what the BrightAuthor presentation needs. |

The mock simulates the devices, so you can try them on the PC: e.g. `var start_button = on` (immersive room), `var btn3 = on` (hands-on), `io in1 on` (diorama) in the Console. `node tools/make-examples.js` rebuilds them.

## Patch: outputs and universes

- **Protocols**: DMX, Art-Net and sACN each have a global on/off switch (Patch page, saved in `settings.outputs`) and a live switch on the dashboard (`output artnet off`; reverts on reboot). With DMX off, the RS485 lines go idle, so another desk can take over.
- **Universes**: up to 8 internal universes (`KD_MAX_UNIVERSES`, about 20 KB of controller memory each; 8 × 512 = 4096 channels, about 1360 RGB pixels). Each has a tick box per protocol (`useDmx`, `useArtnet`, `useSacn`) plus its DMX port, Art-Net port-address and destination (broadcast or a node IP), and sACN universe.
- **Frame rates** (Patch → Protocols, `settings.outputs`): DMX 1–44 fps (a full 512-slot frame takes ~23 ms), Art-Net and sACN 1–60 fps. For Art-Net and sACN you choose between "only changes" (+1 s keep-alive) and continuously at the set rate. The engine runs at 40 Hz, or up to 60 Hz when a network rate above 40 is set. Change live with `output sacn fps 30`.

## DMX monitor

The live output of one universe (after grand master), 4 times a second.

- **Channels**: all 512 channels. Each patched fixture has one blue outline round all its channels (a fixture that runs onto the next row gets a box per row). Its first channel shows the fixture name, the others their channel name (`dim`, `r`, `pan` ...). Hover for the full name.
- **Fixtures**: one card per fixture in the universe: its live colour (with its icon), intensity in %, a small pan/tilt square for moving heads, its address and type, and a bar per channel.
- **Overrides are pink**: a channel you override has a pink value and bar, a fixture card with any override a pink border. The show keeps running underneath; release the override and the show's value comes back.
- **Override panel**: click a channel or a fixture card; Shift/Ctrl+click adds or removes more fixtures. It works like the Scenes programmer: a fader per channel (16-bit channels as one fine fader), **Full / 50% / Off** for the dimmer, and on the right the same **colour wheel** (RGB or HSV) and **position pad** as in Scenes. Everything you touch becomes an override of just that channel, on all selected fixtures; picking a colour also puts a dimmer the show has at zero to full. **All full** / **All zero** override every channel, **↺** gives one channel back to the show, **Release** the selected fixtures, **Clear all overrides** everything. A channel without a fixture opens on its own. The panel stays at the top while you scroll; Esc or ✕ closes it (the overrides stay).
- Overrides are commands, so triggers can do the same: `set 1.48-52 255`, `clear override 1.48-52`, `clear overrides`. They are not saved: a reboot or a project reload clears them.

## Working in the web UI

- **PC editor or live controller**: the badge next to the KD logo shows where you are. On the PC (the launcher or the mock) it is a blue **PC EDITOR** badge: nothing on a controller changes until you send the show to it. On the controller itself it is a red **● LIVE ON CONTROLLER · ip** badge, with a thin red frame around the window and a red **Save to controller** button. The browser tab shows **PC ·** or **● LIVE ·** with a ring or dot in the same colour. The first save in each browser tab on a controller asks whether you really want to change the running show. Pick both colours (red, magenta, orange, green, blue, grey) and switch the frame off or on in Settings → Display. A controller only shows this after its web UI has been updated.

- **Undo / redo**: **Ctrl+Z** / **Ctrl+Y** (or Ctrl+Shift+Z), or the ↶ ↷ buttons next to Save, for any change to the project in the web UI (the last 60 steps). A slider drag or typing a name counts as one step. While you are typing in a text field, Ctrl+Z undoes the typing instead. Undoing back to the last save makes the project "saved" again. The history is in the browser only: it is gone after a reload, and it does not undo what was already saved to the controller.
- **Two screens**: the **⧉** button next to Undo opens a second editor window on the page you are on, for example Timelines on one screen and the Map or Triggers on the other. Both windows edit the same project: a change in one shows up in the other as soon as you stop typing or dragging, and **Save** in either window saves everything (both lose the unsaved dot). Each window has its own page, selection and undo list. In Chrome or Edge on the PC (localhost) the browser asks once whether the page may manage windows; allow it and the new window goes full size onto the other screen. Elsewhere it opens next to the first one: drag it over and maximise it. If nothing opens, allow pop-ups for the page. The page you are on is in the address (`…/#timelines`), so a reload or a bookmark opens that page.
- **Size and theme**: Settings → **Display**. **Auto** size fits the window: bigger on a large screen (a 1920 × 1080 window shows at 120 %), smaller on a laptop (85 % on 1366 × 768), and it follows when you resize the window. Or pick a fixed size from 70 to 175 % with the slider or **A− / A+**. Themes: **Dark**, **Midnight**, **Graphite**, **Light** (bright rooms), **High contrast** and **Stage red** (dim reds only, for a dark venue). Both are kept per browser, so a laptop and a touch screen can each have their own; they are not part of the show. When the page gets narrower than about 760 px (small window or a big size) it switches to the compact layout with the menu along the top. The Console and Log boxes always fill the window down to the bottom.
- **Live state**: what the controller shows (outputs and inputs, variables, devices online/offline, show-device readings, modes, playbacks starting and ending) reaches the web UI as soon as it changes, within about 0.1 s: clicking an output on Monitoring lights its button straight away. With nothing changing, the controller still sends an update every second (clock, frame rates, timeline positions).
- **Big rigs** (hundreds of fixtures, up to 8 full universes): tested with 600 fixtures on 4 full universes and a 2048-level scene, and the Fixtures page with 1250 fixtures on 8 universes; every page draws in well under 0.1 s. Maps with more than 40 fixtures use small dots without icons and without the glow, so live view and effect previews stay smooth.

## Fixtures, groups and maps

- **Fixtures**: name + universe + start address + a list of channel names (`dim, r, g, b, pan…`).
  - `pos:16` makes a **16-bit** coarse/fine pair (0–65535), for winches and motors. Fades and masters work on the full 16-bit value.
  - A per-fixture **dimmer curve**: linear, square law, non-dim (switch at 50%), 5% or 10% preheat.
  - Channels whose name starts with pan, tilt, pos, zoom, focus, gobo, prism, color_wheel, cw, macro, ctrl, speed, enable, shutter, strobe, fx, sound, iris, frost, blade, mode, cto, cct or none, and all 16-bit channels, are exempt from the grand master, blackout and curve.
  - The **Fixtures** page lists them like the trigger list: number, icon, name, groups, `universe.address` and type. Ctrl/Shift+click selects several; Ctrl+C / V, Ctrl+D (copies go to the next free address), Del (also removes them from scenes, tracks, groups and maps), ↑↓, Ctrl+A.
  - **Big rigs fold up**: 8 or more fixtures in a row of the list that belong to the same group (the cells of a pixel bar, a row of pars) show as **one row** with the group name, how many fixtures, the first and last address and the type. Click it to select all of them (Ctrl+click adds or removes them, Shift+click extends), **▸** opens it to show the fixtures, **▾** folds it again. A fixture in several groups folds with its smallest group. While you type in the filter nothing is folded, so a search always shows the fixtures themselves.
  - Above the fixture details is the **patch** (like the Patch view in Pharos Designer): the 512 channels of a universe, each fixture an outlined block over its channels. **Drag a block to another channel** to give the fixture that address; the cells it would land on light up green, or red when that spot is taken or runs past 512 (then nothing moves). Dragging a selected fixture moves all selected fixtures of that universe together, keeping their spacing. Click a block to select the fixture (Shift/Ctrl+click for more); picking a fixture of another universe in the list switches the patch to that universe. Overlapping fixtures have a red border.
  - With several selected: set universe or curve for all, **number the addresses** one after the other from a universe and address (in list order), or make / add to a group.
  - **Auto-patch across universes**: adding fixtures and "Number them" go on in the next universe when the next fixture doesn't fit before channel 512, starting after what is already patched there. A fixture (or pixel) is never split over two universes, so RGB pixels go 170 to a universe (1–510). When there is no next universe, new ones are added (up to 8). The form shows where everything lands first, e.g. `1.380–511 · 2.104–511 · 3.1–510 · adds universe 3`; if it needs more than 8 universes it says how many fit and adds nothing.
  - **+ Add fixtures…** opens the fixture library: search (e.g. `rgbw`, `chauvet slimpar`, `mac aura`), pick the type and mode, how many, the universe and start address (next free by default), and optionally place them on the current map (**Place on map**, off unless you opened the library from the Map page). The library has:
    - **Generic** types: dimmer, dimmer pack, relay, RGB, RGBW, RGBA, RGBAW, RGBWA+UV, tunable white, pixel bars / tape, batten, moving head spot / wash / beam, LED profile and fresnel, strobe, blinder, UV, fog, hazer, fan, motor / winch, servo, laser, projector shutter.
    - **637 brand fixtures** from 137 manufacturers (Chauvet, Martin, Robe, ETC, GLP, Clay Paky, ADJ, Cameo, Eurolite, Showtec, Stairville…), taken from the [Open Fixture Library](https://open-fixture-library.org) (MIT licence; the same source QLC+ uses). Always check the DMX chart against the fixture's manual. `node tools/build-fixture-lib.js <open-fixture-library/fixtures>` rebuilds `data/www/fixture-library.json` from a newer download.
    - Pixel modes (`8 x (r, g, b)`) add **one fixture per cell** plus a group, so effects run along the bar; channels before the cells become a "master" fixture. **Cells** can be set up to 4096, e.g. one "RGB pixel bar / tape" of 1000 cells for a whole LED grid, auto-patched over 6 universes.
    - Library channels get standard names (`dim r g b w a uv lime`, `pan:16 tilt:16`, `shutter strobe gobo color_wheel zoom fx ctrl…`), so presets, effects and the grand master treat them right. Some channels have a **home value** (e.g. a moving head's open shutter), used when the fixture is added to a scene.
  - **Fixture types…**: your own fixture definitions, written as text and saved with the project. A type with the same maker / model as a library type replaces it. **Import file…** reads an Open Fixture Library `.json` (download a fixture there as "Open Fixture Library JSON") or a QLC+ `.qxf`, and turns it into text you can check and edit:
    ```
    fixture Museum / Vitrine LED strip
    icon pixel                     # par, wash, spot, profile, fresnel, bar, pixel, matrix, dimmer, strobe, blinder, fog, fan, laser, effect, relay, motor, screen, generic
    curve linear                   # optional default dimmer curve
    note Our own 4-cell strip      # optional
    mode 4 cells: dim, 4 x (r, g, b)
    mode Simple: dim, r, g, b, strobe=0, shutter=255
    ```
    `:16` makes a 16-bit pair, `=value` is the home value. After **Apply**, fixtures of a changed type can be given the new channels.
  - A fixture made from a type remembers its type and **mode**: change the mode in the fixture editor and the channels follow (scene levels on channels it no longer has are removed). Typing channels by hand still works for anything else.
  - **Change type…** (next to Type in the fixture editor, on the Fixtures and Scenes pages, or for several selected fixtures at once) swaps a fixture for another type from the library, e.g. a generic RGBW for the real model. It keeps the fixture's number, name, address, groups, map place and timeline tracks, and the scene levels on channels the new type also has. Before changing it says how many scene levels would be removed and whether the fixture would now overlap the next one (fix that with the address or "Number them"). Pixel (cell) modes can't be used here; add those as new fixtures.
  - Every fixture has an **icon** (on the Fixtures list, the maps and the Scenes page), taken from its type or guessed from its channels; pick another one in the fixture editor.
  - Type, mode, icon and your own fixture types are only used by the web UI; the controller drops them after loading, like maps.
- **Groups**: named sets of fixtures, made and edited on the Fixtures page (select fixtures → **+ Group from selected**). Groups fill timeline tracks and add many fixtures to a scene at once.
- **Map**: floor plans with your fixtures on them, like the Layout in Pharos Designer.
  - Add maps with **+ Map**, upload a background image (JPG/PNG/WebP/SVG, max 4 MB, stored on the stick in `show/media/`), or use the empty grid.
  - In the fixture list, click a fixture, then **Shift+click** another to select everything in between, or **Ctrl+click** to add/remove one. Drag any selected one onto the map and **all selected fixtures go on in one go**, as a square block in list order (first fixture top-left), still selected so you can give them a shape straight away. Fixtures already on the map move along.
  - Drag fixtures from the list onto the map, or add new ones there (**+ Add fixtures…** opens the library and places them on this map; + Dimmer/RGB/RGBW get the next free address). Drag to move (snaps to a grid), arrows nudge, Del removes from the map.
  - Click, Shift/Ctrl+click or drag a box to select. **Shift+drag** adds a box to the selection, also when you start on a fixture (handy in a dense pixel grid); a plain drag on a fixture moves the selection. The Scenes page map works the same. With a selection you can **make a group**, **add them to a group**, **add the fixtures to a timeline track**, or arrange them:
    - **Shape…**: line ↔, line ↕, diagonal line, circle, half circle, rectangle outline (e.g. LED strip round a showcase), grid, **grid zigzag wired (snake)** or zigzag line, in the area the fixtures cover now. A circle stays round on a wide floor plan, and shapes never get bigger than the map.
    - Next to it: **keep neighbours** (fixtures go in the order they are in now) or **in patch order (address)** (fixture 1 first, the way pixels are wired), and **Columns** for grids (empty = square). Changing these redoes the shape you just made.
    - Big pixel grids: add e.g. a "Generic / RGB pixel bar / tape" with 100 cells (+ Add fixtures… on the Map page, it is placed on the map as a group), click the group, pick **Grid, zigzag wired (snake)**, **in patch order** and 10 columns: a 10 × 10 LED grid with every other row running back, as it is wired. Maps with more than 40 fixtures show smaller dots without icons.
    - **Rotate**: drag the round ⟳ handle above the selection (Shift = 15° steps; it shows the angle while you drag), the ⟲ ⟳ buttons (15°), or the `[` `]` keys (5°, Shift = 15°).
    - **Spread out / pull together**: drag the ⤡ handle at the frame's corner, the − + buttons, or the `-` `+` keys (Shift = more).
  - **Groups** are listed under the fixtures: click one to select its fixtures on the map (it shows e.g. 3/4 when not all of them are on this map). With one fixture selected you can edit its name, universe and address.
  - **Map size**: drag the grip on the map's bottom edge to make it bigger or smaller (double-click it to reset). The map keeps its shape; the size is remembered per page in this browser, separately for the Map, Scenes and Effects (preview) pages.
  - **Live**: each fixture shows its current output (RGB(W) times its dimmer, or the dimmer as warm white).
  - Maps are only used by the web UI. The controller drops them after loading the project, so they use no RAM there.

## Scenes, timelines and effects

- **Scenes**: a set of levels, either by fixture/channel name or raw `universe.channel`.
  - The Scenes page shows a **map** (pick which one, or a list of all fixtures) with every fixture in the scene's colour and level; fixtures not in the scene are faded. Fixtures that aren't on that map are listed under it.
  - **Groups** above the map: click one to select all its fixtures (Shift/Ctrl+click adds the group to what is selected). A fully selected group is highlighted.
  - Click a fixture (Shift/Ctrl+click or drag an area for several, Esc clears, Ctrl+A all) to edit it like on a desk's programmer: a slider for every channel, **Full / 50% / Off** for the dimmer, and on the right a **colour wheel** for fixtures with r/g/b (a dimmer that isn't in the scene yet goes to full; for fixtures that also have white and/or amber, tick **Auto white / amber** to let the picked colour use them: the white part of the colour goes to `w`, warm tones to `a`/`amber`, the rest to r/g/b; off = only r/g/b change; remembered in this browser) and a **position pad** for moving heads (channels named `pan` and `tilt`, 8 or 16-bit): drag the dot, or type pan/tilt in %, arrows nudge it (Shift = more), **Centre** / Home puts it in the middle. Changes go to all selected fixtures; ✕ takes a channel out of the scene, **All channels** adds the rest at their home values, **Remove from scene** takes the fixtures out.
  - With one fixture selected, **Fixture settings** edits its name, mode, icon, address and channels right there.
  - **Live preview** sends your changes to the outputs as overrides while you edit (**Clear preview** removes them).
  - **All levels in this scene** (below) is the full table, also for raw `universe.channel` levels. It is only built when you open it and shows 200 rows at a time (**Show more**); with more than 60 fixtures each row names its fixture instead of offering a list of all of them.
- **Timelines** have **tracks** (lanes) with cues as **clips**, edited like Ableton Live's arrangement view.
  - A clip has a **length**: after it the track is **empty**, and its fixtures show what is underneath (lower-priority timelines, or nothing). The dark slope at the start is the fade in, the one at the end the **fade out** (to what is underneath). Untick the length ("hold until the next cue") for the old Pharos behaviour: the clip runs until the next cue on its track (dashed right edge, `→`). Older projects' cues all hold.
  - **What a clip shows**: a colour clip is a **solid bar** in its colour at its intensity. An effect clip shows a **preview** of the effect as it plays (time left to right, the track's fixtures top to bottom), a scene clip the colour of each fixture in the scene. A new colour clip gets the last colour you picked (white at first).
  - **Mouse**: double-click an empty spot to add a clip (up to 4 s, or up to the next clip). Drag a clip to move it, also to another track; **Ctrl+drag** copies. Drag its **edges** to change start and length, and the small **squares** at its top corners for fade in and fade out. Click empty space to put the **cursor** (dashed line); drag in empty space to **box-select** clips; Shift/Ctrl+click adds to the selection. Drag the orange marker on the ruler to change the timeline's length.
  - **Playing from a spot**: click to put the cursor, then **Space** (or **▶ from … s**) plays from there. Click or drag on the time ruler while it plays to jump. Space (or ❚❚) while playing pauses; Space again carries on from the pause, unless you clicked a new spot in the meantime (then it plays from there). The playhead stops at the end of a timeline that doesn't loop. Starting part-way gives exactly the look of that moment: a fade that is half done starts half done, a running effect starts mid-way. Trigger cues before that point are skipped. The command is `start timeline <tl> at <seconds>`.
  - Click a track (its name area or its lane) to make it the **current track** (orange edge). **+ Cue** adds a clip at the cursor on the current track, and moves the cursor after it, so pressing it again adds the next one. Without a cursor it goes after the last clip of the selected cue's track.
  - Dropping a clip on another works like Ableton: the one underneath is cut back, split around it, or (fully covered) removed. Ctrl+Z undoes.
  - **Snap**: to the grid lines (they follow the zoom), off, or a fixed step. Hold **Alt** while dragging for no snap. **Zoom** with Ctrl+mouse wheel or the − / + / Fit buttons; while playing, the view follows the playhead.
  - Each **track** has its own fixtures and/or groups, picked with the checkboxes or by clicking them on a map (with several maps, choose which one above it). Each track **fades on its own**, so a slow wall fade and a quick FOH change can overlap. A track without fixtures plays scenes on the whole rig.
  - A cue is a **preset** (intensity and/or colour for the track's fixtures), a **scene** (only the channels of the track's fixtures), or a **◆ trigger** (in the Triggers lane).
  - Presets: RGB fixtures without a dimmer channel get their colour scaled by the intensity. RGBW fixtures get white = the common part of R, G and B.
  - Click a clip (or a trigger cue's name) to edit it below, including typing an exact time, length and fades. The **All cues** list also has an editable time for every cue. Max 16 tracks per timeline.
  - **✦ Effect cues** run an effect on the track's fixtures until the next cue on that track, crossfading in over the cue's fade. Each cue has its own parameter values, a level (%) and a live preview.
  - Colours use a **colour wheel** (hue around, saturation outwards, brightness slider, hex field, palette, and sliders as **RGB** (0-255) or **HSV** (hue 0-360, saturation and value 0-100 %), each with a number box and a track that shows the colour you get along it; the RGB/HSV switch counts for every wheel and is remembered in this browser). With the wheel focused: ←/→ hue, ↑/↓ saturation, PgUp/PgDn brightness, 1–9/0 palette.
  - **Keys** on the timeline (they work on all selected clips): Ctrl+C / Ctrl+X / Ctrl+V copy, cut, paste at the cursor (on the cursor's track) · Ctrl+D duplicate right after itself · Ctrl+E split at the cursor · Ctrl+A select all · Del delete (leaves an empty space) · ←/→ previous/next cue · ↑/↓ other track · Shift+←/→ move 0.1 s (Ctrl: 1 s) · 1–9, 0 palette colour · `[` `]` hue · `+` `-` intensity · Enter colour wheel · Space play from the cursor / pause / carry on · Esc deselect.
  - In project.json a clip's length is `"len"` and its fade out `"out"` (both ms); without `len` it holds.
  - Map images you replace or remove are only deleted from the stick when you save, so an unsaved change never points at a deleted image.
  - Each cue has a **crossfade path** (linear, accelerated, braked, damped S-curve, overshoot), like Pharos.
  - Options for length, loop and priority. Higher priority wins, and on equal priority the latest started wins (LTP). A timeline's master acts as its layer opacity, so releasing with a fade reveals whatever is underneath.
  - **Seamless loops:** when a looping timeline comes round to an effect cue that is still running on its track (a clip that runs to the end with no fade out, or one without a length), the effect carries on instead of starting again, so there is no jump whatever its speed. A clip that ends exactly at the end with no fade out isn't let go at the loop when its track has a cue at 0 s (no black frame). A fade out at the end still dips, as drawn.
  - **Group A–G**: starting a timeline releases the others in its group, crossfading over its first cue's fade (Pharos playback groups).
  - **Trigger cues** (◆, **+ Trigger cue**): fire a trigger when the timeline reaches that time, e.g. start a video or send a UDP message in sync with the light. They're stored by trigger name (`"trigger": "Test step"`), follow renames, and run the trigger with `{timeline}` set to the timeline number. A timeline that is fading out after a release doesn't fire its trigger cues. Trigger connections show them (`timeline 2 'Puppet show' cue at 5.0 s`).
- **Effects** (Effects page): small scripts in a shader-like language that run **for every fixture, every frame**, like a fragment shader in an LED test tool.
  - Start from a base effect, duplicate it and change it. The editor checks the code as you type and shows a live preview on a strip, a **10 × 10 grid** (for XY effects) or one of your maps. There are 22 base effects in three groups:
    - **Along the fixtures** (list order): Rainbow, Chase, Bounce (scanner), Theatre chase, Two-colour fade, Colour steps, Wipe, Police.
    - **Whole rig / per fixture**: Breathe, Heartbeat, Strobe, Lightning, Fire, Candle, Sparkle, Twinkle.
    - **XY: over the map** (use the fixtures' map positions `x`, `y`): Wave across the map, XY ripple (rings from a point), XY sweep (a bar at any angle), XY radar (a turning beam), XY plasma (colour clouds), XY gradient. Fixtures that aren't on a map get `x` = their place in the track and `y` = 0.5, so XY effects look best on fixtures placed on a map.
  - **Show effect on the whole map** (tick box next to the preview, when previewing on a map): the effect is also drawn over the whole map, see-through, not only on the fixtures. You see the pattern between and around the fixtures, e.g. where a dark wave is right now. Effects that work in list order (Chase, Fire…) show each fixture's colour over the area nearest to it. The tick box is remembered in this browser.
  - **Change to base effect…** (next to the name) swaps an existing effect's code for another base effect. It keeps its number, so timeline cues that use it carry on with the new look; cue values for parameters that no longer exist are dropped. Ctrl+Z undoes.
  - **Speed doesn't depend on the number of fixtures**: Chase's speed is in rounds per second, so a lap takes as long on 8 fixtures as on 400. (Effects made from the old Chase base effect had speed in *fixtures* per second, so they got slower on a bigger rig: use Change to base effect → Chase to update them.)
  - **Parameter notes**: a comment after a `param` line is its note. It is shown under the parameter's slider on the Effects page and in the timeline cue editor, with the range and default. All base effects have notes.
  - Example:
    ```
    param speed = 0.2 [0, 2]     // slider, settable per timeline cue (this comment is its note)
    param color = #ff8800        // colour parameter: color.r / .g / .b
    h = fract(t * speed + x)
    r, g, b = hsv(h, 1, 1)
    dim = 0.5 + 0.5 * sin(t * tau)
    ```
  - Inputs: `t` (seconds), `i`/`n` (fixture number / count in the track), `u` = i/n, `x`/`y` (map position). Outputs: `r g b` 0–1, `dim`, `w`. Functions: `sin cos tan abs floor ceil fract sqrt exp log sign pow min max mod atan step clamp mix smoothstep rand noise tri saw sq pulse hsv`. The full reference is on the Effects page.
  - The controller compiles the effects when the project loads (`src/Fx.cpp`, same language and results as `data/www/fx.js`). A script error rejects the project with the effect's name and line number.

## Triggers, variables and modes

- **Triggers** run a list of commands. Types:
  - `startup`, `time` (**Time of day / sunrise / sunset**: a clock time HH:MM:SS, or sunrise or sunset with an offset in minutes, `-15` = 15 min before; + weekdays; the list shows sunrise/sunset ones as `sunrise`/`sunset`), `interval`, `input` (a Portenta GPIO pin, or a Machine Control input; debounced) and `timeline_end`.
  - `udp`: matches a message exactly or by `prefix*` (the rest goes into `{1}`). It can listen on its own `port` and only accept one sender (`fromIp`).
  - `osc`: matches an OSC address with `*`/`?` wildcards; the arguments go into `{1}…{n}`. UDP and OSC share up to 6 listen ports.
  - `projector` (**Projector alarm**): a projector's PJLink error status or lamp hours, checked at every monitoring poll. Pick a projector (or any) and the alarm:
    - an error part (`fan`, `lamp`, `temperature`, `cover`, `filter`, `other`, or **any**), firing when it **gets worse** (to warning or error), **becomes an error**, or **is ok again**;
    - **lamp hours reach a limit** (e.g. 4000): fires once when the lamp hours pass it.
    
    An alarm that is already there fires once after the controller starts (so you hear about it after a power cut too), but not again when you save the project. Vars `{projector} {alarm} {state} {lamp}` (+ `{hours}` = the limit), e.g. `email tech@site.nl "{projector}: {alarm} {state}" Lamp at {lamp} h`. In the mock, `projector "PJ left" send ERST=000020` (filter error) or `send LAMP=4100` makes the simulated projector report that.
  - `mode`: the mode changes (to a given mode, or any).
  - `panel`: a touch-panel slider, dial, colour wheel or toggle **changes** (`{value}`; `{r} {g} {b}` for a wheel), or a button is clicked, pressed or released, **held** (fires once it is held down for the set time, default 2 s; letting go earlier does nothing) or **double-clicked** (two clicks within the set time, default 0.5 s; a click trigger on the same button still fires on every click).
  - `input` edges can also be **hold** (the input stays on for the set time) and **double** (two presses within the set time).
  - `sequence` (**Sequence**): fires when other triggers fire **in a given order** within a time (default 5 s from the first step to the last), like a key switch and then a button, or a secret code on panel buttons. A step out of order, or too slow, starts again from the first. The steps are normal triggers; a trigger that is only a step needs no actions of its own (no red ! for that). The editor and the flow view show the steps as arrows into the sequence.
  - `dmx_in` (**DMX input**): Art-Net or sACN that a lighting desk or media server sends to the controller. Pick the protocol, the universe (Art-Net: port address, 0 = 0:0:0; sACN 1-63999) and channels (`1`, `1-8`, `1,3,5`); it fires per channel when the value **changes**, **goes up to a level or above**, or **drops below** it. Vars `{channel} {index} {value} {old}`. At most 4 input universes. sACN by multicast is received for one universe (the first sACN one used); for more, let the desk send unicast to the controller's IP. If several sources send the same universe, the last packet counts (no merging or priority). With **changes** the trigger can fire many times a second, so its "fired" line is only in the log when the TRIG category is set to debug; up/below fires are logged normally. In the mock, `dmxin artnet 0 1 255` in the console simulates channel 1 of universe 0 at 255 (`dmxin sacn 1 1-8 0` for a range).
  - `dmx_change`: an output channel in a range changes. Vars `{channel} {index} {value}` plus per-index **tables**, e.g. `send udp motors "{puppet}{motor}P{=ceil(value*range/255)}\r"`. This replaces the Lua `CompareAndSend` puppet-motor script.
  - `manual`: only fired by other triggers, for nested task lists.
  - `comment`: a coloured **separator** in the list. **Level**: a **main section** is a big heading (the main function, e.g. *Show*); a **sub section** is a smaller heading, indented together with its triggers, until the next main section (e.g. *Projectors* and *Audio* under *Show*). Searching or a colour tab that shows a trigger in a sub section also shows the main heading above it.
- **Trigger list editing:** new triggers go at the end. Ctrl/Shift+click selects several; Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste (also through the system clipboard, between tabs); Ctrl+D duplicates; Del deletes (it warns when other triggers still refer to the deleted ones); ↑↓ select; Ctrl+A selects all. **Moving**: drag a trigger by its row (the **⠿** grip shows where to grab); an orange bar between the rows shows where it will land. Dragging one of the selected triggers moves the whole selection, which ends up together at the bar. **▲ ▼** under the list (or **Alt+↑ / Alt+↓**) move the selected triggers one place up or down (gaps between them stay). Dragging is off while the list is filtered by a search or colour. The shortcuts only work while you're not typing in a field. Typing a number in the trigger's **#** field moves it to that place. The **▶** button at the end of each row fires that trigger straight away, like **Fire now**, without selecting it (it runs the saved version).
- **Typing mistakes** in actions and conditions get a red wavy underline as you type; hover over the red word to see what's wrong, often with a suggestion ("'strat' is not a command - did you mean 'start'?", "there is no timeline '99'"). When a word is missing at the end, a grey placeholder shows what should come next (`start timeline 3 at <seconds>`), underlined the same way.
- **Problems (red !):** a trigger that won't work as intended gets a red **!** in the list. Hover over it to see why; the editor lists the reasons too. Checked: every action and condition (the same check as the red underline), a duplicate name, no actions, and settings that point at something that doesn't exist (panel button, timeline, mode, variable, TCP or monitored device, universe), or are missing (UDP message, OSC address, interval). It updates as soon as you leave a field.
  - **Loops:** a trigger that sets itself off again gets a red ! too: directly (`fire trigger 1` in trigger 1) or through others (1 fires 3, 3 fires 1: shown as `#1 → #3 → #1`). This counts `fire trigger`, `repeat … times`, and a variable trigger whose actions change that variable with `+`, `-` or `toggle`. Not counted: `var x = …` and mode changes (the second time nothing changes, so it stops), cancel/stop, disabled triggers, and timelines that restart each other (often a deliberate show loop). With a `sleep`, `wait until` or `every` in the loop it says the loop runs forever (use an interval trigger or `repeat … times every` for that); without, it's a fast loop that the feedback guard pauses (over 100 fires in a second, see below). When an `if` or a condition could end the loop, it says "unless a condition stops it".
- **Searching:** the search box above the list (Ctrl+F) finds triggers by anything in them: name, number, type, notes, conditions, actions, sequence steps and settings such as an IP address, port or universe. Type several words to find triggers that contain all of them (`qlab stop`). Each found trigger shows up to two lines where the words were found, highlighted, and the box shows how many match ("3 of 41"); the section separators stay as headings. Enter opens the first one, ↑/↓ step through the results, Esc clears the search. Ctrl+A selects only what the list shows. **Colour tabs:** under the search box there is a tab for each trigger colour in use: its **name above a bar in the colour**, and how many triggers have it. Click a tab to show only those triggers, Ctrl+click to add more tabs, **All** to see everything again. **Double-click a tab to name it** (e.g. *Projectors*, *Audio*, *Building*; Enter keeps it, Esc cancels, empty = no name); you can also type the name in **Tab name** under the colour of any trigger. The name belongs to the colour, so every trigger with that colour is in that tab. **A main section separator names the tab of its colour:** a red `== SYSTEM` section gives the red tab the name *SYSTEM*; renaming the tab renames the section (the `==` stays) and renaming the section renames the tab. If a colour has several main sections, the first one counts. Inside a tab you only see the section headings of that colour, not the heading of another colour the triggers happen to sit under.
  **Adding inside a tab** (one tab open): **+ Trigger** gets the tab's colour and goes right after the tab's last item. **+ Separator** gets the colour too: if the colour has no main section yet, the new one becomes its header and its triggers are gathered under it (placed after the section the first of them was in; references by number follow); if it already has one, the new separator is a **sub section** after the tab's last item. A tab without a name shows the colour's name in grey. Dragging is off while a filter is active.
- **Documenting triggers:** every trigger and separator has a **Notes** box under its name for free text (what it's for, who fires it, what to watch out for). A ✎ in the list shows the trigger has notes; hover it to read them, and the search box searches notes too. Notes stay in `project.json` on the stick, and the controller drops them after loading so they use no RAM. For a remark about one step, start an action line with `#`: it's shown greyed out and skipped when the trigger runs.
- **Trigger connections:** when a trigger is selected, the list marks the triggers it sets off (green →) and the ones that set it off (blue ←). This covers `fire/cancel/repeat trigger`, `mode` changes (mode triggers), `var` changes (variable triggers), `start timeline` (timeline-end triggers) and `http` (HTTP-response triggers). The editor lists the same links as clickable chips under **Set off by** and **Sets off**, plus the devices: under **Set off by** what its event comes from (a projector, panel button, TCP device, Machine Control input, a show device feeding its variable…), under **Sets off** every device its actions control (`projector "PJ left" on`, `pc all wake`, `send osc qlab …`, `netio rack …`). Click a device chip to open it on the Devices page.
- **Device icons in the list:** each row shows, without selecting anything, `[blue box] → [green box]`. The **blue box** before the arrow = what sets this trigger off (touch panel (a tapping hand), a timeline cue, another trigger (a lightning bolt: only a direct `fire trigger` / `repeat trigger`, not via a mode, variable or timeline), projector, PC, network device, TCP, Modbus, HTTP, DMX in, Machine Control, or a show device). The **green box** after the arrow = the devices it controls. The icons follow while you type an action (shortly after the last key), also on the other rows a `fire trigger` points to. One icon per kind of device (more than 3 kinds: 2 icons and `+2`); hover an icon to see which devices and what, e.g. *Controls PC: Media PC (wake), QLab Mac (wake)*. The line under the list explains the colours; ▶ at the end of a row = Fire now. Kiss-Box, KNX, BrightSign, DiGidot, NETIO and Pharos have small versions of their own logos; the other kinds have line icons. The same icons are on the Devices and Monitoring tabs. The trigger list is wider by default to make room (drag the divider to change it).
- **Light up when fired** (tick box next to the Triggers heading, on by default): a trigger's row lights up orange the moment it fires on the controller, with where it came from, e.g. `← 38` (trigger 38) or `← TL 2` (a cue on timeline 2). They light up in the real order and timing: if trigger 38 does `fire trigger 39`, both light up together; with `sleep 0.5` before it, 39 lights up half a second later. A trigger with `sleep`s **stays lit (pulsing) for as long as it runs**, with `⏳ 3 s` = time until its next step; it goes out after its last action. The log shows the source too: `fired (nested from trigger 38)`, `fired (timeline 2 cue)`.
- **Flow view:** tick **show flow** to see a diagram of the whole chain, from top to bottom:
  - at the top, dashed round boxes for **where events come from**: panel buttons, devices, projectors, TCP devices, UDP/OSC ports, inputs, DMX in, and show devices (or Modbus) that keep a variable up to date;
  - then the triggers and what they set off; timelines are blue rounded boxes (with their trigger cues and end triggers). The arrow from a timeline to a trigger always says when it fires: *⏱ 2.0 s* (several times if the timeline has several cues for it, *⏱ at end* for a timeline-end trigger);
  - mode changes and variable changes go through one small dashed box per mode group or variable (◇ mode System): the triggers that change it point into it, the triggers that react to it come out of it;
  - **if**s in the actions are yellow diamonds: the **yes** arrow is the `then` part, the **no** arrow the `else` part. A trigger with conditions shows a small *if* in its box (hover for the conditions);
  - right under each trigger, a green round box (↩) for its **feedback**: the panel buttons and labels it changes (`panel … text/color/flash/value`, `label …`);
  - and square boxes for the **devices it controls**: projectors (`projector all on` shows each projector), PCs, UDP/OSC/TCP/HTTP targets, Modbus, show devices (Kiss-Box, KNX, NETIO, Pharos…), Machine Control outputs and emails, with what it does (e.g. *▭ PJ left: power on*). In the whole flow, one trigger's devices share one box (*▭ 2 projectors: power on*, hover for the list); with **only #…** ticked each device has its own box;
  - arrows that go **back up** (on the right) are loops; an endless loop is red.

  Each box sits just above what it sets off and the order is chosen so as few arrows as possible cross; long arrows go around the boxes. Chains that have nothing to do with each other are placed next to each other and wrap, so the diagram stays readable. Hover a box at the top to see where the event comes from (e.g. *From the touch panel: button 'Start show'*) and which triggers it sets off. Click a box to select that trigger (its arrows then show why); click a timeline to open it. By default the flow shows only the selected trigger's flow (**only #… <name>**, top right, ticked): what sets it off, all the way up to the panel button or device, and what it sets off, all the way down. Selecting another trigger (in the list or by clicking its box) follows that one. Untick it to see the whole flow; with a separator selected the whole flow shows too. The diagram follows your edits: a new action (e.g. `pc all wake`) shows up shortly after you stop typing. Click the **colour dots** above the diagram to show only the triggers with those colours (several at once; click again to turn off, *all colours* to clear): you see them with their event sources, devices and feedback, and the other triggers they are linked to dimmed. This filter is separate from the one above the trigger list. With "light up when fired" on, the boxes and arrows light up too, so you can follow e.g. button → "Start puppet show" → timeline → cue trigger, through the if it passed. What a trigger changes (timelines, devices, panel feedback) lights up when that line of its actions runs: after a `sleep`, when a `wait until` is over, and every round of a `repeat … every`. An `if` that is skipped still lights up (the controller's log doesn't say). Dashed arrows only cancel/stop. **− / + zoom**, and **⤢ Expand** shows the flow on the whole screen (Esc or ✕ Close to go back). Drag the bottom edge of the small box to make it taller. Both tick boxes are remembered in this browser.
- **History** (tick **show history**): a time line of when each trigger fired, like a logic analyser: one row per trigger that fired, a mark per fire in its colour, the number of fires, over the last 2 / 10 / 60 minutes or everything kept. Hover a mark for the exact time and where it came from (its own event, another trigger, a timeline, by hand, a repeat, a queued fire); click a row to open the trigger. The controller keeps the last 512 fires in memory (not DMX-change triggers, nor DMX-input triggers on "changes", which fire too often), also while no browser is open; they are gone after a restart. After triggers are renumbered, older fires show under the old numbers. If the controller or the PC mock still runs older software, the strip says so: update the firmware, or close and restart the mock (`KD Designer (PC).cmd`).
- **Templates…** (or **+ From template** under the list): ready-made triggers for visitors (button with cooldown, one request at a time, idle loop and show, visitor counter), opening hours (by the clock, sunset lights, weekend), the technician (projectors on then the input, morning start, night shutdown, offline and lamp-hour emails, long-press restart / all off, secret service code, double-click blackout), effects (channels one by one, blink, relay chase, step through scenes) and external control (OSC, UDP, a desk fader over Art-Net). They use your first timelines, scenes and panel buttons and add the variables they need; check the red ! after adding and change names to fit. Each added trigger has a note saying which template it came from.
- **Find & replace…** (Ctrl+H): in actions and conditions (and, if ticked, names and notes) of all triggers or only the selected ones, with match case and whole words. It lists every place with the match marked and what it becomes (red when the line would no longer be valid); click one to open that trigger. **Replace all** is one step for Ctrl+Z. Renaming triggers this way updates references to them, like a rename in the editor.
- Each trigger type has its own tag colour; `if` triggers get a yellow tag.
- **Trigger names** stay unique automatically for new, duplicated and pasted triggers ("Start (2)"). A manual rename to an existing name is flagged ("same name"). Renaming a trigger updates `fire trigger "<old name>"` references to the new name.
- **Trigger numbers** always follow the list order (1, 2, 3…; separators aren't numbered). Adding, deleting, moving or dragging a trigger renumbers the list, and references by number (`fire trigger 7`, `repeat`, `cancel`, `stop repeat`, also inside if/then/else) are rewritten to follow. References by name (`fire trigger "Start inloop"`, offered first by autocomplete) never need changing; a name shared by two triggers is flagged as ambiguous.
- **Every trigger** can have **conditions** (`mode is …`, `mode not …`, `timeline <tl> running|stopped`, `time between 08:00 18:00`, `day is mon,tue`) and a **colour** tag. Actions can use `{variables}` and `{=maths}` (`+ - * / % ceil floor round abs min max`). Type `{` for a list: the trigger's own (`{message}`, `{value}`…), your variables with their current value, and `{i}` in a `repeat … times` line; inside `{=…}` a name lists them too. Drag an action by its **⠿** grip (left of the line) to change the order it runs in.
- **Pauses between actions:** a line `sleep 0.5` waits half a second before the lines below it run (any number of sleeps per trigger, e.g. 20 relay lines with `sleep 0.5` in between). The trigger's conditions are only checked at the start. `cancel trigger <name>` stops the lines still waiting. `sleep` only works as its own line in a trigger, not after `then`/`else` or in the console.
- **Waiting for something:** `wait until <condition>` waits until the condition is true (any condition, checked 10 times a second), then the lines below run; if it is true already they run straight away. Add `timeout <s>` to give up: `wait until device "PJ left" is online timeout 120` - after 2 minutes the rest is skipped and a warning is logged. Without a timeout it waits until it happens, the trigger is cancelled (`cancel trigger`) or the project is saved.
- **Repeating a trigger:** `repeat "Flash once" 8 times every 0.5` fires the trigger "Flash once" 8 times, half a second apart (`for 0.5` means the same); without `every` they fire straight after each other. In the fired trigger `{count}` (and `{i}`) is the round, 1 to 8. The lines below run after the last round. A number works too: `repeat 7 3 times` = trigger 7, three times. Renaming or renumbering the trigger updates these lines.
- **Loops:** `repeat 8 times every 0.5 io out{=i-1} on` runs the command 8 times, half a second apart; `{i}` counts 1, 2, 3… (also in maths). Without `every` they all run at once (`repeat 4 times set 1.{i} 255`). The lines below the loop run after its last round. The command can be anything, also `fire trigger …` or an `if`, but not `sleep`, `wait` or another loop. (`repeat trigger <name> every <s> [times <n>]` still repeats a whole trigger.)
- **Cooldown** (every trigger): after it ran, new fires are skipped for that many seconds, e.g. 30 s for a visitor button that people press again and again. **Fire now** and the console still fire it, so you can test.
- **While running** (every trigger): what happens when it fires again while it is still busy (waiting in a `sleep`, `wait` or `repeat … every`): **run again alongside** (as before), **ignore** the new fire, **restart** (the waiting rest of the first run is dropped), or **queue** (it runs once more right after the current run; more fires meanwhile are ignored). With `wait until timeline 2 stopped` as the last line, "ignore" means "not while the show plays".
- **Running triggers** show ⏳ with the time to their next step, `⏳ wait` while waiting for a condition (hover for which), or `⟳ 3 left` for a loop. The dashboard's waiting list shows the same.
- **Another port for a device:** `send udp pc 5000 hello` sends to the device "pc" on port 5000 instead of its own port (also for device groups and `send osc pc 9000 /cue/1/go`). A number with nothing after it is still the message: `send udp pc 1234` sends "1234" to the device's own port.
- **if / then / else** in any action: `if var visitors >= 50 then scene 2 else scene 1`. Any condition works after `if`, and `then`/`else` take any command, including another `if`.
- **Variables** (Variables page, like Medialon variables): `number`, `text` or `on/off`, optionally kept across reboots.
  - Usable in every command as `{visitors}` and in maths `{=visitors*2}`.
  - Change with `var visitors = 0`, `var visitors + 1` (or `+= 1`), `var visitors ++` (add 1), `var visitors --` (subtract 1), `var visitors - 2` (or `-= 2`), `var price * 2` (or `*=`), `var price / 4` (or `/=`), `var door toggle`; test with `var visitors >= 50`. Put a space before `++` / `--`.
  - A **Variable change** trigger fires on changes (vars `{variable} {value} {old}`).
  - Link a variable to a **Modbus** point and it follows the PLC; setting it writes back (coils/holding registers; discrete inputs/input registers are read-only).
- **Mode groups** (Modes page): independent groups of states, like the Pharos Management Mode module but several at once:
  ```json
  "modes": [{ "name": "Curtains", "states": ["Open", "Closed"] },
            { "name": "Museum", "states": ["Closed", "Open", "Starting up"] }]
  ```
  Each group has one active state, kept across reboots (`/usb/show/state.json`). Set it with `mode Curtains Open` or `mode Museum "Starting up"`, react with a `mode` trigger (filter on group and/or state; vars `{group} {mode} {old}`), and test with `mode Museum is Open` / `mode Curtains not Closed`.
  - **Stepping:** `mode Curtains toggle` (groups with 2 states), `mode Museum next` / `previous` (after the last state comes the first again), `mode Museum back` (the state it was in before the last change, e.g. after an emergency). A state with one of these names wins.
  - **When a state starts / ends:** per state a list of actions (Modes page, **When it starts** / **When it ends**), so `Museum → Open` can start the inloop and switch on the projectors without a separate trigger. On a change the old state's "ends" actions run first, then the new state's "starts" actions, then the Mode change triggers. `sleep`, `wait until` and `repeat` work in them (e.g. "Starting up": switch on, `sleep 120`, `mode Museum Open`). They don't run when the controller starts or the project is saved.
  - **Only active in** (every trigger, also the timed ones on the Schedule page): the trigger only fires while a mode group is in one of the ticked states, as if switched off in the others. **Fire now** and the console still fire it. The Modes page lists per state which triggers are only active there; the trigger list shows a ◇ tag.
  - **How long:** `mode Museum is Open for 10m` is only true once it has been Open for 10 minutes (`90` = seconds, `30s`, `10m`, `2h`). It counts from the change, also across a reboot when the clock is set. The Modes page shows "since 09:02 · 3 h 12 min".
  - **History:** the Modes page shows a day of every group on a time line (◀ ▶ to go back), and below it each change with who made it: a trigger (click to open it), the web UI, HTTP, UDP, OSC or a linked variable. It comes from the device history and the log on the stick.
  - **Colour and icon** per state: used on the Modes page buttons, the touch panel header and the history. Click the icon button to pick one from a grid (status, show, time, building, technical), or type any emoji or short text under **Other** (Windows: Win + . opens the emoji list). Pick a colour from the preset dots, **+** for any other colour, or **∅** for none.
  - **At power-up:** keep the last state (as before), or always start in a chosen state (a "Starting up" state usually shouldn't survive a reboot). Saving the project never changes a state.
  - **In commands:** `{mode.Museum}` is the group's current state in any command or text, e.g. `panel status text Museum is {mode.Museum}`.
  - **Linked variable:** pick a variable per group and it follows the state both ways: a text variable gets the state's name, a number variable its number (1, 2…); setting the variable to a state name or number changes the state. Link that variable to a Modbus point or a KNX address and a PLC can read and set the mode.
  - **Other systems:** `GET /api/mode` (all groups), `GET /api/mode?group=Museum` (its state as plain text), `GET /api/mode?group=Museum&state=Open` (sets it; `next`/`back`… work too). Also `cmd:mode Museum Open` on the UDP port, and OSC `/kd/cmd` with the command as its argument(s) on the same port (replies `OK …`/`ERR …` as plain text).
  - Renaming a group or a state on the Modes page (change one name in the states list) keeps its colour, actions, power-up state, Only active in and Mode change triggers. Commands that name it (`mode Museum Open`) are not changed: they get a red **!**.

  The Modes page (under Dashboard) has the state buttons per group, the history, and a card per group with its states, power-up state, variable, and per state the look and the actions. The touch panel header shows all groups.
  Old projects with a plain list (`"modes": ["Show", "Test"]`) load as one group called "Mode". `mode Show` / `mode is Show` still work as long as the state name exists in only one group.
  ```json
  { "name": "Museum", "states": ["Closed", "Starting up", "Open"], "startup": "Closed", "var": "museum_state",
    "stateInfo": { "Open": { "color": "#3fb950", "icon": "🟢", "enter": ["start timeline Inloop"], "leave": ["stop timeline Inloop fade 5"] } } }
  ```
  A trigger's `"onlyIn": { "group": "Museum", "states": ["Open"] }`.

## Schedule

- **Schedule** page (like the Medialon scheduler):
  - Clock with **NTP** sync (`settings.time.ntp`, at boot and every 6 h, `ntp sync`), time zone and automatic **summer time** (EU/US).
  - **Sunrise/sunset** from `settings.location` (lat/lon): time triggers at `sunset` with an offset (`-15` = 15 min before), and conditions like `time between sunset 23:00`.
  - **Calendar periods** (`calendar`: name + from/to, `MM-DD` = every year, `YYYY-MM-DD` = once) for holidays and seasons: `calendar Closed inactive`, `date between 07-01 08-31`.
  - A **next 7 days** overview of all timed triggers, showing which are skipped by calendar/date conditions.

## Devices and monitoring

- **Devices** page:
  - **Projectors**: PJLink class 1 over TCP 4352, with an optional password (MD5 auth). Commands are queued in a worker thread, so an offline projector never stalls the show. Power state is polled every 30 s and shown on the dashboard. Use a **Projector alarm** trigger to react to lamp, filter, fan or temperature problems and to lamp hours.
  - **PCs**: Wake-on-LAN (magic packet broadcast on the subnet, ports 9 and 7, needs the MAC) and `startup` / `shutdown` / `reboot` sent as UDP text to the PC (default port 7; the texts can be changed per PC). `pc 1 wake` or `pc "Media PC" wake`, `pc all shutdown`. Shutdown/reboot buttons ask for confirmation.
  - **Network devices**: named UDP/OSC endpoints (e.g. `mediaserver` → 192.168.1.51:7000), used as `send osc mediaserver /play`.
  - **Device groups**: a name for several devices of one kind, made on that kind's Devices tab (tick the members). Use the group name wherever a device name goes and the command runs for each member:
    - network devices: `send udp screens "PLAY\r"` or `send osc screens /go` (each on its own IP and port);
    - PCs: `pc foyer wake`; projectors: `projector zaal1 on`, `projector zaal1 input 31`; TCP devices: `send tcp walls run`;
    - show devices (Kiss-Box, KNX, BrightSign, DiGidot, NETIO, Pharos): `netio racks output 1 off`, `pharos lpcs timeline 1 start`.
    
    The reply says how many worked (`zaal1: 2 of 3 done (PJ 3: …)`). Autocomplete offers groups next to devices. Renaming a device keeps it in its groups. A group can't share its name with a device of its kind or be called `all`. Groups are for commands only, not for conditions or Device online triggers. New groups work after saving.
  - **Email**: plain SMTP (port 25/587, optional AUTH LOGIN, **no TLS**), so use a local relay. `email to@site.nl "Subject" body`.
  - The Devices page has a **tab** for each kind: **Network** (UDP/OSC devices and device groups), **TCP & Modbus**, **PCs**, **Projectors**, **Email**, **Machine Control**, and one per show-device type below. The Monitoring page has the same tabs (plus **All**); kinds with nothing to monitor are greyed out.
  - **Machine Control I/O** (only with the `machine_control` firmware): the inputs and outputs of the Portenta Machine Control the controller runs in. The points are named like the labels on the box:
    - `in0`–`in7`: 24 V digital inputs. `out0`–`out7`: 24 V digital outputs (0.5 A each; a shorted output switches off until you switch it again).
    - `io0`–`io11`: **programmable** 24 V I/O. Pick per point whether it is an **input** or an **output** (default input).
    - `ai0`–`ai2`: analog inputs, per input **0-10 V** (reads volts), **4-20 mA** (reads mA) or **NTC** (reads the resistance in Ω).
    - `ao0`–`ao3`: analog outputs 0-10 V.
    - On the **Machine Control** tab: give points a **name**, pick the programmable I/O direction and the analog-input sensor, link a **variable**, and see every point live with On / Off / Pulse buttons and sliders. **All outputs off** switches everything off.
    - **Commands**: `io out3 on|off|toggle`, `io "Door release" pulse 2` (on for 2 s), `io ao0 7.5` (volts), `io ao0 0 fade 3`, `io all off`. A point can be used by its key or its name.
    - **Triggers**: an **Input** trigger on `in3`, a programmable input or an analog input. Digital: rising = the input goes on (24 V), falling = off. Analog: fires when the reading crosses the **level** you set (with a small margin so a noisy signal doesn't fire twice). Vars `{input} {value}`.
    - **Conditions**: `io in2 is on`, `io ai0 > 5`, `if io io4 is off then …`.
    - **Variables**: a linked variable follows the point (inputs and outputs, `1`/`0` or the reading; analog only on a change of 0.05 or more). For an **output** it works both ways: `var door = 1` also switches the output on.
    - Outputs keep their state when you save the project. Name, direction, sensor and variable changes work after saving. Inputs are debounced (30 ms) and read every 10 ms; analog inputs every 20 ms.
    - In the mock, `io <input> on|off|<value>` simulates a signal on an input (the real controller refuses that).
    - Temperature probes, encoders, CAN and the RTC of the Machine Control are not used yet.
  - **Show devices**: devices with their own protocol: **Kiss-Box, KNX, BrightSign, DiGidot C4, NETIO, Pharos**, each on its own tab with the settings of every device of that type, its readings with buttons/sliders to control them, a **name** and a **variable** per reading, and setup notes. All devices (and projectors) are checked at the one interval set on the **Monitoring** page. Commands are queued in worker threads (HTTP, UDP and live updates), so an offline device never stalls the show. Device online/offline triggers and `device <name> is online` work for them too.
    - **Live updates instead of polling** where the device can push: KNX (every bus telegram), Kiss-Box inputs (with "automatic input state" on the box), Pharos (tick **Live updates**: a WebSocket subscription to timeline, scene and group changes) and NETIO (tick **Live updates**: the NETIO's MQTT-flex publishes every change to the **MQTT broker built into the controller**, port 1883; the tab shows the exact config to paste on the NETIO). A ⚡ live tag shows it's connected; the poll then only checks now and then. BrightSign (with the **KD plugin**, see below) reports zone and variable changes at once too. DiGidot can't push and is polled every **Check every** seconds.
    - The **MQTT broker** (on as soon as a NETIO uses live updates) also accepts other MQTT clients (QoS 0-2 publishes, subscriptions with `+`/`#`); no retained messages or passwords. It shows on the Monitoring page.
    - **Monitoring** has tabs too: **All** (a section per kind: projectors, PCs, each show-device type, network), **Projectors**, **PCs**, **Network**, **Machine Control** (every point live, with controls), and one per show-device type showing every reading: each Kiss-Box relay and contact, each KNX address, NETIO output, Pharos timeline / scene / group / trigger, with names, linked variables and controls.
    - **Health on the Monitoring card**, for every device: **Online for** (since it last came online), **Drop-outs** (times it went offline since the controller started), **Last error** and when. For devices that report their uptime (NETIO, BrightSign, Pharos) also **Uptime** and **Restarts**: when the uptime goes down between two polls the device has restarted (a crash, a power cut or a reboot), even if it was back before the controller noticed it was gone. Each restart is logged as a warning. Plus what each API reports:
      - Pharos: project name, project file and upload date, **Playing** (the running timelines), last boot time, **reset reason** (why it last restarted), memory, temperatures, fan speeds.
      - BrightSign: model, serial, firmware, boot version, connection; with the KD plugin also each zone with what it plays, and the user variables. The DWS API has no crash or reboot reason.
      - NETIO: model, firmware, serial, device clock, mains voltage, loads. DiGidot: scene playing, memory, Art-Net and scene frame rates. Kiss-Box and KNX report nothing beyond answering.
    - **Variables**: pick a variable next to any reading and it follows the device (device → variable), e.g. a Kiss-Box door contact, a NETIO output, a KNX switch, a Pharos timeline's state (`running`, `paused`…) or the DiGidot scene. React with a **Variable change** trigger. On/off readings are `1`/`0`.
    - **Kiss-Box** I/O (Kiss-Box protocol firmware, **UDP** mode, default port 9813): pick the **frame** (IO3CC 3 slots / IO8CC 8 slots) and the **card in each slot**: DO4PR (4 power relays), DO8SK (8 outputs 5-30 VDC), DI8DC (8 inputs 12-48 VDC), AO8DA (8 analog outputs 0-10 V, slider 0-255), AI8RA (8 analog inputs 0-5 V). Name every channel (e.g. "Fog machine") and link it to a variable. The controller reads every slot each check. **The box answers on its own destination port** (Kiss-Box Editor, I/O Mode Setup), usually as a broadcast, not to the port it was asked from: set the device's **listen port** to that port (default 9813; a box we tested used 9817). If they differ, commands still work but the box shows offline ("no reply on listen port ..."), its buttons don't follow and inputs never arrive. If the box sends to a fixed IP instead of broadcasting, that IP must be the controller's. Switch on automatic input state for input cards so contact changes arrive straight away. `kissbox io 1.3 on`, `kissbox io 1 all 1 0 1 0 0 0 0 0`, `kissbox io read 2`, raw: `kissbox io send A5 00 02 01`.
    - **KNX** via a KNX IP interface or router (KNXnet/IP **tunnelling**, UDP 3671; it uses one of the interface's tunnels). Add the group addresses in the table (address, name, datapoint type from a menu, variable), or paste a list (`1/1/1  1  Hall light` per line, e.g. from ETS). They are read once when the tunnel opens and then follow every telegram on the bus (optionally re-read every N s). Controls follow the type: On/Off for switches, ▲▼■ for dim/blinds, a slider for percent, a colour picker for RGB, a field for numbers. `knx gw write "Hall light" on`, `knx gw write 1/2/1 40 5.001`, `knx gw read 3/1/1`. DPTs: 1 on/off, 2, 3 dim (`up`/`down`/`stop`), 5 / 5.001 percent, 5.010 0-255, 6, 7, 8, 9 (temperature etc.), 12, 13, 14, 16 text, 17/18 scene 1-64, 232 RGB `#rrggbb`.
    - **BrightSign**: `brightsign lobby send play1` sends UDP text to the presentation (**UDP** port, default 5000, as set for UDP input in BrightAuthor). Status and `reboot` use the player's **local DWS** REST API (port 80, digest login: user `admin`, password = the DWS password, by default the serial number; the local DWS must be enabled, it is off by default on BrightSignOS 9). **Newer BrightSignOS versions only allow the DWS over https**, which the controller can't do yet: then UDP commands still work, but status and reboot don't. Any DWS call: `brightsign lobby api get info`, `api get files/sd`, `api put control/reboot`. Make **command buttons** (name + UDP text) on the BrightSign tab. **What's playing**: let the presentation send a UDP message to the controller's trigger port on every state (BrightAuthor: send UDP, e.g. `playing Intro`); the last one shows as **Player says** (and can feed a variable); UDP triggers still fire on it too.
      - **KD plugin** (watch and test; every player keeps running its own presentation, so the controller is never a single point of failure): a small script plugin, `kdlink.brs` (download it on the BrightSign tab; it's in `data/www/brightsign/`). In BrightAuthor:connected: Presentation Settings → Support Content → Script Plugins → add it with the name **`kdlink`**, publish, then tick **KD plugin** for the player. Nothing else in the presentation changes: program it as you always do. The plugin listens on its own UDP port **5010** (a user variable `kdPort` changes it), so the presentation's own UDP input is not touched, and it works without the DWS (a player whose DWS can't be reached stays online while the plugin answers; ⚡ live shows it answers). With the controller off, the plugin does nothing.
        - **Zones:** every zone with **what it's playing** (the state name and its file) and every **user variable**, sent the moment they change. Link any of them to a variable and react with a **Variable change** trigger, e.g. when the Video zone reaches `Video 3`, start a timeline.
        - **Test:** a button for every state in every zone, read from the presentation (e.g. Video 1, Video 2, Testpattern, Video 3); the state playing now is lit. A button plays that state's media file in the zone; when the file ends, the presentation carries on by itself (it isn't a real jump to that state). Your own UDP commands (e.g. the one for Video 3) go under **Commands**. **Reboot** restarts the player and its show from the beginning (through the plugin, so it works without the DWS). As a command: `brightsign lobby test Video "Video 2"`, also `play Video clip.mp4`, `stop Video`.
        - **GPIO inputs** (models with a GPIO port): live lights per input, e.g. a motion sensor or a button; link one to a variable like any reading. The player's own reaction to them is unchanged. GPIO is on/off only: analog sensors usually come in over serial.
        - **Activity:** a live list of what the player received: **serial** lines, **UDP** messages (from anyone), GPIO changes and zone changes, the last 30 with their time; the last serial line is also a reading (**Serial in**) you can link to a variable. The plugin sees the serial lines the presentation receives; if the presentation doesn't use the serial port, a user variable `kdSerial` = baud rate (e.g. `9600`) makes the plugin open serial port 0 itself. At most 8 lines per quarter second are passed on, so a chatty device can't flood the network.
        - Also: `brightsign lobby var mode night` sets a user variable (the presentation's *User Variable* events react), `event <text>` sends a Plugin Message. If a zone's state shows empty on your player, a **Send Plugin Message** command (plugin `kdlink`) such as `zone Video Intro` on each state tells the plugin; any other Send Plugin Message to `kdlink` shows as **Player says**.
        - Written against BrightSign's plugin docs, but not tried on a real player yet: zones, states, test plays and GPIO use the player's internal objects, which differ between BrightSignOS versions (every one is checked before use, so the presentation keeps running if something isn't there). Test it on one player first: Monitoring shows straight away what comes in.
    - **DiGidot C4**: JSON API (`/ajax.json`, user/password as set on the C4, default `admin`/`admin`). `digidot c4 scene "Rainbow" fade 2` (by name or list number), `playlist <id>`, `stop`, `master 50`, `speed 150`, `trigger <id>`, `reset`, and any API call: `digidot c4 send {"action":"status"}`. Status: scene playing, master, speed, the scene list.
    - **NETIO** power sockets (JSON API, enable it on the NETIO under M2M API → JSON with read/write; default user/password `netio`). `netio rack output 1 on|off|toggle`, `output all off`, `output 2 restart` (off for the NETIO's own delay, or `restart 5` = 5 s), `output 3 pulse 10`, and any netio.json write: `netio rack send {"Outputs":[{"ID":1,"Action":4}]}`. Status: outputs (by their NETIO names), load in W, inputs, temperature, mains voltage. Pick the **model** (PowerCable 101x / 2PZ / 2Px / 2Kx, PowerBOX 3Px / 4Kx, PowerDIN 4PZ, PowerPDU 4Px / 4Kx / 8Qx / 8Kx / FK6 / 4C, NETIO 4 / 4All) or leave it on "as reported by the NETIO": the outputs, inputs and load columns follow it. A picked model decides the rows exactly; if the NETIO reports a different number of outputs, a warning says so.
    - **Pharos** LPC / TPC / VLC (Controller HTTP API, plain http). Leave user empty when the web API is open; with a user and password the controller logs in with a token. `pharos lpc timeline 2 start fade 3` (`release`, `toggle`, `pause`, `resume`, `rate 0.5`, `position 50`), `scene 4 start`, `group 0 master 50 fade 2`, `trigger 5`, `release all fade 2`, `text Title Welcome`, `override group 3 intensity 80`, `override fixture 1 color #ff8800`, `clear overrides`, `output art-net off`, `beacon on`, and any API call: `pharos lpc api get system`, `api post timeline {"action":"start","num":1}`. Status: model, firmware, project, temperature, and on separate sub-tabs **Timelines** (state, ▶ ⏸ ⏵ ■), **Scenes** (state, start / toggle / release), **Groups** (level, master slider) and the Pharos project's own **Triggers** (searchable list with a **Fire** button each).
    - Not tested against real devices yet (only against the simulated ones in the mock). Things to check first: the Kiss-Box byte format on your firmware, the KNX tunnel on your interface, the BrightSign DWS login, the DiGidot fade unit (sent as milliseconds) and whether your Pharos firmware accepts plain http.
- **TCP devices** (Devices page): kept connected with auto-reconnect; `send tcp watchout run` (line end CR LF/CR/LF/none). Incoming lines fire **TCP message** triggers (`*`, exact or `prefix*`, vars `{device} {message} {1}`).
- **HTTP** requests to REST APIs: `http get|post|put|delete <url> [body]` (plain http, no https; a JSON body gets `application/json`). Responses fire **HTTP response** triggers (vars `{url} {status} {body}`, first 1 KB).
- **Modbus TCP** (Devices page): up to 4 PLCs, polled every `pollMs`. Points are linked from the Variables page; raw writes with `modbus plc write coil 5 1`. TCP/Modbus connections show on the Monitoring page and work with `device plc is online`.
- **Monitoring** tab: every N seconds (default 60, `settings.monitor.interval`, live with `monitor interval 30`, or `monitor check` for now) the controller:
  - pings every PC and network device (ICMP; switch off per item with the Monitor tick box),
  - polls projectors over PJLink: power, lamp hours, input, mute, model and error status (fan/lamp/temperature/cover/filter/other).
  
  Each host shows online/offline, ping time, last seen and a 32-check history bar, and the nav shows a badge with the number offline. A host counts as offline after `failures` missed checks in a row (default 2), so one lost packet doesn't raise an alarm. Changes are logged and fire **Device online/offline** triggers (vars `{device} {kind} {state}`); the condition `device "PJ left" is online` checks the current state.

- **Device view**: click a card (projector, PC, network device or show device; the ⤢ in the corner) to open it big. Under the card:
  - **History** for a date and a time slot you pick (◀ ▶ for the day before/after, **Today**, **Whole day**, **8 - 17**; a slot like 22:00 - 06:00 runs overnight). A bar shows when the device was **online** (green) or **offline** (red), and for projectors a second bar when the **power** was on (warming up counts as on, cooling down as off). Show devices get a bar for **every on/off reading**: Kiss-Box relays/outputs and contacts (digital cards), NETIO outputs and inputs, KNX on/off addresses (DPT 1) and Pharos timelines and scenes (on = running, paused or started). Each bar has the name you gave the channel, and at the right how often it went on and for how long in total (e.g. `3× · 6 h 55 min`). While the device is offline its readings are grey: the controller can't know them. Above it: % online, time offline, number of drop-outs, longest offline, and for projectors the time on, how often it was switched on, first on and last off. Grey = unknown: not checked yet after a start, or the controller itself was off (a gap of more than 15 minutes in the history).
  - A **Log** lane with a mark per log line (colour = level; click a mark to jump to the line), and below it the **log** of just this device: every line in the log files that mentions its name or IP address as a whole word (a device called `io` doesn't match "connection"), in that time slot. Esc or **← All devices** closes it. A slot that includes now refreshes every 15 s.
  - The history is kept on the stick in `logs/history/`, one small file per day (UTC), for 400 days: every online/offline, power and on/off reading change, a `boot` line at each start and an `alive` line every 10 minutes. The log only reaches back as far as the log files (see the Log section: about 450 000 lines). History starts when this firmware is installed; TCP and Modbus connections have none.
  - In the PC mock these files are in the show folder's `logs/`.

## Touch panel

- **Several panels**, e.g. one for the museum operator and one for the technician: **+ Panel** at the top of the Panel page. Each has its own name, title, start page and pages, and its own address: `http://<ip>/panel?p=2` (the number or the name, `?p=Operator`; plain `/panel` is the first). They share the theme. Controls are known by their name across all panels, so a "Stop" button or a status label with the same name on two panels fires the same triggers and shows the same live state. Move a page to another panel with its **Panel** choice. **Panel ↗** in the top bar opens a panel in a new tab (with several, it asks which); it shows the saved project.
- **Touch panel** at `http://<ip>/panel`: pages with optional **PIN**, and on them:
  - **buttons** (colour, width, a Ja/Nee **confirm question**, go-to-page) and **toggles** (an on/off button with a light; value 1/0);
  - **sliders** (horizontal or vertical, range, step, unit), **dials** (drag up/right to turn up) **colour wheels** (colour on the wheel, brightness on the bar under it) and **XY pads** (one dot for two values, e.g. pan/tilt: an X range left to right and a Y range bottom to top; it starts in the middle). Decimals: give a step like `0.1` or `0.01` (the value shows that many decimals); step `0` = smooth;
  - **labels** and a clock.
  - Tick **display only** on a button, toggle, slider, dial, wheel or XY pad to make it look normal but not react to touch, e.g. a slider used as a **progress bar** during start-up that a trigger moves with `panel Startup value 40`. In the preview on the Panel page it gets a 🔒.
  - Tick **disabled** to grey it out so it can't be touched (the same as `panel <name> disable`; `panel <name> enable` makes it usable again until the next `reset` or reload).
  - **Follow timeline** on a slider or dial: it shows how far that timeline is by itself (start of its range at the start of the timeline, end of the range at the end). It follows pause, `start … at`, stop (back to the start) and timelines started any way (button, schedule, trigger). Leave the unit empty to show the time instead, e.g. `1:23 / 5:00`. A control that follows a timeline can't be touched.
  - A **label** can show a **variable** (`Visitors:` + variable visitors = "Visitors: 42") or the **time of a timeline** (Follow timeline: "Main show 1:23 / 5:00", or only the time played "1:23", or the time left "-3:37"). The label's own text goes in front; `panel <label> text …` changes that part.
- **Selecting:** click a control in the preview, or the number (or an empty bit) of its row in the list; going into a field of a row selects it too. **Ctrl+click** adds or removes one, **Shift+click** in the list selects a range, **Ctrl+A** all. Drag one of the selected controls and they all move together (with what's in selected groups). **Delete** removes the selected controls (Ctrl+Z brings them back), **Esc** deselects.
- **Groups:** **+ group** adds a frame with a title (its text, as a rounded tag on the top of the frame in the group's colour; untick **title** for a frame without one) and a colour. Drag controls into the frame (wholly inside) and they belong to it: dragging the frame moves them along, its corner makes it bigger. Controls you drop into a group don't push it away; a group you move pushes controls in its way down. Controls along the frame get a little room to it (the space between controls, and a bit more under the title). On the panel it is only a frame, the controls in it work as normal. `panel <group> text …` changes the title. **Groups can sit in groups:** drop a group wholly inside a bigger one and it moves along with it, with everything in it; it gets a bit of room so its frame and title clear the outer ones. Something inside two groups belongs to the smallest.
- **Layout:** every control has a **size** (columns wide × rows high; a vertical slider is 3 high by default). In the **preview**, drag a control to move it and drag its corner to make it wider or higher; controls in the way move down. A page can have up to 12 columns. **Auto layout** forgets the dragged places (controls fill the page in list order again). Clicking a control in the preview shows it in the table.
- **Theme:** one look for the whole panel (Panel page → Theme): colours for background, buttons, button text, toggles, sliders and dials, labels, cards, plus text size, row height, space between, rounded corners and page width. Presets Dark, Light and Contrast. Everything you add follows the theme; give a control its own colour to override it (✕ next to the colour = back to the theme).
- **Linked to triggers:** controls fire **Panel button** triggers: press, release, click (buttons, toggles) and **change** (toggle, slider, dial, wheel, XY pad, while it moves and once when let go) with `{value}`, `{r} {g} {b}` (0-255) for a colour wheel and `{x} {y}` for an XY pad. Under each control on the Panel page you see which triggers it fires and which change it (click to open them), and **+ trigger** makes a new one for it.
- **Linked to variables** (optional): moving the control sets the variable, and when the variable changes (a trigger, the PLC…) the control follows. Toggles, sliders and dials have one variable. A colour wheel can set a number variable per part: **Red, Green, Blue** (0-255, or 0-100 % if you choose that), **Hue** (0-360), **Saturation** and **Brightness** (0-100), and/or the **whole colour** as `#rrggbb` in a text variable. An XY pad has an **X** and a **Y** variable.
- **Changed by triggers:** any control by its name, e.g. a Start show trigger with `panel "Start show" flash on` and `panel "Start show" text RUNNING`, a stop trigger with `panel "Start show" reset`. Also `color`, `flash <colour>`, `value` (move a slider, switch a toggle) and `disable` / `enable` (greyed out, can't be touched), `lock` / `unlock` (looks normal, can't be touched; `unlock` also frees a display-only control, `reset` goes back to the Panel page setting). The old `label <name> <text>` still works. Changes are pushed to every open panel at once; after a reload of the project they are back to how the Panel page sets them.
- The **preview** on the Panel page is live: it shows what the actions have set (flashing, texts, values).

## Command reference

The same commands work in trigger actions, the web console, `POST /api/cmd` and UDP (`cmd:<command>` on the trigger port replies `OK …`/`ERR …`; OSC `/kd/cmd "<command>"` on that port does the same). The UI autocompletes and validates them.
A timeline `<tl>` is its number or its name: `start timeline Inloop`, `stop timeline "Main show" fade 3` (quotes when the name has spaces; upper/lower case doesn't matter). Autocomplete and ⚙ fill in the name, which keeps working when timelines are renumbered; renaming a timeline updates the commands and conditions that use the old name.

```
start timeline <tl> [at <s>]           stop timeline <tl> [fade <s>]
pause timeline <tl>                    resume timeline <tl>
master timeline <tl> <0-100> [fade <s>]
scene <sc> [fade <s>]                  release scene <sc> [fade <s>]
release all [fade <s>]
set <universe>.<ch>[-<ch>] <0-255>     clear overrides
clear override <universe>.<ch>[-<ch>]  (only these channels go back to the show)
grandmaster <0-100>                    blackout on|off
mode <group> <state>                   mode <group> next|previous|toggle|back
label <name> <text>                    label <name> color <colour>
panel <control> text <text>            panel <control> color <colour>
panel <control> flash on|off|<colour>  panel <control> value <number|1/0|#rrggbb|x,y>
panel <control> disable|enable|lock|unlock|reset
fire trigger <name|#> [after <s>]      cancel trigger <name|#>
repeat trigger <name|#> every <s> [times <n>]            stop repeat <name|#>
sleep <s>                              (trigger actions only: the lines below it run <s> later)
wait until <condition> [timeout <s>]   (trigger actions only: the lines below run once it is true)
repeat <trigger> <n> times [every <s>] (trigger actions only: fires that trigger n times; {count} = the round)
repeat <n> times [every <s>] <command> (trigger actions only: {i} = 1..n; the lines below run after the last)
log <text>                             email <to> "<subject>" <body>
send udp <ip> <port> <text>            send udp <device|devicegroup> [<port>] <text>
send osc <ip> <port> </address> [args] send osc <device|devicegroup> [<port>] </address> [args]
reply <text>                           (answers the sender of the UDP/OSC that fired the trigger)
loglevel <category|all> <debug|info|warn|error>
output dmx|artnet|sacn on|off          output dmx|artnet|sacn fps <n>
projector <pj|all> on|off              projector <pj|all> mute on|off
projector <pj|all> input <code>        projector <pj|all> send <raw PJLink, e.g. LAMP ?>
pc <pc|all> wake|startup|shutdown|reboot
monitor check                          monitor interval <seconds>
var <name> = <value>                   var <name> + <n>   var <name> - <n>   var <name> toggle
var <name> * <n>   var <name> / <n>    var <name> ++   var <name> --   (+= -= *= /= work too)
if <condition> then <command> [else <command>]
send tcp <device> <text>               http get|post|put|delete <url> [body]
modbus <device> write coil|holding <address> <value>
kissbox <dev> <slot>.<ch> on|off|<0-255>    kissbox <dev> <slot> all <8 values>    kissbox <dev> read <slot>    kissbox <dev> send <hex>
knx <dev> write <address|name> <value> [<dpt>]                    knx <dev> read <address|name>
brightsign <dev> send <text>           brightsign <dev> reboot   brightsign <dev> api get|put|post|delete <path> [json]
brightsign <dev> event <text>          brightsign <dev> var <name> <value>   brightsign <dev> play <zone> <file>   brightsign <dev> stop <zone>   (KD plugin)
digidot <dev> scene <name|#> [fade <s>]   digidot <dev> playlist|trigger <id>   digidot <dev> stop|reset
digidot <dev> master <0-100>           digidot <dev> speed <%>   digidot <dev> send <json>
netio <dev> output <n|all|name> on|off|toggle|restart|pulse [<s>]  netio <dev> send <json>
pharos <dev> timeline <n> start|release|toggle|pause|resume [fade <s>]   pharos <dev> timeline <n> rate <x> | position <%>
pharos <dev> scene <n> start|release|toggle [fade <s>]   pharos <dev> group <n> master <0-100> [fade <s>]
pharos <dev> trigger <n> [vars]        pharos <dev> release all [fade <s>]   pharos <dev> text <slot> <text>
pharos <dev> override fixture|group <n> intensity <0-100> | color #rrggbb [fade <s>]   pharos <dev> clear overrides [fade <s>]
pharos <dev> output <protocol> on|off  pharos <dev> beacon on|off   pharos <dev> api get|post|put|delete <path> [json]
io <point> on|off|toggle               io <point> pulse <s>     io <ao0-3> <volts> [fade <s>]     io all off
ntp sync
reload
```

`send udp` and `reply` text support the escapes `\r \n \t \\ \xNN`, e.g. `send udp 192.168.1.10 7001 GO\r`.
OSC arguments are typed automatically: `12` → int, `0.5` / `-inf` → float, anything else → string (`send osc mediaserver /layer/1/level 0 0 -inf`).
`<pj>` and `<pc>` are the number or the name (in quotes when it has a space): `projector 1 on` = `projector "PJ left" on`, `pc "Media PC" wake`. Autocomplete and the ⚙ builder put in the name, which keeps working when the list order changes; type a digit to get the number.
PJLink input codes: 11/12 RGB, 21 video, 31–33 digital/HDMI, 41 storage, 51 network.

`<tl>`/`<sc>` is an id or a `"quoted name"`. When you add a command, update [src/Cmd.cpp](src/Cmd.cpp), `GRAMMAR` in [data/www/app-grammar.js](data/www/app-grammar.js) and `exec` in the mock ([tools/mock-server.js](tools/mock-server.js)).

Example from a PC: `echo -n "cmd:start timeline 2" | nc -u -w1 <ip> 4000`

## Watchdog (self-restart)

If the firmware ever hangs (a bug, a stuck thread), the controller restarts itself within **15 seconds** (`KD_WATCHDOG_MS` in `src/Config.h`): the board's hardware watchdog has to be "fed" by the main loop, and stops being fed when the loop stops. After the restart the project loads and the **Startup** trigger runs as after a power cut, so put everything the building needs in its normal state in Startup.

The log says why the controller started, and the dashboard and the Monitoring page show it as **Last start**:
- `power on`: the power was off.
- `restart`: the controller restarted itself on purpose (a network update).
- `new firmware`: the first start of new firmware (flashed over USB or installed by an update).
- `USB upload`: the same firmware flashed again over USB.
- `unexpected`: the firmware hung (the watchdog restarted it), crashed, or the reset button was pressed. Shown in red and logged as a warning.

The last log lines **survive a restart** (not a power cut): after an unexpected restart the log still shows what happened just before, up to a line `---- restart ----`, and lines that hadn't reached the stick yet are written to it then. A warning also says where the controller was busy when it stopped (e.g. "web at 'save: Show::parse'"), which helps to report a problem.

**Safe mode.** If the controller restarts after a crash **3 times in a row** (a project that crashes it, often from its Startup trigger, would otherwise do so on every start), it starts in safe mode: a red **SAFE MODE** in the header, and **no trigger runs by itself**. That means no Startup, times, inputs, UDP or panel buttons. You can still fire a trigger by hand ("Fire now", the console or `cmd:`), and whatever it fires runs too. Fix the project and **save** it, or restart the controller normally (restart button, power), to end safe mode. Running 5 minutes without a crash clears the count. The count is kept in the board's RTC backup memory. To try the screens in the PC mock, start it with `KD_SAFE_MODE=1`.

## Loop protection

Triggers that set each other off can end up in a loop that never stops, for example:
- a variable trigger that changes its own variable,
- a UDP trigger that sends to a broadcast address and receives its own message back,
- a timeline that fires a trigger that restarts the timeline.

The controller guards against that:
- **A trigger that fires more than 100 times in one second is paused for 10 seconds.** You see a red log line "fired over 100 times in a second - paused (feedback loop?)", a red **paused** tag on its row on the Triggers page, the dashboard's waiting list, and "1 trigger paused" in the header. DMX-change triggers are not counted: they fire once per channel per engine frame anyway. The limits are `KD_TRIGGER_MAX_PER_S` and `KD_TRIGGER_PAUSE_MS` in `src/Config.h`.
- **At most 100 waiting actions** (`sleep`s, `wait until`s, `repeat … every` loops, queued fires, `fire trigger … after` and `repeat trigger`s together, `KD_MAX_SCHEDULED`). A loop that keeps adding them would otherwise use up the memory and crash the controller. When the list is full, the new one is dropped with a warning.
- **UDP/OSC from the controller's own IP is ignored** (it is logged once). A broadcast `send udp` comes back in, and would fire your own triggers. To start your own trigger, use `fire trigger`.
- `fire trigger` chains stop after 8 levels deep, and at most 32 variable changes are handled per engine frame.

## Capacity (measured)

Measured on 9 Nov 2026 on a Portenta Machine Control with a deliberately extreme show: 8 universes full of RGB pixels (1360 fixtures), every one running an effect, a second timeline crossfading full-rig scenes over it, and 108 triggers. Re-run the measurements with `tools/stress/` (see the comment at the top of `stress.js`). A normal show uses a fraction of this.

| What | Result |
|---|---|
| Art-Net out | 8 universes at 40 fps (38.9 measured, no gaps over 50 ms); at 60 fps 61-62 fps, but frames less even (gaps up to 35 ms) |
| Art-Net + sACN together | 16 universes (8 + 8), ~1000 packets/s |
| Engine tick | 13 ms for this show (budget 25 ms at 40 fps); a 120-fixture show ~1 ms |
| UDP / OSC messages in | lights stay at 40 fps even when flooded with 3000 messages/s; ~350-400 trigger fires/s with this show (more with a lighter one); extra messages are dropped |
| One trigger | max 100 fires per second, then paused 10 s (loop protection, above): a fast OSC fader on one trigger hits this |
| UDP round trip (`reply`) | 3-7 ms typical, up to ~15 ms (a message that arrives during an engine tick waits for it) |
| Sending | 500 UDP or OSC messages in ~0.2 s, 100 TCP lines in ~0.1 s; at most 16 HTTP requests waiting (more are refused: "HTTP queue full") |
| `repeat … every 0.01` | runs, but the timing wobbles: gaps up to ~50 ms |
| Web API | ~65 requests/s from one client, ~90/s from 4; with 8 at once most connections are refused |
| Everything at once | 16 universes out + 450 messages/s in + 2 web clients: lights at ~36 fps, 7-10% of the messages lost, no restart |
| Memory | a trigger costs ~400 bytes: ~400-500 triggers fit next to a big show |
| Saving a project | ~36 KB/s onto the stick (a 400 KB show takes ~11 s; the lights keep running) |

A burst (`repeat 500 times send udp …`) runs in one go: the lights pause for those ~0.2 s.

## Logging

- A 512-entry RAM ring is streamed live to every open browser via Server-Sent Events. The UI has filters per level and category, search with highlight, pause, export, and a warning badge.
- Every entry is also written to Serial and appended to `/usb/logs/system.log`. At 8 MB it moves on to `system.1.log`, the older ones to `system.2.log` … `system.4.log`, and the oldest is deleted: 5 files, 40 MB, about 450 000 lines (a line is ~90 bytes). That's months on a normal day of triggers and device checks, a few weeks on a very busy one; a category on DEBUG fills it much faster. Size and number are `KD_LOG_MAX_BYTES` / `KD_LOG_FILES` in `src/Config.h`. In the mock, `KD_LOG_MAX=2000` makes the files tiny to test this.
- Per-category firmware verbosity can be changed at runtime (Log page or `loglevel artnet debug`).
- The status stream reports engine fps, DMX fps, Art-Net/sACN packets/s, UDP rx, worst tick and loop time, and running playbacks. The engine warns when a tick exceeds half its budget.

## HTTP API

| Method | Path | |
|---|---|---|
| GET | `/api/status` | System + playback status (`started` = why the controller last started) |
| GET / PUT | `/api/project` | Read / validate + save + load the project |
| POST | `/api/cmd` | Body: one or more commands (one per line) |
| POST | `/api/trigger?id=N` | Fire a trigger manually |
| GET | `/api/mode[?group=X[&state=Y]]` | Mode groups: all states as JSON; one group's state as plain text; `state` sets it (also `next`, `previous`, `toggle`, `back`) |
| GET | `/api/trighistory` | The last 512 trigger fires: `{"now": ms, "h": [[ms, id, source], …]}` (source: 0 own event, a trigger number, 32768 + timeline, 65535 by hand, 65534 repeat, 65533 delayed, 65532 queued) |
| POST | `/api/panel?control=X&event=click` | Touch-panel event (`press`, `release`, `click`, `change`); `change` adds `&value=` and `&vars=<name>=<value>;<name>=<value>` for the linked variables |
| GET | `/api/events[?since=seq]` | SSE: `log`, `status`, `gap` events |
| GET | `/api/log?since=seq` | Log entries as JSON |
| GET | `/api/loglevels` | Current level per category |
| GET | `/api/history?name=X&from=E&to=E` | One device's online/offline, projector power and on/off reading history from the stick: `[[epoch, "online"], [epoch, "p:1.3=1"], …]`, plus `boot` / `alive` lines (max 7 days). A mode group is `name=mode:<group>` with `m:<state>` lines (spaces as `%20`) |
| GET | `/api/devlog?name=X&ip=IP&from=E&to=E` | Lines of the log files on the stick that mention the device's name or IP (the last 300) |
| GET | `/api/dmx?u=ID` | 512 output values of a universe; with `&o=1` `{"v":[512 values],"o":[overridden channels]}` |
| PUT / DELETE | `/api/media?name=plan.jpg` | Upload (streamed to `show/media/`, max 4 MB) / delete an image |
| GET | `/media/<name>` | An uploaded image |
| PUT | `/api/update` | Body: a `.kdupdate` file; installs the web UI and/or firmware (reply `restart: true` = restarting now) |
| POST | `/api/time` | Body: unix epoch; sets the RTC (the UI does this automatically if unset) |

## Status / roadmap

The firmware compiles cleanly (PlatformIO, `framework-arduino-mbed` 4.6.0; Breakout build ~69% flash / ~45% RAM, Machine Control build ~74% flash / ~46% RAM) but is **not yet tested on hardware**. The network update is also untested on hardware: try it on the bench with the USB-C cable at hand. On the Machine Control check first: that the I/O chips answer (the Machine Control tab says "I/O running"), the analog input readings against a meter, and DMX on its RS485 port. Things to verify first: DMX break/timing on a scope or tester, USB stick detection on your carrier, OSC to your devices, SMTP with your mail relay, and the show-device drivers against the real devices. The web UI and touch panel are tested against the mock server.

Features from the Pharos reference project (`inspiration/`) that are **not** ported:
- **Lua trigger scripts**: the one script in the project (puppet motors) is covered by the `dmx_change` trigger with tables and `{=maths}`.
- Visual layouts/backgrounds, interface themes, and Pharos cloud features.

Next steps worth doing:
- Test the show-device drivers (Kiss-Box, KNX, BrightSign, DiGidot, NETIO, Pharos) on real devices.
- DMX output via DMA on the M7, if DMX turns out to take too much CPU (the M4 core stays unused for now).
- DMX / Art-Net / sACN **input** as trigger sources, and merge (HTP) of incoming data.
- Per-fixture intensity masters, and more effect templates (e.g. using `y`).
- Server-side PIN checks for the touch panel. The PINs are currently checked in the browser and are readable in `project.json`.
- Authentication for the web UI.
- Gzip-compressed UI files on the stick for faster loads.
