# 영어 데이터 만들기 (v1.14): PokeAPI 영어 이름·설명 + tools/en_manual.json → js/lang_en.js
#   python tools/build_en.py <PokeAPI csv 폴더>
#   csv: move_names, move_flavor_text, ability_names, ability_flavor_text, item_names, type_names
#   (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
# 설명은 tools_build_data.py처럼 가장 최근 버전 그룹의 글을 쓴다. 게임 전용 기술·특성·도구는 en_manual.json
import csv, json, os, sys, re
src = sys.argv[1]
R = lambda f: list(csv.DictReader(open(os.path.join(src, f + '.csv'), encoding='utf8')))
t = open('js/data.js', encoding='utf-8').read()
D = json.loads(t[t.index('=') + 1:].rstrip().rstrip(';'))
man = json.load(open('tools/en_manual.json', encoding='utf-8'))

def names(f, key):
    return {int(r[key]): r['name'] for r in R(f) if r['local_language_id'] == '9'}
def flavor(f, key):
    out = {}
    for r in R(f):
        if r['language_id'] != '9': continue
        k, vg = int(r[key]), int(r['version_group_id'])
        if k not in out or vg >= out[k][0]: out[k] = (vg, ' '.join(r['flavor_text'].split()))
    return {k: v[1] for k, v in out.items()}

mn, mf = names('move_names', 'move_id'), flavor('move_flavor_text', 'move_id')
an, af = names('ability_names', 'ability_id'), flavor('ability_flavor_text', 'ability_id')
moves, miss = {}, []
for k in D['moves']:
    i = int(k)
    if k in man['moves']: moves[k] = man['moves'][k]
    elif i in mn: moves[k] = [mn[i], mf.get(i, '')]
    else: miss.append(('move', k, D['moves'][k]['n']))
abilities = {}
for k in D['abilities']:
    i = int(k)
    if k in man['abilities']: abilities[k] = man['abilities'][k]
    elif i in an: abilities[k] = [an[i], af.get(i, '')]
    else: miss.append(('ability', k, D['abilities'][k]['n']))
for k, v in man['moves'].items(): moves.setdefault(k, v)
for k, v in man['abilities'].items(): abilities.setdefault(k, v)
# 게임에서 더한 기술·특성 (moverules.js 등)이 PokeAPI에 있으면 그 번호로도 넣는다
for i, n in mn.items():
    if str(i) not in moves and i < 10000: moves[str(i)] = [n, mf.get(i, '')]
for i, n in an.items():
    if str(i) not in abilities and i < 10000: abilities[str(i)] = [n, af.get(i, '')]

ko2en = {}
rows = R('item_names')
ko = {r['item_id']: r['name'] for r in rows if r['local_language_id'] == '3'}
en = {r['item_id']: r['name'] for r in rows if r['local_language_id'] == '9'}
for i, k in ko.items():
    if i in en: ko2en[k.replace(' ', '')] = en[i]
items = dict(man['items'])
for key, kn in man['megaKo'].items():
    e = man.get('megaEn', {}).get(key) or ko2en.get(kn.replace(' ', ''))
    if not e:   # PokeAPI에 아직 없는 메가스톤: 번호 이름으로 (ms_raichu_mega_x → Raichunite X)
        m = re.match(r'ms_(\w+?)_mega(?:_(\w))?$', key); sp = m.group(1).split('_')[0].capitalize()
        e = sp + 'ite' + (' ' + m.group(2).upper() if m.group(2) else ''); miss.append(('mega-guess', key, e))
    items[key] = [e, None]
types = [x[1] for x in sorted((int(r['type_id']), r['name']) for r in R('type_names') if r['local_language_id'] == '9' and int(r['type_id']) <= 18)]

out = {'types': types, 'moves': moves, 'abilities': abilities, 'items': items}
open('js/lang_en.js', 'w', encoding='utf-8', newline='\n').write(
    '// 영어 이름·설명 (v1.14, tools/build_en.py로 만든다. 직접 고치지 말고 tools/en_manual.json을 고친다)\n'
    '// 출처: PokeAPI (https://pokeapi.co) 영어 이름·설명, 게임 전용은 직접 번역\n'
    'const LANG_EN = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('moves', len(moves), 'abilities', len(abilities), 'items', len(items), 'types', len(types))
for m in miss: print('MISS', *m)
