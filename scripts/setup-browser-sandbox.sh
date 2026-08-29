#!/usr/bin/env bash
set -euo pipefail

BROWSER_USER="${1:-browserjob}"
WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"

if [[ ! "$BROWSER_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo 'browser-sandbox: invalid local user name' >&2
  exit 1
fi

echo 'browser-sandbox: preparing local identity without NSS lookup'
# GitHub hosted runners are ephemeral. Avoid id/getent/useradd here because an
# unknown-name NSS lookup can block on remote identity providers. Maintain a
# job-local passwd/group entry directly and choose an unused high numeric ID.
if awk -F: -v name="$BROWSER_USER" '$1 == name { found=1 } END { exit !found }' /etc/passwd; then
  BROWSER_UID="$(awk -F: -v name="$BROWSER_USER" '$1 == name { print $3; exit }' /etc/passwd)"
  BROWSER_GID="$(awk -F: -v name="$BROWSER_USER" '$1 == name { print $4; exit }' /etc/passwd)"
  BROWSER_HOME="$(awk -F: -v name="$BROWSER_USER" '$1 == name { print $6; exit }' /etc/passwd)"
else
  candidate=61000
  uid_in_use() {
    awk -F: -v value="$1" '$3 == value { found=1 } END { exit !found }' /etc/passwd ||
      awk -F: -v value="$1" '$3 == value { found=1 } END { exit !found }' /etc/group
  }
  while uid_in_use "$candidate"; do
    candidate=$((candidate + 1))
    if [ "$candidate" -gt 61100 ]; then
      echo 'browser-sandbox: no free local UID/GID in reserved range' >&2
      exit 1
    fi
  done
  BROWSER_UID="$candidate"
  BROWSER_GID="$candidate"
  BROWSER_HOME="/home/$BROWSER_USER"
  printf '%s:x:%s:\n' "$BROWSER_USER" "$BROWSER_GID" >> /etc/group
  printf '%s:x:%s:%s:Agent IA isolated browser:%s:/usr/sbin/nologin\n' \
    "$BROWSER_USER" "$BROWSER_UID" "$BROWSER_GID" "$BROWSER_HOME" >> /etc/passwd
fi

mkdir -p "$BROWSER_HOME"
chown "$BROWSER_UID:$BROWSER_GID" "$BROWSER_HOME"
chmod 700 "$BROWSER_HOME"

echo 'browser-sandbox: preparing filesystem'
# Grant traversal only to parent directories. npm installs with a normal 022
# umask, so playwright-core files are already readable; never recurse over
# node_modules here because security setup itself must stay fast and bounded.
cursor="$WORKSPACE"
while [ "$cursor" != "/" ]; do
  chmod o+x "$cursor" 2>/dev/null || true
  cursor="$(dirname "$cursor")"
done
chmod o+rx "$WORKSPACE/scripts" "$WORKSPACE/node_modules" "$WORKSPACE/node_modules/playwright-core"
chmod o+r "$WORKSPACE/scripts/run-browser-job.mjs" "$WORKSPACE/node_modules/playwright-core/package.json"

mkdir -p "$WORKSPACE/browser-artifacts"
chown -R "$BROWSER_UID:$BROWSER_GID" "$WORKSPACE/browser-artifacts"
chmod 700 "$WORKSPACE/browser-artifacts"
if [ -f "$WORKSPACE/browser-job.json" ]; then
  chown "$BROWSER_UID:$BROWSER_GID" "$WORKSPACE/browser-job.json"
  chmod 600 "$WORKSPACE/browser-job.json"
fi

# Fail closed if the isolated numeric identity cannot read exact runtime inputs.
setpriv --reuid="$BROWSER_UID" --regid="$BROWSER_GID" --clear-groups /usr/bin/test -r "$WORKSPACE/scripts/run-browser-job.mjs"
setpriv --reuid="$BROWSER_UID" --regid="$BROWSER_GID" --clear-groups /usr/bin/test -r "$WORKSPACE/node_modules/playwright-core/package.json"
if [ -f "$WORKSPACE/browser-job.json" ]; then
  setpriv --reuid="$BROWSER_UID" --regid="$BROWSER_GID" --clear-groups /usr/bin/test -r "$WORKSPACE/browser-job.json"
fi

echo 'browser-sandbox: installing IPv4 firewall'
IPT_CHAIN="AGENTIA_BROWSER_${BROWSER_UID}"
IP6_CHAIN="AGENTIA_BROWSER6_${BROWSER_UID}"

ipt() { iptables -w 2 "$@"; }
ip6t() { ip6tables -w 2 "$@"; }

if ! ipt -N "$IPT_CHAIN" 2>/dev/null; then
  ipt -F "$IPT_CHAIN"
fi
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

mapfile -t DNS4 < <(awk '/^nameserver[[:space:]]+/ { print $2 }' /etc/resolv.conf | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)
for resolver in "${DNS4[@]}"; do
  ipt -A "$IPT_CHAIN" -d "$resolver" -p udp --dport 53 -j ACCEPT
  ipt -A "$IPT_CHAIN" -d "$resolver" -p tcp --dport 53 -j ACCEPT
done

# Azure platform virtual IP can provide DNS on hosted runners. DNS only.
ipt -A "$IPT_CHAIN" -d 168.63.129.16 -p udp --dport 53 -j ACCEPT
ipt -A "$IPT_CHAIN" -d 168.63.129.16 -p tcp --dport 53 -j ACCEPT
ipt -A "$IPT_CHAIN" -d 168.63.129.16 -j REJECT

# Kernel boundary: configured DNS plus public TCP/443 only. Blocking all other
# UDP also closes QUIC/WebRTC/WebTransport paths.
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
gid=$BROWSER_GID
home=$BROWSER_HOME
identity_source=local-etc-files-no-nss-lookup
filesystem_scope=executor-plus-playwright-core-only
approved_plan_mode=600
artifact_dir_mode=700
xtables_lock_wait_seconds=2
ipv4_private_ranges=blocked
ipv4_egress=tcp443-plus-configured-dns-only
ipv6_egress=blocked
EOF
