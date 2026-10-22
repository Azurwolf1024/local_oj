#!/usr/bin/env python3
"""
Generate a simple 32x32 application icon (app.ico) for the Local OJ launcher.
Pure stdlib (struct/zlib not even needed). Produces a blue rounded-square
background with a white "O" ring — reads as an OJ-style logo.

Layout produced: ICONDIR + ICONDIRENTRY + BITMAPINFOHEADER + BGRA pixels
(bottom-up) + zero AND mask.
"""
import struct

W = H = 32
BG = (0x2D, 0x6C, 0xDF)        # blue background (R, G, B)
FG = (255, 255, 255)           # white ring
CORNER = 6                     # corner radius for rounded square
RING_IN, RING_OUT = 7.0, 12.0  # ring radii


def pixel(x, y):
    r, g, b = BG
    a = 255
    # rounded corners: cut pixels outside a quarter-circle near each corner
    cx = min(x, W - 1 - x)
    cy = min(y, H - 1 - y)
    if cx < CORNER and cy < CORNER:
        dx = CORNER - cx
        dy = CORNER - cy
        if dx * dx + dy * dy > CORNER * CORNER:
            a = 0
    # white ring centred on the icon
    px = x - (W - 1) / 2.0
    py = y - (H - 1) / 2.0
    d = (px * px + py * py) ** 0.5
    if RING_IN <= d <= RING_OUT:
        r, g, b, a = FG[0], FG[1], FG[2], 255
    return (b, g, r, a)  # BGRA


# build rows top-down, then reverse for bottom-up BMP storage
rows_td = [[pixel(x, y) for x in range(W)] for y in range(H)]
rows_bu = rows_td[::-1]
bgra = bytearray()
for row in rows_bu:
    for (b, g, r, a) in row:
        bgra += bytes((b, g, r, a))

# AND mask: 32 px wide -> 4 bytes/row, all zero (fully opaque via alpha)
and_mask = bytes(H * 4)

bih = struct.pack('<IiiHHIIiiII', 40, W, 2 * H, 1, 32, 0, 0, 0, 0, 0, 0)
img = bih + bgra + and_mask

icondir = struct.pack('<HHH', 0, 1, 1)
entry = struct.pack('<BBBBHHII', W, H, 0, 0, 1, 32, len(img), 6 + 16)
ico = icondir + entry + img

with open('app.ico', 'wb') as f:
    f.write(ico)

print('wrote launcher/app.ico (%d bytes)' % len(ico))
