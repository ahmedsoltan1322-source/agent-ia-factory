#!/usr/bin/env bash
set -euo pipefail

TRANSFER_USER="${1:-browsertransfer}"
WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"

# Reuse the proven Phase 7A UID firewall and private-network boundary.
timeout 30s sudo env GITHUB_WORKSPACE="$WORKSPACE" bash "$WORKSPACE/scripts/setup-browser-sandbox.sh" "$TRANSFER_USER"

TRANSFER_UID="$(awk -F: -v name="$TRANSFER_USER" '$1 == name { print $3; exit }' /etc/passwd)"
TRANSFER_GID="$(awk -F: -v name="$TRANSFER_USER" '$1 == name { print $4; exit }' /etc/passwd)"
if [[ -z "$TRANSFER_UID" || -z "$TRANSFER_GID" ]]; then
  echo 'browser-transfer-sandbox: isolated UID/GID missing' >&2
  exit 1
fi

chmod o+r "$WORKSPACE/scripts/run-browser-file-transfer.mjs"
mkdir -p "$WORKSPACE/browser-transfer-artifacts"
chown -R "$TRANSFER_UID:$TRANSFER_GID" "$WORKSPACE/browser-transfer-artifacts"
chmod 700 "$WORKSPACE/browser-transfer-artifacts"

if [[ ! -f "$WORKSPACE/browser-file-transfer.json" ]]; then
  echo 'browser-transfer-sandbox: approved transfer plan file missing' >&2
  exit 1
fi
chown "$TRANSFER_UID:$TRANSFER_GID" "$WORKSPACE/browser-file-transfer.json"
chmod 600 "$WORKSPACE/browser-file-transfer.json"

setpriv --reuid="$TRANSFER_UID" --regid="$TRANSFER_GID" --clear-groups /usr/bin/test -r "$WORKSPACE/scripts/run-browser-file-transfer.mjs"
setpriv --reuid="$TRANSFER_UID" --regid="$TRANSFER_GID" --clear-groups /usr/bin/test -r "$WORKSPACE/browser-file-transfer.json"
setpriv --reuid="$TRANSFER_UID" --regid="$TRANSFER_GID" --clear-groups /usr/bin/test -w "$WORKSPACE/browser-transfer-artifacts"

cat <<EOF
Browser file-transfer sandbox ready
user=$TRANSFER_USER
uid=$TRANSFER_UID
gid=$TRANSFER_GID
network_boundary=reused-phase7a-uid-firewall
ipv4_egress=public-tcp443-plus-configured-dns-only
ipv6_egress=blocked
plan_mode=600
artifact_dir_mode=700
EOF
