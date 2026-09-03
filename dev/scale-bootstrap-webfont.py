#!/usr/bin/env python3
"""Rescales the Bootstrap Icons webfont so its glyphs render at codicon's size.

WHY. A product icon theme cannot set a size — `IProductIconThemeDocument.fonts` takes only
`id`/`src`/`weight`/`style` — and whatever font it installs is rendered with codicon's own
`font: normal normal normal 16px/1`. Matching `unitsPerEm` is not enough: what decides the
apparent size is how much of the em the artwork occupies.

Measured over every glyph of both fonts (median of the per-glyph bounding boxes):

    codicon.ttf        median glyph 0.8133 em, spanning 0.0933 → 0.9067 em
    bootstrap-icons    median glyph 1.0000 em, spanning 0.0000 → 1.0000 em

Bootstrap draws edge to edge in its 16-unit viewBox; codicon leaves ~1.5px of padding inside the
em at 16px. That is the ~11% oversize seen across the IDE. Both are centred on 0.5 em, so the fix
is a pure uniform scale about the centre of the em — no vertical correction, no CSS override.

Usage, from the repo root:

    nix-shell -p python3Packages.fonttools python3Packages.brotli \\
        --run "python3 dev/scale-bootstrap-webfont.py <src.woff2> <dst.woff2>"
"""

import statistics
import sys

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

#: Median glyph extent of codicon.ttf, as a fraction of the em. The target this scales to.
CODICON_MEDIAN_EXTENT = 244 / 300  # 0.81333…


def median_extent(font):
    """Median of the per-glyph bounding boxes, in em, ignoring space-like glyphs."""
    upem = font["head"].unitsPerEm
    glyphs = font.getGlyphSet()
    sizes = []
    for name in font.getGlyphOrder():
        pen = BoundsPen(glyphs)
        try:
            glyphs[name].draw(pen)
        except Exception:
            continue
        if not pen.bounds:
            continue
        x0, y0, x1, y1 = pen.bounds
        if (x1 - x0) < upem * 0.05:
            continue
        sizes.append(max(x1 - x0, y1 - y0) / upem)
    return statistics.median(sizes)


def main(src, dst):
    font = TTFont(src)
    upem = font["head"].unitsPerEm
    before = median_extent(font)
    scale = CODICON_MEDIAN_EXTENT / before

    # Scale about the centre of the em in both axes: the advance width stays 1 em, so the layout
    # box is unchanged and only the artwork inside it shrinks — which is what keeps the glyph
    # centred on the same point codicon centres on.
    centre = upem / 2
    transform = Transform().translate(centre, centre).scale(scale).translate(-centre, -centre)

    glyphs = font.getGlyphSet()
    glyf = font["glyf"]
    for name in font.getGlyphOrder():
        record = DecomposingRecordingPen(glyphs)
        glyphs[name].draw(record)
        pen = TTGlyphPen(None)
        record.replay(TransformPen(pen, transform))
        glyf[name] = pen.glyph()

    # Bounds and left side bearings follow the new outlines; advances and the vertical metrics do
    # not move, because the em and the baseline are exactly where they were.
    hmtx = font["hmtx"]
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        advance, _ = hmtx[name]
        hmtx[name] = (advance, glyph.xMin if glyph.numberOfContours else 0)

    head = font["head"]
    drawn = [glyf[n] for n in font.getGlyphOrder() if glyf[n].numberOfContours]
    head.xMin = min(g.xMin for g in drawn)
    head.yMin = min(g.yMin for g in drawn)
    head.xMax = max(g.xMax for g in drawn)
    head.yMax = max(g.yMax for g in drawn)

    font.flavor = "woff2"
    font.save(dst)

    after = median_extent(TTFont(dst))
    print(f"scale {scale:.6f}")
    print(f"median glyph extent: {before:.4f} em → {after:.4f} em (codicon {CODICON_MEDIAN_EXTENT:.4f} em)")
    print(f"at 16px: {before * 16:.2f}px → {after * 16:.2f}px (codicon {CODICON_MEDIAN_EXTENT * 16:.2f}px)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
