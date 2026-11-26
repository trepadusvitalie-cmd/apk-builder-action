'use strict';
// ================= LANGUAGES: Română (source) · English · Русский =================
// The game is written in Romanian. For English and Russian every visible text node, a few attributes
// and canvas labels are translated on the fly by phrase (longest phrase first, whole words only).
(function () {
  let LANG = null; try { LANG = localStorage.getItem('ironfall.lang'); } catch (e) {}
  window.IF_LANG = LANG || 'ro';

  // [română, english, русский]
  const D = [
    // ---- composite names first (longest wins anyway) ----
    ['Muniție Mitralieră', 'Machine gun ammo', 'Боеприпасы пулемёта'], ['Muniție Tun', 'Cannon ammo', 'Снаряды пушки'], ['Muniție Flăcări', 'Flamer fuel', 'Смесь огнемёта'],
    ['Muniție Rachete', 'Rocket warheads', 'Боеголовки ракет'], ['Muniție Laser', 'Laser power', 'Мощность лазера'], ['Muniție Artilerie', 'Artillery shells', 'Снаряды артиллерии'],
    ['Încărcare Mitralieră', 'Machine gun feed', 'Подача пулемёта'], ['Încărcare Tun', 'Cannon autoloader', 'Автомат заряжания пушки'], ['Încărcare Flăcări', 'Flamer pump', 'Насос огнемёта'],
    ['Încărcare Rachete', 'Rocket reload', 'Перезарядка ракет'], ['Încărcare Laser', 'Laser capacitors', 'Конденсаторы лазера'], ['Încărcare Artilerie', 'Artillery loader', 'Заряжание артиллерии'],
    ['Blindaj compozit Mk', 'Composite armour Mk', 'Композитная броня Mk'], ['Motoare turbo Mk', 'Turbo engines Mk', 'Турбодвигатели Mk'], ['Beton armat Mk', 'Reinforced concrete Mk', 'Железобетон Mk'],
    ['Turbină generator Mk', 'Generator turbine Mk', 'Турбина генератора Mk'], ['Analiză date Mk', 'Data analysis Mk', 'Анализ данных Mk'], ['Producție automată Mk', 'Automated production Mk', 'Автопроизводство Mk'],
    ['Blindaj compozit +25%', 'Composite armour +25%', 'Композитная броня +25%'], ['Motoare turbo +20%', 'Turbo engines +20%', 'Турбодвигатели +20%'], ['Producție automată +40%', 'Automated production +40%', 'Автопроизводство +40%'],
    // ---- map sizes, teams, palettes ----
    ['Normală', 'Normal', 'Обычная'], ['Uriașă', 'Huge', 'Огромная'], ['Gigantică', 'Gigantic', 'Гигантская'], ['Harta mea', 'My map', 'Моя карта'],
    ['Aliat (albastru-galben)', 'Ally (blue-yellow)', 'Союзник (сине-жёлтый)'], ['Aliat (nisip-turcoaz)', 'Ally (sand-turquoise)', 'Союзник (песок-бирюза)'], ['Aliat (gri-violet)', 'Ally (grey-violet)', 'Союзник (серо-фиолетовый)'],
    ['Aliat (kaki-portocaliu)', 'Ally (khaki-orange)', 'Союзник (хаки-оранжевый)'], ['Aliat (mov-roz)', 'Ally (purple-pink)', 'Союзник (лилово-розовый)'], ['Aliat (gri-alb)', 'Ally (grey-white)', 'Союзник (серо-белый)'],
    ['Aliat (verde-lime)', 'Ally (lime green)', 'Союзник (лаймовый)'], ['Aliat (bleumarin)', 'Ally (navy)', 'Союзник (тёмно-синий)'], ['Aliat (maro-argintiu)', 'Ally (brown-silver)', 'Союзник (коричнево-серебряный)'],
    ['Tu (verde-albastru)', 'You (green-blue)', 'Вы (зелёно-синий)'], ['Gazda: verde-albastru', 'Host: green-blue', 'Хост: зелёно-синий'],
    ['Iconițe (oțel)', 'Icons (steel)', 'Иконки (сталь)'], ['Iconițe (roșu avansat)', 'Icons (advanced red)', 'Иконки (красный)'], ['Iconițe (oliv)', 'Icons (olive)', 'Иконки (олива)'], ['Iconițe (negru-auriu)', 'Icons (black-gold)', 'Иконки (чёрно-золотой)'],
    ['Inamic:', 'Enemy:', 'Враг:'], ['Inamic', 'Enemy', 'Враг'], ['Aliat', 'Ally', 'Союзник'],
    // ---- chassis / bodies / propulsion ----
    ['Șasiu Nova (auriu)', 'Nova body (gold)', 'Корпус Нова (золотой)'], ['Șasiu Cercetaș', 'Scout body', 'Корпус Разведчик'], ['Șasiu de Asalt', 'Assault body', 'Штурмовой корпус'], ['Șasiu Titan', 'Titan body', 'Корпус Титан'],
    ['Șasiu mediu', 'Medium body', 'Средний корпус'], ['Șasiu greu', 'Heavy body', 'Тяжёлый корпус'],
    ['Cercetaș', 'Scout', 'Разведчик'], ['Ușor', 'Light', 'Лёгкий'], ['Mediu', 'Medium', 'Средний'], ['Asalt', 'Assault', 'Штурм'], ['Greu', 'Heavy', 'Тяжёлый'], ['Titan', 'Titan', 'Титан'], ['Nova', 'Nova', 'Нова'],
    ['Dronă', 'Drone', 'Дрон'], ['Cyborg greu', 'Heavy cyborg', 'Тяжёлый киборг'], ['Cyborgi', 'Cyborgs', 'Киборги'], ['Cyborg', 'Cyborg', 'Киборг'], ['Drone', 'Drones', 'Дроны'],
    ['Semi-șenile', 'Half-tracks', 'Полугусеницы'], ['Roți', 'Wheels', 'Колёса'], ['Șenile', 'Tracks', 'Гусеницы'], ['Hover', 'Hover', 'Ховер'], ['Picioare', 'Legs', 'Ноги'], ['Rotoare', 'Rotors', 'Роторы'], ['Reactor VTOL', 'VTOL jets', 'Двигатели СВВП'],
    // ---- weapons ----
    ['Rachetă balistică strategică', 'Strategic ballistic missile', 'Стратегическая баллистическая ракета'], ['Mitralieră antiaeriană', 'Anti-air machine gun', 'Зенитный пулемёт'],
    ['Aruncător de flăcări', 'Flamethrower', 'Огнемёт'], ['Rachete sol-aer', 'Surface-to-air missiles', 'Ракеты «земля-воздух»'], ['rachete sol-aer', 'SAM', 'ЗУР'],
    ['Mortier incendiar', 'Incendiary mortar', 'Зажигательный миномёт'], ['Obuzier incendiar', 'Incendiary howitzer', 'Зажигательная гаубица'], ['Obuzier rapid', 'Rapid howitzer', 'Скорострельная гаубица'], ['Obuzier greu', 'Heavy howitzer', 'Тяжёлая гаубица'],
    ['mortier incendiar', 'incendiary mortar', 'зажиг. миномёт'], ['obuzier incendiar', 'incendiary howitzer', 'зажиг. гаубица'], ['obuzier rapid', 'rapid howitzer', 'скоростр. гаубица'], ['obuzier greu', 'heavy howitzer', 'тяжёлая гаубица'],
    ['Mortier IEM', 'EMP mortar', 'ЭМИ-миномёт'], ['mortier IEM', 'EMP mortar', 'ЭМИ-миномёт'], ['Lansator salve', 'Salvo launcher', 'Залповая установка'], ['Lansator plasmă', 'Plasma launcher', 'Плазменная установка'],
    ['Rachetă balistică', 'Ballistic missile', 'Баллистическая ракета'], ['rachetă balistică', 'ballistic missile', 'баллист. ракета'], ['Baterie de rachete Tunet', 'Thunder rocket battery', 'Ракетная батарея «Гром»'], ['Baterie Tunet', 'Thunder battery', 'Батарея «Гром»'], ['baterie Tunet', 'Thunder battery', 'батарея «Гром»'],
    ['Rachete ghidate Săgeată', 'Arrow guided missiles', 'Управляемые ракеты «Стрела»'], ['Rachete Săgeată', 'Arrow missiles', 'Ракеты «Стрела»'], ['rachete Săgeată', 'Arrow missiles', 'ракеты «Стрела»'], ['Rachetă Orizont', 'Horizon missile', 'Ракета «Горизонт»'], ['rachetă Orizont', 'Horizon missile', 'ракета «Горизонт»'],
    ['Rachete Viperă', 'Viper rockets', 'Ракеты «Гадюка»'], ['rachete Viperă', 'Viper rockets', 'ракеты «Гадюка»'], ['Tun antiaerian', 'Anti-air cannon', 'Зенитная пушка'], ['Laser antiaerian', 'Anti-air laser', 'Зенитный лазер'],
    ['mitralieră AA', 'AA machine gun', 'зенитный пулемёт'], ['tun AA', 'AA cannon', 'зенитная пушка'], ['laser AA', 'AA laser', 'зенитный лазер'],
    ['Bombe aeriene', 'Aerial bombs', 'Авиабомбы'], ['Bombe incendiare', 'Incendiary bombs', 'Зажигательные бомбы'], ['Bombă grea', 'Heavy bomb', 'Тяжёлая бомба'],
    ['Mitralieră', 'Machine gun', 'Пулемёт'], ['mitralieră', 'machine gun', 'пулемёт'], ['Mortier', 'Mortar', 'Миномёт'], ['mortier', 'mortar', 'миномёт'], ['Obuzier', 'Howitzer', 'Гаубица'], ['obuzier', 'howitzer', 'гаубица'],
    ['Laser de luptă', 'Combat laser', 'Боевой лазер'], ['Laser', 'Laser', 'Лазер'], ['laser', 'laser', 'лазер'], ['Rachete', 'Rockets', 'Ракеты'], ['rachete', 'rockets', 'ракеты'], ['Tun', 'Cannon', 'Пушка'], ['tun', 'cannon', 'пушка'],
    ['Flăcări', 'Flamer', 'Огнемёт'], ['flăcări', 'flamer', 'огнемёт'], ['plasmă', 'plasma', 'плазма'], ['salve', 'salvo', 'залп'], ['Radar de luptă', 'Combat radar', 'Боевой радар'], ['Radar avansat', 'Advanced radar', 'Улучшенный радар'],
    ['Radar', 'Radar', 'Радар'], ['radar', 'radar', 'радар'], ['Modul reparator', 'Repair module', 'Ремонтный модуль'], ['Reparator', 'Repair unit', 'Ремонтник'], ['reparator', 'repair unit', 'ремонтник'], ['Constructor', 'Builder', 'Строитель'],
    // ---- buildings ----
    ['Platformă de realimentare', 'Rearm pad', 'Площадка перезарядки'], ['Platforme de realimentare:', 'Rearm pads:', 'Площадки перезарядки:'], ['Platformă VTOL', 'VTOL pad', 'Площадка СВВП'],
    ['Fabrică de aeronave', 'VTOL factory', 'Авиазавод'], ['Fabr. aeronave', 'VTOL factory', 'Авиазавод'], ['Fabrică de cyborgi', 'Cyborg factory', 'Завод киборгов'], ['Fabr. cyborgi', 'Cyborg factory', 'Завод киборгов'],
    ['Siloz de rachete balistice', 'Ballistic missile silo', 'Шахта баллистических ракет'], ['Siloz rachetă balistică', 'Ballistic missile silo', 'Шахта баллистической ракеты'], ['Siloz', 'Silo', 'Шахта'],
    ['Cartier General', 'HQ', 'Штаб'], ['Cartierul General', 'the HQ', 'Штаб'], ['Fabrică', 'Factory', 'Завод'], ['Laborator', 'Research lab', 'Лаборатория'], ['Laboratoare', 'Labs', 'Лаборатории'], ['laboratoare', 'labs', 'лабораторий'],
    ['Pompă petrol', 'Oil pump', 'Нефтенасос'], ['Generator', 'Generator', 'Генератор'], ['Turn apărare', 'Defence tower', 'Оборонная башня'], ['Arici antitanc', 'Tank traps', 'Противотанковые ежи'], ['Arici și ziduri', 'Tank traps and walls', 'Ежи и стены'],
    ['Zid beton', 'Concrete wall', 'Бетонная стена'], ['Atelier reparații', 'Repair facility', 'Ремонтная мастерская'], ['Turn radar', 'Radar tower', 'Радарная башня'], ['Turnuri cu tun', 'Cannon towers', 'Пушечные башни'],
    ['CETATEA', 'THE CITADEL', 'ЦИТАДЕЛЬ'], ['Zid', 'Wall', 'Стена'], ['Turn', 'Tower', 'Башня'], ['Buncăre', 'Bunkers', 'Бункеры'], ['Buncăr', 'Bunker', 'Бункер'], ['Fortificații', 'Hardpoints', 'Укрепления'], ['Fortificație', 'Hardpoint', 'Укрепление'],
    ['Fortărețe', 'Fortresses', 'Крепости'], ['Fortăreață', 'Fortress', 'Крепость'], ['Antiaeriană (PVO)', 'Anti-air (AA)', 'ПВО'], ['Amplasament', 'Emplacement', 'Позиция'], ['Aeronave VTOL', 'VTOL aircraft', 'Самолёты СВВП'],
    ['Avanpost', 'Outpost', 'Аванпост'], ['Fort', 'Fort', 'Форт'], ['Bastion', 'Bastion', 'Бастион'], ['Cetate', 'Citadel', 'Цитадель'],
    // ---- research branches ----
    ['Reparare rapidă', 'Rapid repair', 'Быстрый ремонт'], ['Mobilitate', 'Mobility', 'Мобильность'], ['Corp și blindaj', 'Body & armour', 'Корпус и броня'], ['Armament', 'Weapons', 'Вооружение'], ['Artilerie', 'Artillery', 'Артиллерия'],
    ['Sprijin', 'Support', 'Поддержка'], ['Apărare', 'Defence', 'Оборона'], ['Aviație și cyborgi', 'Air & cyborgs', 'Авиация и киборги'], ['Industrie', 'Industry', 'Промышленность'], ['Muniție', 'Ammo', 'Боеприпасы'], ['Cadență', 'Fire rate', 'Скорострельность'], ['Încărcare', 'Reload', 'Перезарядка'],
    // ---- messages ----
    ['— gata!', '— ready!', '— готово!'], ['⚠ Ești atacat!', '⚠ You are under attack!', '⚠ Вас атакуют!'],
    ['✈ Construiește o Platformă de realimentare — aeronavele fără muniție așteaptă', '✈ Build a Rearm pad — aircraft without ammo are waiting', '✈ Постройте площадку перезарядки — самолёты без боеприпасов ждут'],
    ['Nu ai Cartier General', 'You have no HQ', 'У вас нет штаба'], ['Construiește un Atelier de reparații', 'Build a Repair facility', 'Постройте ремонтную мастерскую'], ['Nu ai fabrică pentru reciclare', 'No factory to recycle at', 'Нет завода для переработки'],
    ['Nu se poate construi aici', 'Cannot build here', 'Здесь нельзя строить'], ['Maxim', 'Max', 'Максимум'], ['Energie insuficientă sau coadă plină', 'Not enough energy or queue full', 'Мало энергии или очередь полна'], ['Energie insuficientă', 'Not enough energy', 'Недостаточно энергии'],
    ['Toate laboratoarele sunt ocupate', 'All labs are busy', 'Все лаборатории заняты'], ['🔬 Cercetare finalizată', '🔬 Research complete', '🔬 Исследование завершено'], ['cucerit!', 'captured!', 'захвачен!'], ['⚠ Val de atac din', '⚠ Attack wave from', '⚠ Волна атаки из'],
    ['📍 Punct de adunare setat', '📍 Rally point set', '📍 Точка сбора задана'], ['Cercetează mai întâi o armă potrivită (ex.: Mortier pentru amplasamente).', 'Research a suitable weapon first (e.g. Mortar for emplacements).', 'Сначала исследуйте подходящее оружие (напр. миномёт для позиций).'],
    ['Plasează:', 'Place:', 'Разместить:'], ['Construiește', 'Build', 'Строить'], ['Anulează', 'Cancel', 'Отмена'], ['Selectează unitățile tale și atinge inamicul pentru atac.', 'Select your units and tap the enemy to attack.', 'Выберите свои войска и коснитесь врага для атаки.'],
    ['⚔ Atac-deplasare', '⚔ Attack-move', '⚔ Атака в движении'], ['Atac-deplasare', 'Attack-move', 'Атака в движении'], ['Stop', 'Stop', 'Стоп'], ['📋 Ordine', '📋 Orders', '📋 Приказы'], ['În construcție…', 'Under construction…', 'Строится…'],
    ['Selectează constructori și atinge clădirea ca să ajute.', 'Select builders and tap the building to help.', 'Выберите строителей и коснитесь здания, чтобы помочь.'], ['Producție', 'Production', 'Производство'], ['Coada e goală', 'Queue is empty', 'Очередь пуста'],
    ['· aeronave VTOL:', '· VTOL aircraft:', '· самолёты СВВП:'], ['Proiectant de unități', 'Unit designer', 'Конструктор техники'], ['Proiectant', 'Designer', 'Конструктор'], ['Atinge harta pentru punctul de adunare.', 'Tap the map to set the rally point.', 'Коснитесь карты, чтобы задать точку сбора.'],
    ['Cercetare', 'Research', 'Исследования'], ['· lucrează', '· working', '· работают'], ['· libere', '· free', '· свободны'], ['✔ Cercetat', '✔ Researched', '✔ Изучено'], ['⏳ În curs', '⏳ In progress', '⏳ Идёт'],
    ['Extrage petrol din sondă și produce +', 'Pumps oil from the well and produces +', 'Качает нефть из скважины и даёт +'], ['Repară automat unitățile tale aflate la mai puțin de 11 m.', 'Automatically repairs your units within 11 m.', 'Автоматически чинит ваши войска в радиусе 11 м.'],
    ['Unitățile tale din jur (', 'Your nearby units (', 'Ваши войска рядом ('], ['m) trag mai departe și mai tare. Inamicii văzuți de radar (', 'm) shoot further and harder. Enemies seen by radar (', 'м) стреляют дальше и сильнее. Враги, видимые радаром ('],
    ['m) pot fi loviți de artilerie de la distanță: toată artileria până la bătaia ei maximă (de 3× mai mare decât ce vede singură), iar armele cu rază lungă (obuzier greu, Tunet, Săgeată, balistică, Orizont) până la 2 km. Orice unitate de-a ta vede și ea inamicii din jurul ei.', 'm) can be hit by artillery from afar: all artillery up to its full range (3× what it sees on its own), and long-range weapons (heavy howitzer, Thunder, Arrow, ballistic, Horizon) out to 2 km. Every unit of yours also spots enemies around it.', 'м) поражаются артиллерией издалека: вся артиллерия на полную дальность (в 3 раза больше собственного обзора), а дальнобойное оружие (тяжёлая гаубица, «Гром», «Стрела», баллистическая, «Горизонт») — до 2 км. Каждый ваш юнит тоже видит врагов вокруг себя.'],
    [', rază', ', range', ', дальность'], ['m. Atacă automat inamicii din apropiere.', 'm. Attacks nearby enemies automatically.', 'м. Автоматически атакует ближайших врагов.'], ['Atacă automat inamicii din apropiere.', 'Attacks nearby enemies automatically.', 'Автоматически атакует ближайших врагов.'],
    ['Centrul de comandă. Dă +1.5 ⚡/s. Nu-l pierde!', 'Command centre. Gives +1.5 ⚡/s. Don\'t lose it!', 'Командный центр. Даёт +1.5 ⚡/с. Не потеряйте его!'],
    // ---- orders ----
    ['Foc', 'Fire', 'Огонь'], ['🔥 Liber', '🔥 At will', '🔥 Свободный'], ['↩ Ripostă', '↩ Return fire', '↩ Ответный'], ['✋ Nu trage', '✋ Hold fire', '✋ Не стрелять'], ['Poziție', 'Stance', 'Позиция'], ['Urmărește', 'Pursue', 'Преследовать'],
    ['🛡 Păzește', '🛡 Guard', '🛡 Охранять'], ['📌 Pe loc', '📌 Hold', '📌 На месте'], ['Retragere', 'Retreat', 'Отступление'], ['💀 Niciodată', '💀 Never', '💀 Никогда'], ['❤ La 50%', '❤ At 50%', '❤ При 50%'], ['❤ La 25%', '❤ At 25%', '❤ При 25%'],
    ['🔁 Patrulare', '🔁 Patrol', '🔁 Патруль'], ['🏠 La bază', '🏠 To base', '🏠 На базу'], ['🔧 La reparații', '🔧 To repair', '🔧 На ремонт'], ['♻ Reciclează', '♻ Recycle', '♻ Переработать'],
    ['Atinge harta: unitățile atacă pe drum', 'Tap the map: units attack on the way', 'Коснитесь карты: войска атакуют по пути'], ['Atinge harta: unitățile patrulează între locul lor și punctul ales', 'Tap the map: units patrol between their spot and the chosen point', 'Коснитесь карты: войска патрулируют между своим местом и выбранной точкой'],
    // ---- designer ----
    ['Viață', 'Health', 'Прочность'], ['Viteză', 'Speed', 'Скорость'], ['Atac', 'Attack', 'Атака'], ['Rază', 'Range', 'Дальность'], ['Ieftin', 'Cheap', 'Дёшево'], ['⚡ · viteză ×', '⚡ · speed ×', '⚡ · скорость ×'], ['viață', 'health', 'прочность'],
    ['⚡ · +25% rază aliați', '⚡ · +25% allied range', '⚡ · +25% дальности союзникам'], ['⚡ · repară', '⚡ · repairs', '⚡ · чинит'], ['⚡ · construiește', '⚡ · builds', '⚡ · строит'], ['⚡ · rază', '⚡ · range', '⚡ · дальность'],
    ['Reparare', 'Repair', 'Ремонт'], ['Construiește și repară clădiri.', 'Builds and repairs buildings.', 'Строит и чинит здания.'],
    ['1 · Șasiu — deplasare', '1 · Chassis — movement', '1 · Шасси — передвижение'], ['2 · Corp — blindaj', '2 · Body — armour', '2 · Корпус — броня'], ['3 · Modul de sus — armă, radar sau reparator', '3 · Top module — weapon, radar or repair', '3 · Верхний модуль — оружие, радар или ремонт'],
    ['▶▶ Produ ×5', '▶▶ Build ×5', '▶▶ Создать ×5'], ['▶▶ Produ ×10', '▶▶ Build ×10', '▶▶ Создать ×10'], ['▶▶ Produ ×20', '▶▶ Build ×20', '▶▶ Создать ×20'], ['▶ Produ ×1', '▶ Build ×1', '▶ Создать ×1'], ['Închide', 'Close', 'Закрыть'],
    // ---- multiplayer ----
    ['Conexiune slabă cu serverul… se reîncearcă', 'Weak connection to the server… retrying', 'Слабая связь с сервером… повтор'], ['❌ Partida a început fără tine. Cere-i gazdei o partidă nouă.', '❌ The match started without you. Ask the host for a new one.', '❌ Матч начался без вас. Попросите хоста начать новый.'],
    ['🔗 Legătură directă cu gazda', '🔗 Direct link to the host', '🔗 Прямая связь с хостом'], ['🔗 Legătură directă cu', '🔗 Direct link with', '🔗 Прямая связь с'], ['↺ Legătura directă s-a pierdut — continuăm prin server', '↺ Direct link lost — continuing via the server', '↺ Прямая связь потеряна — продолжаем через сервер'],
    ['👥 Tu:', '👥 You:', '👥 Вы:'], ['a ieșit din joc', 'left the game', 'вышел из игры'], ['⏳ Se așteaptă gazda… (verifică internetul)', '⏳ Waiting for the host… (check your internet)', '⏳ Ожидание хоста… (проверьте интернет)'], ['⏳ Se așteaptă', '⏳ Waiting for', '⏳ Ожидание'],
    ['Comandant', 'Commander', 'Командир'], ['👥 Jucători:', '👥 Players:', '👥 Игроки:'], ['Niciun mesaj încă — salută-ți aliații!', 'No messages yet — greet your allies!', 'Сообщений пока нет — поприветствуйте союзников!'], ['Se așteaptă jucătorii…', 'Waiting for players…', 'Ожидание игроков…'],
    ['Unii prieteni încă încarcă harta — poți începe, dar cei care nu sunt gata rămân pe dinafară.', 'Some friends are still loading the map — you can start, but those not ready will be left out.', 'Некоторые друзья ещё загружают карту — можно начать, но неготовые останутся вне игры.'],
    ['Toți sunt gata!', 'Everyone is ready!', 'Все готовы!'], ['Prietenii încarcă harta…', 'Friends are loading the map…', 'Друзья загружают карту…'], ['· tehnologie', '· technology', '· технологии'],
    ['Joacă împreună cu până la', 'Play together with up to', 'Играйте вместе с'], ['prieteni (', 'friends (', 'друзьями ('],
    ['jucători), de oriunde. Comandați aceeași armată (energie și cercetare comune), fiecare cu baza și culoarea lui, împotriva citadelei. Harta, dificultatea și nivelul de tehnologie le alege cel care creează partida.', 'players), from anywhere. You command the same army (shared energy and research), each with their own base and colour, against the citadel. The map, difficulty and tech level are chosen by whoever creates the match.', 'игроков), откуда угодно. Вы командуете одной армией (общая энергия и исследования), у каждого своя база и цвет, против цитадели. Карту, сложность и уровень технологий выбирает создатель матча.'],
    ['➕ Creează partidă', '➕ Create match', '➕ Создать матч'], ['➜ Intră cu cod', '➜ Join with code', '➜ Войти по коду'], ['Înapoi', 'Back', 'Назад'], ['Codul camerei (până la', 'Room code (up to', 'Код комнаты (до'], ['prieteni):', 'friends):', 'друзей):'],
    ['▶ Începe lupta', '▶ Start the battle', '▶ Начать бой'], ['Camera', 'Room', 'Комната'], ['▶ Sunt gata', '▶ I\'m ready', '▶ Я готов'], ['Ieși', 'Leave', 'Выйти'], ['Se creează camera…', 'Creating room…', 'Создаём комнату…'],
    ['❌ Nu mă pot conecta la server. Verifică internetul.', '❌ Can\'t reach the server. Check your internet.', '❌ Нет связи с сервером. Проверьте интернет.'], ['Codul are 5 caractere', 'The code has 5 characters', 'Код состоит из 5 символов'],
    ['Se intră în camera', 'Joining room', 'Входим в комнату'], ['Nu există camera', 'No such room', 'Нет такой комнаты'], ['nu există camera', 'no such room', 'нет такой комнаты'], ['Se primește harta…', 'Receiving the map…', 'Получаем карту…'],
    ['✔ Ești gata. Se așteaptă ca gazda să înceapă lupta…', '✔ You are ready. Waiting for the host to start…', '✔ Вы готовы. Ждём, пока хост начнёт бой…'],
    // ---- end screen, misc ----
    ['VICTORIE', 'VICTORY', 'ПОБЕДА'], ['ÎNFRÂNGERE', 'DEFEAT', 'ПОРАЖЕНИЕ'], ['Timp:', 'Time:', 'Время:'], ['· Unități produse:', '· Units built:', '· Создано войск:'], ['· Inamici distruși:', '· Enemies destroyed:', '· Уничтожено врагов:'], ['· Pierderi:', '· Losses:', '· Потери:'],
    ['Construiește generatoare pe sondele de petrol! ⚡', 'Build generators on the oil wells! ⚡', 'Стройте генераторы на нефтяных скважинах! ⚡'],
    ['🎵 Muzică: DA', '🎵 Music: ON', '🎵 Музыка: ВКЛ'], ['🔊 Sunete: DA', '🔊 Sounds: ON', '🔊 Звуки: ВКЛ'], ['🎵 Muzică:', '🎵 Music:', '🎵 Музыка:'], ['🔊 Sunete:', '🔊 Sounds:', '🔊 Звуки:'], ['DA', 'ON', 'ВКЛ'], ['NU', 'OFF', 'ВЫКЛ'],
    ['tehnologii deja cercetate ·', 'technologies already researched ·', 'технологий уже изучено ·'], ['⚡ la start (și pentru inamic)', '⚡ at start (and for the enemy)', '⚡ на старте (и у врага)'], ['T1: pornești de la zero, cu 500⚡', 'T1: start from scratch with 500⚡', 'T1: старт с нуля, 500⚡'],
    ['Cod pentru prieten', 'Code for a friend', 'Код для друга'], ['Șterge', 'Delete', 'Удалить'], ['șterge?', 'delete?', 'удалить?'], ['baze inamice', 'enemy bases', 'вражеских баз'], ['inele de forturi', 'rings of forts', 'колец фортов'],
    ['Codul hărții a fost copiat — trimite-l prietenului', 'Map code copied — send it to your friend', 'Код карты скопирован — отправьте его другу'], ['Copiază codul de mai jos și trimite-l prietenului', 'Copy the code below and send it to your friend', 'Скопируйте код ниже и отправьте другу'], ['Cod de hartă greșit', 'Wrong map code', 'Неверный код карты'],
    ['⚔ Armata', '⚔ Army', '⚔ Армия'], ['🚜 Constr.', '🚜 Build', '🚜 Стройка'], ['⬚ Selecție', '⬚ Select', '⬚ Выбор'], ['🏠 Baza', '🏠 Base', '🏠 База'], ['Armata', 'Army', 'Армия'], ['Constr.', 'Build', 'Стройка'], ['Selecție', 'Select', 'Выбор'], ['Baza', 'Base', 'База'], ['Bază', 'Base', 'База'],
    ['💾 Salvează', '💾 Save', '💾 Сохранить'], ['💾 Joc salvat', '💾 Game saved', '💾 Игра сохранена'], ['💾 Joc încărcat', '💾 Game loaded', '💾 Игра загружена'], ['Salvarea a eșuat', 'Saving failed', 'Не удалось сохранить'], ['Salvarea merge doar în campanie', 'Saving works only in the campaign', 'Сохранение доступно только в кампании'], ['💾 Continuă salvarea', '💾 Continue saved game', '💾 Продолжить сохранение'], ['⏸ Pauză', '⏸ Pause', '⏸ Пауза'], ['Pauză', 'Pause', 'Пауза'], ['▶ Continuă', '▶ Resume', '▶ Продолжить'], ['❔ Cum se joacă', '❔ How to play', '❔ Как играть'], ['↻ Joc nou', '↻ New game', '↻ Новая игра'], ['Am înțeles', 'Got it', 'Понятно'],
    ['🗺️ Hartă nouă', '🗺️ New map', '🗺️ Новая карта'], ['Hartă nouă', 'New map', 'Новая карта'], ['Nume', 'Name', 'Название'], ['Mărime:', 'Size:', 'Размер:'], ['Inele de forturi:', 'Fort rings:', 'Кольца фортов:'], ['Forturi pe inel', 'Forts per ring', 'Фортов на кольце'],
    ['Puține', 'Few', 'Мало'], ['Normal', 'Normal', 'Обычно'], ['Multe', 'Many', 'Много'], ['Petrol', 'Oil', 'Нефть'], ['Puțin', 'Little', 'Мало'], ['Mult', 'Lots', 'Много'], ['Teren', 'Terrain', 'Местность'],
    ['Nou la fiecare joc', 'New every game', 'Новая каждую игру'], ['Mereu același', 'Always the same', 'Всегда одна'], ['Cod teren', 'Terrain code', 'Код местности'], ['Sau lipește codul unei hărți primite de la un prieten', 'Or paste a map code from a friend', 'Или вставьте код карты от друга'],
    ['Importă', 'Import', 'Импорт'], ['💾 Salvează harta', '💾 Save map', '💾 Сохранить карту'], ['Strategie în timp real · Pustiul de după cădere', 'Real-time strategy · The wasteland after the fall', 'Стратегия в реальном времени · Пустошь после падения'],
    ['Nivel de tehnologie la start', 'Starting technology level', 'Уровень технологий на старте'], ['Dificultate', 'Difficulty', 'Сложность'], ['Hartă', 'Map', 'Карта'], ['▶ JOACĂ', '▶ PLAY', '▶ ИГРАТЬ'], ['❔ Ajutor', '❔ Help', '❔ Помощь'],
    ['Construiește generatoare pe sondele de petrol, proiectează-ți tancurile și distruge baza inamică.', 'Build generators on oil wells, design your tanks and destroy the enemy base.', 'Стройте генераторы на скважинах, проектируйте танки и уничтожьте вражескую базу.'],
    ['Atinge o sondă de petrol liberă (pată neagră).', 'Tap a free oil well (black spot).', 'Коснитесь свободной нефтяной скважины (чёрное пятно).'],
    ['unități', 'units', 'ед.'], ['constructori', 'builders', 'строит.'], ['În construcție', 'Under construction', 'Строится'],
    ['. Fiecare VTOL are muniție pentru câteva atacuri, apoi se întoarce singur pe platformă.', '. Each VTOL has ammo for a few attacks, then flies back to its pad.', '. У каждого СВВП боезапас на несколько атак, затем он сам возвращается на площадку.'],
    ['🔒 cercetează', '🔒 research', '🔒 изучите'], ['față de:', 'vs:', 'против:'], ['✔ gata', '✔ ready', '✔ готов'], ['⏳ încarcă…', '⏳ loading…', '⏳ загрузка…'],
    ['👥 MULTIPLAYER', '👥 MULTIPLAYER', '👥 МУЛЬТИПЛЕЕР'], ['MULTIPLAYER', 'MULTIPLAYER', 'МУЛЬТИПЛЕЕР'], ['CO-OP', 'CO-OP', 'КООП'],
    ['Aviație avansată', 'Advanced aviation', 'Продвинутая авиация'], ['Artilerie cu bătaie lungă', 'Long-range artillery', 'Дальнобойная артиллерия'], ['Rachete cu bătaie lungă', 'Long-range missiles', 'Дальнобойные ракеты'],
    ['— deblocat!', '— unlocked!', '— открыто!'], ['Magazinul Google Play nu e disponibil acum. Încearcă mai târziu.', 'Google Play store is not available right now. Try again later.', 'Магазин Google Play сейчас недоступен. Попробуйте позже.'],
    ['Plata nu a reușit. Încearcă din nou.', 'The payment did not go through. Try again.', 'Оплата не прошла. Попробуйте ещё раз.'], ['Cumpărarea merge doar în aplicația instalată din Google Play', 'Purchases work only in the app installed from Google Play', 'Покупки работают только в приложении из Google Play'],
    ['O singură plată, pentru totdeauna. Cercetarea rămâne apoi de făcut în laborator, ca de obicei.', 'One payment, forever. You still research it in the lab as usual.', 'Один платёж навсегда. Исследование затем проводится в лаборатории как обычно.'],
    ['Cumpără', 'Buy', 'Купить'],
    ['Anul 2200. Acum o sută de ani, rețeaua de sateliți de luptă a scăpat de sub control și a aruncat asupra Pământului ploaia de fier — Căderea. Din ruine s-a ridicat Legiunea Roșie, care a pus mâna pe vechea Cetate de comandă din centrul continentului. Tu conduci ultimii soldați ai Coaliției Sudului.',
     'The year 2200. A hundred years ago the network of battle satellites went out of control and rained iron down on the Earth — the Fall. From the ruins rose the Red Legion, which seized the old command Citadel at the heart of the continent. You lead the last soldiers of the Southern Coalition.',
     '2200 год. Сто лет назад сеть боевых спутников вышла из-под контроля и обрушила на Землю железный дождь — Падение. Из руин поднялся Красный Легион и захватил старую командную Цитадель в центре континента. Вы ведёте последних солдат Южной Коалиции.'],
    ['Ne-am ascuns în Valea Verde, dar Legiunea ne-a găsit. Șapte avanposturi blochează drumul spre sondele de petrol. Construiește generatoare, fă primele tancuri și curăță valea.',
     'We hid in the Green Valley, but the Legion found us. Seven outposts block the road to the oil wells. Build generators, make your first tanks and clear the valley.',
     'Мы укрылись в Зелёной долине, но Легион нас нашёл. Семь аванпостов перекрывают путь к нефтяным скважинам. Стройте генераторы, создайте первые танки и очистите долину.'],
    ['Avem nevoie de petrol pentru iarnă. În Dunele de Fier, Legiunea păzește cele mai bogate sonde cu trei linii de forturi. Șenilele, rachetele și mortierele noi te vor ajuta să treci prin ele.',
     'We need oil for the winter. In the Iron Dunes the Legion guards the richest wells with three lines of forts. New tracks, rockets and mortars will help you break through.',
     'Нам нужна нефть на зиму. В Железных дюнах Легион охраняет богатейшие скважины тремя линиями фортов. Новые гусеницы, ракеты и миномёты помогут прорваться.'],
    ['Singurul drum spre nord trece prin munții înghețați, unde Legiunea a ridicat patru inele de forturi. Inginerii noștri au terminat laserul de luptă, primele avioane VTOL și fortificațiile.',
     'The only road north crosses the frozen mountains, where the Legion has raised four rings of forts. Our engineers have finished the combat laser, the first VTOL aircraft and hardpoints.',
     'Единственная дорога на север идёт через ледяные горы, где Легион возвёл четыре кольца фортов. Наши инженеры закончили боевой лазер, первые СВВП и укрепления.'],
    ['Am găsit fabricile de artilerie ale Legiunii în Canionul de Foc. Distruge-le înainte să termine noile obuziere și lansatoarele de plasmă. Sunt cele mai bine apărate baze de până acum.',
     'We found the Legion\'s artillery factories in the Fire Canyon. Destroy them before they finish the new howitzers and plasma launchers. These are the best-defended bases so far.',
     'Мы нашли артиллерийские заводы Легиона в Огненном каньоне. Уничтожьте их, пока они не закончили новые гаубицы и плазменные установки. Это самые защищённые базы до сих пор.'],
    ['A sosit ziua. Cetatea Legiunii controlează ultimul satelit care încă poate arunca fier asupra noastră. Rupe inelele de apărare, sparge zidurile și distruge Cetatea. Pentru Coaliție!',
     'The day has come. The Legion\'s Citadel controls the last satellite that can still rain iron on us. Break the defence rings, smash the walls and destroy the Citadel. For the Coalition!',
     'Этот день настал. Цитадель Легиона управляет последним спутником, который ещё может обрушить на нас железо. Прорвите кольца обороны, разбейте стены и уничтожьте Цитадель. За Коалицию!'],
    ['Cetatea a căzut. Legiunea Roșie nu mai există, iar cerul este, în sfârșit, liniștit. Mulțumim, comandante!', 'The Citadel has fallen. The Red Legion is no more and the sky is finally quiet. Thank you, commander!', 'Цитадель пала. Красного Легиона больше нет, и небо наконец спокойно. Спасибо, командир!'],
    ['Primul foc', 'First fire', 'Первый огонь'], ['Dunele de fier', 'Iron dunes', 'Железные дюны'], ['Trecătoarea înghețată', 'Frozen pass', 'Ледяной перевал'], ['Canionul de foc', 'Fire canyon', 'Огненный каньон'], ['Căderea Cetății', 'Fall of the Citadel', 'Падение Цитадели'],
    ['Valea Verde', 'Green Valley', 'Зелёная долина'], ['Deșertul de Est', 'Eastern Desert', 'Восточная пустыня'], ['Munții de Nord', 'Northern Mountains', 'Северные горы'], ['Canionul de Foc', 'Fire Canyon', 'Огненный каньон'], ['Inima continentului', 'Heart of the continent', 'Сердце континента'],
    ['Distruge Cetatea Legiunii.', 'Destroy the Legion\'s Citadel.', 'Уничтожьте Цитадель Легиона.'], ['Distruge toate avanposturile inamice.', 'Destroy all enemy outposts.', 'Уничтожьте все вражеские аванпосты.'],
    ['Tehnologii noi de cercetat:', 'New technologies to research:', 'Новых технологий:'], ['Obiectiv:', 'Objective:', 'Задача:'], ['▶ Începe misiunea', '▶ Start mission', '▶ Начать миссию'], ['▶ Misiunea următoare', '▶ Next mission', '▶ Следующая миссия'],
    ['🎖 CAMPANIE', '🎖 CAMPAIGN', '🎖 КАМПАНИЯ'], ['🎖 Campanie', '🎖 Campaign', '🎖 Кампания'], ['Misiunea', 'Mission', 'Миссия'], ['Mis.', 'Msn.', 'Мис.'], ['MISIUNE ÎNDEPLINITĂ', 'MISSION COMPLETE', 'МИССИЯ ВЫПОЛНЕНА'], ['MISIUNE EȘUATĂ', 'MISSION FAILED', 'МИССИЯ ПРОВАЛЕНА'],
    ['CAMPANIE CÂȘTIGATĂ', 'CAMPAIGN WON', 'КАМПАНИЯ ВЫИГРАНА'], ['↻ Reîncearcă', '↻ Retry', '↻ Повторить'],
    ['Mare', 'Large', 'Большая'], ['Tu', 'You', 'Вы'], ['Fabrica', 'The factory', 'Завод'], ['Laboratorul', 'The lab', 'Лаборатория'], ['Victorie:', 'Victory:', 'Победа:'],
  ];

  // whole help list, translated as blocks so the sentences read naturally
  const HELP = {
    en: `<li><b>One finger drag</b> = move the camera. <b>Two fingers</b> = zoom (pinch) and rotate.</li>
<li><b>Tap</b> a unit = select it. <b>Double tap</b> = all units of the same type.</li>
<li><b>Hold then drag</b> (or the ⬚ button) = box selection.</li>
<li>With units selected: <b>tap the ground</b> = move, <b>tap an enemy</b> = attack.</li>
<li><b>⚔ Attack-move</b>: units attack everything they meet on the way.</li>
<li><b>📋 Orders</b> (with units selected): <b>Fire</b> at will / return fire only / hold fire; <b>Stance</b> pursue / guard the spot / hold position; automatic <b>Retreat</b> to repair at 50% or 25% health. Plus <b>Patrol</b> (tap the map: they go back and forth), <b>To base</b>, <b>To repair</b> and <b>Recycle</b> (returns part of the energy).</li>
<li><b>Builders 🚜</b> raise buildings. Build <b>Generators</b> on oil wells (burning black spots) — each gives +4 energy ⚡/s.</li>
<li><b>Builders</b> have two tabs: <b>Base</b> (generator, factory, lab, repair facility, radar tower) and <b>Defence</b>: Tower, Bunker, Hardpoint, Fortress, Artillery emplacement — each with the weapons you researched — plus tank traps and walls. A hardpoint placed on your concrete wall becomes part of the wall.</li>
<li><b>The factory</b> builds units. In the <b>Designer</b> you pick 3 modules: <b>chassis</b> (wheels, tracks, hover), <b>body</b> (Scout, Light, Medium, Assault, Heavy, Titan or the golden Nova) and the <b>top module</b>: weapon (machine gun, cannon, rockets, <b>laser</b>), <b>radar</b> (+25% range and +15% attack for nearby allies) or <b>repair</b> (repairs damaged units and buildings automatically).</li>
<li><b>The lab</b> has research branches: Mobility, Body & armour, Weapons, <b>Support</b> (radar, repair), <b>Defence</b> (traps, bunkers, hardpoints, fortresses) and Industry.</li>
<li>Select the factory and tap the map to set the <b>rally point</b>.</li>
<li>Builders can <b>repair</b> buildings: select them and tap the damaged building.</li>
<li><b>Victory:</b> destroy the enemy HQ and all enemy factories.</li>`,
    ru: `<li><b>Один палец</b> = перемещение камеры. <b>Два пальца</b> = масштаб (щипок) и поворот.</li>
<li><b>Касание</b> юнита = выбор. <b>Двойное касание</b> = все юниты того же типа.</li>
<li><b>Удерживайте и тяните</b> (или кнопка ⬚) = выбор рамкой.</li>
<li>С выбранными войсками: <b>касание земли</b> = движение, <b>касание врага</b> = атака.</li>
<li><b>⚔ Атака в движении</b>: войска атакуют всё, что встречают по пути.</li>
<li><b>📋 Приказы</b> (с выбранными войсками): <b>Огонь</b> свободный / только ответный / не стрелять; <b>Позиция</b> преследовать / охранять место / стоять; автоматическое <b>Отступление</b> на ремонт при 50% или 25% прочности. А также <b>Патруль</b> (коснитесь карты: туда и обратно), <b>На базу</b>, <b>На ремонт</b> и <b>Переработать</b> (возвращает часть энергии).</li>
<li><b>Строители 🚜</b> возводят здания. Стройте <b>Генераторы</b> на нефтяных скважинах (горящие чёрные пятна) — каждый даёт +4 энергии ⚡/с.</li>
<li>У <b>Строителей</b> две вкладки: <b>База</b> (генератор, завод, лаборатория, ремонтная мастерская, радарная башня) и <b>Оборона</b>: Башня, Бункер, Укрепление, Крепость, Артиллерийская позиция — с изученным оружием — плюс ежи и стены. Укрепление, поставленное на вашу бетонную стену, становится частью стены.</li>
<li><b>Завод</b> производит войска. В <b>Конструкторе</b> выбираются 3 модуля: <b>шасси</b> (колёса, гусеницы, ховер), <b>корпус</b> (Разведчик, Лёгкий, Средний, Штурм, Тяжёлый, Титан или золотой Нова) и <b>верхний модуль</b>: оружие (пулемёт, пушка, ракеты, <b>лазер</b>), <b>радар</b> (+25% дальности и +15% атаки союзникам рядом) или <b>ремонт</b> (автоматически чинит войска и здания).</li>
<li>В <b>Лаборатории</b> ветки исследований: Мобильность, Корпус и броня, Вооружение, <b>Поддержка</b> (радар, ремонт), <b>Оборона</b> (ежи, бункеры, укрепления, крепости) и Промышленность.</li>
<li>Выберите завод и коснитесь карты, чтобы задать <b>точку сбора</b>.</li>
<li>Строители могут <b>чинить</b> здания: выберите их и коснитесь повреждённого здания.</li>
<li><b>Победа:</b> уничтожьте вражеский штаб и все вражеские заводы.</li>`,
  };

  const idx = { en: 1, ru: 2 }[window.IF_LANG];
  window.IF_T = s => s;                                    // Romanian: nothing to do
  if (idx) {
    const map = new Map(); for (const r of D) if (!map.has(r[0])) map.set(r[0], r[idx]);
    const keys = [...map.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('(?<![\\p{L}])(' + keys.join('|') + ')(?![\\p{L}])', 'gu');
    const tr = s => (s && /[\p{L}]/u.test(s)) ? s.replace(re, m => map.get(m)) : s;
    window.IF_T = tr;
    const fixNode = n => { if (n.__ifT === n.nodeValue) return; const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; n.__ifT = n.nodeValue; };
    const ATTR = ['placeholder', 'title', 'aria-label'];
    const fixEl = el => { for (const a of ATTR) { const v = el.getAttribute && el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
      if (el.tagName === 'INPUT' && el.type === 'text' && el.value === 'Harta mea') el.value = map.get('Harta mea'); };
    const walk = root => { if (root.nodeType === 3) { fixNode(root); return; } if (root.nodeType !== 1) return; if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
      fixEl(root); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n; while ((n = w.nextNode())) { if (n.nodeType === 3) fixNode(n); else fixEl(n); } };
    const start = () => {
      const ul = document.querySelector('#help ul.help'); if (ul && HELP[window.IF_LANG]) ul.innerHTML = HELP[window.IF_LANG];
      document.documentElement.lang = window.IF_LANG; document.title = 'Ironfall 2200';
      walk(document.body);
      new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') fixNode(m.target); else if (m.type === 'attributes') fixEl(m.target); else for (const n of m.addedNodes) walk(n); } })
        .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    // canvas labels (minimap, designer chart)
    const ft = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { return ft.call(this, typeof t === 'string' ? tr(t) : t, ...a); };
  }

  // ---- language picker: shown before the game the first time, and from the 🌐 button in the menu ----
  function picker(first) {
    const o = document.createElement('div'); o.id = 'langPick';
    o.innerHTML = `<div class="lpbox"><div class="lpt">IRONFALL <span>2200</span></div><div class="lps">🌐 Limba · Language · Язык</div>
      <button data-l="ro">🇷🇴 Română</button><button data-l="en">🇬🇧 English</button><button data-l="ru">🇷🇺 Русский</button></div>`;
    o.addEventListener('click', ev => { const b = ev.target.closest('[data-l]'); if (!b) return; const l = b.dataset.l;
      try { localStorage.setItem('ironfall.lang', l); } catch (e) {}
      if (first && l === 'ro') { o.remove(); return; } location.reload(); });
    document.body.appendChild(o);
  }
  window.IF_LANG_PICK = () => picker(false);
  const boot = () => {
    const hb = document.getElementById('bHelp'), menu = hb && hb.parentNode;
    if (menu && !document.getElementById('bLang')) { const b = document.createElement('button'); b.id = 'bLang'; b.textContent = '🌐 ' + ({ ro: 'Română', en: 'English', ru: 'Русский' }[window.IF_LANG]); b.addEventListener('click', () => picker(false)); menu.appendChild(b); }
    if (!LANG) picker(true);
  };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
