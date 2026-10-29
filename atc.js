/* Классификация АТХ (ВОЗ) для каталога: группы 1-го уровня (буква) и 2-го (буква + 2 цифры) по-русски,
   плюс симптомы для поиска «по показанию»: «кашель» → R05, «давление» → C02, C03, C07, C08, C09 и т. д.
   Коды симптомов — начала кодов АТХ (N02BE — парацетамол и родственные, а не все анальгетики).
   keys — начала слов после UzSearch.normalize (кириллица, ё → е): «кашл» найдёт «кашель», «кашля», «от кашля».
   Ключ из 3 букв — только целое слово: «ран» не должен находить «ранитидин», «нос» — «носпа». */
(function (root) {
  "use strict";
  const GROUPS = {
    A: ["Пищеварение и обмен веществ", "Желудок, кишечник, печень, диабет, витамины"],
    B: ["Кровь", "Анемия, свёртываемость, растворы для инфузий"],
    C: ["Сердце и сосуды", "Давление, сердце, холестерин"],
    D: ["Кожа", "Мази, кремы, антисептики, лечение ран"],
    G: ["Мочеполовая система", "Гинекология, урология, половые гормоны"],
    H: ["Гормоны", "Кроме половых гормонов и инсулина"],
    J: ["Против инфекций", "Антибиотики, противовирусные, противогрибковые, вакцины"],
    L: ["Онкология и иммунитет", "Противоопухолевые, иммуномодуляторы"],
    M: ["Мышцы, суставы, кости", "Противовоспалительные, миорелаксанты, подагра"],
    N: ["Нервная система", "Обезболивающие, успокоительные, сон, память"],
    P: ["Против паразитов", "Глисты, простейшие, вши и чесотка"],
    R: ["Дыхание", "Кашель, насморк, горло, астма, аллергия"],
    S: ["Глаза и уши", "Капли и мази для глаз и ушей"],
    V: ["Прочие", "Диагностика, контраст, питание"],
  };
  const SUB = {
    A01: "Стоматологические средства", A02: "При повышенной кислотности, изжоге, язве", A03: "При спазмах и нарушениях работы ЖКТ",
    A04: "Против тошноты и рвоты", A05: "Для печени и желчных путей", A06: "Слабительные", A07: "При диарее и кишечных инфекциях",
    A08: "Для снижения веса", A09: "Ферменты для пищеварения", A10: "При сахарном диабете", A11: "Витамины",
    A12: "Минеральные добавки", A13: "Общеукрепляющие", A14: "Анаболические средства", A15: "Для аппетита",
    A16: "Прочие для ЖКТ и обмена веществ",
    B01: "Против тромбов", B02: "Кровоостанавливающие", B03: "При анемии", B05: "Растворы и кровезаменители",
    B06: "Прочие для крови",
    C01: "Для сердца", C02: "Снижающие давление", C03: "Мочегонные", C04: "Расширяющие периферические сосуды",
    C05: "Для вен и сосудов (ангиопротекторы)", C07: "Бета-блокаторы", C08: "Блокаторы кальциевых каналов",
    C09: "Ингибиторы АПФ и сартаны", C10: "Снижающие холестерин",
    D01: "Противогрибковые для кожи", D02: "Смягчающие и защитные", D03: "Для заживления ран и язв", D04: "Против зуда",
    D05: "При псориазе", D06: "Антибиотики для кожи", D07: "Гормональные мази и кремы", D08: "Антисептики",
    D09: "Лечебные повязки", D10: "Против угревой сыпи", D11: "Прочие для кожи",
    G01: "Противомикробные для гинекологии", G02: "Прочие для гинекологии", G03: "Половые гормоны, контрацептивы",
    G04: "Для урологии и простаты",
    H01: "Гормоны гипофиза и гипоталамуса", H02: "Кортикостероиды", H03: "Для щитовидной железы",
    H04: "Гормоны поджелудочной железы", H05: "Для обмена кальция",
    J01: "Антибиотики", J02: "Противогрибковые", J03: "Сульфаниламиды", J04: "Против туберкулёза",
    J05: "Противовирусные", J06: "Сыворотки и иммуноглобулины", J07: "Вакцины",
    L01: "Противоопухолевые", L02: "Гормональные противоопухолевые", L03: "Иммуностимуляторы", L04: "Иммунодепрессанты",
    M01: "Противовоспалительные (НПВС)", M02: "Мази и гели при боли в суставах и мышцах", M03: "Миорелаксанты",
    M04: "При подагре", M05: "Для костей (остеопороз)", M09: "Прочие для мышц и суставов",
    N01: "Анестетики", N02: "Обезболивающие и жаропонижающие", N03: "Противоэпилептические",
    N04: "При болезни Паркинсона", N05: "Успокоительные, снотворные, нейролептики",
    N06: "Антидепрессанты, ноотропы, для памяти", N07: "Прочие для нервной системы",
    P01: "Против простейших", P02: "Против глистов", P03: "Против вшей, чесотки, насекомых",
    R01: "Для носа", R02: "Для горла", R03: "При астме и бронхоспазме", R05: "От кашля и простуды",
    R06: "Против аллергии", R07: "Прочие для дыхания",
    S01: "Для глаз", S02: "Для ушей", S03: "Для глаз и ушей",
    V01: "Аллергены", V03: "Прочие лечебные", V04: "Диагностические", V06: "Лечебное питание",
    V07: "Вспомогательные (вода для инъекций и т. п.)", V08: "Контрастные", V09: "Диагностические радиофармпрепараты",
    V10: "Лечебные радиофармпрепараты",
  };
  const SYMPTOMS = [
    ["Кашель", ["кашл", "кашел", "мокрот", "отхарк", "бронхит"], ["R05"]],
    ["Простуда и грипп", ["простуд", "грипп", "орви", "орз"], ["R05", "N02BE", "J05AH", "R01"]],
    ["Температура", ["температур", "жар", "лихорад", "жаропониж"], ["N02BE", "M01AE"]],
    ["Боль", ["боль", "боли", "болит", "болей", "обезбол", "мигрен"], ["N02", "M01A"]],
    ["Боль в горле", ["горл", "ангин", "тонзил", "фаринг"], ["R02"]],
    ["Насморк", ["насморк", "ринит", "заложен", "нос", "носа", "носу"], ["R01"]],
    ["Аллергия", ["аллерг", "крапивниц", "зуд"], ["R06", "D04"]],
    ["Давление", ["давлен", "гипертон", "гипертенз"], ["C02", "C03", "C07", "C08", "C09"]],
    ["Сердце", ["сердц", "аритм", "стенокард", "сердечн"], ["C01"]],
    ["Холестерин", ["холестерин", "атеросклер"], ["C10"]],
    ["Диабет", ["диабет", "сахар"], ["A10"]],
    ["Изжога и гастрит", ["изжог", "гастрит", "язва", "язвы", "язвен", "кислотн", "желуд"], ["A02"]],
    ["Тошнота и рвота", ["тошнот", "рвот", "укачив"], ["A04"]],
    ["Диарея", ["диаре", "понос"], ["A07"]],
    ["Запор", ["запор", "слабит"], ["A06"]],
    ["Вздутие и спазмы", ["вздути", "метеоризм", "спазм", "колик"], ["A03"]],
    ["Печень", ["печен", "желч", "гепат"], ["A05"]],
    ["Пищеварение", ["пищевар", "фермент"], ["A09"]],
    ["Витамины и минералы", ["витамин", "минерал", "кальци", "магни"], ["A11", "A12"]],
    ["Анемия", ["анеми", "железодефиц", "малокров"], ["B03"]],
    ["Тромбы", ["тромб", "разжиж"], ["B01"]],
    ["Кровотечение", ["кровотеч", "кровоостан"], ["B02"]],
    ["Инфекция, антибиотики", ["антибиот", "инфекц", "бактер"], ["J01"]],
    ["Грибок", ["грибок", "грибк", "молочниц", "микоз", "кандид"], ["D01", "J02", "G01AF"]],
    ["Вирусы и герпес", ["вирус", "герпес"], ["J05", "D06BB"]],
    ["Глисты", ["глист", "гельминт", "паразит"], ["P02"]],
    ["Вши и чесотка", ["вши", "педикул", "чесотк"], ["P03"]],
    ["Суставы и спина", ["сустав", "спин", "артрит", "артроз", "радикулит", "остеохондроз", "поясниц"], ["M01", "M02"]],
    ["Мышцы", ["мышц", "миорелакс"], ["M03"]],
    ["Подагра", ["подагр"], ["M04"]],
    ["Кости и остеопороз", ["остеопороз", "кости", "костн"], ["M05"]],
    ["Сон и нервы", ["бессонниц", "сон", "сна", "нерв", "стресс", "тревог", "успоко"], ["N05"]],
    ["Депрессия", ["депресс"], ["N06A"]],
    ["Память и мозг", ["памят", "ноотроп", "мозг"], ["N06B", "N06D"]],
    ["Эпилепсия и судороги", ["эпилеп", "судорог"], ["N03"]],
    ["Раны и ожоги", ["ран", "раны", "рана", "ранк", "ожог", "заживл", "порез"], ["D03", "D06"]],
    ["Дерматит и экзема", ["дерматит", "экзем"], ["D07"]],
    ["Прыщи и акне", ["прыщ", "акне", "угри", "угрев"], ["D10"]],
    ["Псориаз", ["псориаз"], ["D05"]],
    ["Глаза", ["глаз", "конъюнктив"], ["S01"]],
    ["Уши", ["ухо", "уха", "уши", "отит"], ["S02"]],
    ["Астма и одышка", ["астм", "одышк", "бронхоспазм"], ["R03"]],
    ["Щитовидная железа", ["щитовидн", "тиреоид"], ["H03"]],
    ["Мочевые пути и простата", ["цистит", "простат", "мочев"], ["G04"]],
    ["Контрацепция", ["контрацеп", "противозачат"], ["G03A"]],
    ["Потенция", ["потенц", "эрекц"], ["G04BE"]],
    ["Похудение", ["похуд", "ожирен"], ["A08"]],
    ["Иммунитет", ["иммун"], ["L03"]],
    ["Антисептики", ["антисепт", "дезинф"], ["D08"]],
  ].map(([name, keys, atc]) => ({ name, keys, atc }));

  // ---------- узбекский (латиница): группы, подгруппы, симптомы и узбекские слова для поиска по симптому ----------
  const GROUPS_UZ = {
    A: ["Hazm qilish va modda almashinuvi", "Oshqozon, ichak, jigar, diabet, vitaminlar"],
    B: ["Qon", "Kamqonlik, qon ivishi, infuziya eritmalari"],
    C: ["Yurak va qon tomirlar", "Bosim, yurak, xolesterin"],
    D: ["Teri", "Malham, krem, antiseptiklar, yaralarni davolash"],
    G: ["Siydik-tanosil tizimi", "Ginekologiya, urologiya, jinsiy gormonlar"],
    H: ["Gormonlar", "Jinsiy gormonlar va insulindan tashqari"],
    J: ["Infeksiyalarga qarshi", "Antibiotiklar, virus va zamburug‘ga qarshi, vaksinalar"],
    L: ["Onkologiya va immunitet", "O‘smaga qarshi, immunomodulyatorlar"],
    M: ["Mushak, bo‘g‘im, suyaklar", "Yallig‘lanishga qarshi, miorelaksantlar, podagra"],
    N: ["Asab tizimi", "Og‘riq qoldiruvchi, tinchlantiruvchi, uyqu, xotira"],
    P: ["Parazitlarga qarshi", "Gijjalar, sodda jonivorlar, bit va qo‘tir"],
    R: ["Nafas olish tizimi", "Yo‘tal, tumov, tomoq, astma, allergiya"],
    S: ["Ko‘z va quloq", "Ko‘z va quloq uchun tomchi va malhamlar"],
    V: ["Boshqalar", "Diagnostika, kontrast, ozuqa"],
  };
  const SUB_UZ = {
    A01: "Stomatologik vositalar", A02: "Kislotalilik, jig‘ildon qaynashi, yara uchun", A03: "Spazm va oshqozon-ichak faoliyati buzilishida",
    A04: "Ko‘ngil aynishi va qusishga qarshi", A05: "Jigar va o‘t yo‘llari uchun", A06: "Surgi dorilar", A07: "Diareya va ichak infeksiyalarida",
    A08: "Vazn kamaytirish uchun", A09: "Hazm qilish fermentlari", A10: "Qandli diabetda", A11: "Vitaminlar",
    A12: "Mineral qo‘shimchalar", A13: "Umumiy quvvatlovchi", A14: "Anabolik vositalar", A15: "Ishtahani ochuvchi",
    A16: "Oshqozon-ichak va modda almashinuvi uchun boshqalar",
    B01: "Trombga qarshi", B02: "Qon to‘xtatuvchi", B03: "Kamqonlikda", B05: "Eritmalar va qon o‘rnini bosuvchilar",
    B06: "Qon uchun boshqalar",
    C01: "Yurak uchun", C02: "Bosimni pasaytiruvchi", C03: "Siydik haydovchi", C04: "Periferik tomirlarni kengaytiruvchi",
    C05: "Vena va tomirlar uchun (angioprotektorlar)", C07: "Beta-blokatorlar", C08: "Kalsiy kanallari blokatorlari",
    C09: "AAF ingibitorlari va sartanlar", C10: "Xolesterinni pasaytiruvchi",
    D01: "Teri uchun zamburug‘ga qarshi", D02: "Yumshatuvchi va himoyalovchi", D03: "Yara va yaralarni bitkazish uchun", D04: "Qichishishga qarshi",
    D05: "Psoriazda", D06: "Teri uchun antibiotiklar", D07: "Gormonli malham va kremlar", D08: "Antiseptiklar",
    D09: "Davolovchi bog‘lamlar", D10: "Husnbuzarga qarshi", D11: "Teri uchun boshqalar",
    G01: "Ginekologiya uchun mikroblarga qarshi", G02: "Ginekologiya uchun boshqalar", G03: "Jinsiy gormonlar, kontratseptivlar",
    G04: "Urologiya va prostata uchun",
    H01: "Gipofiz va gipotalamus gormonlari", H02: "Kortikosteroidlar", H03: "Qalqonsimon bez uchun",
    H04: "Oshqozon osti bezi gormonlari", H05: "Kalsiy almashinuvi uchun",
    J01: "Antibiotiklar", J02: "Zamburug‘ga qarshi", J03: "Sulfanilamidlar", J04: "Silga qarshi",
    J05: "Virusga qarshi", J06: "Zardoblar va immunoglobulinlar", J07: "Vaksinalar",
    L01: "O‘smaga qarshi", L02: "Gormonal o‘smaga qarshi", L03: "Immunostimulyatorlar", L04: "Immunodepressantlar",
    M01: "Yallig‘lanishga qarshi (NYaQV)", M02: "Bo‘g‘im va mushak og‘rig‘ida malham va gellar", M03: "Miorelaksantlar",
    M04: "Podagrada", M05: "Suyaklar uchun (osteoporoz)", M09: "Mushak va bo‘g‘imlar uchun boshqalar",
    N01: "Anestetiklar", N02: "Og‘riq qoldiruvchi va isitma tushiruvchi", N03: "Epilepsiyaga qarshi",
    N04: "Parkinson kasalligida", N05: "Tinchlantiruvchi, uxlatuvchi, neyroleptiklar",
    N06: "Antidepressantlar, nootroplar, xotira uchun", N07: "Asab tizimi uchun boshqalar",
    P01: "Sodda jonivorlarga qarshi", P02: "Gijjalarga qarshi", P03: "Bit, qo‘tir va hasharotlarga qarshi",
    R01: "Burun uchun", R02: "Tomoq uchun", R03: "Astma va bronxospazmda", R05: "Yo‘tal va shamollashdan",
    R06: "Allergiyaga qarshi", R07: "Nafas olish uchun boshqalar",
    S01: "Ko‘z uchun", S02: "Quloq uchun", S03: "Ko‘z va quloq uchun",
    V01: "Allergenlar", V03: "Boshqa davolovchi", V04: "Diagnostik", V06: "Davolovchi ozuqa",
    V07: "Yordamchi (in’eksiya uchun suv va h.k.)", V08: "Kontrast moddalar", V09: "Diagnostik radiofarmpreparatlar",
    V10: "Davolovchi radiofarmpreparatlar",
  };
  // [русское название] → [узбекское, узбекские начала слов (латиницей, приводятся к виду запроса через normalize)]
  const SYMPTOMS_UZ = {
    "Кашель": ["Yo‘tal", ["yo‘tal", "yotal", "balg‘am"]],
    "Простуда и грипп": ["Shamollash va gripp", ["shamolla", "gripp", "tumov"]],
    "Температура": ["Isitma", ["isitma", "harorat", "qizdirma", "temperatura"]],
    "Боль": ["Og‘riq", ["og‘riq", "ogriq", "og‘ri"]],
    "Боль в горле": ["Tomoq og‘rig‘i", ["tomoq", "angina"]],
    "Насморк": ["Tumov", ["tumov", "burun"]],
    "Аллергия": ["Allergiya", ["allergi", "qichish", "toshma"]],
    "Давление": ["Qon bosimi", ["bosim", "gipertoni"]],
    "Сердце": ["Yurak", ["yurak", "aritmi"]],
    "Холестерин": ["Xolesterin", ["xolesterin"]],
    "Диабет": ["Diabet", ["diabet", "qandli"]],
    "Изжога и гастрит": ["Jig‘ildon qaynashi va gastrit", ["jig‘ildon", "jigildon", "gastrit", "oshqozon"]],
    "Тошнота и рвота": ["Ko‘ngil aynishi va qusish", ["ko‘ngil", "qusish"]],
    "Диарея": ["Ich ketishi", ["diareya", "ichketar"]],
    "Запор": ["Ich qotishi", ["qabziyat", "qotishi"]],
    "Вздутие и спазмы": ["Dam bo‘lish va spazmlar", ["spazm", "sanchiq", "meteorizm"]],
    "Печень": ["Jigar", ["jigar"]],
    "Пищеварение": ["Hazm qilish", ["hazm"]],
    "Витамины и минералы": ["Vitamin va minerallar", ["vitamin", "mineral"]],
    "Анемия": ["Kamqonlik", ["kamqon", "anemiya"]],
    "Тромбы": ["Trombozlar", ["tromb"]],
    "Кровотечение": ["Qon ketishi", ["qonash", "qonketish"]],
    "Инфекция, антибиотики": ["Infeksiya, antibiotiklar", ["infeksiya", "antibiotik", "bakteriya"]],
    "Грибок": ["Zamburug‘", ["zamburug‘", "zamburug"]],
    "Вирусы и герпес": ["Viruslar va gerpes", ["virus", "gerpes"]],
    "Глисты": ["Gijjalar", ["gijja", "parazit"]],
    "Вши и чесотка": ["Bit va qo‘tir", ["qo‘tir", "bit"]],
    "Суставы и спина": ["Bo‘g‘im va bel", ["bo‘g‘im", "bel", "artrit", "artroz"]],
    "Мышцы": ["Mushaklar", ["mushak"]],
    "Подагра": ["Podagra", ["podagra"]],
    "Кости и остеопороз": ["Suyak va osteoporoz", ["suyak", "osteoporoz"]],
    "Сон и нервы": ["Uyqu va asab", ["uyqu", "uyqusiz", "asab", "stress", "xavotir"]],
    "Депрессия": ["Depressiya", ["depressiya"]],
    "Память и мозг": ["Xotira va miya", ["xotira", "miya"]],
    "Эпилепсия и судороги": ["Epilepsiya va tirishish", ["epilepsiya", "tirish"]],
    "Раны и ожоги": ["Yara va kuyish", ["yara", "kuyish", "kuygan"]],
    "Дерматит и экзема": ["Dermatit va ekzema", ["dermatit", "ekzema"]],
    "Прыщи и акне": ["Husnbuzar", ["husnbuzar", "akne"]],
    "Псориаз": ["Psoriaz", ["psoriaz"]],
    "Глаза": ["Ko‘z", ["ko‘z"]],
    "Уши": ["Quloq", ["quloq", "otit"]],
    "Астма и одышка": ["Astma va nafas qisishi", ["astma", "nafas", "hansira"]],
    "Щитовидная железа": ["Qalqonsimon bez", ["qalqonsimon"]],
    "Мочевые пути и простата": ["Siydik yo‘llari va prostata", ["sistit", "prostata", "siydik"]],
    "Контрацепция": ["Kontratseptsiya", ["kontratsep"]],
    "Потенция": ["Potensiya", ["potensiya", "erektsiya"]],
    "Похудение": ["Ozish", ["ozish", "semizlik"]],
    "Иммунитет": ["Immunitet", ["immunitet"]],
    "Антисептики": ["Antiseptiklar", ["antiseptik", "dezinfek"]],
  };
  for (const s of SYMPTOMS) {
    const uz = SYMPTOMS_UZ[s.name];
    s.nameRu = s.name;
    s.nameUz = uz ? uz[0] : s.name;
    s.keysUz = uz ? uz[1] : [];
  }
  let lang = "ru", normalize = (x) => x, uzKeysReady = false;

  const api = {
    GROUPS, SUB, SYMPTOMS,
    // язык и функция normalize из search.js: узбекские слова симптомов приводим к тому же виду, что и запрос
    setLang(l, norm) {
      lang = l === "uz" ? "uz" : "ru";
      if (norm && !uzKeysReady) {
        normalize = norm;
        for (const s of SYMPTOMS) s.keys = s.keys.concat(s.keysUz.map((k) => normalize(k)).filter(Boolean));
        uzKeysReady = true;
      }
      for (const s of SYMPTOMS) s.name = lang === "uz" ? s.nameUz : s.nameRu;
    },
    group: (code) => (lang === "uz" ? GROUPS_UZ : GROUPS)[(code || "").charAt(0)] || null,
    sub: (code) => (lang === "uz" ? SUB_UZ : SUB)[(code || "").slice(0, 3)] || null,
    // симптомы по запросу: слово запроса начинается с ключа («кашля» → «кашл») или ключ — с длинного слова («аллер»)
    symptoms(normQuery) {
      const words = normQuery.split(" ").filter((w) => w.length >= 3);
      if (!words.length) return [];
      const hit = (w, k) => (k.length <= 3 ? w === k : w.startsWith(k) || (w.length >= 4 && k.startsWith(w)));
      return SYMPTOMS.filter((s) => words.some((w) => s.keys.some((k) => hit(w, k))));
    },
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.UzAtc = api;
})(this);
