#!/usr/bin/env python3
"""Generate the app icon set (favicon + PWA / home-screen icons).

Pure standard library — no Pillow/ImageMagick needed. The icon is a stylised
QRIS-red QR code: three finder patterns, a timing track and a deterministic
data speckle, on a white panel over a full-bleed red background (so Android's
maskable crop still looks intentional).

Outputs into ../static:
  favicon.svg          crisp browser-tab icon
  icon-192.png         PWA manifest icon
  icon-512.png         PWA manifest icon (install / splash)
  apple-touch-icon.png iOS home-screen icon (180x180)
"""

import os
import struct
import zlib

# --- palette ---------------------------------------------------------------
RED = (0xE1, 0x19, 0x00)     # QRIS-ish red, full-bleed background
WHITE = (0xFF, 0xFF, 0xFF)   # inner panel
DARK = (0x15, 0x23, 0x3B)    # QR modules

N = 21                       # module grid (QR v1 size)
QUIET = 2                    # quiet-zone modules around the grid, inside panel


def build_matrix():
    """Return an N x N grid of 0/1 with a believable QR layout."""
    m = [[0] * N for _ in range(N)]
    reserved = [[False] * N for _ in range(N)]

    def finder(top, left):
        for r in range(7):
            for c in range(7):
                edge = r in (0, 6) or c in (0, 6)
                center = 2 <= r <= 4 and 2 <= c <= 4
                m[top + r][left + c] = 1 if (edge or center) else 0
                reserved[top + r][left + c] = True
        # 1-module white separator ring around the finder
        for r in range(-1, 8):
            for c in range(-1, 8):
                rr, cc = top + r, left + c
                if 0 <= rr < N and 0 <= cc < N and not reserved[rr][cc]:
                    reserved[rr][cc] = True  # stays white (value already 0)

    finder(0, 0)            # top-left
    finder(0, N - 7)        # top-right
    finder(N - 7, 0)        # bottom-left

    # timing tracks on row 6 / col 6
    for i in range(8, N - 8):
        m[6][i] = 1 if i % 2 == 0 else 0
        reserved[6][i] = True
        m[i][6] = 1 if i % 2 == 0 else 0
        reserved[i][6] = True

    # deterministic data speckle in the free cells
    for r in range(N):
        for c in range(N):
            if reserved[r][c]:
                continue
            h = ((r * 73856093) ^ (c * 19349663) ^ ((r * c) * 83492791)) & 0xFFFFFFFF
            m[r][c] = 1 if (h % 100) < 48 else 0
    return m


MATRIX = build_matrix()


def render_rows(size):
    """Render the icon at `size`x`size` as a list of RGB byte rows."""
    margin = round(size * 0.11)                 # red border / maskable safe area
    panel = size - 2 * margin                   # white panel side
    span = N + 2 * QUIET                         # grid + quiet zone, in modules
    module = panel // span                       # integer module size (crisp)
    grid = module * N
    origin = margin + (panel - grid) // 2        # center the grid in the panel

    rows = []
    for y in range(size):
        row = bytearray(size * 3)
        for x in range(size):
            if margin <= x < size - margin and margin <= y < size - margin:
                color = WHITE
                gx, gy = x - origin, y - origin
                if 0 <= gx < grid and 0 <= gy < grid:
                    if MATRIX[gy // module][gx // module]:
                        color = DARK
            else:
                color = RED
            row[x * 3:x * 3 + 3] = bytes(color)
        rows.append(row)
    return rows


def write_png(path, size):
    rows = render_rows(size)
    raw = bytearray()
    for row in rows:
        raw.append(0)            # filter type 0 (none)
        raw.extend(row)

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))
    print("wrote", path, f"({size}x{size})")


def write_svg(path):
    vb = N + 2 * QUIET
    off = QUIET
    rects = []
    for r in range(N):
        for c in range(N):
            if MATRIX[r][c]:
                rects.append(f'<rect x="{c+off}" y="{r+off}" width="1" height="1"/>')
    panel = vb  # white panel == full viewbox here; red frame drawn behind it
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" '
        f'shape-rendering="crispEdges">'
        f'<rect width="{vb}" height="{vb}" rx="2.5" fill="#E11900"/>'
        f'<rect x="0.9" y="0.9" width="{vb-1.8}" height="{vb-1.8}" rx="1.6" fill="#fff"/>'
        f'<g fill="#15233B">{"".join(rects)}</g>'
        f'</svg>'
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    print("wrote", path, "(svg)")


def main():
    static = os.path.join(os.path.dirname(__file__), "..", "static")
    static = os.path.abspath(static)
    write_png(os.path.join(static, "icon-192.png"), 192)
    write_png(os.path.join(static, "icon-512.png"), 512)
    write_png(os.path.join(static, "apple-touch-icon.png"), 180)
    write_svg(os.path.join(static, "favicon.svg"))


if __name__ == "__main__":
    main()
