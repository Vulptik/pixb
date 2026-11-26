"""Repackage the existing fonts as WOFF2 without changing typography.

Requires fonttools[woff] and uharfbuzz. Original files remain untouched. Verify all glyph
outlines, character mappings, layout tables, and metrics after decompression.
"""

from pathlib import Path
from io import BytesIO
import unicodedata

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools import subset
import uharfbuzz as hb


def shaper(font):
    stream = BytesIO()
    flavor = font.flavor
    font.flavor = None
    font.save(stream)
    font.flavor = flavor
    face = hb.Font(hb.Face(stream.getvalue()))
    hb.ot_font_set_funcs(face)
    def shape(text):
        buffer = hb.Buffer()
        buffer.add_str(text)
        buffer.guess_segment_properties()
        buffer.language = "fr"
        hb.shape(face, buffer)
        return [(font.getGlyphName(g.codepoint), p.x_advance, p.y_advance, p.x_offset, p.y_offset)
                for g, p in zip(buffer.glyph_infos, buffer.glyph_positions)]
    return shape

# Keep the full face as a fallback. The primary face covers Latin (including
# extended letters and combining marks), punctuation, currency, and UI symbols.
LATIN_RANGES = ((0x0000, 0x036F), (0x1E00, 0x1EFF), (0x2000, 0x22FF), (0xFEFF, 0xFEFF), (0xFFFD, 0xFFFD))
LATIN_NAMES = {
    "lora": ("Lora", "PixB Serif Latin"),
    "source-sans-3": ("Source Sans 3", "PixB Sans Latin"),
}
OFL_NAME_IDS = {0, 13, 14}


def rename_subset(font, original_family, subset_family):
    # The OFL reserves the upstream family names for the unmodified faces.
    # Keep copyright and license records while renaming the Latin derivatives.
    family_ids = {1, 4, 16, 18, 21}
    postscript_ids = {6, 20, 25}
    if "fvar" in font:
        postscript_ids.update(instance.postscriptNameID for instance in font["fvar"].instances)

    original_postscript = original_family.replace(" ", "")
    subset_postscript = subset_family.replace(" ", "")
    for record in font["name"].names:
        if record.nameID in family_ids:
            record.string = record.toUnicode().replace(original_family, subset_family)
        elif record.nameID in postscript_ids:
            record.string = record.toUnicode().replace(original_postscript, subset_postscript)
        elif record.nameID == 3:
            version, _, postscript = record.toUnicode().split(";", 2)
            record.string = f"{version};PixB;{postscript.replace(original_postscript, subset_postscript)}"


def license_records(font):
    return {
        (record.nameID, record.platformID, record.platEncID, record.langID): record.toUnicode()
        for record in font["name"].names
        if record.nameID in OFL_NAME_IDS
    }


for name in ("source-sans-3", "lora", "jetbrains-mono"):
    source = Path("public/fonts") / f"{name}.woff2"
    target = source.with_name(f"{name}.web.woff2")
    original = TTFont(source, recalcTimestamp=False)
    original.flavor = "woff2"
    original.save(target)
    restored = TTFont(target, recalcTimestamp=False)
    assert original.getBestCmap() == restored.getBestCmap()
    assert original["hmtx"].metrics == restored["hmtx"].metrics
    for tag in ("OS/2", "hhea", "GPOS", "GSUB", "kern", "fvar", "gvar"):
        if tag in original:
            assert original[tag].compile(original) == restored[tag].compile(restored), tag
    before, after = original.getGlyphSet(), restored.getGlyphSet()
    assert set(before.keys()) == set(after.keys())
    for glyph in before.keys():
        first, second = RecordingPen(), RecordingPen()
        before[glyph].draw(first)
        after[glyph].draw(second)
        assert first.value == second.value, glyph
    print(f"{name}: {source.stat().st_size:,} -> {target.stat().st_size:,} bytes; glyphs and metrics identical")
    if name == "jetbrains-mono":
        continue
    primary = TTFont(source, recalcTimestamp=False)
    options = subset.Options()
    options.layout_features = ["*"]
    options.glyph_names = True
    options.notdef_outline = True
    options.legacy_kern = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    primary_codes = [code for code in primary.getBestCmap() if any(start <= code <= end for start, end in LATIN_RANGES)]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=primary_codes)
    subsetter.subset(primary)
    rename_subset(primary, *LATIN_NAMES[name])
    primary.flavor = "woff2"
    latin_path = source.with_name(f"{name}.latin.woff2")
    primary.save(latin_path)
    latin = TTFont(latin_path, recalcTimestamp=False)
    assert license_records(latin) == license_records(original)
    assert latin.getBestCmap() == {code: original.getBestCmap()[code] for code in primary_codes}
    for glyph in latin.getGlyphSet().keys():
        first, second = RecordingPen(), RecordingPen()
        before[glyph].draw(first)
        latin.getGlyphSet()[glyph].draw(second)
        assert first.value == second.value, glyph
        assert original["hmtx"].metrics[glyph] == latin["hmtx"].metrics[glyph], glyph
    for field in ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent", "sxHeight", "sCapHeight"):
        assert getattr(original["OS/2"], field, None) == getattr(latin["OS/2"], field, None), field
    shape_original, shape_latin = shaper(original), shaper(latin)
    letters = [chr(code) for code in primary_codes if unicodedata.category(chr(code)).startswith("L")]
    for left in letters:
        for right in letters:
            assert shape_original(left + right) == shape_latin(left + right), repr(left + right)
    for text in ("Office affluent ffi ffl", "Été à Noël — Œuvre, cœur, déjà vu…", "A\u0301 e\u0308 c\u0327", "1600 × 1000 · 54,5 kB", "Łódź İstanbul Việt Nam"):
        assert shape_original(text) == shape_latin(text), text
    print(f"{name} primary Latin: {latin_path.stat().st_size:,} bytes; outlines, metrics and character coverage verified")
