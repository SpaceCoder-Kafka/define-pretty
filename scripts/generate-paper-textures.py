"""Original deterministic paper fibers; no reference pixels or third party textures.

Run from the repository root with Python 3. The transparent SVGs combine diffuse
pulp, sparse long fibers, and tiny pressed flecks. Separate seeds keep the blue,
reading surface, and translucent tape from sharing a single noise overlay.
"""
from pathlib import Path
import random

DESTINATION = Path('public/assets/paper')
DESTINATION.mkdir(parents=True, exist_ok=True)


def texture(name, seed, strength):
    rng = random.Random(seed)
    parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><filter id="pulp" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency=".15 .23" numOctaves="3" seed="{seed}" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/>
<feComponentTransfer><feFuncA type="linear" slope="{strength}"/></feComponentTransfer>
</filter></defs><rect width="100%" height="100%" filter="url(#pulp)" opacity=".55"/>''']
    for _ in range(800):
        x, y = rng.uniform(0, 512), rng.uniform(0, 512)
        dx, dy = rng.uniform(-4, 7), rng.uniform(.3, 2.8)
        color = '#fffdf4' if rng.random() > .34 else '#5f665b'
        alpha = rng.uniform(.025, .12) * strength / .2
        parts.append(f'<path d="M{x:.2f} {y:.2f}q{dx / 2:.2f} {-dy:.2f} {dx:.2f} {dy:.2f}" fill="none" stroke="{color}" stroke-width="{rng.uniform(.25, .8):.2f}" opacity="{alpha:.3f}"/>')
    for _ in range(140):
        x, y = rng.uniform(0, 512), rng.uniform(0, 512)
        parts.append(f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{rng.uniform(.4, 1.6):.2f}" ry="{rng.uniform(.25, .8):.2f}" fill="#fffdf4" opacity="{strength * .6:.3f}"/>')
    parts.append('</svg>')
    (DESTINATION / f'fibers-{name}.svg').write_text('\n'.join(parts))


texture('light', 31, .065)
texture('blue', 57, .32)
texture('tape', 83, .22)
