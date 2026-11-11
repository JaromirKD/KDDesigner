#!/bin/bash
# Double-click to work on shows on this Mac: the launcher page opens in the browser
# (shows, controllers on the network and USB). Close this Terminal window to stop it and
# every show it opened. A show folder can also be passed: open -a Terminal is not needed,
# run it from a terminal with the folder as the argument.
cd "$(dirname "$0")" || exit 1
# Node from the usual places, even when Terminal doesn't load the shell profile.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org and try again."
  read -r -n 1 -s -p "Press any key to close."
  exit 1
fi
node tools/launcher.js "$1"
echo
echo "  The launcher stopped."
read -r -n 1 -s -p "Press any key to close."
