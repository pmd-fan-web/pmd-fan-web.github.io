# 원작(레드 구조대·하늘의 탐험대) 던전 타일 시트를 게임이 쓰는 DTEF 형식(18×8칸, 24px)으로 바꾼다.
# 시트(The Spriters Resource, SilverDeoxys563 정리본)는 칸마다 왼쪽 'Legend' 열에 이웃 모양(3×3, 검은 칸 = 같은 지형)이 있고,
# 같은 줄·같은 칸의 Walls / Ground / Water 열이 그 모양의 타일이다. 열 이름은 머리글 그림을 알려진 이름과 맞춰 고른다.
#
# 출력: <out>/<이름>.png (기본: 벽·물·바닥), <이름>_1.png, <이름>_2.png (벽·바닥의 변형. 없는 칸은 투명)
# 사용법: python tools/build_tilesets.py assets_in/Tileset pmdgfx/tiles
import sys, os, glob, re, hashlib, json
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
LINE = (128, 255, 255)
TEAL = (0, 128, 128)

# 이웃 비트 (js/tiles.js와 같게)
NW, N, NE, E, SE, S, SW, W = 1, 2, 4, 8, 16, 32, 64, 128
LAYOUT = [
    E | S | SE, W | E | SW | S | SE, W | SW | S, E | S, W | E, W | S,
    N | NE | E | S | SE, 255, NW | N | W | SW | S, N | S, 0, N | W,
    N | NE | E, NW | N | NE | W | E, NW | N | W, N | E, S, None,
    NW | N | W | E | SW | S, N | NE | W | E | S | SE, W | E | S, E, N | W | E | S, W,
    N | W | E | SW | S | SE, NW | N | NE | W | E | S, N | W | E, N | E | S, N, N | W | S,
    NW | N | NE | W | E | SW | S, NW | N | NE | W | E | S | SE, N | NE | E | S, NW | N | W | S, W | E | SW | S, W | E | S | SE,
    NW | N | W | E | SW | S | SE, N | NE | W | E | SW | S | SE, N | E | S | SE, N | W | SW | S, NW | N | W | E, N | NE | W | E,
    N | W | E | S | SE, N | W | E | SW | S, N | NE | W | E | S, NW | N | W | E | S, N | NE | W | E | SW | S, NW | N | W | E | S | SE,
]
RULE = {m: i for i, m in enumerate(LAYOUT) if m is not None}
def reduce(m):
    if m & NW and not (m & N and m & W): m &= ~NW
    if m & NE and not (m & N and m & E): m &= ~NE
    if m & SW and not (m & S and m & W): m &= ~SW
    if m & SE and not (m & S and m & E): m &= ~SE
    return m

# 머리글 이름 (hdrs 묶음을 눈으로 확인해서 붙인 것). 역할: wall / walt / ground / galt / water / skip
HEADER_ROLE = json.load(open(os.path.join(os.path.dirname(__file__), 'tileset_headers.json'), encoding='utf-8'))

def header_key(im, x0, y0):
    hdr = im.crop((x0 + 2, y0 - 16, x0 + 73, y0 - 3))
    bw = bytes(1 if sum(p) > 600 else 0 for p in hdr.getdata())
    return hashlib.md5(bw).hexdigest()[:8]

def is_empty(tile):
    # 빈 칸(청록 바탕·투명)이거나, 청록 바탕에 메모 글씨가 적힌 칸 (예: Howling Forest의 'wtf <-'). 진짜 타일에는 청록 바탕색이 거의 없다
    px = list(tile.getdata()); teal = sum(1 for p in px if p[:3] == TEAL); clear = sum(1 for p in px if p[3] < 10)
    return teal + clear > len(px) * 0.85 or teal > len(px) * 0.25

def clean(tile):   # 마젠타(투명 표시)는 투명으로
    t = tile.copy(); d = t.load()
    for y in range(t.height):
        for x in range(t.width):
            if d[x, y][:3] == (255, 0, 255): d[x, y] = (0, 0, 0, 0)
    return t

def slug(name):
    n = re.sub(r'^.*Dungeon Tiles - ', '', name)[:-4]
    return re.sub(r'[^a-z0-9]+', '', n.lower())

report = {}
for f in sorted(glob.glob(os.path.join(SRC, '*Dungeon Tiles*.png'))):
    im = Image.open(f).convert('RGBA'); rgb = im.convert('RGB'); Wd, Ht = im.size
    xs = [x for x in range(Wd) if sum(1 for y in range(0, Ht, 2) if rgb.getpixel((x, y)) == LINE) > 100]
    ys = [y for y in range(Ht) if sum(1 for x in range(0, Wd, 2) if rgb.getpixel((x, y)) == LINE) > 100]
    if len(xs) < 9 or len(ys) < 10: report[os.path.basename(f)] = 'skip (격자 없음)'; continue
    xs.append(xs[-1] + 25); ys.append(ys[-1] + 25)   # 마지막 줄·칸의 끝
    groups = len(xs[:-1]) // 3
    roles = [HEADER_ROLE.get(header_key(rgb, xs[g * 3], ys[0]), 'skip') for g in range(groups)]
    cols = {r: [g for g, x in enumerate(roles) if x == r] for r in ('wall', 'walt', 'ground', 'galt', 'water')}
    if not cols['wall'] or not cols['ground']: report[os.path.basename(f)] = f'skip (열 이름 {roles})'; continue
    sheets = [Image.new('RGBA', (432, 192), (0, 0, 0, 0)) for _ in range(3)]
    filled = [0, 0, 0]
    for r in range(len(ys) - 2):
        for c in range(3):
            lx, ly = xs[c] + 1, ys[r] + 1
            cen = rgb.getpixel((lx + 12, ly + 12))
            if sum(cen) < 600: continue   # 흰 가운데가 있는 칸만 (빈 칸 건너뛰기)
            m = 0
            for (dx, dy, bit) in [(4, 4, NW), (12, 4, N), (20, 4, NE), (20, 12, E), (20, 20, SE), (12, 20, S), (4, 20, SW), (4, 12, W)]:
                if sum(rgb.getpixel((lx + dx, ly + dy))) < 60: m |= bit
            idx = RULE.get(reduce(m))
            if idx is None: continue
            def put(group, sheet, block):
                tx = xs[group * 3 + c] + 1; tile = im.crop((tx, ly, tx + 24, ly + 24))
                if is_empty(tile): return
                dx, dy = (block * 6 + idx % 6) * 24, (idx // 6) * 24
                if sheet > 0 or not sheets[sheet].getpixel((dx + 12, dy + 12))[3]:
                    sheets[sheet].paste(clean(tile), (dx, dy)); filled[sheet] += 1
            put(cols['wall'][0], 0, 0); put(cols['ground'][0], 0, 2)
            if cols['water']: put(cols['water'][0], 0, 1)
            for k in (1, 2):
                if len(cols['walt']) >= k: put(cols['walt'][k - 1], k, 0)
                if len(cols['galt']) >= k: put(cols['galt'][k - 1], k, 2)
    name = slug(os.path.basename(f))
    sheets[0].save(os.path.join(OUT, name + '.png'), optimize=True)
    for k in (1, 2):
        p = os.path.join(OUT, f'{name}_{k}.png')
        if filled[k]: sheets[k].save(p, optimize=True)
        elif os.path.exists(p): os.remove(p)
    report[os.path.basename(f)] = f'{name}: 기본 {filled[0]}칸, 변형 {filled[1]}/{filled[2]}칸 ({roles})'
for k, v in report.items(): print(v if v.startswith(('skip',)) is False else f'{k}: {v}')
