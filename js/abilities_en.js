// 영어 (LANG === 'en'에서만 읽는다): 원문 → 영어. 원문이 바뀌면 그 문장은 한국어로 나온다
'use strict';
const ABIL_EN = {
"모든 기술이 자속 보정(1.5배)을 받는다.": "All moves get the same-type bonus (×1.5).",
"스카이스킨": "Aerilate",
"노말타입의 기술이 비행타입이 된다. 위력이 조금 올라간다.": "Turns Normal-type moves into Flying-type moves and boosts their power a little.",
"드래곤스킨": "Dragonize",
"노말타입의 기술이 드래곤타입이 된다. 위력이 조금 올라간다.": "Turns Normal-type moves into Dragon-type moves and boosts their power a little.",
"메가솔라": "Mega Sol",
"날씨가 쾌청이 아니어도 쾌청일 때처럼 기술을 쓸 수 있다.": "Uses moves as if the weather were harsh sunlight, even when it isn't.",
"하바네로분출": "Spicy Spray",
"공격 기술로 데미지를 받으면 공격한 상대를 화상 상태로 만든다.": "When hit by a damaging move, burns the attacker.",
"불꽃의갈기": "Fiery Mane",
"불꽃타입 기술의 위력이 올라간다.": "Boosts the power of Fire-type moves.",
"파동의방호": "Aura Guard",
"접촉하는 기술로 받는 데미지가 절반이 된다.": "Halves damage taken from contact moves.",
"혼연일체": "As One",
"버드렉스의 긴장감과 블리자포스의 백의울음 두 가지 특성을 겸비한다.": "Combines Calyrex's Unnerve and Glastrier's Chilling Neigh.",
"버드렉스의 긴장감과 레이스포스의 흑의울음 두 가지 특성을 겸비한다.": "Combines Calyrex's Unnerve and Spectrier's Grim Neigh.",
"자기 기술은 늘 쾌청일 때처럼 쓴다: 불꽃 기술 1.5배·물 기술 0.5배, 솔라빔을 모으지 않고 쏘고, 아침햇살·광합성 회복량이 늘어난다.": "Its own moves always act as in harsh sunlight: Fire moves ×1.5, Water moves ×0.5, Solar Beam fires without charging, and Morning Sun and Synthesis heal more.",
"공격 기술로 데미지를 받으면 공격한 상대가 화상에 걸린다.": "When hit by a damaging move, the attacker is burned.",
"긴장감(적이 기술을 쓰는 확률 절반) + 적을 쓰러뜨리면 공격이 1단계 오른다.": "Unnerve (foes use moves half as often) + defeating a foe raises Attack by 1 stage.",
"긴장감(적이 기술을 쓰는 확률 절반) + 적을 쓰러뜨리면 특수공격이 1단계 오른다.": "Unnerve (foes use moves half as often) + defeating a foe raises Sp. Atk by 1 stage.",
"자신과 같은 타입을 가진 적에게 위력이 1.25배.": "×1.25 power against foes that share its type.",
"지난 행동 이후 공격을 받았다면 위력이 1.3배.": "×1.3 power if it was hit since its last action.",
"그 적에게 하는 첫 공격의 위력이 2배.": "×2 power on its first attack against each foe.",
"상대의 방어·특수방어 상승을 무시하고 공격한다.": "Ignores the target's Defense and Sp. Def boosts.",
"공격이 맞으면 30% 확률로 상대를 독 상태로 만든다.": "30% chance to poison the target when an attack hits.",
"날씨가 없어서 대신 불꽃 기술의 위력이 1.3배.": "With no weather, Fire moves get ×1.3 power instead.",
"날씨가 없어서 대신 물 기술의 위력이 1.3배.": "With no weather, Water moves get ×1.3 power instead.",
"날씨가 없어서 대신 바위 기술의 위력이 1.3배.": "With no weather, Rock moves get ×1.3 power instead.",
"날씨가 없어서 대신 얼음 기술의 위력이 1.3배.": "With no weather, Ice moves get ×1.3 power instead.",
"모래바람이 없어도 땅·바위·강철 기술의 위력이 1.2배.": "Ground, Rock and Steel moves get ×1.2 power even without a sandstorm.",
"층에 들어서거나(탐험대) 처음 마주치면(적) 발밑을 일렉트릭필드로 바꾼다.": "Sets Electric Terrain underfoot on entering a floor (team) or when first met (foe).",
"층에 들어서거나(탐험대) 처음 마주치면(적) 발밑을 사이코필드로 바꾼다.": "Sets Psychic Terrain underfoot on entering a floor (team) or when first met (foe).",
"층에 들어서거나(탐험대) 처음 마주치면(적) 발밑을 미스트필드로 바꾼다.": "Sets Misty Terrain underfoot on entering a floor (team) or when first met (foe).",
"층에 들어서거나(탐험대) 처음 마주치면(적) 발밑을 그래스필드로 바꾼다.": "Sets Grassy Terrain underfoot on entering a floor (team) or when first met (foe).",
"날씨가 없어서 HP 감소 없이 특수공격이 1.3배.": "With no weather, Sp. Atk is ×1.3 with no HP loss.",
"동료가 없으므로 항상 특수공격이 1.2배.": "With no partner around, Sp. Atk is always ×1.2.",
"가장 높은 능력(공격·방어·특공·특방)이 항상 1.3배. (던전에는 일렉트릭필드가 없어서 늘 발동)": "Its highest stat (Attack, Defense, Sp. Atk, Sp. Def) is always ×1.3. (Always active, as dungeons have no Electric Terrain)",
"쾌청이면 가장 높은 능력(공격·방어·특공·특방)이 1.3배. (평소 1.1배)": "In harsh sunlight, its highest stat (Attack, Defense, Sp. Atk, Sp. Def) is ×1.3. (×1.1 otherwise)",
"공격이 1.33배.": "Attack ×1.33.",
"특수방어가 1.25배. (주변 포켓몬의 특수공격을 낮추는 효과를 재해석)": "Sp. Def ×1.25. (Reworks lowering nearby Pokémon's Sp. Atk)",
"노말·격투 기술이 고스트 타입에게도 맞는다. 상대의 회피율 상승을 무시하고, 명중률이 떨어지지 않는다.": "Normal and Fighting moves hit Ghost types. Ignores the target's evasion boosts, and its accuracy can't be lowered.",
"특수공격이 1.25배. (주변 적의 특수방어를 낮추는 효과를 재해석)": "Sp. Atk ×1.25. (Reworks lowering nearby foes' Sp. Def)",
"공격이 1.1배.": "Attack ×1.1.",
"전기 기술의 위력이 1.3배.": "Electric moves ×1.3 power.",
"풀 기술의 위력이 1.2배.": "Grass moves ×1.2 power.",
"강철 타입 적에게 주는 데미지가 1.2배.": "×1.2 damage to Steel-type foes.",
"HP가 가득 찬 상태에서는 한 번에 쓰러지지 않는다. (함정·반동 포함, 여러 번 맞는 연속기는 버티지 못한다)": "Can't be knocked out in one hit from full HP. (Includes traps and recoil; doesn't hold against multi-hit moves)",
"가루 기술과 독가시·폭발 함정이 통하지 않는다.": "Immune to powder moves and Poison Sting and Explosion traps.",
"폭발 함정과 폭발씨의 데미지를 받지 않는다.": "Takes no damage from Explosion traps or Blast Seeds.",
"땅 타입 기술을 받지 않고, 함정을 밟지 않는다.": "Immune to Ground-type moves and doesn't trigger traps.",
"워프 함정에 걸리지 않는다.": "Unaffected by Warp traps.",
"적의 주변 공격(범위 기술)에 받는 데미지가 절반.": "Takes half damage from foes' area attacks.",
"동료가 없으므로 자신이 받는 데미지가 0.9배.": "With no partner around, takes ×0.9 damage.",
"선제기가 없으므로 받는 데미지가 0.9배.": "With no priority moves in play, takes ×0.9 damage.",
"위압감으로 적의 명중률이 0.9배.": "Its Pressure makes foes' accuracy ×0.9.",
"적의 변화 기술(상태이상·능력 하락)을 받지 않는다.": "Unaffected by foes' status moves (status conditions, stat drops).",
"전기 기술을 받지 않고 공격이 오른다. (스피드 대신)": "Immune to Electric moves, and they raise its Attack. (instead of Speed)",
"자신과 같은 편 모두(같은 층) 잠듦 상태가 되지 않는다.": "It and all allies (same floor) can't fall asleep.",
"자신과 같은 편 모두(같은 층) 혼란 상태가 되지 않는다. 자신은 위협도 받지 않는다.": "It and all allies (same floor) can't be confused. It's also immune to Intimidate.",
"혼란에 걸리지 않고 위협도 통하지 않는다.": "Can't be confused and is immune to Intimidate.",
"날씨가 없어서 대신 상태이상에 걸릴 확률이 절반.": "With no weather, the chance of status conditions is halved instead.",
"능력이 떨어지지 않는다.": "Its stats can't be lowered.",
"명중률이 떨어지지 않고, 옆 칸의 함정을 반드시 발견한다.": "Its accuracy can't be lowered, and it always spots traps on adjacent tiles.",
"교체가 없으므로 대신 상태이상이 절반의 시간만에 낫는다.": "With no switching, status conditions heal in half the time instead.",
"비가 없어도 턴마다 20% 확률로 상태이상이 낫는다.": "Even without rain, 20% chance each turn to heal status conditions.",
"턴마다 옆 칸에 있는 같은 편(자신 제외)의 상태이상을 30% 확률로 고쳐 준다.": "Each turn, 30% chance to heal the status of an adjacent ally (not itself).",
"공격 외의 데미지(독·화상·반동·함정·배고픔)를 받지 않는다.": "Takes no damage except from attacks (poison, burn, recoil, traps, hunger).",
"접촉 공격을 한 상대의 특성을 가시지않는향기로 바꾼다.": "Changes the Ability of a foe that makes contact to Lingering Aroma.",
"공격을 받으면 발밑을 그래스필드로 만든다.": "Turns the ground into Grassy Terrain when hit.",
"불꽃 기술을 맞으면 공격이 올라간다. 화상을 입지 않는다.": "Attack rises when hit by Fire moves. Can't be burned.",
"상태이상이 되지 않는다. 고스트 기술로 받는 데미지가 절반이 된다.": "Can't get status conditions. Halves damage from Ghost moves.",
"불꽃 기술을 맞으면 데미지를 받지 않고 방어가 크게 올라간다.": "Takes no damage from Fire moves and sharply raises Defense instead.",
"바람 기술을 맞으면 데미지를 받지 않고 공격이 올라간다.": "Takes no damage from wind moves and raises Attack instead.",
"바람 기술을 맞으면 몸에 전기를 모은다 (다음 전기 기술의 위력이 올라간다).": "Charges up when hit by a wind move (boosting its next Electric move).",
"교체되어 물러나면 마이티폼으로 바뀐다.": "Changes to Hero Form when switched out.",
"동료 어써러셔의 입속에 들어가 안에서 지시를 내린다.": "Goes inside an allied Dondozo's mouth and gives orders from there.",
"데미지를 받으면 몸에 전기를 모은다 (다음 전기 기술의 위력이 올라간다).": "Charges up when taking damage (boosting its next Electric move).",
"쾌청이거나 부스터에너지를 지니고 있으면 가장 높은 능력이 올라간다.": "Raises its highest stat in harsh sunlight or while holding Booster Energy.",
"일렉트릭필드이거나 부스터에너지를 지니고 있으면 가장 높은 능력이 올라간다.": "Raises its highest stat on Electric Terrain or while holding Booster Energy.",
"황금처럼 단단한 몸이라 상대의 변화 기술을 받지 않는다.": "Its body is hard as gold, so it isn't affected by the foe's status moves.",
"재앙을 부르는 그릇의 힘으로 자신 이외 모든 포켓몬의 특수공격을 낮춘다.": "The power of its ruinous vessel lowers the Sp. Atk of all other Pokémon.",
"마음의 눈으로 보기 때문에 노말·격투 타입 기술을 고스트 타입에게 맞힐 수 있다. 상대의 회피율 변화를 무시하고, 명중률도 떨어지지 않는다.": "Its mind's eye lets its Normal- and Fighting-type moves hit Ghost types. Ignores evasion changes, and its accuracy can't be lowered.",
"재앙을 부르는 구슬의 힘으로 자신 이외 모든 포켓몬의 특수방어를 낮춘다.": "The power of its ruinous beads lowers the Sp. Def of all other Pokémon.",
"등장했을 때 날씨를 쾌청으로 만든다. 쾌청이면 공격이 올라간다.": "Turns the sunlight harsh when it appears. Attack rises in harsh sunlight.",
"상대의 능력이 올라가면 자신도 편승해서 똑같이 올린다.": "When a foe's stats rise, it copies the boost.",
"먹은 열매를 다음 턴에 한 번 더 되새김질해서 먹는다.": "Chews a Berry it ate once more on the next turn.",
"베는 기술의 위력이 올라간다.": "Boosts the power of slicing moves.",
"쓰러진 동료가 많을수록 공격과 특수공격이 조금씩 올라간다.": "Attack and Sp. Atk rise a little for each fainted ally.",
"물리 공격을 받으면 상대 주변에 독압정을 뿌린다.": "Scatters Toxic Spikes around the foe when hit by a physical attack.",
"꼬리의 갑옷 덕분에 상대의 선제 기술을 받지 않는다.": "Its tail armor blocks the foe's priority moves.",
"땅 타입 기술을 맞으면 데미지를 받지 않고 HP를 회복한다.": "Takes no damage from Ground-type moves and restores HP instead.",
"변화 기술을 늦게 쓰는 대신 상대의 특성에 방해받지 않는다.": "Uses status moves last, but isn't hindered by the foe's Ability.",
"등장했을 때 달콤한 꿀 향기로 상대의 회피율을 떨어뜨린다.": "Lowers the foe's evasion with a sweet honey scent when it appears.",
"등장했을 때 동료를 대접해서 HP를 회복시킨다.": "Treats allies when it appears, restoring their HP.",
"공격하면 상대를 맹독 상태로 만들 때가 있다.": "Attacks may badly poison the target.",
"등장했을 때 테라스탈폼으로 바뀐다.": "Changes to Terastal Form when it appears.",
"HP가 가득 차 있으면 어떤 기술을 맞아도 효과가 별로다.": "At full HP, every move it's hit by is not very effective.",
"독 상태로 만든 상대를 혼란에 빠뜨린다.": "Confuses targets it poisons.",
"접촉 기술이 방어 기술을 뚫고 맞는다. (이때는 데미지가 줄어든다)": "Contact moves break through protection. (Damage is reduced then)",
"HP가 절반 이하가 되면 코어의 모습이 된다 (방어·특수방어가 낮아지고 공격·특수공격·스피드가 오른다).": "At half HP or less, it takes its Core form (Defense and Sp. Def drop; Attack, Sp. Atk and Speed rise).",
"HP가 절반 이하가 되면 달마모드가 된다.": "At half HP or less, it enters Zen Mode.",
"공격 기술을 쓰면 블레이드폼, 변화 기술을 쓰면 실드폼이 된다. 층마다 실드폼으로 돌아온다.": "Becomes Blade Forme when it uses an attack and Shield Forme when it uses a status move. Returns to Shield Forme each floor.",
"Lv20 이상이고 HP가 1/4보다 많으면 군집의 모습이 된다.": "At Lv20+ with HP above 1/4, it takes School Form.",
"물리 공격을 한 번 막아 내고 나이스페이스가 된다. 설경인 층에 들어서면 다시 아이스페이스가 된다.": "Blocks one physical attack and becomes Noice Face. Returns to Ice Face on entering a snowy floor.",
"5턴마다 배부른 모양과 배고픈 모양이 번갈아 바뀐다.": "Switches between Full Belly and Hangry Mode every 5 turns.",
"계단을 한 번 내려간 뒤로는 마이티폼이 된다.": "Becomes Hero Form after going down the stairs once.",
"던전에서는 늘 테라스탈폼이 된다.": "Always in Terastal Form in dungeons.",
"🔄 던전에서 모습이 바뀐다: ": "🔄 Changes form in dungeons:",
"천정부지": "Eelevate",
"땅에서 떠 있어 땅 타입 기술을 받지 않는다. 기술로 상대를 쓰러뜨리면 가장 높은 능력이 올라간다.": "Floats above the ground, avoiding Ground-type moves. Defeating a foe with a move raises its highest stat.",
"땅 타입 기술을 받지 않고 함정을 밟지 않는다. 적을 쓰러뜨리면 공격·특수공격 중 높은 쪽이 1단계 오른다.": "Immune to Ground-type moves and doesn't trigger traps. Defeating a foe raises the higher of Attack or Sp. Atk by 1 stage.",
"처음 마주친 적의 공격을 1단계 낮춘다. (탐험대에 여럿 있어도 한 번만, 적의 위협은 탐험대 모두에게)": "Lowers the Attack of the first foe it meets by 1 stage. (Once even if several teammates have it; a foe's Intimidate hits the whole team)",
"처음 마주친 적의 회피율을 1단계 낮춘다. (탐험대에 여럿 있어도 한 번만, 적의 위압감은 탐험대 모두에게)": "Lowers the evasion of the first foe it meets by 1 stage. (Once even if several teammates have it; a foe's Supersweet Syrup hits the whole team)",
"벌레·고스트·악 기술에 맞으면 공격이 오른다. (스피드 대신)": "Attack rises when hit by Bug, Ghost or Dark moves. (instead of Speed)",
"물리 공격에 맞으면 방어가 떨어지고 공격이 오른다. (스피드 대신)": "When hit by a physical attack, Defense falls and Attack rises. (instead of Speed)",
"풀죽으면 공격이 오른다. (스피드 대신)": "Attack rises when it flinches. (instead of Speed)",
"10턴마다 무작위 능력 하나가 크게 오르고 다른 하나가 떨어진다.": "Every 10 turns, one random stat rises sharply and another falls.",
"층에 들어설 때마다 공격 또는 특수공격이 오른다.": "Attack or Sp. Atk rises each time it enters a floor.",
"층에 들어설 때마다 공격이 오른다.": "Attack rises each time it enters a floor.",
"층에 들어설 때마다 방어가 오른다.": "Defense rises each time it enters a floor.",
"스피드가 없으므로 대신 행동 후 15% 확률로 적이 움직이지 못한다 (한 턴 더 행동).": "With no Speed order, 15% chance after acting to freeze foes in place instead (one more action).",
"날씨·스피드 대신 행동 후 10% 확률로 적이 움직이지 못한다 (한 턴 더 행동).": "Instead of weather and Speed, 10% chance after acting to freeze foes in place (one more action).",
"상태이상일 때 회피율이 1.3배. (스피드 대신)": "Evasion ×1.3 while it has a status condition. (instead of Speed)",
"HP가 1/4 이하이면 회피율이 1.5배.": "Evasion ×1.5 at 1/4 HP or less.",
"날씨가 없어도 회피율이 1.1배.": "Evasion ×1.1 even with no weather.",
"접촉한 적을 30% 확률로 혼란에 빠뜨린다. (헤롱헤롱 대신)": "30% chance to confuse foes that make contact. (instead of infatuation)",
"접촉한 적의 공격을 낮춘다. (스피드 대신)": "Lowers the Attack of foes that make contact. (instead of Speed)",
"접촉한 적을 30% 확률로 풀죽게 한다.": "30% chance to make foes that make contact flinch.",
"접촉한 적의 명중률을 낮춘다.": "Lowers the accuracy of foes that make contact.",
"접촉한 적을 30% 확률로 독 상태로 만든다.": "30% chance to poison foes that make contact.",
"접촉 공격을 받으면 10% 확률로 아이템을 줍는다.": "10% chance to pick up an item when hit by a contact attack.",
"접촉 공격이 맞으면 10% 확률로 아이템을 얻는다.": "10% chance to get an item when its contact attack hits.",
"접촉 기술로 쓰러지면 쓰러뜨린 상대에게 그 상대의 최대 HP 1/4 데미지를 준다.": "If knocked out by a contact move, deals 1/4 of the attacker's max HP to it.",
"행동할 때 25% 확률로 게으름을 피운다. (원작은 한 턴 걸러 행동)": "25% chance to loaf around when acting. (In the originals it acts every other turn)",
"층에 들어선 뒤 10턴 동안 공격이 절반.": "Attack is halved for 10 turns after entering a floor.",
"교체 대신 자연 회복 속도가 2배.": "Instead of switching, natural healing is ×2.",
"날씨 대신 자연 회복 속도가 1.5배.": "Instead of weather, natural healing is ×1.5.",
"층에 들어설 때 30% 확률로 아이템을 주워 온다.": "30% chance to bring back an item on entering a floor.",
"층에 들어설 때 20% 확률로 사과를 발견한다.": "20% chance to find an Apple on entering a floor.",
"열매를 먹었을 때 50% 확률로 열매가 남는다.": "50% chance a Berry is left over after eating it.",
"열매로 회복하는 양이 1.5배.": "Healing from Berries ×1.5.",
"음식으로 채우는 배고픔이 1.5배.": "Belly filled by food ×1.5.",
"쓰러졌을 때 잃는 아이템이 1/4로 줄어든다.": "Items lost when fainting are cut to 1/4.",
"층의 아이템 위치가 미니맵에 표시된다.": "Item locations on the floor show on the minimap.",
"주변 2칸 안의 함정을 발견하기 쉽다.": "Easier to spot traps within 2 tiles.",
"층의 모든 적 위치가 미니맵에 표시된다.": "All foes on the floor show on the minimap.",
"통로에서의 시야가 1칸 넓어진다.": "Sight in corridors is 1 tile wider.",
"적이 기술을 쓰는 확률이 절반으로 줄어든다.": "Foes use moves half as often.",
"효과가 굉장한 기술의 데미지가 1.25배.": "Super-effective moves deal ×1.25 damage.",
"층마다 처음 받는 공격 하나를 탈이 대신 맞는다 (최대 HP의 1/8만 잃는다).": "The disguise takes the first hit each floor (losing only 1/8 of max HP).",
"HP가 절반 아래로 떨어지면 특수공격이 1단계 오른다 (층마다 한 번).": "Sp. Atk rises by 1 stage when HP falls below half (once per floor).",
"주변 4칸 안의 잠든 적은 턴마다 최대 HP의 1/8 데미지를 입는다.": "Sleeping foes within 4 tiles take 1/8 of their max HP in damage each turn.",
"모든 기술이 자속 보정(1.5배)을 받는다. (타입을 바꾸는 힘을 재해석)": "All moves get the same-type bonus (×1.5). (Reworks its type-changing power)",
"모든 기술이 자속 보정(1.5배)을 받는다. (메모리로 타입을 바꾸는 힘을 재해석)": "All moves get the same-type bonus (×1.5). (Reworks changing type with Memories)",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 강한 비로 바꾼다. 물 기술 1.5배, 불꽃 타입 공격 기술은 꺼져서 실패한다. 이 포켓몬이 쓰러지기 전에는 다른 날씨로 바뀌지 않는다.": "Turns the weather into heavy rain on entering a floor (player) or when first met (foe). Water moves ×1.5; Fire-type attacks fizzle and fail. The weather can't change until this Pokémon faints.",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 아주 강한 햇살로 바꾼다. 불꽃 기술 1.5배, 물 타입 공격 기술은 증발해서 실패한다. 이 포켓몬이 쓰러지기 전에는 다른 날씨로 바뀌지 않는다.": "Turns the weather into extremely harsh sunlight on entering a floor (player) or when first met (foe). Fire moves ×1.5; Water-type attacks evaporate and fail. The weather can't change until this Pokémon faints.",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 난기류로 바꾼다. 비행 타입이 약점(전기·얼음·바위)에 보통 데미지만 받고, 쾌청·비 효과는 사라진다. 이 포켓몬이 쓰러지기 전에는 다른 날씨로 바뀌지 않는다.": "Turns the weather into strong winds on entering a floor (player) or when first met (foe). Flying types take only normal damage from their weaknesses (Electric, Ice, Rock), and sun and rain effects vanish. The weather can't change until this Pokémon faints.",
"새끼와 함께 공격해서 주는 데미지가 1.25배.": "Attacks together with its child for ×1.25 damage.",
"상대의 방어 상승과 방어 특성을 무시하고 공격한다.": "Ignores the target's Defense boosts and defensive Abilities.",
"오라를 뒤집는 힘으로 악·페어리 타입 적에게 주는 데미지가 1.2배.": "Its aura-reversing power deals ×1.2 damage to Dark and Fairy foes.",
"세포가 모여 단단해져 받는 데미지가 0.85배.": "Its gathered cells harden, so it takes ×0.85 damage.",
"승리를 부르는 힘으로 명중률이 1.2배.": "Its victory-calling power makes accuracy ×1.2.",
"적을 쓰러뜨리면 공격이 1단계 오른다.": "Defeating a foe raises Attack by 1 stage.",
"적을 쓰러뜨리면 공격·특수공격 중 높은 쪽이 1단계 오른다.": "Defeating a foe raises the higher of Attack or Sp. Atk by 1 stage.",
"노말 기술이 전기 타입이 되고 위력이 오른다.": "Normal moves become Electric type and get stronger.",
"접촉한 적은 30% 확률로 저주에 걸려 풀죽는다.": "Foes that make contact have a 30% chance to be cursed and flinch.",
"접촉한 적의 공격을 낮춘다.": "Lowers the Attack of foes that make contact.",
"접촉한 적을 30% 확률로 지독한 향기로 혼란에 빠뜨린다.": "30% chance to confuse foes that make contact with its awful scent.",
"독 상태가 되지 않는다.": "Can't be poisoned.",
"HP가 1/3 이하이면 얼음 기술의 위력이 1.5배.": "Ice moves ×1.5 power at 1/3 HP or less.",
"재빠르게 뽑아 들어 행동 후 15% 확률로 한 턴 더 행동한다.": "Draws quickly: 15% chance after acting to act once more.",
"느긋하게 버텨서 받는 데미지가 0.9배.": "Holds out leisurely, taking ×0.9 damage.",
"쾌청이면 자신과 같은 편 모두의 공격과 특수방어가 1.5배. (체리꼬는 포지폼으로 바뀐다)": "In harsh sunlight, Attack and Sp. Def of it and all allies ×1.5. (Cherrim changes to Sunshine Form)",
"층에서 처음 마주친 상대로 변신한다 (모습·타입·능력치·능력 변화·특성·기술. HP를 뺀 능력치는 1.1배, 기술 PP는 10). HP는 그대로이고 다음 층에 가면 원래대로 돌아온다. 적이면 리더로 변신한다.": "Transforms into the first foe it meets on a floor (look, types, stats, stat changes, Ability, moves; stats other than HP ×1.1, move PP 10). HP stays the same, and it changes back on the next floor. As a foe, it transforms into the leader.",
"치유의 힘으로 자연 회복 속도가 1.5배.": "Its healing power makes natural healing ×1.5.",
"파도를 타듯 행동 후 10% 확률로 한 턴 더 행동한다.": "Rides the wave: 10% chance after acting to act once more.",
"늘 잠든 듯한 상태라 상태이상이 되지 않는다.": "Always in a sleep-like state, so it can't get status conditions.",
"쓰러지면 마지막으로 공격한 상대에게 데미지를 준다.": "When it faints, damages the last foe that attacked it.",
"춤추듯 행동 후 10% 확률로 한 턴 더 행동한다.": "Dances on: 10% chance after acting to act once more.",
"전기를 공급해서 특수공격이 1.2배.": "Supplies electricity for Sp. Atk ×1.2.",
"적을 쓰러뜨리면 기세를 이어받아 공격이 1단계 오른다.": "Defeating a foe carries the momentum, raising Attack by 1 stage.",
"접촉한 적은 최대 HP의 1/8 데미지를 입는다.": "Foes that make contact take 1/8 of their max HP in damage.",
"공격과 특수공격이 1.1배.": "Attack and Sp. Atk ×1.1.",
"강철 기술의 위력이 1.5배.": "Steel moves ×1.5 power.",
"턴마다 30% 확률로 상태이상이 낫는다.": "30% chance each turn to heal status conditions.",
"지휘 능력으로 공격과 특수공격이 1.1배.": "Its command skills give Attack and Sp. Atk ×1.1.",
"층에 들어설 때마다 공격과 특수공격이 오른다.": "Attack and Sp. Atk rise each time it enters a floor.",
"층에 들어서거나(탐험대) 처음 마주치면(적) 날씨와 필드를 모두 없앤다.": "Clears all weather and terrain on entering a floor (team) or when first met (foe).",
"HP가 가득 차 있으면 받는 데미지가 절반.": "Takes half damage at full HP.",
"선제 개념이 없으므로 대신 변화 기술이 반드시 명중한다.": "With no priority in play, its status moves always hit instead.",
"변화 기술이 반드시 명중한다.": "Its status moves always hit.",
"도구를 다루는 게 서툴러서 오히려 던지는 아이템의 데미지가 1.5배.": "Clumsy with tools, so thrown items deal ×1.5 damage instead.",
"날씨가 없으므로 대신 공격할 때 상대의 특성을 무시한다.": "With no weather, it ignores the target's Ability when attacking instead.",
"무거운 몸으로 방어가 1.3배.": "Its heavy body gives Defense ×1.3.",
"가벼운 몸으로 회피율이 1.2배.": "Its light body gives evasion ×1.2.",
"적을 놓치지 않는다. 상대의 회피율 상승을 무시한다.": "Never loses sight of foes. Ignores the target's evasion boosts.",
"층에 들어설 때마다 무작위 능력 하나가 오른다.": "A random stat rises each time it enters a floor.",
"독·강철 타입도 독 상태로 만들 수 있다.": "Can poison even Poison and Steel types.",
"선제 개념이 없으므로 대신 비행 기술의 위력이 1.2배.": "With no priority in play, Flying moves get ×1.2 power instead.",
"바람 기술 구분이 없으므로 비행 기술의 위력이 1.2배.": "With no wind-move category, Flying moves get ×1.2 power.",
"접촉 공격을 해도 상대의 접촉 특성(정전기 등)이 발동하지 않는다.": "Its contact attacks don't trigger the target's contact Abilities (Static, etc.).",
"소리 기술이 물 타입이 되고, 위력이 1.2배.": "Sound moves become Water type with ×1.2 power.",
"모습을 속여서 회피율이 1.15배.": "Its disguised look gives evasion ×1.15.",
"필드 대신 항상 방어가 1.3배.": "Instead of terrain, Defense is always ×1.3.",
"동료가 없으므로 받는 데미지가 0.95배.": "With no partner around, takes ×0.95 damage.",
"5턴마다 스피드가 1단계 오른다.": "Speed rises by 1 stage every 5 turns.",
"비가 오면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. (평소 5%)": "In rain, Speed ×2 and a 20% chance after acting to act once more. (5% otherwise)",
"쾌청이면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. (평소 5%)": "In harsh sunlight, Speed ×2 and a 20% chance after acting to act once more. (5% otherwise)",
"모래바람이면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. 모래바람 데미지를 받지 않는다. (평소 5%)": "In a sandstorm, Speed ×2 and a 20% chance after acting to act once more. Takes no sandstorm damage. (5% otherwise)",
"설경이면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. (평소 5%)": "In snow, Speed ×2 and a 20% chance after acting to act once more. (5% otherwise)",
"가진 도구 개념이 없으므로 항상 스피드가 1.3배.": "With no held-item concept for this, Speed is always ×1.3.",
"스피드가 1.1배.": "Speed ×1.1.",
"모래바람이면 회피율 1.25배 (평소 1.05배). 모래바람 데미지를 받지 않는다.": "Evasion ×1.25 in a sandstorm (×1.05 otherwise). Takes no sandstorm damage.",
"설경이면 회피율 1.25배 (평소 1.05배).": "Evasion ×1.25 in snow (×1.05 otherwise).",
"쾌청이면 특수공격 1.5배 (HP 감소 없음). 평소에도 1.1배.": "Sp. Atk ×1.5 in harsh sunlight (no HP loss). ×1.1 otherwise.",
"비가 오면 자연 회복 2.5배 (평소 1.2배).": "Natural healing ×2.5 in rain (×1.2 otherwise).",
"설경이면 자연 회복 2.5배 (평소 1.2배).": "Natural healing ×2.5 in snow (×1.2 otherwise).",
"비가 오면 턴마다 60% 확률로 상태이상이 낫는다. (평소 10%)": "60% chance each turn to heal status conditions in rain. (10% otherwise)",
"쾌청이면 상태이상에 걸리지 않는다. (평소 25% 확률로 막음)": "Can't get status conditions in harsh sunlight. (Blocks them 25% of the time otherwise)",
"물 기술을 흡수해 회복하고, 비가 오면 자연 회복 2배. 불꽃 기술에 약하다.": "Absorbs Water moves to heal, and natural healing ×2 in rain. Weak to Fire moves.",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 쾌청으로 바꾼다.": "Turns the sunlight harsh on entering a floor (player) or when first met (foe).",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 비로 바꾼다.": "Makes it rain on entering a floor (player) or when first met (foe).",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 모래바람으로 바꾼다.": "Whips up a sandstorm on entering a floor (player) or when first met (foe).",
"층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 설경으로 바꾼다.": "Makes it snow on entering a floor (player) or when first met (foe).",
"플레이어가 이 특성이면 날씨 효과가 모두 사라진다. (적일 때는 효과 없음)": "If the player has this Ability, all weather effects vanish. (No effect on foes)",
"날씨에 따라 타입이 바뀐다 (쾌청 불꽃, 비 물, 설경 얼음).": "Its type changes with the weather (Fire in sun, Water in rain, Ice in snow).",
"땅·바위·강철 기술의 위력이 1.2배. 모래바람 데미지를 받지 않는다.": "Ground, Rock and Steel moves ×1.2 power. Takes no sandstorm damage.",
"가루 기술, 독가시·폭발 함정, 모래바람 데미지를 받지 않는다.": "Immune to powder moves, Poison Sting and Explosion traps, and sandstorm damage.",
"층에 들어서거나(탐험대) 처음 마주치면(적) 날씨를 쾌청으로 만든다. 쾌청이면 공격이 1.33배.": "Turns the sunlight harsh on entering a floor (team) or when first met (foe). Attack ×1.33 in harsh sunlight.",
"일렉트릭필드 위에서는 가장 높은 능력(공격·방어·특공·특방)이 1.3배. (평소 1.1배)": "On Electric Terrain, its highest stat (Attack, Defense, Sp. Atk, Sp. Def) is ×1.3. (×1.1 otherwise)",
"그래스필드 위에서는 방어가 1.5배.": "Defense ×1.5 on Grassy Terrain.",
"공격을 받으면 날씨를 모래바람으로 바꾼다.": "Whips up a sandstorm when hit.",
"공격을 받으면 발밑을 그래스필드로 바꾼다.": "Turns the ground into Grassy Terrain when hit.",
"일렉트릭필드 위에서는 스피드가 2배.": "Speed ×2 on Electric Terrain."
};
const abilEn = s => {
  if (!s) return s;
  const FORM = '🔄 던전에서 모습이 바뀐다: ';
  if (s.startsWith(FORM)) return ABIL_EN[FORM] + (ABIL_EN[s.slice(FORM.length)] || s.slice(FORM.length));
  return ABIL_EN[s] || s;
};
// 데이터에 영어가 없는 특성 (스카이스킨·천정부지 등): 이름·설명
for (const a of Object.values(DATA.abilities)) { if (ABIL_EN[a.n]) a.n = ABIL_EN[a.n]; if (ABIL_EN[a.d]) a.d = ABIL_EN[a.d]; }
const AB_FLAG_EN = { 1: 'contact', 8: 'punching', 9: 'sound', 15: 'powder', 16: 'biting', 17: 'pulse', 18: 'ball and bomb' };
function abilityExactEn(r) {
  if (!r) return '';
  const T = t => typeName(t), S = st => STAT_NAMES[st], x = v => `×${+v.toFixed(2)}`, pct = v => `${Math.round(v * 100)}%`;
  const types = o => Object.entries(o).map(([t, m]) => `${T(+t)} ${x(m)}`).join(', ');
  const stage = (st, ch) => `${S(st)} ${ch > 0 ? 'rises' : 'falls'} by ${Math.abs(ch)} stage${Math.abs(ch) > 1 ? 's' : ''}`;
  const fl = f => AB_FLAG_EN[f] || 'certain';
  const o = [];
  if (r.pinch) o.push(`${T(r.pinch)} moves ×1.5 power at 1/3 HP or less`);
  if (r.adapt) o.push('Same-type bonus ×1.5 → ×2');
  if (r.technician) o.push('Moves with 60 power or less ×1.5 power');
  if (r.flagMul) o.push(`${fl(r.flagMul[0])} moves ${x(r.flagMul[1])} power`);
  if (r.slicing) o.push(`Slicing moves (Leaf Blade, X-Scissor, Night Slash, Air Slash, Psycho Cut, etc.) ${x(r.slicing)} power`);
  if (r.sheer) o.push('Moves with added effects ×1.3 power (but the effects don\'t trigger)');
  if (r.reckless) o.push('Recoil moves ×1.2 power');
  if (r.tinted) o.push('Not-very-effective moves deal ×2 damage');
  if (r.atkMul) o.push(`Attack ${x(r.atkMul)}`);
  if (r.hustle) o.push('Physical moves ×0.8 accuracy');
  if (r.guts) o.push('Attack ×1.5 with a status condition (burn doesn\'t lower Attack)');
  if (r.marvel) o.push('Defense ×1.5 with a status condition');
  if (r.toxicBoost) o.push('Attack ×1.5 while poisoned');
  if (r.flareBoost) o.push('Sp. Atk ×1.5 while burned');
  if (r.sniper) o.push('Critical damage ×1.5 → ×2.25');
  if (r.critStage) o.push(`Crit stage +${r.critStage} (1/16 → 1/8)`);
  if (r.accMul) o.push(`Accuracy ${x(r.accMul)}`);
  if (r.noGuard) o.push('Moves by and against it always hit');
  if (r.skin) o.push(`Normal moves become ${T(r.skin)} type with ×1.2 power`);
  if (r.normalize) o.push('All moves become Normal type with ×1.2 power');
  if (r.typeMul) o.push(`Move power: ${types(r.typeMul)}`);
  if (r.scrappy) o.push('Normal and Fighting moves hit Ghost types normally (×1) instead of ×0.5');
  if (r.moldBreaker) o.push('Ignores the target\'s Ability when attacking');
  if (r.skillLink) o.push('Multi-hit moves always hit the max number of times');
  if (r.serene) o.push('Added effect chances ×2');
  if (r.stench) o.push('10% chance to make the target flinch when an attack hits');
  if (r.poisonTouch) o.push('30% chance to poison the target when an attack hits');
  if (r.resist) o.push(`Damage taken: ${types(r.resist)}`);
  if (r.absorb) {
    const a = r.absorb;
    o.push(`Immune to ${T(a.t)} moves; ${a.heal ? `restores ${a.heal}% of max HP` : a.flash ? 'its Fire moves get ×1.5 power afterward' : stage(a.st, a.ch)}`);
  }
  if (r.seMul) o.push(`Super-effective moves deal ${x(r.seMul)} damage to it`);
  if (r.fullHpHalf) o.push('Takes half damage at full HP');
  if (r.contactResist) o.push(`Contact moves deal ${x(r.contactResist)} damage to it`);
  if (r.specialResist) o.push(`Special moves deal ${x(r.specialResist)} damage to it`);
  if (r.physResist) o.push(`Physical moves deal ${x(r.physResist)} damage to it`);
  if (r.flagResist) o.push(`${fl(r.flagResist[0])} moves deal ${x(r.flagResist[1])} damage to it`);
  if (r.wonderGuard) o.push(`Only super-effective moves hit (basic attacks hit ${WONDER_GUARD_BASIC * 100}% of the time)`);
  if (r.noCrit) o.push('Can\'t take critical hits');
  if (r.immuneFlag) o.push(`Immune to ${fl(r.immuneFlag)} moves`);
  if (r.dmgTaken) o.push(`Damage taken ${x(r.dmgTaken)}`);
  if (r.foeAcc) o.push(`Foes' accuracy ${x(r.foeAcc)}`);
  if (r.miracle) o.push('Foes\' status moves ×0.5 accuracy');
  if (r.noStatus) o.push(`Can't be ${r.noStatus.map(k => STATUS_NAMES[k]).join('/')}`);
  if (r.onHitBy) {
    const h = r.onHitBy;
    const when = h.types ? `When hit by ${h.types.map(T).join('/')} moves,` : h.t ? `When hit by ${T(h.t)} moves,` : h.phys ? 'When hit by physical moves,' : 'When hit by an attack,';
    o.push(`${when} ${stage(h.st, h.ch)}${h.st2 ? `, ${stage(h.st2, h.ch2)}` : ''}`);
  }
  if (r.noFlinch) o.push('Can\'t flinch');
  if (r.noIntimidate) o.push('Immune to Intimidate');
  if (r.statusResist) o.push(`${pct(r.statusResist)} chance to block status conditions`);
  if (r.noDrop) o.push(r.noDrop === 'all' ? 'Foes can\'t lower its stats' : `Foes can't lower its ${r.noDrop.map(S).join('/')}`);
  if (r.keenEye) o.push('Always spots traps on adjacent tiles');
  if (r.shieldDust) o.push('Unaffected by added effects of foes\' moves');
  if (r.synchronize) o.push('A foe that poisons, burns or paralyzes it gets the same condition');
  if (r.earlyBird) o.push('Wakes up in half the time');
  if (r.cureChance) o.push(`${pct(r.cureChance)} chance each turn to heal status conditions`);
  if (r.poisonHeal) o.push('While poisoned, restores 1/12 of max HP every 2 turns instead of taking damage');
  if (r.rockHead) o.push('Takes no recoil damage');
  if (r.simple) o.push('Stat changes ×2');
  if (r.contrary) o.push('Stat changes are reversed');
  if (r.unaware) o.push('Ignores the foe\'s stat changes');
  if (r.defiant) o.push(`When a foe lowers its stats, ${S(r.defiant)} rises by 2 stages`);
  if (r.angerPoint) o.push('Attack maxes out (+6) when hit by a critical hit');
  if (r.onKO) o.push(`Defeating a foe raises ${r.onKO === 'best' ? 'the higher of Attack or Sp. Atk' : r.onKO === 'spa' ? 'Sp. Atk' : 'Attack'} by 1 stage`);
  if (r.contact) {
    const c = r.contact, ail = c.ail === 'spore' ? 'poison, paralysis or sleep' : c.ail ? STATUS_NAMES[c.ail] : '';
    if (c.ail) o.push(`${c.c}% chance to inflict ${ail} on foes that make contact`);
    if (c.dmg) o.push(`Foes that make contact take 1/${c.dmg} of their max HP`);
    if (c.st) o.push(`Foes that make contact: ${stage(c.st, c.ch)}`);
    if (c.flinch) o.push(`${c.flinch}% chance to make foes that make contact flinch`);
  }
  if (r.aftermath) o.push('The foe that knocks it out takes 1/4 of its own max HP');
  if (r.liquidOoze) o.push('Foes using HP-draining moves take damage instead of healing');
  if (r.defeatist) o.push('Attack and Sp. Atk halved at half HP or less');
  if (r.tangled) o.push('Evasion ×1.5 while confused');
  if (r.merciless) o.push('Always lands critical hits on poisoned targets');
  if (r.colorChange) o.push('Its type changes to the type of the move that hit it');
  if (r.spaMul) o.push(`Sp. Atk ${x(r.spaMul)}`);
  if (r.defMul) o.push(`Defense ${x(r.defMul)}`);
  if (r.evasion) o.push(`Evasion ${x(r.evasion)}`);
  if (r.regen) o.push(`Natural healing ${x(r.regen)}`);
  if (r.chipImmune) o.push('Takes no sandstorm damage');
  if (r.steadfast) o.push('Speed rises by 1 stage when it flinches');
  if (r.quickFeet) o.push('Speed ×1.5 with a status condition (paralysis doesn\'t lower Speed)');
  if (r.speedMul) o.push(`Speed ${x(r.speedMul)}`);
  return o.join(' / ');
}
