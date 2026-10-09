# Sourced by the hooks. Git runs them in a non-interactive shell, whose PATH may carry an older
# Node than .nvmrc, and pnpm then refuses to start or runs tools under the wrong version.
# Homebrew's nvm keeps nvm.sh outside NVM_DIR. nvm.sh finds its own directory through
# BASH_SOURCE, which sh does not have, so it must be told under this shell.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
for NVM_SH in "$NVM_DIR/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh /usr/local/opt/nvm/nvm.sh; do
  if [ -s "$NVM_SH" ]; then
    . "$NVM_SH"
    nvm use --silent >/dev/null
    break
  fi
done

# package.json's engines floor: 22.18 is the first Node that runs the hooks' TypeScript unflagged.
floor_major=22
floor_minor=18
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
minor=$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)
if [ "$major" -lt "$floor_major" ] || { [ "$major" -eq "$floor_major" ] && [ "$minor" -lt "$floor_minor" ]; }; then
  echo "hooks: Node >= $floor_major.$floor_minor is needed (package.json engines), found $(node -v 2>/dev/null || echo none) (load your Node version manager in the shell git runs from, or install nvm)" >&2
  exit 1
fi
