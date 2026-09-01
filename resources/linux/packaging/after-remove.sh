#!/bin/bash
# Package-manager hooks must remain LF-only so dpkg can execute their shebangs.
# Why: remove only the HiveCode-owned PATH symlinks created by after-install.sh.
# Never delete a regular file, bare /usr/bin/orca, or another package's symlink.
set -e

# Debian runs the old package's postrm with "upgrade" after unpacking a new
# version. RPM passes 1 while another package version remains installed. Neither
# transition is an uninstall: keep operator-managed enablement and live service
# state intact so upgrades do not silently lose boot persistence.
case "${1:-}" in
  upgrade|failed-upgrade|abort-upgrade|1)
    exit 0
    ;;
esac

for link in /usr/bin/hive /usr/bin/hivecode /usr/bin/orca-ide; do
  if [ -L "$link" ]; then
    target="$(readlink "$link" || true)"
    case "$target" in
      /opt/HiveCode/resources/bin/hive|/opt/HiveCode/resources/bin/hivecode|/opt/HiveCode/resources/bin/orca-ide|\
      /opt/hivecode/resources/bin/hive|/opt/hivecode/resources/bin/hivecode|/opt/hivecode/resources/bin/orca-ide|\
      /opt/Orca/resources/bin/hive|/opt/Orca/resources/bin/hivecode|/opt/Orca/resources/bin/orca-ide|\
      /opt/orca-ide/resources/bin/hive|/opt/orca-ide/resources/bin/hivecode|/opt/orca-ide/resources/bin/orca-ide|\
      /opt/orca/resources/bin/hive|/opt/orca/resources/bin/hivecode|/opt/orca/resources/bin/orca-ide)
        rm -f "$link"
        ;;
    esac
  fi
done

if [ -f /usr/lib/systemd/system/hivecode-runtime.service ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now hivecode-runtime.service >/dev/null 2>&1 || true
  fi
  rm -f /usr/lib/systemd/system/hivecode-runtime.service
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
  fi
fi

# Runtime state, the service account, and operator-owned /etc/hivecode/runtime.env
# are deliberately preserved for reinstall or rollback.

exit 0
