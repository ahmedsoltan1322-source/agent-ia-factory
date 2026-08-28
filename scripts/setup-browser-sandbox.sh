#!/usr/bin/env bash
set -euo pipefail

BROWSER_USER="${1:-browserjob}"
WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"

if ! id "$BROWSER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$BROWSER_USER"
fi

BROWSER_UID="$(id -u "$BROWSER_USER")"
BROWSER_HOME="$(getent passwd "$BROWSER_USER" | cut -d: -f6)"

# Grant path traversal only to the workspace, then expose only the executor and
# pinned playwright-core runtime. Do not recursively expose the whole checkout.
cursor="$WORKSPACE"
while [ "$cursor" != "/" ]; do
  chmod o+x "$cursor" 2>/dev/null || true
  cursor="$(dirname "$cursor")"
done
chmod o+rx "$WORKSPACE/scripts" "$WORKSPACE/node_modules"
chmod o+r "$WORKSPACE/scripts/run-browser-job.mjs"
chmod -R o+rX "$WORKSPACE/node_modules/playwright-core"

mkdir -p "$WORKSPACE/browser-artifacts"
chown -R "$BROWSER_USER:$BROWSER_USER" "$WORKSPACE/browser-artifacts"
chmod 700 "$WORKSPACE/browser-artifacts"
if [ -f "$WORKSPACE/browser-job.json" ]; then
  chown "$BROWSER_USER:$BROWSER_USER" "$WORKSPACE/browser-job.json"
  chmod 600 "$WORKSPACE/browser-job.json"
fi

IPT_CHAIN="AGENTIA_BROWSER_${BROWSER_UID}"
IP6_CHAIN="AGENTIA_BROWSER6_${BROWSER_UID}"

iptables -N "$IPT_CHAIN" 2>/dev/null || true
iptables -F "$IPT_CHAIN"
while iptables -D OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IPT_CHAIN" 2>/dev/null; do :; done
iptables -I OUTPUT 1 -m owner --uid-owner "$BROWSER_UID" -j "$IPT_CHAIN"

# Permit DNS only to resolvers explicitly configured by the runner. This must be
# inserted before loopback/private blocks because systemd-resolved may use 127.0.0.53.
mapfile -t DNS4 < <(awk '/^nameserver[[:space:]]+/ { print $2 }' /etc/resolv.conf | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)
for resolver in "${DNS4[@]}"; do
  iptables -A "$IPT_CHAIN" -d "$resolver" -p udp --dport 53 -j ACCEPT
  iptables -A "$IPT_CHAIN" -d "$resolver" -p tcp --dport 53 -j ACCEPT
done

# Azure platform virtual IP can provide DNS on hosted runners. DNS only.
iptables -A "$IPT_CHAIN" -d 168.63.129.16 -p udp --dport 53 -j ACCEPT
iptables -A "$IPT_CHAIN" -d 168.63.129.16 -p tcp --dport 53 -j ACCEPT
iptables -A "$IPT_CHAIN" -d 168.63.129.16 -j REJECT

# Browser egress is HTTPS-only at the kernel boundary. DNS rules above are the
# only exception. Blocking other UDP also closes QUIC/WebRTC/WebTransport paths.
iptables -A "$IPT_CHAIN" -p udp -j REJECT
iptables -A "$IPT_CHAIN" -p tcp ! --dport 443 -j REJECT

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
  iptables -A "$IPT_CHAIN" -d "$CIDR" -j REJECT
done
iptables -A "$IPT_CHAIN" -j RETURN

# Phase 7A deliberately disables all IPv6 egress for the isolated browser UID.
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -N "$IP6_CHAIN" 2>/dev/null || true
  ip6tables -F "$IP6_CHAIN"
  while ip6tables -D OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$IP6_CHAIN" 2>/dev/null; do :; done
  ip6tables -I OUTPUT 1 -m owner --uid-owner "$BROWSER_UID" -j "$IP6_CHAIN"
  ip6tables -A "$IP6_CHAIN" -j REJECT
fi

cat <<EOF
Browser sandbox installed
user=$BROWSER_USER
uid=$BROWSER_UID
home=$BROWSER_HOME
filesystem_scope=executor-plus-playwright-core-only
approved_plan_mode=600
artifact_dir_mode=700
ipv4_private_ranges=blocked
ipv4_egress=tcp443-plus-configured-dns-only
ipv6_egress=blocked
EOF
