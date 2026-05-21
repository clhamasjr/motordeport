"""
Gera todos os icones PNG necessarios pro PWA.

USO PARA TROCAR O LOGO:

A) Logo PROPRIO (recomendado quando tiver o PNG da marca):
   1. Coloque o logo da LhamasCred como logo.png na raiz do v2-next/
      (quadrado, fundo transparente OU solido, minimo 512x512)
   2. cd v2-next
   3. python scripts/gerar-icones.py logo.png
   4. git add public/icons && git commit -m "feat: novo logo PWA" && git push

B) Placeholder (LF azul sobre fundo escuro) — o que esta agora:
   python scripts/gerar-icones.py
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
OUT = ROOT / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

# Cores do tema (devem bater com globals.css :root)
BG = (15, 23, 42)          # #0f172a — background dark
FG = (59, 130, 246)        # #3b82f6 — primary blue
WHITE = (248, 250, 252)

SPECS = [
    ('icon-192.png', 192, False),
    ('icon-512.png', 512, False),
    ('icon-maskable-192.png', 192, True),
    ('icon-maskable-512.png', 512, True),
    ('apple-touch-icon.png', 180, False),
    ('favicon-32.png', 32, False),
]


def from_logo(logo_path: Path, size: int, maskable: bool) -> Image.Image:
    """Redimensiona o logo do usuario e centraliza no fundo BG."""
    logo = Image.open(logo_path).convert('RGBA')
    canvas = Image.new('RGBA', (size, size), BG + (255,))
    # Maskable: deixa 80% da area pro logo (20% safe zone fora)
    pad_ratio = 0.10 if not maskable else 0.20
    inner = int(size * (1 - 2 * pad_ratio))
    logo.thumbnail((inner, inner), Image.LANCZOS)
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.paste(logo, (x, y), logo if logo.mode == 'RGBA' else None)
    return canvas


def placeholder(size: int, maskable: bool) -> Image.Image:
    img = Image.new('RGBA', (size, size), BG + (255,))
    d = ImageDraw.Draw(img)
    pad = int(size * 0.12 if not maskable else size * 0.2)
    d.ellipse([pad, pad, size - pad, size - pad], fill=FG)
    text_size = int(size * 0.45 if not maskable else size * 0.35)
    font = None
    for f in ('arialbd.ttf', 'arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'):
        try:
            font = ImageFont.truetype(f, text_size)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()
    text = 'LF'
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(
        ((size - tw) // 2 - bbox[0], (size - th) // 2 - bbox[1] - int(size * 0.04)),
        text, fill=WHITE, font=font,
    )
    return img


def main():
    logo_arg = sys.argv[1] if len(sys.argv) > 1 else None
    logo_path = Path(logo_arg) if logo_arg else None
    if logo_path and not logo_path.is_absolute():
        logo_path = ROOT / logo_path

    if logo_path:
        if not logo_path.exists():
            print(f'ERRO: logo nao encontrado em {logo_path}')
            sys.exit(1)
        print(f'Usando logo: {logo_path}')
        gen = lambda size, mask: from_logo(logo_path, size, mask)
    else:
        print('Usando placeholder (LF azul). Pra usar seu logo, rode: python scripts/gerar-icones.py logo.png')
        gen = placeholder

    for name, size, mask in SPECS:
        img = gen(size, mask)
        img.save(OUT / name, 'PNG', optimize=True)
        print(f'  {name:30s} {size}x{size} {"maskable" if mask else ""}')

    print(f'\nOK. {len(SPECS)} icones em {OUT}')


if __name__ == '__main__':
    main()
