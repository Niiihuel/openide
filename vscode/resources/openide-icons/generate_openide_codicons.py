#!/usr/bin/env fontforge
"""Build the OpenIDE regular and active icon fonts while preserving Codicon's API.

The workbench keeps Codicon's public ids/codepoints, so extensions and existing UI code do not
change. Generic UI glyphs use separately drawn Reicon-style outline/filled vectors. Editor-only
symbols fall back to compact normalized Codicon geometry. Brand marks are copied byte-for-byte at
the outline level and never emboldened or rescaled.

Run through FontForge, not CPython:
  fontforge -script generate_openide_codicons.py <codicon.ttf> <mapping.json> <output-dir>
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

import fontforge
import psMat


BRAND_PREFIXES = (
    "anthropic",
    "apple",
    "azure",
    "claude",
    "code-oss",
    "copilot",
    "docker",
    "gemini",
    "gitlab",
    "google",
    "github",
    "meta",
    "microsoft",
    "mistral",
    "openai",
    "twitter",
    "xai",
)


def protected_codepoints(mapping_path: str) -> set[int]:
    with open(mapping_path, "r", encoding="utf-8") as handle:
        mapping = json.load(handle)
    return {
        int(codepoint)
        for codepoint, aliases in mapping.items()
        if any(alias == prefix or alias.startswith(prefix + "-") for alias in aliases for prefix in BRAND_PREFIXES)
    }


def load_vector_reference(output_dir: str) -> tuple[dict[int, dict[str, str]], int]:
    reference: dict[int, dict[str, str]] = {}
    override_count = 0
    for filename in ("reicon-reference.json", "openide-icon-overrides.json"):
        reference_path = os.path.join(output_dir, filename)
        if not os.path.exists(reference_path):
            continue
        with open(reference_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        definitions = data.get("definitions", {})
        glyphs = {}
        for codepoint, raw_value in data.get("glyphs", {}).items():
            value = dict(raw_value)
            vector_name = value.pop("vector", None)
            if vector_name:
                value = {**definitions[vector_name], **value}
            glyphs[int(codepoint)] = value
        reference.update(glyphs)
        if filename == "openide-icon-overrides.json":
            override_count = len(glyphs)
    return reference, override_count


def apply_semantic_policy(
    reference: dict[int, dict[str, str]],
    mapping_path: str,
    output_dir: str,
) -> tuple[int, int]:
    """Keep public Codicon variants visually distinct when a Reicon fallback loses meaning."""
    with open(mapping_path, "r", encoding="utf-8") as handle:
        mapping = json.load(handle)
    with open(os.path.join(output_dir, "openide-icon-policy.json"), "r", encoding="utf-8") as handle:
        policy = json.load(handle)
    with open(os.path.join(output_dir, "openide-icon-overrides.json"), "r", encoding="utf-8") as handle:
        overrides = json.load(handle).get("glyphs", {})

    semantic_suffixes = tuple("-" + suffix for suffix in policy["semanticSuffixes"])
    filled_suffix = "-" + policy["filledSuffix"]
    preserved = 0
    explicit_filled = 0
    for raw_codepoint, aliases in mapping.items():
        codepoint = int(raw_codepoint)
        if codepoint not in reference or raw_codepoint in overrides:
            continue
        if any(
            alias in policy["preserveCodiconNames"]
            or any(alias.startswith(prefix) for prefix in policy["preserveCodiconPrefixes"])
            for alias in aliases
        ):
            del reference[codepoint]
            preserved += 1
            continue
        entry = reference[codepoint]
        source_name = entry.get("name", "")
        loses_semantic_suffix = any(
            alias.endswith(suffix) and not source_name.endswith(suffix)
            for alias in aliases
            for suffix in semantic_suffixes
        )
        if loses_semantic_suffix:
            del reference[codepoint]
            preserved += 1
            continue
        if any(alias.endswith(filled_suffix) for alias in aliases):
            filled_vector = entry.get("filled", "")
            if filled_vector:
                entry["outline"] = filled_vector
                entry.pop("outlineAppend", None)
                explicit_filled += 1
    return preserved, explicit_filled


def import_svg_glyph(glyph, svg_code: str, svg_path: str) -> None:
    # Width/height deliberately match Codicon's 300-unit em. FontForge applies the SVG viewBox
    # transform, including the screen-to-font Y axis conversion, during import.
    with open(svg_path, "w", encoding="utf-8") as handle:
        handle.write(
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" '
            f'viewBox="0 0 24 24">{svg_code}</svg>'
        )
    width = glyph.width
    glyph.clear()
    glyph.importOutlines(svg_path)
    glyph.width = width
    glyph.removeOverlap()
    glyph.correctDirection()
    glyph.round()


def style_font(
    input_path: str,
    output_path: str,
    family: str,
    fallback_weight: int,
    protected: set[int],
    reference: dict[int, dict[str, str]],
    reference_weight: str,
    regular_source_path: str | None = None,
) -> tuple[int, list[str]]:
    font = fontforge.open(input_path)
    regular_source = fontforge.open(regular_source_path) if regular_source_path else None
    font.fontname = family.replace(" ", "")
    font.familyname = family
    font.fullname = family
    font.version = "1.0"

    failures: list[str] = []
    imported = 0
    with tempfile.TemporaryDirectory(prefix="openide-icons-") as temp_dir:
        existing_codepoints = {
            codepoint
            for glyph in font.glyphs()
            for codepoint in (glyph.encoding, glyph.unicode)
            # Algunas posiciones privadas aparecen como slots vacíos en la fuente base.
            # No son parte de su API visible y deben poder recibir los glifos de producto.
            if codepoint >= 0 and glyph.isWorthOutputting()
        }
        for glyph in font.glyphs():
            codepoint = glyph.encoding if glyph.encoding in reference else glyph.unicode
            if glyph.unicode < 0 or glyph.unicode in protected or glyph.encoding in protected or not glyph.isWorthOutputting():
                continue
            baseline_layer = glyph.foreground.dup()
            baseline_width = glyph.width
            try:
                # FontForge expone ciertos aliases de Codicon (json/bracket es el caso más
                # visible) con un unicode canónico y un encoding distinto. Los overrides siguen
                # el codepoint público del mapping, por eso priorizamos ese encoding si existe.
                entry = reference.get(codepoint, {})
                fill_from_outline = reference_weight == "filled" and entry.get("filledFromOutline")
                vector_key = "outline" if fill_from_outline else reference_weight
                vector = entry.get(vector_key, "") + entry.get(vector_key + "Append", "")
                if vector:
                    if fill_from_outline and regular_source is not None:
                        glyph.clear()
                        glyph.foreground = regular_source[glyph.encoding].foreground.dup()
                        glyph.width = baseline_width
                    else:
                        import_svg_glyph(glyph, vector, os.path.join(temp_dir, f"{codepoint}-{reference_weight}.svg"))
                    if entry.get("opticalScaleX"):
                        optical_scale_x = float(entry["opticalScaleX"])
                        glyph.transform(psMat.translate(-150, 0))
                        glyph.transform(psMat.scale(optical_scale_x, 1))
                        glyph.transform(psMat.translate(150, 0))
                    if fill_from_outline:
                        if isinstance(fill_from_outline, dict) and fill_from_outline.get("scale"):
                            # Algunas parejas simétricas de trazos (por ejemplo las llaves) pierden
                            # un lado con changeWeight de FontForge. Un crecimiento óptico centrado
                            # conserva ambos contornos y aun diferencia claramente el estado activo.
                            scale = float(fill_from_outline["scale"])
                            glyph.transform(psMat.translate(-150, -150))
                            glyph.transform(psMat.scale(scale))
                            glyph.transform(psMat.translate(150, 150))
                        else:
                            glyph.changeWeight(int(fill_from_outline))
                            glyph.removeOverlap()
                            glyph.correctDirection()
                        glyph.round()
                    imported += 1
                    continue
                # Slightly smaller optical box, centered in the original 300-unit cell. This gives
                # editor-only Codicons breathing room without changing metrics or codepoints.
                center_x = glyph.width / 2
                glyph.transform(psMat.translate(-center_x, -150))
                glyph.transform(psMat.scale(0.955))
                glyph.transform(psMat.translate(center_x, 150))
                baseline_has_outline = not baseline_layer.isEmpty()

                # Editor-specific fallback: normalize contour weight without inventing a semantically
                # wrong replacement. The active font remains denser for selected controls.
                glyph.changeWeight(fallback_weight)
                glyph.removeOverlap()
                # A few line-like upstream contours cannot survive the stronger weight operation in
                # FontForge. Fall back progressively instead of ever shipping a blank active icon.
                if baseline_has_outline and glyph.foreground.isEmpty():
                    glyph.foreground = baseline_layer
                    glyph.changeWeight(max(7, fallback_weight // 2))
                    glyph.removeOverlap()
                if baseline_has_outline and glyph.foreground.isEmpty():
                    glyph.foreground = baseline_layer
                glyph.simplify(0.45, ("smoothcurves", "mergelines", "removesingletonpoints"))
                glyph.round()
            except Exception as error:  # One malformed upstream glyph must not invalidate the family.
                failures.append(f"{glyph.glyphname}: {error}")
                glyph.foreground = baseline_layer
                glyph.width = baseline_width

        # OpenIDE-owned actions can use private glyphs without repurposing a public Codicon.
        # The icon registry supplies the CSS codepoint while this branch adds its outline to both
        # companion fonts. Existing Codicon metrics and aliases therefore remain untouched.
        for codepoint, entry in reference.items():
            if codepoint in existing_codepoints or codepoint in protected:
                continue
            vector = entry.get(reference_weight, "") + entry.get(reference_weight + "Append", "")
            if not vector:
                continue
            try:
                glyph = font.createChar(codepoint, f"openide{codepoint:04X}")
                glyph.width = 300
                import_svg_glyph(glyph, vector, os.path.join(temp_dir, f"{codepoint}-{reference_weight}.svg"))
                imported += 1
            except Exception as error:
                failures.append(f"openide{codepoint:04X}: {error}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    font.generate(output_path)
    font.close()
    if regular_source is not None:
        regular_source.close()
    if failures:
        print(f"[openide-icons] {family}: {len(failures)} glyphs kept with partial styling", file=sys.stderr)
        for failure in failures[:12]:
            print(f"  {failure}", file=sys.stderr)
    return imported, failures


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: generate_openide_codicons.py <codicon.ttf> <mapping.json> <output-dir>")
    input_path, mapping_path, output_dir = map(os.path.abspath, sys.argv[1:])
    protected = protected_codepoints(mapping_path)
    reference, override_count = load_vector_reference(output_dir)
    preserved_count, explicit_filled_count = apply_semantic_policy(reference, mapping_path, output_dir)
    regular_path = os.path.join(output_dir, "openide-codicon.ttf")
    regular_count, _ = style_font(input_path, regular_path, "OpenIDE Icons", 7, protected, reference, "outline")
    filled_count, _ = style_font(input_path, os.path.join(output_dir, "openide-codicon-filled.ttf"), "OpenIDE Icons Filled", 24, protected, reference, "filled", regular_path)
    print(f"[openide-icons] generated 2 fonts; imported {regular_count}/{filled_count} outline/filled pairs "
          f"({override_count} OpenIDE optical overrides); preserved {len(protected)} brand codepoints, "
          f"{preserved_count} semantic Codicons; corrected {explicit_filled_count} explicit filled variants")


if __name__ == "__main__":
    main()
