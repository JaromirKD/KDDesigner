# Builds a .kdupdate file: the firmware plus the web UI (data/www) in one file,
# installed over the network from Settings -> Software update.
#
# Runs by itself after every PlatformIO build (extra_scripts in platformio.ini) and
# writes updates/KD-Designer-<version>-<target>.kdupdate. Run by hand for a
# web-UI-only update (any controller, no restart):  python tools/make_update.py --www-only
#
# Format (read by src/Update.cpp and tools/mock-server.js):
#   "KDUPDATE 1\n" + one line of JSON + "\n" + the files' bytes, back to back.
#   JSON: {"version", "target": "portenta" | "machine_control" | "any", "built",
#          "files": [{"name": "firmware.bin" | "www/<path>", "size", "crc"}]}   (crc = CRC-32)
import json, os, re, sys, time, zlib

MAGIC = b"KDUPDATE 1\n"


def www_files(root):
    www = os.path.join(root, "data", "www")
    out = []
    for d, _, names in os.walk(www):
        for n in sorted(names):
            full = os.path.join(d, n)
            out.append(("www/" + os.path.relpath(full, www).replace(os.sep, "/"), full))
    return sorted(out)


def make(root, version, target, firmware=None):
    files = ([("firmware.bin", firmware)] if firmware else []) + www_files(root)
    blobs = []
    for name, path in files:
        with open(path, "rb") as f:
            blobs.append((name, f.read()))
    header = {
        "version": version,
        "target": target,
        "built": time.strftime("%Y-%m-%d %H:%M"),
        "files": [{"name": n, "size": len(b), "crc": zlib.crc32(b) & 0xFFFFFFFF} for n, b in blobs],
    }
    os.makedirs(os.path.join(root, "updates"), exist_ok=True)
    label = version if firmware else "www-" + time.strftime("%Y%m%d-%H%M")
    out = os.path.join(root, "updates", "KD-Designer-%s-%s.kdupdate" % (label, target))
    with open(out, "wb") as f:
        f.write(MAGIC + json.dumps(header, separators=(",", ":")).encode() + b"\n")
        for _, b in blobs:
            f.write(b)
    print("Update file: %s (%d KB)" % (out, os.path.getsize(out) // 1024))
    return out


def ini_version(root):
    with open(os.path.join(root, "platformio.ini")) as f:
        m = re.search(r'KD_VERSION=\\"([^"\\]+)\\"', f.read())
    return m.group(1) if m else "dev"


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--www-only" not in sys.argv:
        sys.exit("Firmware updates are made by the build (python -m platformio run). "
                 "For the web UI only: python tools/make_update.py --www-only")
    make(root, ini_version(root), "any")
else:
    # Loaded by PlatformIO (SCons): package after the .bin is linked.
    Import("env")  # noqa: F821

    def _after_build(source, target, env):
        root = env.subst("$PROJECT_DIR")
        board = "machine_control" if env.subst("$PIOENV") == "machine_control" else "portenta"
        make(root, ini_version(root), board, str(target[0]))

    env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", _after_build)  # noqa: F821
