#!/bin/zsh
# Double-click this in Finder to set up OnTask on this Mac. It's safe to run
# again any time (for example after moving the OnTask folder).
#
# It installs the companion and the phone app, downloads the local screen
# model, and lets Chrome start the companion by itself from then on.

cd "$(dirname "$0")" || exit 1

# Pick up Node and Ollama wherever your shell normally finds them.
[ -f ~/.zprofile ] && source ~/.zprofile >/dev/null 2>&1
[ -f ~/.zshrc ] && source ~/.zshrc >/dev/null 2>&1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"

MODEL="qwen3-vl:4b"
step() { print -P "\n%B$1%b"; }
finish() {
  print ""
  [ -t 0 ] && read -k 1 -s "?Press any key to close this window."
  exit "${1:-0}"
}

step "Setting up OnTask"

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  print "Node.js isn't installed. Opening the download page: install it, then double-click this file again."
  open "https://nodejs.org/en/download"
  finish 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  print "Node.js $(node -v) is too old; OnTask needs version 22 or newer. Opening the download page."
  open "https://nodejs.org/en/download"
  finish 1
fi
print "Node.js $(node -v) ✓"

# 2. Ollama and the screen model (optional: OnTask works without them, just
#    without screen watching).
if command -v ollama >/dev/null 2>&1; then
  if ! ollama list >/dev/null 2>&1; then
    if [ -d /Applications/Ollama.app ]; then open -a Ollama; else (ollama serve >/dev/null 2>&1 &); fi
    for i in {1..20}; do ollama list >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  if ollama list 2>/dev/null | grep -q "^$MODEL"; then
    print "Screen model $MODEL ✓"
  else
    step "Downloading the screen model ($MODEL, about 3.3 GB). This takes a few minutes."
    ollama pull "$MODEL" || print "Couldn't download it right now. OnTask still works; run this again later for screen watching."
  fi
else
  print "Ollama isn't installed, so screen watching will be off. Opening its download page; install it and run this again to turn it on."
  open "https://ollama.com/download"
fi

# 3. The companion and the phone app.
step "Installing the companion"
(cd companion && npm install --no-fund --no-audit --loglevel=error) || { print "Installing the companion failed (see above)."; finish 1; }

step "Installing the phone app"
(cd mobile && npm install --no-fund --no-audit --loglevel=error) || print "Installing the phone app failed (see above). The extension still works."

# 4. Let Chrome start the companion.
step "Connecting to Chrome"
node companion/scripts/setup.js || { print "Couldn't register with Chrome (see above)."; finish 1; }

step "All set."
print "Click the OnTask icon in Chrome. If you just loaded it for the first time, add it from chrome://extensions → Load unpacked → the 'extension' folder."
finish 0
