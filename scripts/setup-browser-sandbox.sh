#!/usr/bin/env bash
set -euo pipefail

BROWSER_USER="${1:-browserjob}"
WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"

if ! id "$BROWSER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$BROWSER_USER"
fi

BROWSER_UID="$(id -u "$BROWSER_USER")"
BROWSER_HOME="$(getent passwd "$BROWSER_USER" | cut -d: -f6)"

echo 'browser-sandbox: preparing filesystem'
# Grant traversal only to parent directories. npm installs with a normal 022
# umask, so playwright-core files are already world-readable; never recurse over
# node_modules here because the security setup itself must stay fast and bounded.
cursor="$WORKSPACE"
while [ "$cursor" != "/" ]; do
  chmod o+x "$cursor" 2>/dev/null || true
  cursor="$(dirname "$cursor")"
done
chmod o+rx "$WORKSPACE/scripts" "$WORKSPACE/node_modules" "$WORKSPACE/node_modules/playwright-core"
chmod o+r "$WORKSPACE/scripts/run-browser-job.mjs" "$WORKSPACE/node_modules/playwright-core/package.json"

mkdir -p "$WORKSPACE/browser-artifacts"
chown -R "$BROWSER_USER:$BROWSER_USER" "$WORKSPACE/browser-artifacts"
chmod 700 "$WORKSPACE/browser-artifacts"
if [ -f "$WORKSPACE/browser-job.json" ]; then
  chown "$BROWSER_USER:$BROWSER_USER" "$WORKSPACE/browser-job.json"
  chmod 600 "$WORKSPACE/browser-job.json"
fi

# Fail closed if the isolated UID cannot actually read its exact runtime inputs.
sudo -u "$BROWSER_USER" test -r "$WORKSPACE/scripts/run-browser-job.mjs"
sudo -u "$BROWSER_USER" test -r "$WORKSPACE/node_modules/playwright-core/package.json"
if [ -f "$WORKSPACE/browser-job.json" ]; then
  sudo -u "$BROWSER_USER" test -r "$WORKSPACE/browser-job.json"
fi

echo 'browser-sandbox: installing IPv4 firewall'
IPT_CHAIN="AGENTIA_BROWSER_${BROWSER_UID}"
IP6_CHAIN="AGENTIA_BROWSER6_${BROWSER_UID}"

ipt() { iptables -w 2 "$@"; }
ip6t() { ip6tables -w 2 "$@"; }

if ! ipt -N "$IPT_CHAIN" 2>/dev/null; then
  ipt -F "$IPT_CHAIN"
fi
# A fresh hosted runner should have no old jump. Keep cleanup bounded anyway.
for _ in 1 2 3 4; do
  if ipt -C OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IPT_CHAIN" 2>/dev/null; then
    ipt -D OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IPT_CHAIN"
  else
    break
  fi
done
if ipt -C OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IPT_CHAIN" 2>/dev/null; then
  echo 'browser-sandbox: stale IPv4 jump could not be removed' >&2
  exit 1
fi
ipt -I OUTPUT 1 -m owner --uid-owner "$BROWSER_UID" -j "$IPT_CHAIN"

# Permit DNS only to resolvers explicitly configured by the runner. This must be
# inserted before loopback/private blocks because systemd-resolved may use 127.0.0.53.
mapfile -t DNS4 < <(awk '/^nameserver[[:space:]]+/ { print $2 }' /etc/resolv.conf | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)
for resolver in "${DNS4[@]}"; do
  ipt -A "$IPT_CHAIN" -d "$resolver" -p udp --dport 53 -j ACCEPT
  ipt -A "$IPT_CHAIN" -d "$resolver" -p tcp --dport 53 -j ACCEPT
done

# Azure platform virtual IP can provide DNS on hosted runners. DNS only.
ipt -A "$IPT_CHAIN" -d 168.63.129.16 -p udp --dport 53 -j ACCEPT
ipt -A "$IPT_CHAIN" -d 168.63.129.16 -p tcp --dport 53 -j ACCEPT
ipt -A "$IPT_CHAIN" -d 168.63.129.16 -j REJECT

# Browser egress is HTTPS-only at the kernel boundary. DNS rules above are the
# only exception. Blocking other UDP also closes QUIC/WebRTC/WebTransport paths.
ipt -A "$IPT_CHAIN" -p udp -j REJECT
ipt -A "$IPT_CHAIN" -p tcp ! --dport 443 -j REJECT

for CIDR in \
  0.0.0.0/8 \
  10.0.0.0/8 \
  100.64.0.0/10 \
  127.0.0.0/8 \
  169.254.0.0/16 \
  172.16.0.0/12 \
  192.0.0.0/24 \
  192.168.0.0/16 \
  198.18.0.0/15 \
  192.0.2.0/24 \
  198.51.100.0/24 \
  203.0.113.0/24 \
  224.0.0.0/4; do
  ipt -A "$IPT_CHAIN" -d "$CIDR" -j REJECT
done
ipt -A "$IPT_CHAIN" -j RETURN

echo 'browser-sandbox: installing IPv6 deny rule'
# Phase 7A deliberately disables all IPv6 egress for the isolated browser UID.
if command -v ip6tables >/dev/null 2>&1; then
  if ! ip6t -N "$IP6_CHAIN" 2>/dev/null; then
    ip6t -F "$IP6_CHAIN"
  fi
  for _ in 1 2 3 4; do
    if ip6t -C OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IP6_CHAIN" 2>/dev/null; then
      ip6t -D OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IP6_CHAIN"
    else
      break
    fi
  done
  if ip6t -C OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IP6_CHAIN" 2>/dev/null; then
    echo 'browser-sandbox: stale IPv6 jump could not be removed' >&2
    exit 1
  fi
  ip6t -I OUTPUT 1 -m owner --uid-owner "$BROWSER_UID" -j "$IP6_CHAIN"
  ip6t -A "$IP6_CHAIN" -j REJECT
else
  echo 'browser-sandbox: ip6tables unavailable; fail closed' >&2
  exit 1
fi

cat <<EOF
Browser sandbox installed
user=$BROWSER_USER
uid=$BROWSER_UID
home=$BROWSER_HOME
filesystem_scope=executor-plus-playwright-core-only
approved_plan_mode=600
artifact_dir_mode=700
xtables_lock_wait_seconds=2
ipv4_private_ranges=blocked
ipv4_egress=tcp443-plus-configured-dns-only
ipv6_egress=blocked
EOF
