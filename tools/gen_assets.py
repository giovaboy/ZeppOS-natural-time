#!/usr/bin/env python3
"""Generates per-target editable assets: backgrounds (including the
black-with-degrees variant), needle hands in the 7 weekday colors
(thin + solid styles), style-selector previews, the edit-background
foreground mock, and reuses select/tips masks from Textwatch Italiano.

Run from anywhere: python3 tools/gen_assets.py
"""

import math
import os
import shutil

from PIL import Image, ImageDraw, ImageFont

SS = 4  # supersampling factor for smooth shapes

TARGETS = {
    'default-target.r': 480,
    'target-466': 466, 'target-466.r': 466,
    'target-454': 454, 'target-454.r': 454,
    'target-416': 416, 'target-416.r': 416,
    'target-360': 360, 'target-360.r': 360,
}

SUN = (229, 160, 13, 255)        # 0xe5a00d
DIM = (102, 97, 80, 255)         # 0x666150
TEXT_DIM = (154, 144, 124, 255)  # 0x9a907c
NIGHT_RIM = (35, 42, 58, 255)    # 0x232a3a
DAY_RIM = (54, 197, 210, 255)    # 0x36c5d2

ITALIANO_ASSETS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..',
    'ZeppOS-Textwatch-Italiano', 'assets', 'default-target.r')
FONT_PATH = os.path.join(ITALIANO_ASSETS, 'fonts', 'Barlow-Medium.ttf')


def rgb(c):
    return ((c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF, 255)


def nt_to_screen(nt):
    return (nt + 180) % 360


def point_at(cx, cy, radius, screen_deg):
    a = math.radians(screen_deg)
    return (cx + radius * math.sin(a), cy - radius * math.cos(a))


def radial_bg(res, inner, outer):
    im = Image.new('RGBA', (res, res), outer + (255,))
    px = im.load()
    cx = cy = (res - 1) / 2
    maxd = res / 2
    for y in range(res):
        for x in range(res):
            t = min(1.0, math.hypot(x - cx, y - cy) / maxd)
            px[x, y] = tuple(
                round(inner[i] + (outer[i] - inner[i]) * t) for i in range(3)
            ) + (255,)
    return im


def bg_cosmo(res):
    import random
    rnd = random.Random(441)  # deterministic
    im = radial_bg(res, (10, 12, 24), (2, 3, 8))
    d = ImageDraw.Draw(im)
    for _ in range(90):
        x, y = rnd.uniform(0, res), rnd.uniform(0, res)
        r = rnd.uniform(0.4, 1.4) * res / 480
        v = rnd.randint(90, 220)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(v, v, min(255, v + 20), 255))
    return im


def bg_nero_gradi(res):
    """Pure black with natural-degree numerals at the significant points:
    0 (bottom), 90 (left), 180 (top), 270 (right) big; diagonals smaller."""
    s = res * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    R = s / 2
    cx = cy = R
    big = ImageFont.truetype(FONT_PATH, round(R * 0.105))
    small = ImageFont.truetype(FONT_PATH, round(R * 0.07))
    for nt in range(0, 360, 45):
        major = nt % 90 == 0
        x, y = point_at(cx, cy, R * 0.76, nt_to_screen(nt))
        d.text((x, y), str(nt), font=big if major else small,
               fill=TEXT_DIM if major else DIM, anchor='mm')
    return im.resize((res, res), Image.LANCZOS)


def gen_backgrounds(res):
    return {
        'BG_nero.png': Image.new('RGBA', (res, res), (0, 0, 0, 255)),
        'BG_nero_gradi.png': bg_nero_gradi(res),
        'BG_notte.png': radial_bg(res, (16, 24, 42), (4, 6, 12)),
        'BG_cosmo.png': bg_cosmo(res),
        'BG_antracite.png': radial_bg(res, (32, 36, 42), (10, 11, 14)),
    }


WHITE = (255, 255, 255, 255)


def hand_bar_width(res, style):
    if style == 'thin':
        return max(4, round(res * 0.011))
    if style == 'original':
        return round(res * 0.025)
    return round(res * 0.0275)


def hand_length(res, style):
    # Hub center -> tip. Must match the runtime formulas in index.js.
    if style == 'original':
        return round(res / 2 * 0.62)
    return round(res / 2 * 0.86)


def hub_radius(res):
    # Must match the runtime formula in index.js (image width = 2 * this).
    return round(res / 2 * 0.03)


def hand_tail(res, style):
    # How far the hand continues past the hub center.
    if style == 'original':
        return round(res / 2 * 0.09)
    return hub_radius(res)


def hand_color(style):
    return WHITE if style == 'original' else SUN


def gen_hand(res, style):
    """Hand pointing up, hub disc baked in; the rotation anchor (hub
    center) sits at y = hand_length from the image top."""
    length = hand_length(res, style)
    barw = hand_bar_width(res, style)
    hubr = hub_radius(res)
    tail = hand_tail(res, style)
    imgw = 2 * hubr
    imgh = length + tail
    W, H = imgw * SS, imgh * SS
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = hand_color(style)
    cx = W / 2
    ay = length * SS  # anchor (hub center)
    bw = barw * SS
    if style == 'solid':
        tip = max(SS * 2, round(bw * 0.3))
        d.polygon([(cx - tip / 2, 0), (cx + tip / 2, 0),
                   (cx + bw / 2, ay), (cx - bw / 2, ay)], fill=c)
        d.ellipse([cx - tip / 2, 0, cx + tip / 2, tip], fill=c)
    elif style == 'original':
        # Uniform white bar with rounded caps, continuing past the hub.
        d.rounded_rectangle([cx - bw / 2, 0, cx + bw / 2, H - 1],
                            radius=bw / 2, fill=c)
    else:
        d.rectangle([cx - bw / 2, 0, cx + bw / 2, ay], fill=c)
        r = bw * 1.6
        d.ellipse([cx - r, 0, cx + r, 2 * r], fill=c)  # round tip dot
    hr = hubr * SS
    d.ellipse([cx - hr, ay - hr, cx + hr, ay + hr], fill=c)
    return im.resize((imgw, imgh), Image.LANCZOS)


def gen_style_preview(res, kind):
    """Full-resolution 'real' preview for the style selector: the hand
    exactly as rendered on the dial (size, color, baked hub), at 45°."""
    s = res * SS
    im = Image.new('RGBA', (s, s), (10, 10, 12, 255))
    d = ImageDraw.Draw(im)
    cx = cy = s / 2
    length = hand_length(res, kind) * SS
    bw = hand_bar_width(res, kind) * SS
    hr = hub_radius(res) * SS
    c = hand_color(kind)
    ang = math.radians(45)
    sin, cos = math.sin(ang), math.cos(ang)
    tipx, tipy = cx + length * sin, cy - length * cos
    if kind == 'solid':
        d.line([cx, cy, tipx, tipy], fill=c, width=round(bw))
    elif kind == 'original':
        tail = hand_tail(res, kind) * SS
        tx, ty = cx - tail * sin, cy + tail * cos
        d.line([tx, ty, tipx, tipy], fill=c, width=round(bw))
        for px_, py_ in ((tipx, tipy), (tx, ty)):
            d.ellipse([px_ - bw / 2, py_ - bw / 2,
                       px_ + bw / 2, py_ + bw / 2], fill=c)
    else:
        d.line([cx, cy, tipx, tipy], fill=c, width=round(bw))
        r = bw * 1.6
        d.ellipse([tipx - r, tipy - r, tipx + r, tipy + r], fill=c)
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=c)
    return im.resize((res, res), Image.LANCZOS)


def gen_select_screen(res):
    """Full-screen selection marker for the style edit zone: a subtle ring."""
    s = res * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = round(res / 2 * 0.012) * SS or SS
    d.ellipse([w, w, s - w, s - w], outline=(154, 144, 124, 220), width=w)
    return im.resize((res, res), Image.LANCZOS)


def gen_fg(res):
    """Foreground mock drawn over background candidates in the editor."""
    s = res * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    R = s / 2
    cx = cy = R
    rim_w = R * 0.055
    d.ellipse([rim_w / 2, rim_w / 2, s - rim_w / 2, s - rim_w / 2],
              outline=NIGHT_RIM, width=round(rim_w))
    d.arc([rim_w / 2, rim_w / 2, s - rim_w / 2, s - rim_w / 2],
          start=150, end=30, fill=DAY_RIM, width=round(rim_w))
    for i in range(24):
        nt = 15 * i
        major = nt % 90 == 0
        x, y = point_at(cx, cy, R * 0.9, nt_to_screen(nt))
        r = R * (0.018 if major else 0.009)
        d.ellipse([x - r, y - r, x + r, y + r], fill=SUN if major else DIM)
    # sample thin needle + sun at 226 deg natural time
    sx, sy = point_at(cx, cy, R * 0.9, nt_to_screen(226))
    tx, ty = point_at(cx, cy, R * 0.86, nt_to_screen(226))
    d.line([cx, cy, tx, ty], fill=SUN, width=round(R * 0.022))
    r = R * 0.06
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=SUN)
    r = R * 0.03
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SUN)
    return im.resize((res, res), Image.LANCZOS)


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
    for target, res in TARGETS.items():
        base = os.path.join(root, target)
        for sub in ('bg', 'hands', 'stylesel', 'mask'):
            os.makedirs(os.path.join(base, sub), exist_ok=True)

        for name, im in gen_backgrounds(res).items():
            im.save(os.path.join(base, 'bg', name))

        for style in ('thin', 'solid', 'original'):
            gen_hand(res, style).save(
                os.path.join(base, 'hands', f'{style}.png'))

        for kind in ('thin', 'solid', 'original'):
            gen_style_preview(res, kind).save(
                os.path.join(base, 'stylesel', f'style_{kind}.png'))
        gen_select_screen(res).save(
            os.path.join(base, 'stylesel', 'select_screen.png'))

        gen_fg(res).save(os.path.join(base, 'mask', 'fg_x.png'))

        shutil.copy(os.path.join(ITALIANO_ASSETS, 'mask', 'tips.png'),
                    os.path.join(base, 'mask', 'tips.png'))
        print(f'{target}: done ({res}px)')


if __name__ == '__main__':
    main()
