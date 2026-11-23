#!/usr/bin/env bash
# Runs inside the Orka container Task. Installs pinned tools into /tmp (the only
# writable path), prepares a signed-commit clone of Jont828/dynamo, then runs
# Copilot CLI headless with $SHEPHERD_PROMPT. Only the agent's reply is streamed
# to stdout, which Orka stores as the Task result.
set -euo pipefail

export HOME=/tmp/home TZ="${TZ:-America/New_York}"
export UV_CACHE_DIR=/tmp/uv-cache UV_PYTHON_INSTALL_DIR=/tmp/uv-python
export npm_config_prefix=/tmp/npm npm_config_cache=/tmp/npm-cache
export PRE_COMMIT_HOME=/tmp/pre-commit-cache XDG_CACHE_HOME=/tmp/cache XDG_CONFIG_HOME=/tmp/home/.config
export PATH=/tmp/py/bin:/tmp/tools/bin:/tmp/npm/bin:$PATH
export GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0
mkdir -p "$HOME/.ssh" /tmp/tools/bin /tmp/work

GH_VERSION=2.103.3
GH_SHA256=4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d
UV_VERSION=0.13.7
UV_SHA256=c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83
COPILOT_VERSION=1.0.105

LOG=/tmp/bootstrap.log
step() { printf '[bootstrap %s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
fail() {
  step "FAILED: $*"
  tail -n 40 "$LOG" >&2 || true
  exit 1
}

: "${GH_TOKEN:?GH_TOKEN is not set}"
: "${SSH_SIGNING_KEY:?SSH_SIGNING_KEY is not set}"
: "${SHEPHERD_PROMPT:?SHEPHERD_PROMPT is not set}"
: "${SHEPHERD_WATCH_JS:?SHEPHERD_WATCH_JS is not set}"

# PR watch gate (watch.mjs): pick a regular run, a run scoped to new merge conflicts and
# CI failures, or nothing. It needs only Node, so a slot with nothing new ends here in
# seconds, before any tool install or clone.
mkdir -p /tmp/watch
printf '%s\n' "$SHEPHERD_WATCH_JS" > /tmp/watch/watch.mjs
unset SHEPHERD_WATCH_JS
SHEPHERD_OUT_DIR=/tmp/watch node /tmp/watch/watch.mjs || fail "PR watch gate"
case "$(cat /tmp/watch/mode)" in
  none) exit 0 ;;
  full) ;;
  watch) SHEPHERD_PROMPT="$(cat /tmp/watch/trigger.md)"$'\n\n'"$SHEPHERD_PROMPT" ;;
  *) fail "PR watch gate wrote an unknown mode" ;;
esac
export COPILOT_GITHUB_TOKEN="$GH_TOKEN"

umask 077
printf '%s\n' "$SSH_SIGNING_KEY" > "$HOME/.ssh/signing_key"
unset SSH_SIGNING_KEY
ssh-keygen -y -f "$HOME/.ssh/signing_key" > "$HOME/.ssh/signing_key.pub" 2>>"$LOG" || fail "invalid SSH signing key"
umask 022

step "installing gh $GH_VERSION, uv $UV_VERSION, copilot $COPILOT_VERSION"
{
  curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz"
  echo "$GH_SHA256  /tmp/gh.tgz" | sha256sum -c -
  tar -xzf /tmp/gh.tgz -C /tmp/tools --strip-components=1
  curl -fsSL -o /tmp/uv.tgz "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz"
  echo "$UV_SHA256  /tmp/uv.tgz" | sha256sum -c -
  tar -xzf /tmp/uv.tgz -C /tmp/tools/bin --strip-components=1
  rm -f /tmp/gh.tgz /tmp/uv.tgz
  uv venv --seed --python 3.12 /tmp/py
  uv pip install --python /tmp/py/bin/python pre-commit pytest pyyaml
  npm install -g --no-fund --no-audit --loglevel=error "@github/copilot@${COPILOT_VERSION}"
} >>"$LOG" 2>&1 || fail "tool installation"

login="$(gh api user --jq .login 2>>"$LOG")" || fail "GitHub token rejected"
[ "$login" = "Jont828" ] || fail "token belongs to '$login', expected Jont828"

step "configuring git and cloning Jont828/dynamo"
{
  git config --global user.name "Jonathan Tong"
  git config --global user.email "jt572@cornell.edu"
  git config --global gpg.format ssh
  git config --global user.signingkey "$HOME/.ssh/signing_key"
  git config --global commit.gpgsign true
  printf 'jt572@cornell.edu %s\n' "$(cat "$HOME/.ssh/signing_key.pub")" > "$HOME/.ssh/allowed_signers"
  git config --global gpg.ssh.allowedSignersFile "$HOME/.ssh/allowed_signers"
  git config --global init.defaultBranch main
  git config --global fetch.prune true
  gh auth setup-git --hostname github.com
  git clone --filter=blob:none --no-tags https://github.com/Jont828/dynamo.git /tmp/work/dynamo
  cd /tmp/work/dynamo
  git remote add upstream https://github.com/ai-dynamo/dynamo.git
  git config remote.upstream.promisor true
  git config remote.upstream.partialclonefilter blob:none
  git config remote.upstream.tagOpt --no-tags
  git fetch upstream main
} >>"$LOG" 2>&1 || fail "git setup"

cd /tmp/work/dynamo
step "running Copilot CLI (${SHEPHERD_MODEL:-default model}, effort ${SHEPHERD_EFFORT:-default}); report follows"
printf '\n===== PR SHEPHERD REPORT =====\n'
set +e
copilot -p "$SHEPHERD_PROMPT" \
  ${SHEPHERD_MODEL:+--model "$SHEPHERD_MODEL"} \
  ${SHEPHERD_EFFORT:+--reasoning-effort "$SHEPHERD_EFFORT"} \
  --allow-all --no-ask-user --no-color -s 2>/tmp/copilot.err
rc=$?
set -e
printf '\n===== END REPORT =====\n'
if [ "$rc" -ne 0 ]; then
  step "copilot exited with $rc"
  tail -n 40 /tmp/copilot.err >&2 || true
fi
exit "$rc"
