# Rebuilt Portenta core library (more network sockets)

Arduino's Mbed core for the Portenta H7 comes with a pre-built `libmbed.a` whose network stack
(lwIP) allows only **4 sockets in total**. KD Designer needs many more (Art-Net, sACN, UDP trigger
ports, the web server and its browsers, MQTT, PJLink, TCP devices, KNX, Kiss-Box, NTP...), so on
the first hardware test (6 Nov 2026) the web server refused every connection.

`variants/PORTENTA_H7_M7/` is a copy of the core's own variant folder (Arduino Mbed core 4.6.0, as
installed by PlatformIO) with two files replaced by a rebuild:

- `libs/libmbed.a` - Mbed OS 6.17 + Arduino's 267 patches, built with Arduino's own
  `mbed-os-to-arduino` script and the same compiler as Arduino's releases (GCC 9-2019-q4)
- `mbed_config.h` - the matching settings

Only the lwIP limits differ from Arduino's build (`conf/mbed_app.json`):

| Setting | Arduino | Here |
|---|---|---|
| `lwip.socket-max` (all sockets) | 4 | 32 |
| `lwip.tcp-socket-max` | 4 | 20 |
| `lwip.udp-socket-max` | 4 | 16 |
| `lwip.tcp-server-max` | 4 | 4 |
| `lwip.memp-num-tcp-seg` | 16 | 48 |
| `lwip.mem-size` (bytes) | 16000 | 16000 (it sits in a fixed 16 KB slot of RAM_D2, `.ethusbram` in the linker script: more doesn't link) |
| `lwip.pbuf-pool-size` | 5 | 8 |
| `lwip.num-pbuf` / `lwip.num-netbuf` | 8 / 8 | 16 / 16 |

`platformio.ini` uses this folder through `board_build.variants_dir`; everything else (headers,
Arduino libraries, compiler) still comes from PlatformIO's normal package. Both builds
(`portenta_h7_m7` and `machine_control`) use it.

## Rebuilding (only when moving to a new Arduino core version, or changing the limits)

Needs WSL with Ubuntu 22.04 (`wsl --install -d Ubuntu-22.04`).

1. In Ubuntu: `mkdir -p ~/kdcore && cd ~/kdcore && git clone --depth 1 --branch <core version> https://github.com/arduino/ArduinoCore-mbed.git`
2. `bash setup-tools.sh` (once: Python env, mbed-cli, GCC 9-2019-q4 in `/opt`; runs as root)
3. Change the limits in `build-core.sh` if needed, then `bash build-core.sh` (a few minutes)
4. Copy the core's variant folder from `%USERPROFILE%\.platformio\packages\framework-arduino-mbed\variants\PORTENTA_H7_M7`
   here, then put the new `libs/libmbed.a`, `mbed_config.h` and `conf/mbed_app.json` from
   `~/kdcore/ArduinoCore-mbed/variants/PORTENTA_H7_M7/` over it. Keep the core's own
   `defines.txt` (the rebuilt one lacks the `CORE_MAJOR/MINOR/PATCH` lines).
5. Build, and check the RAM line: every extra socket and buffer costs RAM.

If PlatformIO ever updates `framework-arduino-mbed` to another version, this folder must be
rebuilt for that version too (the headers come from the package, the library from here).

## Heap wrappers (redo after every rebuild)

Mbed's malloc wrappers (`mbed_alloc_wrappers.o`: a statistics mutex and memory tracing on every
call, realloc as malloc + copy + free) made each allocation cost ~3000 CPU cycles. `src/Heap.cpp`
has lean versions. `libmbed.a` is linked whole (`--whole-archive`), so Mbed's versions are made
**weak** in this copy of the library, and ours win. After rebuilding or replacing `libmbed.a`, run
once (PowerShell, in the project folder):

```bash
& "$env:USERPROFILE\.platformio\packages\toolchain-gccarmnoneeabi\bin\arm-none-eabi-objcopy.exe" --weaken-symbol=__wrap__malloc_r --weaken-symbol=__wrap__free_r --weaken-symbol=__wrap__realloc_r --weaken-symbol=__wrap__calloc_r --weaken-symbol=__wrap__memalign_r --weaken-symbol=malloc_wrapper --weaken-symbol=free_wrapper --weaken-symbol=mbed_stats_heap_get tools\core\variants\PORTENTA_H7_M7\libs\libmbed.a
```

Without it the build stops with "multiple definition of `__wrap__malloc_r`".
