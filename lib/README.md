# Patched copies of Arduino core libraries

PlatformIO uses a library in this folder instead of the core's library with the same name.

- `SocketWrapper/` - Arduino Mbed core 4.6.0's SocketWrapper (`EthernetClient`, `EthernetUDP`...)
  with one fix in `src/MbedClient.cpp` `readSocket()`: every open TCP connection kept a thread
  spinning at normal priority, which starved the DMX output thread (a few frames/s with the web
  UI open), and it slept 100 ms before reading a request that was already there (every web
  request started ~120 ms late). Also `write()` keeps the socket non-blocking (Arduino's switched
  it to blocking, so the reader's `recv()` could block holding the lock `read()` needs) and
  `connect()` uses the client's `setSocketTimeout` (Arduino's had no limit: 20 s and more for a
  device that is off). `MbedUdp` has three additions (9 Nov 2026) for the network receive thread
  (`src/NetRx.cpp`): `sendTo()` (one datagram straight from a buffer, socket stays non-blocking),
  `receive()` (into the caller's buffer) and `onEvent()` (the socket's sigio). See the comments there. Everything else is unchanged; when moving to a new core
  version, copy its SocketWrapper here again and re-apply the fix (or drop it if Arduino fixed it).
- `ArduinoJson/` - ArduinoJson 7.4.3 (`bblanchon/ArduinoJson`, taken out of `lib_deps` on
  10 Nov 2026; `examples` left out). One change in `src/ArduinoJson/Memory/StringPool.hpp`
  `get()` (and `strings_` made `mutable`): a string that is already stored moves to the front
  of the list. ArduinoJson shares
  equal strings by searching a list of all strings of the document, and puts new ones in front,
  so the keys every object has ended up at the back: loading a 400 KB show did ~45 000 searches
  through ~1 700 strings (1.8 s of the 2 s load on the board; with the change 0.6 s). To
  update the library, copy the new version here and re-apply the loop (search "KD Designer").
- `Arduino_USBHostMbed5/` - the USB stick driver, version 0.3.1 from the PlatformIO registry
  (`facchinm/Arduino_USBHostMbed5`, taken out of `lib_deps`; `.github`/`examples` left out).
  One change in `src/USBHostMSD/USBHostMSD.cpp` (9 Nov 2026): `program()` / `read()` send up to
  `KD_MSD_BLOCKS` (64) blocks per SCSI command instead of one 512-byte block each. Every command
  is a command packet, a status reply and the stick's own delay, so writing ran at ~100 KB/s;
  now ~200 KB/s (a 456 KB project: 4.7 s -> 2.3 s, read back identical). The driver doesn't
  use DMA (`dma_enable = 0`) and splits the data into USB packets itself. To update the
  library, copy the new version here and re-apply the two loops (search "KD Designer").
