#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || "$(uname -s)" != Linux ]]; then
  echo 'Release upload network configuration requires a GitHub-hosted Linux runner.' >&2
  exit 1
fi

# These settings affect only this disposable sender, never a persistent host configuration.
if ! sudo -n modprobe tcp_bbr; then
  echo 'tcp_bbr module load failed; checking whether BBR is already available.' >&2
fi
available="$(sysctl -n net.ipv4.tcp_available_congestion_control)"
if [[ " $available " != *' bbr '* ]]; then
  echo 'BBR is not available on this runner.' >&2
  exit 1
fi

routes="$(ip -4 route show default)"
if [[ -z "$routes" || "$routes" == *$'\n'* || ! "$routes" =~ [[:space:]]dev[[:space:]]([a-zA-Z0-9_.-]+)([[:space:]]|$) ]]; then
  echo 'Expected one IPv4 default route with a valid interface.' >&2
  exit 1
fi
interface="${BASH_REMATCH[1]}"
sudo -n modprobe sch_fq
sudo -n tc qdisc replace dev "$interface" root fq
qdisc="$(tc qdisc show dev "$interface")"
if [[ ! "$qdisc" =~ ^qdisc[[:space:]]fq[[:space:]][^[:space:]]+[[:space:]]root([[:space:]]|$) || "$qdisc" == *$'\n'* ]]; then
  echo 'The sender root qdisc did not read back as fq.' >&2
  exit 1
fi
sudo -n sysctl -w net.ipv4.tcp_congestion_control=bbr
if [[ "$(sysctl -n net.ipv4.tcp_congestion_control)" != bbr ]]; then
  echo 'The sender congestion control did not read back as bbr.' >&2
  exit 1
fi
printf 'Release upload sender verified: interface=%s, root qdisc=fq, congestion control=bbr\n' "$interface"
