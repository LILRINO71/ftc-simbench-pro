"""Draws the home-screen icons from the app's own logo (the hexagon and arc in the favicon, tools/build.mjs).

    python tools/make-icons.py

Writes site/icon-192.png, site/icon-512.png, site/icon-maskable-512.png and site/apple-touch-icon.png.
The build copies site/ into dist/. Needs Pillow; nothing is downloaded, and the icons are
committed, so a normal build never runs this.
"""
import os
from PIL import Image, ImageDraw

BG = (15, 16, 18)            # the theme colour in the page head
HEX = (242, 178, 48)         # #F2B230
INK = (35, 26, 14)           # #231A0E
SS = 4                       # draw four times larger, then shrink: smooth edges


def bez(p0, p1, p2, p3, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def icon(size, logo, rounded):
    """logo: the share of the icon's width the 32-unit mark takes up."""
    big = size * SS
    img = Image.new("RGBA", (big, big), BG + (255,))
    if rounded:                                  # a plain "any" icon: rounded square on a clear corner
        m = Image.new("L", (big, big), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=255)
        img.putalpha(m)
    d = ImageDraw.Draw(img)
    k = big * logo / 32.0
    ox = oy = (big - 32 * k) / 2

    def P(x, y):
        return (ox + x * k, oy + y * k)

    d.polygon([P(16, 2.6), P(27.6, 9.3), P(27.6, 22.7), P(16, 29.4), P(4.4, 22.7), P(4.4, 9.3)], fill=HEX)
    # the stroke is a round dot stamped all along the curve: even width, round caps
    arc = [P(x, y) for x, y in bez((9.3, 21), (11.3, 14.6), (17.5, 11.2), (23.3, 13), 300)]
    w = 2.4 * k
    for q in arc:
        d.ellipse([q[0] - w / 2, q[1] - w / 2, q[0] + w / 2, q[1] + w / 2], fill=INK)
    c = P(23.4, 13)
    d.ellipse([c[0] - 2.4 * k, c[1] - 2.4 * k, c[0] + 2.4 * k, c[1] + 2.4 * k], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "site")
icon(192, 0.70, True).save(os.path.join(out, "icon-192.png"), optimize=True)
icon(512, 0.70, True).save(os.path.join(out, "icon-512.png"), optimize=True)
# a maskable icon is cropped to a circle or squircle by the phone: the mark stays in the middle 60 %
icon(512, 0.52, False).save(os.path.join(out, "icon-maskable-512.png"), optimize=True)
# iOS rounds the corners itself and wants none transparent
icon(180, 0.66, False).convert("RGB").save(os.path.join(out, "apple-touch-icon.png"), optimize=True)
print("wrote 4 icons in", os.path.normpath(out))
