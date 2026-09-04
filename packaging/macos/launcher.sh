#!/bin/bash
# The whole of the mac app, and it is deliberately this short.
#
# Keeper is a server and a page in your own browser, so there is no window
# for this bundle to own and nothing for it to stay alive for. It starts the
# server, waits until the server says it is up, and gets out of the way.
#
# EXITING IS THE FEATURE. An app that stayed running would be a running app
# as far as the system is concerned, and clicking a running app's icon does
# not run it again: it activates it. There is nothing to activate, so the
# person who closed their tab and clicked the icon to get it back would watch
# nothing happen. Because this exits, every click is a fresh launch, and a
# fresh launch finds the server already running and opens the tab again.

set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
res="$here/Resources"

log="$HOME/Library/Logs/keeper.log"
mkdir -p "$(dirname "$log")"

# Trimmed rather than rotated. It is one process writing a handful of lines
# per launch, and a log that needs rotating is a log that is being used for
# something this is not.
if [ -f "$log" ] && [ "$(wc -c <"$log")" -gt 262144 ]; then
  tail -c 65536 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
fi

# WHERE THE THINGS KEEPER SHELLS OUT TO ACTUALLY LIVE.
#
# A double clicked app is started by launchd, not by a shell, so it gets
# PATH=/usr/bin:/bin:/usr/sbin:/sbin and nothing else. Measured on this
# machine with a probe bundle, and `launchctl getenv PATH` is empty, so
# nothing anywhere fills it in. Homebrew installs into /opt/homebrew/bin on
# apple silicon and /usr/local/bin on intel, and neither is on that list, so
# a person who ran `brew install ffmpeg` because keeper asked them to got
# every clip on the shelf with no poster behind it and no reason given. From
# a terminal it worked, which is the worst version of a bug.
#
# Appended rather than prepended: the system's own tools win, and this only
# adds places to look afterwards. sips, osascript and the finder all live in
# /usr/bin and are found either way.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin"
export PATH

echo "--- $(date) ---" >>"$log"
"$res/node" "$res/app/bin/keeper.mjs" app >>"$log" 2>&1 &

# The server writes this file the moment it has a port, just before it opens
# the browser, so its arrival is the readiness signal. Polling for a file
# needs nothing installed, which curl and python cannot promise on a mac
# without developer tools.
run="$HOME/Library/Application Support/keeper/run.json"
for _ in $(seq 1 200); do
  [ -f "$run" ] && break
  sleep 0.1
done

exit 0
