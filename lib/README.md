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
