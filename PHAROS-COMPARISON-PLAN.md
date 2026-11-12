# Performance comparison: Pharos LPC 1 vs KD Designer

A side-by-side test of the two controllers running **the same show**, measured **from the outside**
(what comes out on the network and the DMX cable), so both are judged the same way. The KD has its
own figures in `/api/status`, the LPC doesn't expose those - so the numbers that go in the table
come from captures on the PC and the DMX line, never from either controller's own report.

## 1. Keep it fair

- **Size**: an LPC 1 drives 512 channels (one universe). Run the comparison at **1 universe**.
  What the KD does beyond that (8 universes, 16 with sACN) goes in a separate "KD only" section at the
  end, not in the head-to-head table.
- **Same network**: both on the same switch, same cable length, same PC. Nothing else busy on that
  switch. Best: a managed switch with a mirror port, or a small unmanaged one with only the test gear.
- **Same output settings**: write down the LPC's output frame rate / refresh setting in Designer 2 and
  set the KD to the same (e.g. both 40 fps). Same protocol (Art-Net unicast to the PC, or sACN).
- **Same show**, built by hand on both (list in section 3). Write down both firmware versions,
  Designer 2 version, and the date.
- **One controller at a time** on the output universe (or give them different universes), so captures
  don't mix the two.
- Repeat each timing test **at least 100 times** and report median, 95 % and worst - single readings say
  little.

## 2. What you need

| Item | For |
|---|---|
| PC/laptop with **Wireshark** (on mains power, sleep off) | Art-Net/sACN timing, trigger latency (one clock for in and out) |
| **DMX analyser** or a USB-DMX input (Enttec Pro, DMXking) - better: a **logic analyser / scope** on the DMX line (a cheap 8-channel USB logic analyser + an RS-485 receiver does it) | DMX frame rate, break/MAB lengths, jitter, refresh |
| One real fixture (RGB or dimmer) | Seeing flicker / steps in fades |
| Optional: phone with **slow-motion video** (240 fps) | Fade smoothness as the eye sees it |
| A switchable power strip + stopwatch | Boot and power-cut tests |
| Node on the PC (already used by `tools/stress/`) | Sending trigger messages at a steady pace |

## 3. The test show (build it identically on both)

| # | Item | Used in |
|---|---|---|
| S1 | Scene "Off": all 512 channels 0 | everything |
| S2 | Scene "Full": all 512 at 255 | fade tests |
| S3 | Fade S1 -> S2 in **10 s**, linear | T3 |
| S4 | A **chase/effect over 170 RGB pixels** (rainbow or moving bar, 1 cycle per 2 s) | T2, T8 |
| S5 | Timeline 60 min: a cue every minute that sets channel 1 to the minute number | T7 |
| S6 | UDP trigger "GO" (port e.g. 4000) -> snap to "Full"; "OFF" -> snap to "Off" | T4 |
| S7 | UDP trigger "PING" -> sends a UDP "PONG" back to the PC | T5, T6 |
| S8 | Startup: start the S4 effect | T9 |
| S9 | Optional: a contact input -> snap to "Full" (if both units have inputs wired) | T4b |

The KD side is written by `node tools/lpc/make-lpc-shows.js --pc <PC address>` into
`tools/lpc/compare/project.json`. Its triggers listen on UDP port 4000: `GO`, `OFF`, `FADEUP`,
`FADEDOWN`, `PING <n>` (answers `PONG <n>`), `STOP`, `FX1` / `FX2` / `FX3` (1, 2 or 3 effects for T8)
and `HOUR` (S5). Use the same words on the LPC.

## 4. The tests

| # | Test | How | Measure |
|---|---|---|---|
| T1 | **DMX cable timing** | Logic analyser on the DMX output, show running S4, 30 s capture | frames/s, gap between frames (min/max = jitter), break and MAB length, number of slots. Check against the DMX standard (break >= 92 µs, MAB >= 12 µs) |
| T2 | **Network output** | Wireshark, filter `udp.port == 6454` (Art-Net) or `5568` (sACN), S4 running, 60 s | packets/s, gaps (Statistics > I/O graph, or export to CSV), longest gap, sequence numbers missing |
| T3 | **Fade smoothness** | Capture the 10 s fade S3 (network + DMX) | distinct values channel 1 goes through (ideal: ~255 steps in 10 s at 40 fps = 400 frames), any step backwards, start/end time vs 10.0 s. Watch the fixture at low levels, film it in slow motion |
| T4 | **Trigger latency** | Script sends "GO"/"OFF" alternating once a second, 200 times; Wireshark sees both the UDP in and the Art-Net out | time from "GO" packet to the first Art-Net frame with channel 1 = 255. Median / 95 % / worst |
| T4b | Input latency (optional) | Contact closure and DMX line on the same logic analyser | contact -> first DMX frame with the new value |
| T5 | **Round trip** | "PING" -> "PONG", 1 per second, 200 times | median / 95 % / worst round trip |
| T6 | **Message load** | "PING" at 10, 50, 100, 200, 500 per second, evenly spaced, 30 s each, S4 running | % of PONGs that come back, and whether the Art-Net output (T2) keeps its frame rate meanwhile |
| T7 | **Timeline accuracy** | Run S5 for 1 hour, capture | each cue's real time vs. start; drift after 60 min. Also a time-of-day trigger at an exact clock time (both on NTP): how far off the real time |
| T8 | **Effect load** | S4 at 170 pixels, then 2 effects layered, then 3 | frame rate on the wire stays at the set rate? (T2 method) |
| T9 | **Boot** | Switch power on with the stopwatch / logic analyser | power-on -> first DMX frame; -> first Art-Net packet; -> startup effect running; -> web page answers |
| T10 | **Power cut** | Cut power 10 times at random moments (once right after saving a show change) | comes back by itself? show intact? same state? |
| T11 | **Robustness** | Unplug/replug the network cable while running; open the web UI and click around during S4; heavy broadcast traffic on the switch (lab only, never on a live network) | output keeps going? recovers? how long? |
| T12 | **24 h soak** | Leave S4 + PINGs at 10/s running for 24 h | any gap > 100 ms, any restart, still answering |
| T13 | **Programming** (subjective, but useful) | Time yourself building the same show on each; time a save/upload of a change until it is live | minutes to build, seconds until a change is live |

## 5. Results table

| Test | Figure | LPC 1 | KD Designer | Notes |
|---|---|---|---|---|
| T1 | DMX frames/s, jitter (min-max gap), break/MAB | | | |
| T2 | Art-Net packets/s, longest gap | | | |
| T3 | steps in 10 s fade, backward steps, duration | | | |
| T4 | GO -> output: median / 95 % / worst (ms) | | | |
| T4b | contact -> DMX (ms) | | | |
| T5 | round trip median / 95 % / worst (ms) | | | |
| T6 | PONG % at 10 / 50 / 100 / 200 / 500 per s | | | |
| T7 | cue drift after 60 min; clock trigger error | | | |
| T8 | frame rate with 1 / 2 / 3 effects | | | |
| T9 | boot to DMX / Art-Net / show / web (s) | | | |
| T10 | recovered after 10 power cuts | | | |
| T11 | cable replug recovery (s), output during web use | | | |
| T12 | gaps / restarts in 24 h | | | |
| T13 | build time, change-to-live time | | | |

**KD only** (beyond the LPC 1's size): repeat T2, T6 and T8 with `tools/stress/` (8 universes,
Art-Net + sACN, the `all` test) and copy the README "Capacity (measured)" figures in for reference.

## 6. Order on the day

1. Update both to their latest firmware, note the versions. Back up the KD's project first
   (`GET /api/project`) and the LPC's show in Designer 2.
2. Build the test show on both (section 3), check by eye with the fixture that they do the same thing.
3. KD on its own: T1-T9, then the LPC on its own, same order (same PC, same cables).
4. T10-T11 on both.
5. T12 overnight: one unit per night, or both at once on different universes.
6. Put both original shows back.

## 7. Watch out

- Wireshark on Windows timestamps packets fairly well, but with the PC busy it adds a few ms: close
  other programs, and for the sub-millisecond figures (T1, T4b) trust the logic analyser.
- The KD's own `stress.js art` counts Art-Net from **any** source on the network - keep the LPC off the
  universe while using it, or use Wireshark filtered by IP.
- The LPC's "PING -> PONG" must be a plain UDP trigger with a UDP action; make sure it doesn't have
  a debounce/hold setting that the KD's doesn't (and the other way round: no cooldown on the KD trigger).
- The KD limits one trigger to 100 fires/s (loop protection) - for T6 above that, spread the PINGs over
  several triggers on both units, or note the limit in the table.
