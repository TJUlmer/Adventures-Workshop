"""Just enough of the Photoshop file format to write a layered template.

Written by hand because the alternative is a dependency for files that are
generated once, and because only a narrow slice of the format is needed: an
8-bit RGB document, some full-canvas RGBA layers, and a composite.

Ordered as the format wants it, which is not the order it reads in — a layer's
record has to state how long each of its channels will be, so the channels are
compressed first and the records are built around the answers.

Verify anything written with this by reading it back (`psd_tools`) and checking
the stored composite against a recomposite of the layers. Photoshop is stricter
than most readers, and a file that opens in one is not proof.
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image

# A layer, as the callers describe one.
Layer = tuple[Image.Image, str, bool]  # image (RGBA, full canvas), name, visible


def packbits(data: bytes) -> bytes:
    """PackBits, the run-length coding PSD uses for 8-bit channels."""
    out = bytearray()
    i, n = 0, len(data)
    while i < n:
        run = 1
        while i + run < n and run < 128 and data[i + run] == data[i]:
            run += 1
        if run >= 3:
            out.append(257 - run)
            out.append(data[i])
            i += run
            continue

        start = i
        i += 1
        while i < n and (i - start) < 128:
            # A run of three is worth breaking the literal for.
            if i + 2 < n and data[i] == data[i + 1] == data[i + 2]:
                break
            i += 1
        literal = data[start:i]
        out.append(len(literal) - 1)
        out += literal
    return bytes(out)


def rle_rows(plane: bytes, width: int, height: int) -> tuple[bytes, bytes]:
    """One channel as (row byte counts, packed rows)."""
    counts = bytearray()
    rows = bytearray()
    for y in range(height):
        packed = packbits(plane[y * width : (y + 1) * width])
        counts += struct.pack(">H", len(packed))
        rows += packed
    return bytes(counts), bytes(rows)


def _pascal4(text: str) -> bytes:
    """A Pascal string padded so the whole thing is a multiple of four."""
    raw = text.encode("latin-1", "replace")[:255]
    out = bytes([len(raw)]) + raw
    return out + b"\x00" * (-len(out) % 4)


def _unicode_name(text: str) -> bytes:
    """The `luni` block, which is the name Photoshop actually shows."""
    data = struct.pack(">I", len(text)) + text.encode("utf-16-be")
    data += b"\x00" * (len(data) % 2)
    return b"8BIM" + b"luni" + struct.pack(">I", len(data)) + data


def _layer_block(image: Image.Image, name: str, visible: bool) -> tuple[bytes, bytes]:
    """One layer, as (record, channel data). Full-canvas, RGBA, RLE."""
    width, height = image.size
    red, green, blue, alpha = image.split()

    channels = bytearray()
    lengths: list[tuple[int, int]] = []
    for ident, plane in ((-1, alpha), (0, red), (1, green), (2, blue)):
        counts, rows = rle_rows(plane.tobytes(), width, height)
        block = struct.pack(">H", 1) + counts + rows
        channels += block
        lengths.append((ident, len(block)))

    record = struct.pack(">iiii", 0, 0, height, width)
    record += struct.pack(">H", len(lengths))
    for ident, length in lengths:
        record += struct.pack(">hI", ident, length)
    # Blend mode, then opacity / clipping / flags / filler. Bit 1 of the flags
    # is *hidden*, not visible, which is the one easy thing to get backwards.
    record += b"8BIM" + b"norm"
    record += bytes([255, 0, 0 if visible else 2, 0])

    extra = struct.pack(">I", 0) + struct.pack(">I", 0) + _pascal4(name) + _unicode_name(name)
    record += struct.pack(">I", len(extra)) + extra

    return bytes(record), bytes(channels)


def _resolution_block(dpi: int) -> bytes:
    data = struct.pack(">IHHIHH", dpi << 16, 1, 1, dpi << 16, 1, 1)
    return b"8BIM" + struct.pack(">H", 1005) + b"\x00\x00" + struct.pack(">I", len(data)) + data


def flatten(layers: list[Layer], size: tuple[int, int]) -> Image.Image:
    """The composite the file stores, built the way a reader would build it."""
    out = Image.new("RGBA", size, (0, 0, 0, 255))
    for image, _name, visible in layers:
        if visible:
            out = Image.alpha_composite(out, image)
    return out


def write_psd(path: Path, layers: list[Layer], composite: Image.Image, dpi: int = 300) -> None:
    width, height = composite.size

    records = bytearray()
    channels = bytearray()
    for image, name, visible in layers:
        record, data = _layer_block(image, name, visible)
        records += record
        channels += data

    info = struct.pack(">h", len(layers)) + bytes(records) + bytes(channels)
    info += b"\x00" * (len(info) % 2)
    layer_and_mask = struct.pack(">I", len(info)) + info + struct.pack(">I", 0)

    # The composite: unlike a layer, every row count comes before every row.
    counts = bytearray()
    rows = bytearray()
    for plane in composite.convert("RGB").split():
        row_counts, row_data = rle_rows(plane.tobytes(), width, height)
        counts += row_counts
        rows += row_data

    resources = _resolution_block(dpi)

    with path.open("wb") as out:
        out.write(b"8BPS" + struct.pack(">H", 1) + b"\x00" * 6)
        out.write(struct.pack(">HIIHH", 3, height, width, 8, 3))
        out.write(struct.pack(">I", 0))
        out.write(struct.pack(">I", len(resources)) + resources)
        out.write(struct.pack(">I", len(layer_and_mask)) + layer_and_mask)
        out.write(struct.pack(">H", 1) + bytes(counts) + bytes(rows))
