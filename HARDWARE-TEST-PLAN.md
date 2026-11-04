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
- Ethernet: controller and this PC on the same switch (a small switch with DHCP router, or
  this PC on a fixed IP in `192.168.1.x` if the controller falls back to `192.168.1.50`)
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
| | | | |
