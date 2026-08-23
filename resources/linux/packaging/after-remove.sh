#!/bin/bash
# Why: remove only the HiveCode-owned PATH symlinks created by after-install.sh.
# Never delete a regular file, bare /usr/bin/orca, or another package's symlink.
set -e

for link in /usr/bin/hivecode /usr/bin/orca-ide; do
  if [ -L "$link" ]; then
    target="$(readlink "$link" || true)"
    case "$target" in
      /opt/HiveCode/resources/bin/hivecode|/opt/HiveCode/resources/bin/orca-ide|\
      /opt/hivecode/resources/bin/hivecode|/opt/hivecode/resources/bin/orca-ide|\
      /opt/Orca/resources/bin/hivecode|/opt/Orca/resources/bin/orca-ide|\
      /opt/orca-ide/resources/bin/hivecode|/opt/orca-ide/resources/bin/orca-ide|\
      /opt/orca/resources/bin/hivecode|/opt/orca/resources/bin/orca-ide)
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
