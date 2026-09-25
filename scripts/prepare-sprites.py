"""Prepare the confirmed artwork supplied for the mobile preview.

Usage: python3 scripts/prepare-sprites.py /path/to/project_sources
The originals remain in the user's uploaded files. The output names are stable
spriteRef values, and action frames are cut from the numbered reference charts.
"""
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

SOURCE = Path(sys.argv[1])
DEST = Path(__file__).resolve().parents[1] / 'public/assets/sprites'
DEST.mkdir(parents=True, exist_ok=True)

NAMES = [
    'player_base_sheet', 'player_base_actions_reference',
    'player_ki_charge', 'player_ki_beam',
    'blue_storm_front', 'blue_storm_left', 'blue_storm_right', 'blue_storm_back',
    'super_lightning_blue', 'super_lightning_gold',
    'player_transform_sheet', 'player_transform_actions_reference',
    'transform_five_color_magic', 'transform_absolute_defense', 'transform_meteor_rain',
    'slime', 'goblin_boss', 'wolf', 'tiger_boss', 'ghost', 'zombie_boss', 'orc',
    'cyclops_boss', 'red_dragon_boss',
    'wyvern_red', 'wyvern_blue', 'wyvern_gold', 'wyvern_purple', 'wyvern_green',
    'final_boss_baseball', 'final_boss_demon', 'final_boss_dark_flame',
]
# Files are indexed by the stable two-digit prefix attached to uploaded copies.
files = [next(SOURCE.glob(f'{i:02d}-*.png')) for i in range(6, 38)]
assert len(files) == len(NAMES)

def save(image: Image.Image, name: str, limit: int = 850) -> None:
    image = image.convert('RGBA')
    if max(image.size) > limit:
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    target = DEST / f'{name}.png'
    temporary = DEST / f'{name}.tmp.png'
    image.save(temporary, optimize=True)
    try:
        with Image.open(temporary) as check: check.verify()
    except (OSError, SyntaxError):
        # A failed encoder write must never become a deployed sprite.
        image.save(temporary, optimize=False)
        with Image.open(temporary) as check: check.verify()
    temporary.replace(target)

def get_image(i: int) -> Image.Image:
    return Image.open(files[i - 6]).convert('RGBA')

def remove_detached_artifacts(frame: Image.Image) -> Image.Image:
    """Keep the connected character and its antialiasing, discard loose matte flecks."""
    from scipy.ndimage import label, binary_dilation
    rgba = np.asarray(frame).copy()
    alpha = rgba[:, :, 3]
    components, count = label(alpha > 48)
    if count:
        sizes = np.bincount(components.ravel())
        sizes[0] = 0
        core = components == sizes.argmax()
        nearby = binary_dilation(core, iterations=2)
        rgba[:, :, 3] = np.where(nearby, alpha, 0)
    return Image.fromarray(rgba, 'RGBA')

for i, name in enumerate(NAMES):
    im = get_image(i + 6)
    if name in ('super_lightning_blue', 'super_lightning_gold'):
        # Source is RGB with an opaque white background. Keep its colored arcs.
        rgb = np.asarray(im.convert('RGB'), dtype=np.int16)
        alpha = np.uint8(np.clip((255 - rgb.min(axis=2)) * 1.65, 0, 255))
        im.putalpha(Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(0.5)))
    elif name == 'final_boss_dark_flame':
        # The source has a nearly black backdrop; retain luminous purple flame.
        rgb = np.asarray(im.convert('RGB'), dtype=np.int16)
        brightness = rgb.max(axis=2)
        alpha = np.uint8(np.clip((brightness - 18) * 2.1, 0, 255))
        im.putalpha(Image.fromarray(alpha, 'L'))
    if name not in ('player_base_sheet', 'player_transform_sheet',
                    'player_base_actions_reference', 'player_transform_actions_reference',
                    'super_lightning_blue', 'super_lightning_gold', 'final_boss_dark_flame'):
        box = im.getchannel('A').getbbox()
        if box: im = im.crop(box)
    save(im, name, 1100 if 'sheet' in name or 'reference' in name else 850)

def sheet_frames(image: Image.Image, cols: int, rows: int, prefix: str) -> None:
    width, height = image.size
    frames = []
    for row in range(rows):
        for col in range(cols):
            box = (round(col * width / cols), round(row * height / rows),
                   round((col + 1) * width / cols), round((row + 1) * height / rows))
            frame = image.crop(box)
            bounds = frame.getchannel('A').getbbox()
            frames.append(remove_detached_artifacts(frame.crop(bounds) if bounds else frame))
    for pose, group in (('idle', frames[:cols * (rows // 2)]),
                        ('move', frames[cols * (rows // 2):])):
        cell = (220, 270)
        strip = Image.new('RGBA', (cell[0] * len(group), cell[1]))
        for index, frame in enumerate(group):
            frame.thumbnail((cell[0] - 8, cell[1] - 8), Image.Resampling.LANCZOS)
            strip.alpha_composite(frame, (index * cell[0] + (cell[0]-frame.width)//2,
                                          cell[1] - frame.height - 4))
        save(strip, f'{prefix}_{pose}', max(strip.size))

sheet_frames(get_image(6), 4, 4, 'player_base')
# The transformation sheet has eight idle frames, with no actual walking poses.
transform = get_image(16)
tw, th = transform.size
idle = Image.new('RGBA', (220 * 8, 270))
for index in range(8):
    row, col = divmod(index, 4)
    frame = transform.crop((col * tw // 4, row * th // 2,
                            (col + 1) * tw // 4, (row + 1) * th // 2))
    box = frame.getchannel('A').getbbox()
    frame = remove_detached_artifacts(frame.crop(box) if box else frame)
    frame.thumbnail((210, 260), Image.Resampling.LANCZOS)
    idle.alpha_composite(frame, (index * 220 + (220-frame.width)//2, 270-frame.height-4))
save(idle, 'player_transform_idle', max(idle.size))

# Both action reference boards include numbered poses, arrows and a dark backing.
# Extract each numbered character separately. GrabCut follows the figure silhouette
# within each cell; a dark-background threshold is used only as a fallback.
try:
    import cv2
except ImportError:
    cv2 = None

def extract_actions(image: Image.Image, prefix: str, transformed: bool) -> None:
    w, h = image.size
    # Explicit grid numbers are printed on each reference board.
    bands = ((.065, .323, 7, 'jump'), (.418, .632, 5, 'crouch'),
             (.765, .955, 7, 'roll'))
    arr = np.array(image.convert('RGB'))
    for y0, y1, count, pose in bands:
        strip = Image.new('RGBA', (260 * count, 290))
        for idx in range(count):
            left, right = round(w * idx / count), round(w * (idx + 1) / count)
            top, bottom = round(h * y0), round(h * y1)
            rgb = arr[top:bottom, left:right].copy()
            ch, cw = rgb.shape[:2]
            if cv2:
                mask = np.full((ch, cw), cv2.GC_PR_BGD, np.uint8)
                pad = 9
                mask[:pad] = mask[-pad:] = cv2.GC_BGD
                mask[:, :pad] = mask[:, -pad:] = cv2.GC_BGD
                # Central head/torso and bright skin/clothes provide foreground
                # seeds. Do not seed the dark reference-board background as FG.
                yy, xx = np.ogrid[:ch, :cw]
                ellipse = ((xx - cw*.50)/(cw*.36))**2 + ((yy - ch*.50)/(ch*.48))**2 < 1
                mask[ellipse] = cv2.GC_PR_FGD
                fg_seeds = (rgb[:, :, 0] > 115) & (rgb[:, :, 1] > 72) & (rgb[:, :, 2] > 61)
                fg_seeds &= ellipse & (yy > pad) & (yy < ch-pad)
                mask[fg_seeds] = cv2.GC_FGD
                mask[:pad] = mask[-pad:] = cv2.GC_BGD
                mask[:, :pad] = mask[:, -pad:] = cv2.GC_BGD
                cv2.grabCut(rgb[:, :, ::-1], mask, None,
                            np.zeros((1,65), np.float64), np.zeros((1,65), np.float64),
                            4, cv2.GC_INIT_WITH_MASK)
                fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
                fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8))
                labels, components, stats, _ = cv2.connectedComponentsWithStats(fg)
                if labels > 1:
                    largest = np.argmax(stats[1:, cv2.CC_STAT_AREA]) + 1
                    fg = np.where(components == largest, 255, 0).astype(np.uint8)
                fg = cv2.GaussianBlur(fg, (3,3), 0.6)
            else:
                fg = np.uint8(np.clip((rgb.max(axis=2).astype(np.int16) - 38) * 5, 0, 255))
            frame = Image.fromarray(np.dstack((rgb, fg)), 'RGBA')
            box = frame.getchannel('A').getbbox()
            frame = frame.crop(box) if box else frame
            frame.thumbnail((248, 282), Image.Resampling.LANCZOS)
            strip.alpha_composite(frame, (idx * 260 + (260-frame.width)//2,
                                          290-frame.height-4))
        save(strip, f'{prefix}_{pose}', max(strip.size))

extract_actions(get_image(7), 'player_base', False)
extract_actions(get_image(17), 'player_transform', True)

# The base action board has a colored panel, arrows and captions painted into the
# same pixels as the figures. Automated cutouts leave visible background shards.
# For the playable preview, derive clean transparent poses from its matching
# supplied idle/movement sheet, keeping the action board intact for reference.
base = get_image(6)
bw, bh = base.size
clean = []
for index in range(16):
    row, col = divmod(index, 4)
    frame = base.crop((round(col*bw/4), round(row*bh/4),
                       round((col+1)*bw/4), round((row+1)*bh/4)))
    box = frame.getchannel('A').getbbox()
    clean.append(remove_detached_artifacts(frame.crop(box) if box else frame))

def derived_strip(pose: str, transforms: list[tuple[int, float, int]]) -> None:
    strip = Image.new('RGBA', (260 * len(transforms), 290))
    for idx, (source, height, angle) in enumerate(transforms):
        im = clean[source].copy()
        target_height = int(260 * height)
        im.thumbnail((225, target_height), Image.Resampling.LANCZOS)
        if angle: im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
        im.thumbnail((252, 280), Image.Resampling.LANCZOS)
        strip.alpha_composite(im, (idx * 260 + (260-im.width)//2, 290-im.height-4))
    save(strip, f'player_base_{pose}', max(strip.size))

derived_strip('jump', [(0, 1, 0), (8, .74, 0), (9, 1, -9), (10, 1, -15),
                       (11, 1, 7), (12, .96, 0), (8, .72, 0)])
derived_strip('crouch', [(0, 1, 0), (8, .8, 0), (8, .66, 0),
                         (9, .75, 0), (0, 1, 0)])
derived_strip('roll', [(8, .82, -18), (9, .72, -55), (10, .75, -105),
                       (11, .75, -165), (12, .75, -230), (13, .76, -300), (14, 1, 0)])

manifest = {name: f'assets/sprites/{name}.png' for name in NAMES}
manifest.update({f'player_base_{pose}': f'assets/sprites/player_base_{pose}.png'
                 for pose in ('idle', 'move', 'jump', 'crouch', 'roll')})
manifest.update({f'player_transform_{pose}': f'assets/sprites/player_transform_{pose}.png'
                 for pose in ('idle', 'jump', 'crouch', 'roll')})
(DEST.parent.parent.parent / 'data/assets/sprites.json').parent.mkdir(parents=True, exist_ok=True)
(DEST.parent.parent.parent / 'data/assets/sprites.json').write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'Prepared {len(NAMES)} named uploads and 9 action strips in {DEST}')
