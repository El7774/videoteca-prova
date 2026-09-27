#!/usr/bin/env python3
"""Genera le icone launcher PNG (densità mdpi..xxxhdpi) con il motivo minimal dell'app."""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'app', 'res')

BG = (14, 16, 19, 255)        # #0E1013
FG = (234, 236, 239, 255)     # #EAECEF
ACCENT = (76, 141, 255, 255)  # #4C8DFF

SIZES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

def draw_icon(size: int) -> Image.Image:
    SS = 4  # supersampling
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # sfondo con angoli arrotondati (raggio ~18%)
    r = int(S * 0.18)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=BG)

    # cornice arrotondata minimal
    f0, f1 = int(S * 0.30), int(S * 0.70)
    fr = int(S * 0.07)
    w = max(2, int(S * 0.035))
    d.rounded_rectangle([f0, f0, f1, f1], radius=fr, outline=FG, width=w)

    # triangolo play
    tri = [(int(S * 0.435), int(S * 0.415)),
           (int(S * 0.615), int(S * 0.500)),
           (int(S * 0.435), int(S * 0.585))]
    d.polygon(tri, fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)

for folder, size in SIZES.items():
    out_dir = os.path.join(RES, folder)
    os.makedirs(out_dir, exist_ok=True)
    draw_icon(size).save(os.path.join(out_dir, 'ic_launcher.png'))
    draw_icon(size).save(os.path.join(out_dir, 'ic_launcher_round.png'))
    print(f"{folder}/ic_launcher.png ({size}x{size})")

print('Icone generate.')
