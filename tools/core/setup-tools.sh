#!/bin/bash
# Build tools for ArduinoCore-mbed's mbed-os-to-arduino, as in its release.yaml.
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3-pip python3-venv git mercurial jq rsync wget bzip2 >/dev/null
if [ ! -d /opt/gcc-arm-none-eabi-9-2019-q4-major ]; then
  wget -q -O /opt/gcc9.tar.bz2 https://developer.arm.com/-/media/files/downloads/gnu-rm/9-2019q4/gcc-arm-none-eabi-9-2019-q4-major-x86_64-linux.tar.bz2
  tar -xjf /opt/gcc9.tar.bz2 -C /opt/
  rm /opt/gcc9.tar.bz2
fi
if [ ! -d /opt/mbed_env ]; then python3 -m venv /opt/mbed_env; fi
source /opt/mbed_env/bin/activate
cd ~/kdcore/ArduinoCore-mbed
python3 -m pip install -q -r extras/requirements.txt
python3 -m pip install -q mbed-cli setuptools
python3 -m pip install -q --upgrade six
mbed config -G GCC_ARM_PATH /opt/gcc-arm-none-eabi-9-2019-q4-major/bin/
/opt/gcc-arm-none-eabi-9-2019-q4-major/bin/arm-none-eabi-gcc --version | head -1
mbed --version
echo TOOLS-OK
