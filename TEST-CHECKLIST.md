# Test checklist - to-do list of 10 Nov 2026

Tick each box when it works; write what went wrong next to it when it doesn't.
Numbers match `todo.txt`.

**Before you start:** test on a copy, not your real show. In the launcher (`KD Designer (PC).cmd`)
**Duplicate** your show (or open the feature demo) and open the copy. On the board use a test
project, not the museum show (its triggers talk to real devices). Back up the board's project first.

---

## Part 1 - In the mock (PC)

### A. Map
- [ ] **1** Map page: add a rectangle, an ellipse, a line and a text label. Move them, resize them, change the colour. Save, reload: still there.
- [ ] **2** Select ~12 fixtures, Shape… → grid. Set Columns = 4: Rows becomes 3. Change it to 6: the grid redoes itself.
- [ ] **3** Drag a shape's side handles: width and height change separately.
- [ ] **4** Timelines → a track's map view: drag a box over fixtures, Shift-click and Ctrl-click to add/remove. Same as on the Map page.
- [ ] **5** Make a map much wider than high, tick **round effects**, put a circle effect on its fixtures: the circle looks round in the preview. Untick: it stretches again (old behaviour).

### B. Scenes and timelines
- [ ] **6** Scenes: the count above the map is right; **Only fixtures in this scene** hides the others; **Select those in scene** selects them; the scene list shows a count per scene.
- [ ] **7** Start a timeline, keep **● Live editing** on, change a cue level or move a clip while it plays: the output (DMX monitor / dashboard) changes at once. Switch it off: changes wait for the save.
- [ ] **8** A colour/effect clip shows a level line. Drag it down: the clip and the Level slider follow.

### C. Triggers
- [ ] **9** Select 3 triggers (Ctrl-click): the editor says **3 triggers selected**. Change colour, enabled, cooldown, while running, only active in: all 3 change.
- [ ] **10** Give a trigger a condition that is false, fire it: the row flashes red (not orange), the fire history and the log say "condition false".
- [ ] **11** Fire a trigger from another trigger / a timeline: the "← 38" / "← TL 2" mark is left of the name.
- [ ] **12** Show flow: triggers with conditions have a yellow diamond above them; an `if … then … else` in the actions shows a diamond with yes/no arrows.
- [ ] **13** Click a colour tab, drag a trigger and a separator up/down inside it: they move.
- [ ] **14** In a colour tab, drag a trigger above the header separator: it jumps back under the header. The header keeps the tab's name.
- [ ] **15** "Sequence" is gone from the trigger types and templates. Open an old project with a sequence trigger (e.g. a git version from before): it turns into a separator with notes.
- [ ] **16** Make a **Calendar change** trigger on a period that starts in a minute (or change the period's dates so it becomes active): it fires once, on active, and again on inactive.

### D. Schedule and calendar
- [ ] **17** Schedule page: nothing overlaps. Also try Settings > Display at the smallest and biggest UI size, and a narrow window.
- [ ] **18** Make a period "Museum open" Monday-Saturday: Sundays are not active (month view, conditions).
- [ ] **19** Dates show and are typed as DD-MM / DD-MM-YYYY everywhere (periods, `date between` conditions, log, backups list).
- [ ] **20** Month view: periods tint the days, timed triggers are listed, skipped ones are crossed out. Click a day: full list. Narrow window: a count per day.

### E. Devices and monitoring
- [ ] **21** Menu: Devices is right under Dashboard.
- [ ] **22** Monitoring → click a device: the graph appears first, the log lines after; refreshing doesn't reload everything.

### F. Network (the mock only shows the page; the real test is on the board)
- [ ] **23** Settings > Network: DNS fields, **In use now** panel. Type a wrong IP, a mask like 255.0.255.0, a gateway outside the subnet: red message, Save refuses.

### G. General
- [ ] **25** Select a fixture / map item / clip / trigger, press **Backspace**: it is deleted. Type in a field and press Backspace: only the text changes.
- [ ] **26** Right-click a trigger, fixture, map fixture, shape, clip, scene, timeline, effect, device, variable: a menu with sensible actions; try a few (Fire, Duplicate, Delete, open →).
- [ ] **27** Dashboard: switch Art-Net off: the status bar stops showing its fps. Switch all three off: **output off** chip.

### H. Extras
- [ ] **29** A scene used by a trigger: **Used in N places** under its name, links open the trigger. Delete the scene: a warning first.
- [ ] **32** Save 3 times, Settings → **Backups**: 3 new lines with date/time. **Restore…** an older one: the editor shows it (not saved until you save). Network setting stays.
- [ ] **34** Select fixtures, press **L** (or Locate button / right-click → Locate): they blink white 5 s, also with grand master at 0 / blackout, then go back.
- [ ] **35** Map: Snap on with grid 20/40; align and distribute 4 fixtures; rotate a selection; Ctrl+C on one map, Ctrl+V on another map.
- [ ] **36** Press **?** on several pages: each shows that page's shortcuts.

### I / J
- [ ] **39** Save: the progress bar shows Sending → Loading → Writing to the stick, then "Saved". Reload the page: a loading bar.
- [ ] **J1** Switch DMX off on the Dashboard: Patch shows it off too (same switch). Save, reload: still off.
- [ ] **J2** Devices → a projector: **lower case** option, default UPPER case.

---

## Part 2 - On the board

Upload by USB first (`python -m platformio run -e machine_control -t upload --upload-port COM3`), then:

- [ ] **37a** After the USB upload: boots, web UI opens, Settings shows the new version.
- [ ] **37b** Install a network update (`updates/*.kdupdate`, Settings > Update): installs, log says "installed".
- [ ] **37c** A test update bigger than 768 KB installs too (checks the bootloader writes the second half of the flash). Ask Claude to make one.
- [ ] **38** Save your own show: note the "Project saved (…)" log line (time per step). Expect ~1 s to "Saved" and the stick write after. Status bar: "writing to the stick…" then gone.
- [ ] **38** Save twice quickly: second save waits / works, no restart (Last start stays `power on`).
- [ ] **32** Settings → Backups lists the saves on the stick; restore one.
- [ ] **24a** Change the network to a fixed address and say **OK** to switch now: the editor opens on the new address and it stays. Then do it again with a wrong address: after 2 minutes the board is back on the old one.
- [ ] **24b** During a network test, pull the power: after the restart the old setting is used.
- [ ] **24c** Put `network-reset.txt` on the stick, restart: DHCP again, file removed, log line.
- [ ] **23** **In use now** shows the real IP, mask, gateway, DNS, MAC and cable link. Pull the cable: link goes down.
- [ ] **NTP** With DNS set, the clock gets set (Settings / log "NTP").
- [ ] **5** A round effect on a wide map looks the same on the fixtures as in the preview.
- [ ] **7** Live editing a running timeline changes the real output; no flicker or restart of the timeline.
- [ ] **16/18** A Calendar change trigger and a weekday period on the board (Clock.cpp): fires at the right moment.
- [ ] **22** Monitoring → a device with weeks of history: opens within a few seconds from the stick.
- [ ] **27** Switch outputs off/on: status bar matches what an Art-Net/sACN monitor on the PC sees.
- [ ] **34** Locate on real fixtures.
- [ ] **J2** The projector that wants lower case: with the option on it switches on/off and its state is read.
- [ ] Long run: leave the stress show running overnight (`Overnight stress test.cmd`), check the report in `tools/stress/soak-results/`.
