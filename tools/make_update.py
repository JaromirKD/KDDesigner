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
#
# Text files of the web UI go in gzipped (www/app-core.js.gz): the controller reads its USB
# stick at ~300 KB/s, so a quarter of the bytes opens the UI much faster. www/etags.txt lists
# "<url path> <stored size> <crc hex>" per file: the controller's ETag, so a reload only checks
# (304). A stick filled by hand from data/www has neither and is served as before (src/Web.cpp).
import gzip, json, os, re, sys, time, zlib

MAGIC = b"KDUPDATE 1\n"
GZIP_EXT = (".html", ".js", ".css", ".json", ".svg")


def www_files(root):
    www = os.path.join(root, "data", "www")
    out = []
    for d, _, names in os.walk(www):
        for n in sorted(names):
            full = os.path.join(d, n)
            out.append(("www/" + os.path.relpath(full, www).replace(os.sep, "/"), full))
    return sorted(out)


def www_blobs(root):
    blobs, etags = [], []
    for name, path in www_files(root):
        with open(path, "rb") as f:
            data = f.read()
        url = name[3:]   # www/x -> /x
        if name.endswith(GZIP_EXT):
            data = gzip.compress(data, 9, mtime=0)
            name += ".gz"
        blobs.append((name, data))
        etags.append("%s %d %08x" % (url, len(data), zlib.crc32(data) & 0xFFFFFFFF))
    blobs.append(("www/etags.txt", ("\n".join(etags) + "\n").encode()))
    return blobs


def make(root, version, target, firmware=None):
    blobs = []
    if firmware:
        with open(firmware, "rb") as f:
            blobs.append(("firmware.bin", f.read()))
    blobs += www_blobs(root)
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
        pioenv = env.subst("$PIOENV")
        board = "machine_control" if pioenv.startswith("machine_control") else "portenta"
        # The padded test build (env machine_control_bigtest) gets its own name, so it never
        # replaces the real update file.
        version = ini_version(root) + ("-bigtest" if pioenv.endswith("_bigtest") else "")
        make(root, version, board, str(target[0]))

    env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", _after_build)  # noqa: F821
