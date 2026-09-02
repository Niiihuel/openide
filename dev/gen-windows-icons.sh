#!/usr/bin/env bash
#
# Regenerates every Windows brand asset from icons/openide.png.
#
# Why this exists next to icons/build_icons.sh: that script is VSCodium's, it needs seven tools
# (icns2png, png2icns, icotool, rsvg-convert…) and when one is missing its `check_programs` exits
# with status 0 — silently. That is how the tree ended up shipping VSCodium's coral as OpenIDE's
# Windows icon: the app icon, the installer wizard art and the Start tiles were all still theirs,
# and nothing ever said so. This one needs ImageMagick alone and fails loudly.
#
# What it writes (paths are the ones build/win32/code.iss and the AppX manifest read):
#   resources/win32/code.ico            app, shortcuts, installer icon
#   resources/win32/code_70x70.png      Start tile, small
#   resources/win32/code_150x150.png    Start tile, medium
#   resources/win32/inno-big-*.bmp      the installer's left panel, one per DPI
#   resources/win32/inno-small-*.bmp    the installer's header, one per DPI
#   resources/win32/<type>.ico          the file-type icons Explorer shows for .ts, .json, ...
#
# Usage: dev/gen-windows-icons.sh
set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE="icons/openide.png"
TARGET="vscode/resources/win32"

command -v magick >/dev/null || { echo "magick (ImageMagick) is required" >&2; exit 1; }
[[ -f "${SOURCE}" ]] || { echo "missing ${SOURCE}" >&2; exit 1; }

# The app icon: the sizes Windows actually asks for, from the taskbar (16) to the file dialog (256).
#
# The big entries are PNG-compressed and the small ones stay DIB, which is the convention every
# Windows shell has read since Vista — and the difference between a 160KB icon and a 400KB one
# embedded in the executable AND in the installer. ImageMagick alone writes DIB for all nine.
cat > "${TMPDIR:-/tmp}/openide-mkico.py" <<'PYICO'
import struct, sys

out, small_ico, *pngs = sys.argv[1:]

entries = []  # (width, height, bpp, payload)
data = open(small_ico, 'rb').read()
count = struct.unpack_from('<H', data, 4)[0]
for i in range(count):
	width, height, colors, reserved, planes, bpp, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + i * 16)
	entries.append((width, height, bpp, data[offset:offset + size]))
for path in pngs:
	payload = open(path, 'rb').read()
	width, height = struct.unpack('>II', payload[16:24])
	entries.append((width % 256, height % 256, 32, payload))

# Windows reads the directory in order; largest first is what every other icon in the tree does.
entries.sort(key=lambda e: -(e[0] or 256))
header = struct.pack('<HHH', 0, 1, len(entries))
offset = len(header) + len(entries) * 16
directory, payloads = b'', b''
for width, height, bpp, payload in entries:
	directory += struct.pack('<BBBBHHII', width, height, 0, 0, 1, bpp, len(payload), offset)
	offset += len(payload)
	payloads += payload
open(out, 'wb').write(header + directory + payloads)
PYICO

mkico() { # <out.ico> <source.png>  -- the nine sizes Windows asks for, large ones PNG-compressed
	magick "$2" -define icon:auto-resize=64,48,32,24,20,16 "${TMPDIR:-/tmp}/oi-small.ico"
	for size in 256 128 96; do
		magick "$2" -resize "${size}x${size}" "${TMPDIR:-/tmp}/oi-${size}.png"
	done
	python3 "${TMPDIR:-/tmp}/openide-mkico.py" "$1" "${TMPDIR:-/tmp}/oi-small.ico" \
		"${TMPDIR:-/tmp}/oi-256.png" "${TMPDIR:-/tmp}/oi-128.png" "${TMPDIR:-/tmp}/oi-96.png"
}

mkico "${TARGET}/code.ico" "${SOURCE}"
echo "code.ico"

# Start tiles: transparent, the logo inset so Windows' own padding does not clip it.
for size in 70 150; do
	inset=$(( size * 88 / 100 ))
	magick "${SOURCE}" -resize "${inset}x${inset}" \
		-background none -gravity center -extent "${size}x${size}" \
		"${TARGET}/code_${size}x${size}.png"
	echo "code_${size}x${size}.png"
done

# Installer art. Inno Setup takes BMP with no alpha, so the logo is flattened onto the wizard's
# white panel; the dimensions are Inno's per-DPI set and must not change.
render_bmp() { # <file> <width> <height> <logo-fraction-of-width>
	local file="$1" width="$2" height="$3" fraction="$4"
	local logo=$(( width * fraction / 100 ))
	magick -size "${width}x${height}" xc:white \
		\( "${SOURCE}" -resize "${logo}x${logo}" \) -gravity center -composite \
		-alpha off BMP3:"${TARGET}/${file}"
	echo "${file}"
}

for spec in "100 164 314" "125 192 386" "150 246 459" "175 273 556" "200 328 604" "225 355 700" "250 410 797"; do
	read -r dpi width height <<< "${spec}"
	render_bmp "inno-big-${dpi}.bmp" "${width}" "${height}" 62
done

for spec in "100 55 55" "125 64 68" "150 83 80" "175 92 97" "200 110 106" "225 119 123" "250 138 140"; do
	read -r dpi width height <<< "${spec}"
	render_bmp "inno-small-${dpi}.bmp" "${width}" "${height}" 84
done


# The file-type icons: what Explorer draws on a .ts, .json or .py once the installer registers
# OpenIDE for those extensions. They are upstream's document artwork with a product badge dropped
# in the bottom-right corner, and the badge was still VSCodium's coral -- so a fresh install put
# somebody else's logo on every source file on the machine.
#
# Only the badge is regenerated, never the document or the language glyph: those are upstream's and
# there is no reason to redraw them. The badge box is 64x64 at +150+185, which is exactly where
# both upstream's mark and VSCodium's sat -- measured, not guessed, by differencing the two sets.
# The tile is painted opaque in the page's own colour first, so nothing of the old badge can show
# through the logo's transparent corners.
PAGE="#F5F6F7"
BADGE_AT="+150+185"

magick "${SOURCE}" -resize 56x56 -background "${PAGE}" -gravity center -extent 64x64 \
	-alpha remove -alpha off "${TMPDIR:-/tmp}/openide-badge.png"

for file in "${TARGET}"/*.ico; do
	name="$(basename "${file}" .ico)"
	[[ "${name}" == "code" ]] && continue

	# Layer 0 is the 256x256 master every other size is resampled from.
	magick "${file}[0]" -resize 256x256 "${TMPDIR:-/tmp}/oi-type.png"
	magick "${TMPDIR:-/tmp}/oi-type.png" "${TMPDIR:-/tmp}/openide-badge.png" \
		-geometry "${BADGE_AT}" -compose over -composite "${TMPDIR:-/tmp}/oi-typed.png"
	mkico "${file}" "${TMPDIR:-/tmp}/oi-typed.png"
	echo "${name}.ico"
done

echo "done — every Windows asset now comes from ${SOURCE}"
