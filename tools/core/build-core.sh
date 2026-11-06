#!/bin/bash
# Rebuilds the Portenta H7 M7 libmbed.a with higher lwIP limits (KD Designer).
set -e
source /opt/mbed_env/bin/activate
export PATH=$PATH:/opt/gcc-arm-none-eabi-9-2019-q4-major/bin/
cd ~/kdcore/ArduinoCore-mbed
CONF=variants/PORTENTA_H7_M7/conf/mbed_app.json
git checkout -q -- "$CONF"
jq '.target_overrides["*"] += {
  "lwip.socket-max": 32,
  "lwip.tcp-socket-max": 20,
  "lwip.udp-socket-max": 16,
  "lwip.tcp-server-max": 4,
  "lwip.memp-num-tcp-seg": 48,
  "lwip.mem-size": 16000,
  "lwip.pbuf-pool-size": 8,
  "lwip.num-pbuf": 16,
  "lwip.num-netbuf": 16
}' "$CONF" > /tmp/conf.json && mv /tmp/conf.json "$CONF"
grep lwip "$CONF"
# Same two steps as extras/package.sh: fetch mbed-os + Arduino's patches, then build the variant.
if [ ! -f /tmp/mbed-os-program/.patched ]; then
  set +e
  ./mbed-os-to-arduino -b origin/latest -a NOPE:NOPE
  set -e
  touch /tmp/mbed-os-program/.patched
fi
./mbed-os-to-arduino PORTENTA_H7_M7:PORTENTA_H7_M7
ls -la variants/PORTENTA_H7_M7/libs/
grep -n "LWIP_\(SOCKET_MAX\|TCP_SOCKET_MAX\|UDP_SOCKET_MAX\|MEM_SIZE\|PBUF_POOL_SIZE\)" variants/PORTENTA_H7_M7/mbed_config.h
echo BUILD-OK
