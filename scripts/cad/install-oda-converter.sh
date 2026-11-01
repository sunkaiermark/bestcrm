#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
command -v curl >/dev/null
command -v sha256sum >/dev/null
exec 8>/run/lock/bestcrm-release-guard.lock
flock -n 8
test ! -e /run/bestcrm/write-maintenance
systemctl is-active --quiet bestcrm
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
base=/opt/bestcrm-cad
version="$base/oda-27.9-f2a8e125e84e"
expected=f2a8e125e84eee32d88c6d06d957c05b71c3b53b44304b1c479e466b2b0929ff
url='https://www.opendesign.com/guestfiles/get?filename=ODAFileConverter_QT6_lnxX64_11dll_27.9.AppImage'
test ! -L "$base"
install -d -o root -g root -m 755 "$base"
test "$(readlink -f "$base")" = "$base"
if test -e "$version"; then
  test ! -L "$version" && test -d "$version"
  test "$(readlink -f "$version")" = "$version"
  test -f "$version/SHA256SUMS"
  (cd "$version" && sha256sum --quiet -c SHA256SUMS)
  test -x "$version/convert" && test -x "$version/payload/AppRun"
  echo "CONVERTER_ALREADY_INSTALLED=$version/convert"
  exit 0
fi
stage=$(mktemp -d "$base/.stage-XXXXXXXX")
cleanup() {
  if test -n "${stage:-}" && test -d "$stage"; then
    test "$(dirname "$stage")" = "$base"
    case "$(basename "$stage")" in .stage-*) rm -rf -- "$stage";; *) return 1;; esac
  fi
}
trap cleanup EXIT
if test "$#" = 1; then
  test -f "$1" && test ! -L "$1"
  cp -- "$1" "$stage/ODAFileConverter.AppImage"
elif test "$#" = 0; then
  curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 600 --retry 2 --output "$stage/ODAFileConverter.AppImage" "$url"
else
  echo 'Usage: install-oda-converter.sh [verified-offline-AppImage]' >&2
  exit 1
fi
printf '%s  %s\n' "$expected" "$stage/ODAFileConverter.AppImage" | sha256sum -c -
test "$(od -An -tx1 -N4 "$stage/ODAFileConverter.AppImage" | tr -d ' \n')" = 7f454c46
chmod 755 "$stage/ODAFileConverter.AppImage"
if ! (cd "$stage" && timeout 90 ./ODAFileConverter.AppImage --appimage-extract > extract.log 2>&1); then
  tail -n 40 "$stage/extract.log" >&2
  exit 1
fi
test -d "$stage/squashfs-root" && test ! -L "$stage/squashfs-root"
mv -- "$stage/squashfs-root" "$stage/payload"
test -x "$stage/payload/AppRun"
install -m 755 "$script_dir/oda-convert.sh" "$stage/convert"
install -d -m 755 "$stage/compat"
if test ! -e /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 && test -f /usr/lib/x86_64-linux-gnu/libxcb-util.so.1; then
  ln -s /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 "$stage/compat/libxcb-util.so.0"
fi
printf 'version=27.9\nsha256=%s\nsource=%s\n' "$expected" "$url" > "$stage/INSTALL_SOURCE.txt"
test "$(dirname "$(readlink -f "$stage")")" = "$base"
chmod -R go-w -- "$stage"
chmod 755 "$stage"
(cd "$stage" && find . -type f ! -path './SHA256SUMS' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
mv -- "$stage" "$version"
stage=''
echo "CONVERTER_INSTALLED=$version/convert"
echo 'BESTCRM configuration and services have not been changed. Run the sample verification next.'
