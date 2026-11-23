#!/usr/bin/env bash
# Mint a dedicated GitHub OAuth token for the Orka PR shepherd with GitHub's device flow.
# Uses GitHub CLI's public OAuth client (device flow needs no client secret), so no gh
# config or macOS keychain entry is touched. Secrets (device_code, token) only go to
# files under the private state dir; stdout carries only non-secret status lines.
#
#   mint-token.sh start <state-dir>   request a user code (prints USER_CODE / VERIFY_URL)
#   mint-token.sh poll  <state-dir>   wait for approval, verify the account, write <state-dir>/token
set -euo pipefail
umask 077
mode="${1:?mode}"; dir="${2:?state dir}"
CID=178c6fc778ccc68e1d6a
SCOPE="repo read:org workflow"
EXPECTED_LOGIN=Jont828

case "$mode" in
start)
  resp=$(curl -fsS -X POST -H 'Accept: application/json' \
    --data-urlencode "client_id=$CID" --data-urlencode "scope=$SCOPE" \
    https://github.com/login/device/code)
  jq -r '.device_code' <<<"$resp" > "$dir/device_code"
  jq -r '.interval // 5' <<<"$resp" > "$dir/interval"
  echo $(( $(date +%s) + $(jq -r '.expires_in // 900' <<<"$resp") )) > "$dir/deadline"
  echo "USER_CODE=$(jq -r '.user_code' <<<"$resp")"
  echo "VERIFY_URL=$(jq -r '.verification_uri' <<<"$resp")"
  echo "EXPIRES_IN=$(jq -r '.expires_in' <<<"$resp")s"
  ;;
poll)
  dc=$(cat "$dir/device_code"); interval=$(cat "$dir/interval"); deadline=$(cat "$dir/deadline")
  tok=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep "$interval"
    r=$(curl -sS -X POST -H 'Accept: application/json' \
      --data-urlencode "client_id=$CID" --data-urlencode "device_code=$dc" \
      --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:device_code' \
      https://github.com/login/oauth/access_token) || continue
    err=$(jq -r '.error // empty' <<<"$r")
    case "$err" in
      authorization_pending) ;;
      slow_down) interval=$(( interval + 5 )) ;;
      "") tok=$(jq -r '.access_token // empty' <<<"$r"); break ;;
      *) echo "DEVICE_FLOW_ERROR=$err"; rm -f "$dir/device_code"; exit 2 ;;
    esac
  done
  rm -f "$dir/device_code"
  [ -n "$tok" ] || { echo "DEVICE_FLOW_TIMEOUT"; exit 3; }
  hdrs=$(curl -sS -D - -o "$dir/user.json" -H "Authorization: token $tok" https://api.github.com/user | tr -d '\r')
  login=$(jq -r '.login // empty' "$dir/user.json"); rm -f "$dir/user.json"
  if [ "$login" != "$EXPECTED_LOGIN" ]; then
    # Wrong account: revoke the fresh token instead of leaving it live.
    jq -n --arg t "$tok" '{credentials: [$t]}' | curl -sS -o /dev/null -X POST \
      -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
      --data @- https://api.github.com/credentials/revoke || true
    echo "WRONG_ACCOUNT=${login:-unknown} (token revoked, nothing stored)"; exit 4
  fi
  printf %s "$tok" > "$dir/token"
  scopes=$(awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}' <<<"$hdrs")
  client=$(awk -F': ' 'tolower($1)=="x-oauth-client-id"{print $2}' <<<"$hdrs")
  echo "AUTHORIZED login=$login scopes=[$scopes] client=$client prefix=${tok:0:4} len=${#tok}"
  ;;
*) echo "unknown mode $mode" >&2; exit 64 ;;
esac
