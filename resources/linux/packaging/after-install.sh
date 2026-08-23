#!/bin/bash
# Package-manager hooks must remain LF-only so dpkg can execute their shebangs.
# Why: register HiveCode and the safe `orca-ide` compatibility command at
# package-install time. Never claim bare `orca`, which belongs to GNOME Orca.
# The in-app "Install CLI" action (CliInstaller) can never run on a headless
# server, so without these symlinks `hivecode serve` is unreachable from the shell on
# the exact hosts that need it most. deb/rpm both run this after unpacking.
#
# The shim resolves the real app by walking up from its own location, so a
# symlink works. We discover the install dir instead of hardcoding /opt/HiveCode
# because electron-builder's directory name can vary by productName sanitization.
set -e

is_managed_target() {
  case "$1" in
    /opt/HiveCode/resources/bin/hivecode|/opt/HiveCode/resources/bin/orca-ide|\
    /opt/hivecode/resources/bin/hivecode|/opt/hivecode/resources/bin/orca-ide|\
    /opt/Orca/resources/bin/hivecode|/opt/Orca/resources/bin/orca-ide|\
    /opt/orca-ide/resources/bin/hivecode|/opt/orca-ide/resources/bin/orca-ide|\
    /opt/orca/resources/bin/hivecode|/opt/orca/resources/bin/orca-ide)
      return 0
      ;;
  esac
  return 1
}

install_link() {
  name="$1"
  shim="$2"
  link="/usr/bin/$name"
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    ln -s "$shim" "$link"
    return
  fi
  if [ -L "$link" ]; then
    target="$(readlink "$link" || true)"
    if is_managed_target "$target"; then
      ln -sfn "$shim" "$link"
    fi
  fi
}

for dir in /opt/HiveCode /opt/hivecode /opt/Orca /opt/orca-ide /opt/orca; do
  sandbox="$dir/chrome-sandbox"
  if [ -f "$sandbox" ]; then
    # Why: packaged Linux installs must leave Chromium's sandbox helper usable
    # on hosts where unprivileged user namespaces are unavailable.
    chmod 4755 "$sandbox" || true
  fi

  hivecode_shim="$dir/resources/bin/hivecode"
  orca_ide_shim="$dir/resources/bin/orca-ide"
  if [ -x "$hivecode_shim" ] && [ -x "$orca_ide_shim" ]; then
    install_link hivecode "$hivecode_shim"
    install_link orca-ide "$orca_ide_shim"
    runtime_unit="$dir/resources/systemd/hivecode-runtime.service"
    runtime_env_example="$dir/resources/systemd/runtime.env.example"
    if [ -f "$runtime_unit" ]; then
      if ! getent group hivecode-runtime >/dev/null 2>&1; then
        groupadd --system hivecode-runtime
      fi
      if ! getent passwd hivecode-runtime >/dev/null 2>&1; then
        useradd --system --gid hivecode-runtime --home-dir /var/lib/hivecode-runtime \
          --create-home --shell /usr/sbin/nologin hivecode-runtime
      fi
      install -d -m 755 /usr/lib/systemd/system /etc/hivecode
      install -m 644 "$runtime_unit" /usr/lib/systemd/system/hivecode-runtime.service
      if [ -f "$runtime_env_example" ] && [ ! -e /etc/hivecode/runtime.env.example ]; then
        install -m 644 "$runtime_env_example" /etc/hivecode/runtime.env.example
      fi
      if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload || true
      fi
    fi
    break
  fi
done

exit 0
