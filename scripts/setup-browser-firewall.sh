#!/usr/bin/env bash
set -euo pipefail

BROWSER_USER="${1:-browserjob}"
CHAIN4="AIF_BROWSER4"
CHAIN6="AIF_BROWSER6"

if ! id "$BROWSER_USER" >/dev/null 2>&1; then
  sudo useradd --system --create-home --shell /bin/bash "$BROWSER_USER"
fi

BROWSER_UID="$(id -u "$BROWSER_USER")"

sudo iptables -N "$CHAIN4" 2>/dev/null || sudo iptables -F "$CHAIN4"
sudo ip6tables -N "$CHAIN6" 2>/dev/null || sudo ip6tables -F "$CHAIN6"

if ! sudo iptables -C OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$CHAIN4" 2>/dev/null; then
  sudo iptables -I OUTPUT 1 -m owner --uid-owner "$BROWSER_UID" -j "$CHAIN4"
fi
if ! sudo ip6tables -C OUTPUT -m owner --uid-owner "$BROWSER_UID" -j "$CHAIN6" 2>/dev/null; then
  sudo ip6tables -I OUTPUT 1 -m owner --uid-owner "$BROWSER_UID" -j "$CHAIN6"
fi

# Permit only DNS traffic to resolvers configured by the runner. This allows
# system/local DNS such as 127.0.0.53 without allowing ordinary web access to
# private addresses. DNS answers are independently validated in the Node runner.
while read -r resolver; do
  [ -n "$resolver" ] || continue
  if [[ "$resolver" == *:* ]]; then
    sudo ip6tables -A "$CHAIN6" -d "$resolver" -p udp --dport 53 -j ACCEPT
    sudo ip6tables -A "$CHAIN6" -d "$resolver" -p tcp --dport 53 -j ACCEPT
  elif [[ "$resolver" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    sudo iptables -A "$CHAIN4" -d "$resolver" -p udp --dport 53 -j ACCEPT
    sudo iptables -A "$CHAIN4" -d "$resolver" -p tcp --dport 53 -j ACCEPT
  fi
done < <(awk '/^[[:space:]]*nameserver[[:space:]]+/ {print $2}' /etc/resolv.conf | sort -u)

# Azure platform virtual IP may be a resolver on hosted runners. DNS is allowed
# above only if configured; all other traffic to the platform IP is denied.
sudo iptables -A "$CHAIN4" -d 168.63.129.16 -j REJECT

for cidr in \
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
  sudo iptables -A "$CHAIN4" -d "$cidr" -j REJECT
done

for cidr in \
  ::1/128 \
  fc00::/7 \
  fe80::/10 \
  2001:db8::/32; do
  sudo ip6tables -A "$CHAIN6" -d "$cidr" -j REJECT
done

# Public internet traffic that survives the deny list is permitted. HTTP-level
# policy still restricts Browser requests to HTTPS GET/HEAD/OPTIONS and same-site
# top-level navigation.
sudo iptables -A "$CHAIN4" -j RETURN
sudo ip6tables -A "$CHAIN6" -j RETURN

echo "BROWSER_UID=$BROWSER_UID"
echo "Browser firewall chains installed: $CHAIN4 / $CHAIN6"
