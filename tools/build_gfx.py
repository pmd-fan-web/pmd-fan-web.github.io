# 원작 아이템·함정·상태 이상 그림 묶음 만들기
# 입력: assets_in/ 의 시트 두 장 (Spriters Resource, PMD 레드 구조대: 아이템·상태 이상)
# 출력: items.png (16×16 칸), traps.png (24×24 칸), status.png (상태 이상 애니메이션 줄)
#   → ../pmd-fan-web-assets/sprites/ (사이트용, 별도 저장소) 와 pmdgfx/ (내 컴퓨터 테스트용, git에 안 올라감)
# 칸 번호는 js/gfx.js 의 GFX_ITEM_CELLS 순서와 같아야 한다
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets_in')
OUTS = [os.path.join(ROOT, '..', 'pmd-fan-web-assets', 'sprites'), os.path.join(ROOT, 'pmdgfx')]
ITEMS_SHEET = 'Game Boy Advance - Pokemon Mystery Dungeon_ Red Rescue Team - Miscellaneous - Items & Objects.png'
STATUS_SHEET = 'Game Boy Advance - Pokemon Mystery Dungeon_ Red Rescue Team - Miscellaneous - Status Effects.png'


def transparent(im, bg):
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][:3] == bg[:3]:
                px[x, y] = (0, 0, 0, 0)
    return im


def components(im, bg, ymax):
    W = im.width
    seen = set()
    out = []
    for y in range(ymax):
        for x in range(W):
            if (x, y) in seen or im.getpixel((x, y))[:3] == bg[:3]:
                continue
            st = [(x, y)]; seen.add((x, y)); xs = []; ys = []
            while st:
                a, b = st.pop(); xs.append(a); ys.append(b)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        c, d = a + dx, b + dy
                        if 0 <= c < W and 0 <= d < ymax and (c, d) not in seen and im.getpixel((c, d))[:3] != bg[:3]:
                            seen.add((c, d)); st.append((c, d))
            if len(xs) > 6:
                out.append((min(xs), min(ys), max(xs), max(ys)))
    out.sort(key=lambda r: (r[1] // 6, r[0]))
    return out


# 시트의 아이템 덩어리 번호 (components 정렬 순서) → 묶음 칸 순서
ITEM_PICK = list(range(0, 10)) + list(range(10, 20)) + list(range(20, 26)) + list(range(27, 34)) + list(range(34, 40)) \
    + list(range(40, 46)) + list(range(46, 50)) + [51, 52, 53] + [60, 61] + [66, 67]


def main():
    sheet = Image.open(os.path.join(SRC, ITEMS_SHEET)).convert('RGB')
    bg = sheet.getpixel((0, 0))
    comps = components(sheet, bg, 142)
    clear = transparent(sheet, bg)
    cols = 16
    items = Image.new('RGBA', (cols * 16, ((len(ITEM_PICK) + cols - 1) // cols) * 16), (0, 0, 0, 0))
    for i, ci in enumerate(ITEM_PICK):
        x0, y0, x1, y1 = comps[ci]
        w, h = x1 - x0 + 1, y1 - y0 + 1
        if w > 16 or h > 16:
            sys.exit(f'item {ci} too big: {w}x{h}')
        part = clear.crop((x0, y0, x1 + 1, y1 + 1))
        items.paste(part, ((i % cols) * 16 + (16 - w) // 2, (i // cols) * 16 + (16 - h) // 2), part)
    # 함정·바닥: 24×24 칸 8×3 (시트의 배치 그대로)
    traps = Image.new('RGBA', (8 * 24, 3 * 24), (0, 0, 0, 0))
    for r, y in enumerate([143, 168, 193]):
        for c in range(8):
            x = 1 + 25 * c
            traps.paste(sheet.crop((x, y, x + 24, y + 24)).convert('RGBA'), (c * 24, r * 24))
    # 상태 이상: 오른쪽 그림 부분만 (x 104~, y 32~264), 배경은 투명
    st = Image.open(os.path.join(SRC, STATUS_SHEET)).convert('RGBA')
    sbg = st.getpixel((st.width - 1, st.height - 1))
    status = transparent(st.crop((104, 32, 344, 264)), sbg)
    out = {'items': items, 'traps': traps, 'status': status}
    for d in OUTS:
        os.makedirs(d, exist_ok=True)
        for name, img in out.items():
            img.save(os.path.join(d, name + '.png'))
    for name, img in out.items():
        print(name, img.size)


if __name__ == '__main__':
    main()
