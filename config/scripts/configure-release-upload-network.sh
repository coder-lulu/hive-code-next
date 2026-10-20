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
if ! qdisc="$(tc qdisc show dev "$interface")"; then
  printf 'Unable to read sender qdiscs. Observed qdiscs:\n%s\n' "$qdisc" >&2
  exit 1
fi
root_count=0
root_type=''
root_line=''
while IFS= read -r line; do
  if [[ "$line" =~ ^qdisc[[:space:]]+([^[:space:]]+)[[:space:]]+[^[:space:]]+[[:space:]]+root([[:space:]]|$) ]]; then
    root_count=$((root_count + 1))
    root_type="${BASH_REMATCH[1]}"
    root_line="$line"
  fi
done <<< "$qdisc"
if [[ "$root_count" != 1 || "$root_type" != fq ]]; then
  printf 'Expected exactly one sender root qdisc of type fq. Observed qdiscs:\n%s\n' "$qdisc" >&2
  exit 1
fi
printf 'Verified sender root: %s\n' "$root_line"
sudo -n sysctl -w net.ipv4.tcp_congestion_control=bbr
if [[ "$(sysctl -n net.ipv4.tcp_congestion_control)" != bbr ]]; then
  echo 'The sender congestion control did not read back as bbr.' >&2
  exit 1
fi
printf 'Release upload sender verified: interface=%s, root qdisc=fq, congestion control=bbr\n' "$interface"
