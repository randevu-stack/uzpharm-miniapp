/* Мини-апп «Справочник лекарств»: поиск по реестру и по симптомам, каталог по группам АТХ, карточка с ценами, фото,
   составом и инструкцией, аналоги по МНН, избранное и профиль (нижние вкладки — как в Jurabekapp).
   Данные — catalog.json и info/*.json (собирает miniapp/build.py), поиск — search.js, группы и симптомы — atc.js.
   Навигация — один стек экранов (nav, ниже): каждый переход кладёт экран в стек и в history, «Назад» в Telegram,
   системный жест, «‹ Назад» и свайп вправо снимают верхний. Приложение закрывается только с главной. */
(function () {
  "use strict";
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.initData);
  const NO_INN = /^отсутствует утвержд[её]нное мнн$/i;
  const T = UzI18n.t;                // тексты интерфейса на текущем языке — i18n.js
  // разделы инструкции в порядке показа (ключи — как в реестре, см. INSTRUCTION_SECTIONS в uzpharm/db.py), названия — в i18n.js
  const SECTIONS = ["indication_for_use", "route_of_administration", "contraindication", "side_effect", "special_direction",
    "pregnancy", "drug_interaction", "overdose", "influence_driving_ability", "pharmacodynamics", "pharmacokinetics",
    "description", "incompatibility", "special_precautions_disposal", "preclinical_safety_data"];
  const PAGE = 30;                   // результатов поиска за раз, дальше — «Показать ещё»
  const FAV_CLOUD = "favs";          // ключ в Telegram CloudStorage: {v: [id…], t: время изменения}
  const FAV_MAX = 300;               // значение в CloudStorage — до 4096 символов, id ~6 символов
  const VIEWED_MAX = 30;
  const BOT = "Uzpharmapp";          // @Uzpharmapp: ссылка «Поделиться» — t.me/<бот>?start=d_<id>, бот присылает карточку
  const SAVE_MIN = 10;               // «аналог дешевле» показываем, если выгода от 10 %

  const $ = (id) => document.getElementById(id);
  const input = $("q"), statusEl = $("status"), results = $("results"), clearBtn = $("clear");
  const cardView = $("card-view"), cardBody = $("card");
  const tabs = { search: $("tab-search"), catalog: $("tab-catalog"), fav: $("tab-fav"), profile: $("tab-profile") };

  let drugs = [], byId = new Map(), byInn = new Map(), byInfo = new Map(), diseases = [];
  let shopsDate = "";                               // на какую дату цены в аптеках (d.shop)
  let tab = "search";
  const tabScroll = { search: 0, catalog: 0, fav: 0, profile: 0 };
  let catPath = [];                  // каталог: стопка экранов [{type, …}], пустая — список групп

  // ---------- хранилище в телефоне: всегда через try — в приватном режиме оно может не работать ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
  };
  let favs = store.get("favIds", []);            // id карточек, последние добавленные — первыми
  let viewed = store.get("viewedIds", []);

  // ---------- язык: переключатель O‘Z / RU на главной, иначе язык Telegram (uz — узбекский), иначе русский ----------
  function setLang(l) {
    UzI18n.lang = l === "uz" ? "uz" : "ru";
    UzAtc.setLang(UzI18n.lang, UzSearch.normalize);
    document.documentElement.lang = UzI18n.lang;
    document.title = T("appName");
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = T(n.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((n) => { n.innerHTML = T(n.dataset.i18nHtml); });   // только свои строки из i18n.js
    document.querySelectorAll("[data-i18n-ph]").forEach((n) => { n.placeholder = T(n.dataset.i18nPh); n.setAttribute("aria-label", T(n.dataset.i18nPh)); });
    document.querySelectorAll("[data-i18n-aria]").forEach((n) => n.setAttribute("aria-label", T(n.dataset.i18nAria)));
    document.querySelectorAll(".lang-sw button").forEach((b) => {
      const on = b.dataset.lang === UzI18n.lang;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("chips").replaceChildren(...T("examples").map((x) =>
      el("li", null, el("button", { type: "button", text: x, onclick: () => { input.value = x; onQuery(true); } }))));
    setUpdated();
  }
  function setUpdated() {
    $("updated").textContent = drugs.length
      ? T(navigator.onLine === false ? "updatedOffline" : "updated", { n: drugs.length.toLocaleString("ru-RU") })
      : T("updatedDefault");
  }
  function switchLang(l) {
    if (l === UzI18n.lang) return;
    store.set("lang", l);
    haptic();
    setLang(l);
    renderList();
    if (tab === "catalog") renderCatalog();
    if (tab === "fav") renderFav();
    renderProfile();
    if (top().card) renderCard(byId.get(top().card));
  }

  if (tg) {
    tg.ready();
    tg.expand();
    if (inTelegram) document.documentElement.classList.add("tg");
    // тёмная тема Telegram: светлая обводка у фото (--img-outline в style.css)
    const syncScheme = () => {
      document.documentElement.classList.toggle("dark", tg.colorScheme === "dark");
      // шапка и низ Telegram — цвета фона приложения, а не темы Telegram (палитра своя, см. style.css)
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg2").trim();
      try {
        if (tg.setHeaderColor) tg.setHeaderColor(bg);
        if (tg.setBackgroundColor) tg.setBackgroundColor(bg);
        if (tg.setBottomBarColor) tg.setBottomBarColor(bg);
      } catch (e) { /* старый клиент Telegram */ }
    };
    syncScheme();
    tg.onEvent("themeChanged", syncScheme);
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();   // как в Jurabekapp: прокрутка вниз не сворачивает приложение
    // кнопка «Назад» Telegram и системный жест «назад»: снять верхний экран стека (видна, пока есть куда вернуться)
    tg.BackButton.onClick(() => back());
  }

  // ---------- маленькие помощники: только textContent, никакого innerHTML с данными реестра ----------
  function el(tag, props, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c != null && c !== false) n.append(c);
    return n;
  }
  function svg(markup) {                          // только наши собственные иконки из констант ниже
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = markup;
    return s;
  }
  const ICO = {
    pill: '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="m9.2 7.9 5.6 8.2"/>',
    star: '<path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.3 6.6 20.3l1.1-6.1L3.2 9.9l6.1-.8L12 3.5z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    share: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
    save: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.5"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    sym: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    maker: '<path d="M4 22V4s1-1 4-1 5 2 8 2 4-1 4-1v11s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
  };
  const num = (x) => Math.round(x).toLocaleString("ru-RU").replace(/ /g, " ");
  const sum = (x) => num(x) + " " + T("sum");
  const date = (s) => (s && s.length >= 10 ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—");
  const minPrice = (d) => d.prices.reduce((m, p) => (p[1] && (m == null || p[1] < m) ? p[1] : m), null);
  // цена за штуку — по «№28» в названии упаковки; без количества сравнивать пачки нечестно (10 шт. против 30)
  const unitPrice = (d) => d.prices.reduce((m, [pack, retail]) => {
    const n = Number((/№\s*(\d+)/.exec(pack) || [])[1]);
    return retail && n && (m == null || retail / n < m) ? retail / n : m;
  }, null);
  const sameDose = (a, b) => UzSearch.normalize(a.form) === UzSearch.normalize(b.form)
    && UzSearch.normalize(a.dosage) === UzSearch.normalize(b.dosage);
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  // В реестре марка и форма — одной строкой: «СУМАМЕД® Таблетки, покрытые … №3(1x3)». Делим на марку и остальное:
  // начало формы — по полю «форма», иначе по первому слову-форме; марку из КАПСА — в обычный регистр («Сумамед®»)
  const FORM_WORD = /\s(?=(таблетк|капсул|раствор|порошок|сироп|суспензи|мазь|крем|гель|капли|спрей|аэрозол|лиофилизат|концентрат|суппозитор|свеч|гранул|драже|эмульси|линимент|настойк|экстракт|пастилк|пластыр|шампун|лосьон|саше|эликсир|леденц|жевательн|покрыт|шипуч|диспергир)[а-я]*)/i;
  function splitName(d) {
    if (d.short) return d.short;
    const t = d.trade;
    let i = d.form ? t.toLowerCase().indexOf(d.form.toLowerCase().slice(0, 12), 1) : -1;
    if (i <= 0) {
      const m = FORM_WORD.exec(t);
      i = m ? m.index : -1;
    }
    let brand = i > 0 ? t.slice(0, i).trim().replace(/[\s,;:]+$/, "") : t;
    const rest = i > 0 ? t.slice(i).trim() : "";
    brand = brand.replace(/[A-ZА-ЯЁ][A-ZА-ЯЁ-]{3,}/g, (w) => w.split("-").map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join("-"));
    d.short = { brand, rest: rest.charAt(0).toUpperCase() + rest.slice(1) };
    return d.short;
  }
  // форма выпуска для фильтра в поиске; порядок проверок важен: «порошок для раствора для инъекций» — укол
  const FORM_CATS = [
    ["inj", /инъекц|инфуз|лиофилизат|внутривен|внутримыш|ампул/], ["tab", /таблет|драже|пастилк|леденц/], ["cap", /капсул/],
    ["syr", /сироп|суспенз|эликсир|для приема внутрь|для внутреннего|эмульси/], ["drop", /капли/],
    ["oint", /мазь|крем|гель|линимент|паст[аы]|бальзам|лосьон/], ["spray", /спрей|аэрозол|ингал/], ["supp", /суппозитор|свеч/],
    ["pow", /порошок|гранул|саше/],
  ];
  const FORM_ORDER = ["tab", "cap", "syr", "inj", "drop", "oint", "spray", "supp", "pow", "other"];
  function formCat(d) {
    if (!d.fc) {
      const f = (d.form || d.trade).toLowerCase();
      d.fc = (FORM_CATS.find(([, re]) => re.test(f)) || ["other"])[0];
    }
    return d.fc;
  }
  function thumb(d) {
    if (!d.photo) return el("span", { class: "thumb none" }, svg(ICO.pill));
    const t = el("span", { class: "thumb", role: "img", "aria-label": T("pack") });
    t.style.backgroundImage = `url("photos/${d.photo}")`;
    return t;
  }
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }
  function haptic() {
    try { if (inTelegram && tg.HapticFeedback) tg.HapticFeedback.selectionChanged(); } catch (e) { /* старый клиент */ }
  }

  // ---------- данные ----------
  async function load() {
    try {
      // адрес с ?v=<хэш> вписывает build.py в <link id="data">; браузер начал качать его ещё при разборе страницы
      const r = await fetch($("data").getAttribute("href"));
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      const f = Object.fromEntries(data.fields.map((name, i) => [name, i]));
      const dicts = data.dicts || {};               // формат catalog.json — в miniapp/build.py
      const v = (a, name) => (dicts[name] ? dicts[name][a[f[name]]] : a[f[name]]);
      const shops = data.shops || {};               // безрецептурные: [от, до, аптек] в Ташкенте
      shopsDate = data.shopsDate || "";
      drugs = data.drugs.map((a) => {
        const d = {
          id: a[f.id], trade: a[f.name], inn: v(a, "inn"), form: v(a, "form"), dosage: v(a, "dosage"), maker: v(a, "maker"),
          rx: !!a[f.rx], indefinite: !!a[f.indefinite], expires: v(a, "expires"), photo: a[f.photo], level: v(a, "level"),
          uz: !!a[f.uz], atc: v(a, "atc") || "", comp: v(a, "comp") || "", route: v(a, "route") || "",
          shelf: v(a, "shelf") || "", info: v(a, "info") || "", shop: shops[a[f.id]] || null,
        };
        d.prices = a[f.prices].map(([pack, retail]) => [pack === 0 ? d.trade : pack, retail]);   // 0 — как название
        // поля для search.js — как search_content в базе бота
        d.text = UzSearch.normalize([d.trade, d.inn].filter(Boolean).join(" "));
        d.name = UzSearch.normalize(d.trade);
        d.rawLen = d.trade.length;
        // у ~3 тыс. карточек вместо МНН заглушка — по ней аналоги не ищем, иначе «аналогом» Цитрамона станет спирт
        if (NO_INN.test(d.inn)) d.inn = "";
        d.innKey = UzSearch.normalize(d.inn);
        return d;
      });
      byId = new Map(drugs.map((d) => [d.id, d]));
      for (const d of drugs) {
        if (d.info) (byInfo.get(d.info) || byInfo.set(d.info, []).get(d.info)).push(d);
        if (!d.innKey) continue;
        if (!byInn.has(d.innKey)) byInn.set(d.innKey, []);
        byInn.get(d.innKey).push(d);
      }
      // заболевания (МКБ-10) из инструкций: [название, код, [номера инструкций]] → карточки с этими инструкциями
      diseases = (data.diseases || []).map(([name, code, infos]) => {
        const list = [...new Set(infos.flatMap((i) => byInfo.get((dicts.info || [])[i]) || []))];
        return { name, code, key: UzSearch.normalize(name), drugs: list };
      }).filter((x) => x.drugs.length);
      setUpdated();
      if (input.value) renderList();               // запрос набрали, пока грузились данные, — показать результаты
      if (tab === "catalog") renderCatalog();
      if (byId.has(startId)) open(startId);        // открыли по ссылке на препарат: «Назад» из карточки — на главную
      pullFavs();
      // индекс для поиска с опечатками (~0,3 с на 18 тыс. карточек) строим заранее, пока человек ещё не печатает
      (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => UzSearch.prepare(drugs));
    } catch (e) {
      statusEl.textContent = T("loadError");
      statusEl.classList.add("warn");
    }
  }

  // ---------- строки списков ----------
  function row(d, withStar, save) {               // save — на сколько % аналог дешевле открытого препарата
    const p = minPrice(d);
    const { brand, rest } = splitName(d);
    const item = el("button", { class: "item", type: "button", onclick: () => open(d.id) },
      thumb(d),
      el("span", { class: "item-body" }, el("span", { class: "item-name", text: brand }),
        rest ? el("span", { class: "item-form", text: rest }) : null,
        el("span", { class: "item-sub", text: d.maker, title: d.maker })),   // под названием — сразу производитель
      el("span", { class: "item-price" }, p ? el("b", { text: num(p) }) : d.shop ? el("b", { text: T("shopFrom", { n: num(d.shop[0]) }) }) : null,
        save ? el("span", { class: "save-tag", text: `−${save} %` }) : p || d.shop ? T("sum") : T(d.rx ? "noPrice" : "freePrice"),
        el("span", { class: d.rx ? "rx-tag rx" : "rx-tag otc", text: d.rx ? T("rx") : T("otc") })));
    return el("li", { class: withStar ? "with-star" : "" }, item, withStar ? favButton(d, "row-star") : null);
  }

  // ---------- вкладка «Поиск» ----------
  function renderList() {
    const q = input.value;
    results.replaceChildren();
    statusEl.classList.remove("warn");
    tabs.search.querySelectorAll(".picks").forEach((n) => n.remove());
    const empty = UzSearch.normalize(q).replace(/ /g, "").length < 3;
    // главная (заголовок, примеры, группы, памятка) — пока запрос пустой; с запросом наверху только поиск
    tabs.search.classList.toggle("has-q", !!q.trim());
    $("home").hidden = !!q.trim();
    if (empty) {
      statusEl.textContent = q.trim() ? T("typeMore") : "";
      return;
    }
    if (!drugs.length) {                           // справочник ещё грузится — поиск выполнится сам после загрузки
      statusEl.textContent = T("loading");
      return;
    }
    const nq = UzSearch.normalize(q);
    if (nq !== filtQ) {                            // новый запрос — фильтры и «Показать ещё» с начала
      filtQ = nq;
      filt = { form: "", uz: false, otc: false, cheap: false };
      shown = PAGE;
    }
    const { items, exact } = UzSearch.search(drugs, q, 5000);   // все совпадения: фильтры работают по всем, не по первым 30
    const picks = symptomPicks(q);                 // «кашель», «астма» — подбор по группе или заболеванию
    if (picks) statusEl.before(picks);
    if (!items.length) {
      statusEl.textContent = picks ? T("noNamePicks") : T("nothing");
      return;
    }
    if (!exact) {
      statusEl.textContent = T("notExact");
      statusEl.classList.add("warn");
      results.append(...items.slice(0, PAGE).map((d) => row(d)));
      return;
    }
    // фильтры: «Сделано в UZ» и «Без рецепта» сужают список, форма выпуска — поверх них (счётчики — с учётом флажков)
    const base = items.filter((d) => (!filt.uz || d.uz) && (!filt.otc || !d.rx));
    const counts = new Map();
    for (const d of base) counts.set(formCat(d), (counts.get(formCat(d)) || 0) + 1);
    if (filt.form && !counts.has(filt.form)) filt.form = "";
    let list = filt.form ? base.filter((d) => formCat(d) === filt.form) : base;
    if (filt.cheap) {                              // дешевле — выше; Jurabek всё равно первым, без цены — в конце
      list = list.map((d, i) => [d, i]).sort(([a, i], [b, j]) => UzSearch.prio(a) - UzSearch.prio(b)
        || (minPrice(a) ?? Infinity) - (minPrice(b) ?? Infinity) || i - j).map(([d]) => d);
    }
    if (items.length > 5) statusEl.before(filterBar(counts, base.length));
    const active = filt.form || filt.uz || filt.otc;
    statusEl.textContent = active ? T("foundFiltered", { n: list.length, total: items.length }) : T("found", { n: items.length });
    if (!list.length) {
      statusEl.textContent = T("filterNone");
      results.append(el("li", { class: "more-li" }, el("button", { class: "more", type: "button", text: T("resetFilters"),
        onclick: () => { filt = { form: "", uz: false, otc: false, cheap: false }; renderList(); } })));
      return;
    }
    results.append(...list.slice(0, shown).map((d) => row(d)));
    if (list.length > shown) {
      results.append(el("li", { class: "more-li" }, el("button", { class: "more", type: "button",
        text: `${T("showMore")} · ${list.length - shown}`, onclick: () => { shown += PAGE; renderList(); } })));
    }
  }
  let filt = { form: "", uz: false, otc: false, cheap: false }, filtQ = "", shown = PAGE;
  function filterBar(counts, n) {
    const chip = (text, on, onclick) => el("button", { class: "fchip" + (on ? " on" : ""), type: "button",
      "aria-pressed": on ? "true" : "false", onclick: () => { haptic(); shown = PAGE; onclick(); renderList(); } }, text);
    const forms = FORM_ORDER.filter((k) => counts.has(k));
    return el("div", { class: "picks filters" },
      forms.length > 1 ? el("div", { class: "frow" },
        chip(`${T("fAll")} · ${n}`, !filt.form, () => { filt.form = ""; }),
        ...forms.map((k) => chip(`${T("forms")[k]} · ${counts.get(k)}`, filt.form === k, () => { filt.form = filt.form === k ? "" : k; }))) : null,
      el("div", { class: "frow" },
        chip(T("fCheap"), filt.cheap, () => { filt.cheap = !filt.cheap; }),
        chip(T("fUz"), filt.uz, () => { filt.uz = !filt.uz; }),
        chip(T("fOtc"), filt.otc, () => { filt.otc = !filt.otc; })));
  }

  // ---------- избранное: телефон + облако Telegram, синхронизация как в Jurabekapp ----------
  const isFav = (id) => favs.includes(id);
  function cloudOk() {
    try { return inTelegram && !!tg.CloudStorage && tg.isVersionAtLeast("6.9"); } catch (e) { return false; }
  }
  function saveFavs(at) {
    store.set("favIds", favs);
    store.set("favAt", at);
  }
  function pushFavs(at) {
    if (!cloudOk()) return;
    try {
      tg.CloudStorage.setItem(FAV_CLOUD, JSON.stringify({ v: favs.slice(0, FAV_MAX), t: at }), () => {});
      store.set("favSynced", true);
    } catch (e) { /* без облака избранное всё равно живёт в телефоне */ }
  }
  function pullFavs() {
    if (!cloudOk()) return;
    try {
      tg.CloudStorage.getItem(FAV_CLOUD, (err, val) => {
        if (err) return;
        let cloud = null;
        try {
          const c = JSON.parse(val || "null");
          if (c && Array.isArray(c.v)) cloud = { v: c.v.filter(Number.isInteger), t: +c.t || 0 };
        } catch (e) { /* испорченное значение — перезапишем своим */ }
        const localAt = store.get("favAt", 0);
        if (!cloud) return pushFavs(localAt || Date.now());          // в облаке пусто — кладём своё
        if (!store.get("favSynced", false)) {                         // первая встреча этого телефона с облаком — объединяем
          favs = favs.concat(cloud.v.filter((id) => !isFav(id))).slice(0, FAV_MAX);
          const at = Date.now();
          saveFavs(at);
          pushFavs(at);
          return favsChanged();
        }
        if (cloud.t > localAt) {                                      // на другом устройстве изменили позже
          favs = cloud.v;
          saveFavs(cloud.t);
          favsChanged();
        } else if (localAt > cloud.t) {                               // здесь новее — обновляем облако
          pushFavs(localAt);
        }
      });
    } catch (e) { /* старый клиент Telegram */ }
  }
  function favsChanged() {
    document.querySelectorAll(".fav-btn").forEach((b) => setFavState(b, isFav(Number(b.dataset.id))));
    if (tab === "fav") renderFav();
    if (tab === "profile") renderProfile();
  }
  function setFavState(btn, on) {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? T("favDel") : T("favAdd"));
  }
  function toggleFav(id) {
    const adding = !isFav(id);
    favs = adding ? [id, ...favs].slice(0, FAV_MAX) : favs.filter((x) => x !== id);
    const at = Date.now();
    saveFavs(at);
    pushFavs(at);
    haptic();
    toast(adding ? T("favAdded") : T("favRemoved"));
    document.querySelectorAll(".fav-btn").forEach((b) => { if (Number(b.dataset.id) === id) setFavState(b, adding); });
  }
  function favButton(d, cls) {
    const b = el("button", { class: `fav-btn ${cls || ""}`, type: "button", "data-id": String(d.id),
      onclick: (e) => { e.stopPropagation(); toggleFav(d.id); } }, svg(ICO.star));
    setFavState(b, isFav(d.id));
    return b;
  }

  function renderFav() {
    const list = favs.map((id) => byId.get(id)).filter(Boolean);   // карточка могла уйти из реестра
    const body = $("fav-body");
    if (!list.length) {
      body.replaceChildren(el("div", { class: "empty" },
        el("span", { class: "empty-ico" }, svg(ICO.star)),
        el("p", { class: "empty-title", text: T("favEmptyTitle") }),
        el("p", { class: "muted", text: T("favEmptyText") }),
        el("button", { class: "btn", type: "button", text: T("findDrug"), onclick: () => setTab("search") })));
      return;
    }
    body.replaceChildren(
      el("p", { class: "status", text: UzI18n.count(list.length, ["препарат", "препарата", "препаратов"]) }),
      el("ul", { class: "list" }, ...list.map((d) => row(d, true))));
  }

  // ---------- вкладка «Профиль» ----------
  function pfRow(icon, text, opts) {
    opts = opts || {};
    const tag = opts.href ? "a" : opts.onclick ? "button" : "div";      // строка без действия — просто текст
    const props = { class: "pf-row" + (opts.quiet ? " quiet" : "") + (tag === "div" ? " static" : "") };
    if (opts.href) props.href = opts.href;
    if (tag === "button") props.type = "button";
    if (opts.onclick) props.onclick = opts.onclick;
    return el(tag, props,
      icon ? el("span", { class: "pf-ico" }, svg(icon)) : null,
      el("span", { class: "pf-text" }, text, opts.sub ? el("small", { class: "pf-sub", text: opts.sub }) : null),
      opts.right || ((opts.href || opts.onclick) && !opts.quiet ? el("span", { class: "pf-chev", text: "›" }) : null));
  }
  function renderProfile() {
    const u = (inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user) || {};
    const userName = [u.first_name, u.last_name].filter(Boolean).join(" ") || T("guest");
    const avatar = el("div", { class: "pf-avatar", text: userName.charAt(0).toUpperCase() });
    if (/^https:\/\//.test(u.photo_url || "")) {
      const img = el("img", { src: u.photo_url, alt: "", referrerpolicy: "no-referrer" });
      img.onerror = () => img.remove();             // фото не загрузилось — остаётся первая буква
      avatar.append(img);
    }
    const nFav = favs.filter((id) => byId.has(id)).length;
    const seen = viewed.map((id) => byId.get(id)).filter(Boolean);

    $("profile-body").replaceChildren(el("div", { class: "pf" },
      el("div", { class: "pf-head" }, avatar,
        el("div", null, el("div", { class: "pf-name", text: userName }),
          el("div", { class: "pf-role", text: u.username ? `@${u.username}` : T("userRole") }))),

      el("div", { class: "pf-stats" },
        el("button", { class: "pf-stat", type: "button", onclick: () => setTab("fav") },
          el("b", { text: String(nFav) }), el("span", { text: T("inFav") })),
        el("button", { class: "pf-stat", type: "button", onclick: () => $("pf-history").scrollIntoView({ behavior: "smooth" }) },
          el("b", { text: String(seen.length) }), el("span", { text: T("viewedN") }))),

      el("div", { id: "pf-history" }, el("div", { class: "pf-label", text: T("recent") }),
        el("div", { class: "pf-group" }, ...(seen.length
          ? [...seen.map((d) => pfRow(null, splitName(d).brand, { sub: splitName(d).rest, onclick: () => open(d.id) })),
            pfRow(null, T("clearHistory"), { quiet: true, onclick: clearViewed })]
          : [el("div", { class: "pf-empty", text: T("noViewed") })]))),

      el("div", null, el("div", { class: "pf-label", text: T("memoLabel") }),
        el("div", { class: "pf-group" },
          pfRow(ICO.info, T("memoRow"), { sub: T("memoRowSub") }))),

      el("p", { class: "source", text: T("disclaimer") })));
  }
  function clearViewed() {
    const doClear = () => {
      viewed = [];
      store.set("viewedIds", viewed);
      renderProfile();
    };
    if (inTelegram && tg.showConfirm) tg.showConfirm(T("clearConfirm"), (ok) => ok && doClear());
    else doClear();
  }

  // ---------- карточка ----------
  function open(id) {
    push({ card: id }, "card");
  }

  function renderCard(d) {
    viewed = [d.id, ...viewed.filter((x) => x !== d.id)].slice(0, VIEWED_MAX);
    store.set("viewedIds", viewed);

    // верх: крупное фото на мятном фоне, круглые кнопки «Поделиться» и «В избранное» в панели над ним
    $("bar-actions").replaceChildren(
      el("button", { class: "cb", type: "button", "aria-label": T("share"), onclick: () => share(d) }, svg(ICO.share)),
      favButton(d, "cb"));
    const pic = el("div", { class: "pic" }, d.photo
      ? el("img", { src: `photos/${d.photo}`, alt: T("photoAlt", { name: d.trade }) })
      : el("span", { class: "pic-none" }, svg(ICO.pill)));
    if (d.photo && d.level !== "exact") pic.append(el("p", { class: "photo-note", text: T("photoNote") }));
    const { brand, rest } = splitName(d);
    const head = el("div", { class: "ctitle" }, el("h2", { text: brand }),
      rest ? el("p", { class: "cform", text: rest }) : null,
      el("div", { class: "tags" },
        el("span", { class: "maker" }, svg(ICO.maker), d.maker),
        el("span", { class: d.rx ? "badge rx" : "badge otc", text: d.rx ? T("rx") : T("otc") }),
        d.uz ? el("span", { class: "badge uz", text: T("uzMade") }) : null));

    // цена: одна упаковка — крупно; несколько — крупно минимальная и список упаковок
    // безрецептурным предельную цену не назначают (с 01.04.2025) — так и пишем, а не «не установлена»
    const p = minPrice(d), free = !p && !d.rx, shop = free && d.shop;
    // есть цены аптек — разброс «от–до» на зелёном блоке, как настоящая цена; нет — честно «свободная»
    const price = shop
      ? el("section", { class: "price shop" },
        el("small", { text: T("shopLabel") }),
        el("b", null, shop[0] === shop[1] ? num(shop[0]) : `${num(shop[0])} – ${num(shop[1])}`, el("i", { text: " " + T("sum") })),
        el("span", { class: "price-ok" }, T("shopCount", { n: shop[2], s: plural(shop[2], "аптеке", "аптеках", "аптеках"), date: date(shopsDate) })),
        el("p", { class: "price-note", text: T("shopNote") }))
      : el("section", { class: "price" + (p ? "" : " none") },
        el("small", { text: free ? T("priceFreeLabel") : d.prices.length > 1 && p ? T("priceFrom") : T("price") }),
        p ? el("b", null, num(p), el("i", { text: " " + T("sum") })) : el("b", { class: "price-none", text: T(free ? "priceFree" : "priceNone") }),
        p ? el("span", { class: "price-ok" }, svg(ICO.check), T("priceOk")) : null,
        free ? el("p", { class: "price-note", text: T("priceFreeNote") }) : null);
    if (d.prices.length > 1) {
      price.append(el("ul", { class: "packs" }, ...d.prices.map(([pack, retail]) => el("li", null,
        el("span", { text: pack || T("pack") }), el("b", { text: retail ? sum(retail) : T("noPrice") })))));
    }

    // три главных факта плитками, остальное — в блоке «О препарате»
    const sub = UzAtc.sub(d.atc);
    const tiles = el("div", { class: "tiles" },
      el("div", null, el("small", { text: T("substance") }), el("b", { text: d.inn || "—" })),
      sub ? el("button", { type: "button", onclick: () => openCatalog({ type: "s", code: d.atc.slice(0, 3) }) },
        el("small", { text: T("group") }), el("b", { text: sub })) : el("div", null, el("small", { text: T("group") }), el("b", { text: "—" })),
      el("div", null, el("small", { text: T("shelf") }), el("b", { text: shelfLife(d.shelf) || "—" })));
    const facts = el("dl", { class: "facts" });
    const fact = (k, v) => v && facts.append(el("dt", { text: k }), el("dd", null, v));
    fact(T("comp"), d.comp);
    fact(T("form"), [d.form, d.dosage].filter(Boolean).join(", "));
    fact(T("maker"), d.maker);
    fact(T("route"), d.route);
    fact(T("reg"), d.indefinite ? T("regForever") : T("regUntil", { d: date(d.expires) }));

    // аналоги: сначала Jurabek Laboratories, затем дешевле, затем по названию
    const analogs = (byInn.get(d.innKey) || []).filter((a) => a.id !== d.id)
      .sort((a, b) => UzSearch.prio(a) - UzSearch.prio(b)
        || (minPrice(a) ?? Infinity) - (minPrice(b) ?? Infinity) || a.trade.localeCompare(b.trade, "ru"));

    // выгода: только та же форма и дозировка, цена за штуку; среди выгодных первым — Jurabek, как в списке аналогов
    const mine = unitPrice(d);
    const saves = new Map();
    if (mine) {
      for (const a of analogs) {
        const u = sameDose(a, d) && unitPrice(a);
        const pct = u ? Math.round((1 - u / mine) * 100) : 0;
        if (pct >= SAVE_MIN) saves.set(a.id, pct);
      }
    }
    const best = analogs.filter((a) => saves.has(a.id))
      .sort((a, b) => UzSearch.prio(a) - UzSearch.prio(b) || saves.get(b.id) - saves.get(a.id))[0];

    // аналоги: лента карточек вбок; «Списком» — все строками, с выгодой в %
    let analogBlock = null;
    if (analogs.length) {
      const strip = el("div", { class: "ans" }, ...analogs.slice(0, 20).map((a) => {
        const ap = minPrice(a);
        const t = thumb(a);
        t.classList.add("an-pic");
        return el("button", { class: "an", type: "button", onclick: () => open(a.id) }, t,
          el("b", { text: splitName(a).brand }), el("small", { class: "an-form", text: splitName(a).rest }), el("small", { text: a.maker }),
          el("span", { class: "an-p" }, ap ? sum(ap) : a.shop ? T("shopFrom", { n: sum(a.shop[0]) }) : T(a.rx ? "noPrice" : "freePrice"),
            saves.has(a.id) ? el("em", { text: `−${saves.get(a.id)} %` }) : null));
      }));
      const all = el("button", { class: "sec-link", type: "button", text: analogs.length > 1 ? T("asList") : "" });
      analogBlock = el("section", { class: "block analogs" },
        el("div", { class: "sec-h" }, el("h2", null, T("analogs"), el("em", { text: String(analogs.length) })), analogs.length > 1 ? all : null),
        el("p", { class: "hint an-hint", text: T("sameInn") }), strip);
      all.addEventListener("click", () => {
        strip.replaceWith(el("ul", { class: "list" }, ...analogs.slice(0, 50).map((a) => row(a, false, saves.get(a.id)))));
        all.remove();
      });
    }

    cardBody.replaceChildren(
      pic, head,
      el("section", { class: "block price-wrap" }, price, p ? priceCheck(d) : null,
        best ? el("button", { class: "save", type: "button", onclick: () => open(best.id) },
          el("span", { class: "save-ico" }, svg(ICO.save)),
          el("span", { class: "save-text" }, el("b", { text: T("saveTitle", { p: saves.get(best.id) }) }),
            el("small", { text: T("saveText", { name: splitName(best).brand }) })),
          el("span", { class: "pf-chev", text: "›" })) : null),
      tiles,
      analogBlock,
      el("section", { class: "block" }, el("div", { class: "sec-h" }, el("h2", { text: T("about") })), el("div", { class: "about" }, facts)),
      instructionBlock(d));
  }

  // «Мне продают дороже?»: цена с чека против предельной; несколько упаковок — выбор упаковки
  function priceCheck(d) {
    const packs = d.prices.filter(([, r]) => r);
    let limit = packs[0][1];
    const res = el("div", { class: "check-res", role: "status", "aria-live": "polite" });
    const field = el("input", { class: "check-in", type: "text", inputmode: "numeric", autocomplete: "off",
      placeholder: T("checkPlaceholder"), "aria-label": T("checkPlaceholder"), enterkeyhint: "done" });
    let was = "";
    const update = () => {
      const val = Number(field.value.replace(/\D/g, ""));
      res.className = "check-res";
      if (!val) return res.replaceChildren();
      const over = val > limit;
      res.classList.add(over ? "bad" : "ok");
      res.replaceChildren(el("b", null, svg(over ? ICO.x : ICO.check),
        over ? T("checkOver", { d: sum(val - limit), p: Math.max(1, Math.round((val / limit - 1) * 100)) })
          : val < limit ? T("checkOkLess", { d: sum(limit - val) }) : T("checkOk")),
        over ? el("small", { text: T("checkOverNote") }) : null);
      const now = over ? "bad" : "ok";
      if (now !== was) {
        was = now;
        try { if (inTelegram && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(over ? "error" : "success"); } catch (e) { /* старый клиент */ }
      }
    };
    field.addEventListener("input", update);
    field.addEventListener("keydown", (e) => { if (e.key === "Enter") field.blur(); });
    let select = null;
    if (packs.length > 1) {
      select = el("select", { class: "check-pack", "aria-label": T("checkPack") },
        ...packs.map(([pack, r], i) => el("option", { value: String(i), text: `${pack} — ${sum(r)}` })));
      select.addEventListener("change", () => { limit = packs[Number(select.value)][1]; update(); });
    }
    return el("div", { class: "check" }, el("p", { class: "check-t", text: T("checkTitle") }), select,
      el("label", { class: "check-box" }, field, el("span", { text: T("sum") })), res);
  }

  // ---------- инструкция ----------
  const infoCache = new Map();                    // имя файла → Promise с разделами
  function loadInfo(name) {
    if (!infoCache.has(name)) {
      infoCache.set(name, fetch(`info/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).catch((e) => { infoCache.delete(name); throw e; }));
    }
    return infoCache.get(name);
  }
  // HTML инструкции собираем заново только из разрешённых тегов: DOMParser не выполняет скрипты,
  // а в страницу попадают лишь наши createElement и текст (build.py чистит его ещё при сборке)
  const RICH_TAGS = new Set(["P", "BR", "UL", "OL", "LI", "STRONG", "EM", "U", "SUP", "SUB", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]);
  function rich(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const frag = document.createDocumentFragment();
    const walk = (src, dst) => {
      for (const n of src.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) dst.append(n.nodeValue);
        else if (n.nodeType === Node.ELEMENT_NODE && RICH_TAGS.has(n.tagName)) {
          const e = document.createElement(n.tagName.toLowerCase());
          for (const a of ["colspan", "rowspan"]) if (/^\d{1,2}$/.test(n.getAttribute(a) || "")) e.setAttribute(a, n.getAttribute(a));
          walk(n, e);
          dst.append(n.tagName === "TABLE" ? el("div", { class: "table-wrap" }, e) : e);   // широкая таблица листается вбок
        } else if (n.nodeType === Node.ELEMENT_NODE) walk(n, dst);
      }
    };
    walk(doc.body, frag);
    return frag;
  }
  function instructionBlock(d) {
    const sec = el("section", { class: "block" }, el("div", { class: "sec-h" }, el("h2", { text: T("instr") })));
    if (d.info) {
      const box = el("div", { class: "instr" }, el("p", { class: "hint", text: T("instrLoading") }));
      sec.append(box);
      loadInfo(d.info).then((info) => {
        box.replaceChildren(...SECTIONS.filter((k) => info[k]).map((k, i) =>
          el("details", i === 0 ? { class: "instr-sec", open: "" } : { class: "instr-sec" },
            el("summary", { text: T("sections")[k] }), el("div", { class: "rich" }, rich(info[k])))));
      }, () => box.replaceChildren(el("p", { class: "hint", text: T("instrError") })));
      return sec;
    }
    // своей инструкции в реестре нет — честно говорим и даём инструкцию препарата с тем же веществом и формой
    const form = UzSearch.normalize(d.form);
    const donor = (byInn.get(d.innKey) || []).filter((a) => a.info && UzSearch.normalize(a.form) === form)
      .sort((a, b) => (sameDose(a, d) ? 0 : 2) + UzSearch.prio(a) - (sameDose(b, d) ? 0 : 2) - UzSearch.prio(b))[0];
    sec.append(el("p", { class: "hint", text: T("instrNone") }));
    if (donor) {
      sec.append(el("button", { class: "save donor", type: "button", onclick: () => open(donor.id) },
        el("span", { class: "save-ico" }, svg(ICO.doc)),
        el("span", { class: "save-text" }, el("b", { text: T("instrDonor") }),
          el("small", { text: `${splitName(donor).brand} — ${donor.maker}` })),
        el("span", { class: "pf-chev", text: "›" })));
    }
    return sec;
  }
  function shelfLife(s) {                         // в реестре «4 лет», «24 месяцев» — приводим к нормальному русскому
    const m = /^(\d+)\s*(лет|год|года|мес)/i.exec(s || "");
    if (!m) return s;
    const n = Number(m[1]);
    if (UzI18n.lang === "uz") return /^мес/i.test(m[2]) ? `${n} oy` : `${n} yil`;
    return /^мес/i.test(m[2]) ? `${n} ${plural(n, "месяц", "месяца", "месяцев")}` : `${n} ${plural(n, "год", "года", "лет")}`;
  }

  function share(d) {
    haptic();
    const link = `https://t.me/${BOT}?start=d_${d.id}`;
    const p = minPrice(d);
    const text = p ? T("shareText", { name: d.trade, sum: sum(p) }) : d.trade;
    try {
      if (inTelegram && tg.openTelegramLink) {        // окно Telegram «Переслать»: выбрать чат и отправить
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
        return;
      }
    } catch (e) { /* старый клиент — ниже */ }
    if (navigator.share) {
      navigator.share({ title: d.trade, text, url: link }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${text}\n${link}`).then(() => toast(T("linkCopied")), () => toast(link));
    } else {
      toast(link);
    }
  }

  // ---------- каталог: группа АТХ → подгруппа → вещество → препараты; плюс подбор по симптому и заболеванию ----------
  const byPrio = (a, b) => UzSearch.prio(a) - UzSearch.prio(b) || a.trade.localeCompare(b.trade, "ru");
  const inAtc = (prefixes) => (d) => prefixes.some((p) => d.atc.startsWith(p));
  const count = (n) => UzI18n.count(n, ["препарат", "препарата", "препаратов"]);

  function substances(list) {                    // препараты → [{title, key, list}] по МНН, без МНН — отдельно
    const map = new Map(), none = [];
    for (const d of list) {
      if (!d.innKey) { none.push(d); continue; }
      if (!map.has(d.innKey)) map.set(d.innKey, { title: d.inn.charAt(0).toUpperCase() + d.inn.slice(1), list: [] });
      map.get(d.innKey).list.push(d);
    }
    const out = [...map.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
    if (none.length) out.push({ title: T("noInn"), list: none, muted: true });
    return out;
  }
  function catRow(title, sub, n, onclick, muted) {
    return el("li", null, el("button", { class: "item cat-item" + (muted ? " muted" : ""), type: "button", onclick },
      el("span", { class: "item-body" }, el("span", { class: "item-name", text: title }), sub ? el("span", { class: "item-sub", text: sub }) : null),
      el("span", { class: "cat-count", text: String(n) }), el("span", { class: "pf-chev", text: "›" })));
  }
  function substanceRows(list, title) {
    return substances(list).map((s) => catRow(s.title, null, s.list.length,
      () => catPush({ type: "list", title: s.title, sub: title, list: s.list }), s.muted));
  }
  function renderCatalog() {
    const node = catPath[catPath.length - 1] || { type: "root" };
    let title = T("catalog"), sub = "", body = [];
    if (!drugs.length) {
      body = [el("p", { class: "status", text: T("loading") })];
    } else if (node.type === "root") {
      sub = T("catalogSub");
      const groups = Object.keys(UzAtc.GROUPS).map((code) => [code, ...UzAtc.group(code)]).map(([code, name, hint]) =>
        [code, name, hint, drugs.filter((d) => d.atc.charAt(0) === code).length]).filter((g) => g[3]);
      body = [el("ul", { class: "list" }, ...groups.map(([code, name, hint, n]) =>
        catRow(name, hint, n, () => catPush({ type: "g", code }))))];
    } else if (node.type === "g") {
      [title, sub] = UzAtc.group(node.code);
      const subs = new Map();
      for (const d of drugs) if (d.atc.charAt(0) === node.code && d.atc.length >= 3) subs.set(d.atc.slice(0, 3), (subs.get(d.atc.slice(0, 3)) || 0) + 1);
      body = [el("ul", { class: "list" }, ...[...subs].sort().map(([code, n]) =>
        catRow(UzAtc.sub(code) || code, null, n, () => catPush({ type: "s", code }))))];
    } else if (node.type === "s") {
      title = UzAtc.sub(node.code) || node.code;
      sub = (UzAtc.group(node.code) || [""])[0];
      body = [el("ul", { class: "list" }, ...substanceRows(drugs.filter(inAtc([node.code])), title))];
    } else if (node.type === "sym") {             // симптом может вести в несколько подгрупп — показываем их секциями
      title = node.sym.name;
      sub = T("symSub");
      body = node.sym.atc.map((p) => [p, drugs.filter(inAtc([p]))]).filter(([, l]) => l.length).map(([p, l]) =>
        el("section", { class: "cat-sec" }, el("h3", { text: UzAtc.sub(p) || p }), el("ul", { class: "list" }, ...substanceRows(l, title))));
    } else if (node.type === "dis") {
      title = node.dis.name;
      sub = T("disSub", { code: node.dis.code });
      body = [el("ul", { class: "list" }, ...node.dis.drugs.slice().sort(byPrio).map((d) => row(d)))];
    } else if (node.type === "list") {
      title = node.title;
      sub = `${node.sub} · ${count(node.list.length)}`;
      body = [el("ul", { class: "list" }, ...node.list.slice().sort(byPrio).map((d) => row(d)))];
    }
    $("catalog-body").replaceChildren(
      el("header", { class: "top cat-top" },
        catPath.length ? el("button", { class: "back cat-back", type: "button", onclick: back },
          svg('<path d="M15 5l-7 7 7 7"/>'), T("back")) : null,
        el("h1", { text: title }), sub ? el("p", { class: "muted", text: sub }) : null),
      ...body);
    shownCat = catPath;
  }
  function catPush(node) {
    push({ cat: [...catPath, node] }, "cat");
  }
  function openCatalog(node) {                   // с главной, из поиска или карточки: «Назад» — туда, откуда пришли
    push({ tab: "catalog", cat: [node], card: null }, "cat");
  }

  function symptomPicks(q) {
    const nq = UzSearch.normalize(q);
    const picks = UzAtc.symptoms(nq).map((s) => ({ s, n: drugs.filter(inAtc(s.atc)).length })).filter((x) => x.n)
      .map(({ s, n }) => ({ title: s.name, sub: count(n), go: () => openCatalog({ type: "sym", sym: s }) }));
    // заболевания из инструкций: все слова запроса (от 4 букв) — начала слов названия («астм» → «Астма»)
    const words = nq.split(" ").filter((w) => w.length >= 4);
    if (words.length) {
      for (const x of diseases) {
        if (picks.length >= 4) break;
        if (picks.some((p) => p.title.toLowerCase() === x.name.toLowerCase())) continue;   // «Кашель» уже есть как симптом
        if (words.every((w) => x.key.split(" ").some((t) => t.startsWith(w)))) {
          picks.push({ title: x.name, sub: T("byInstr", { count: count(x.drugs.length) }), go: () => openCatalog({ type: "dis", dis: x }) });
        }
      }
    }
    if (!picks.length) return null;
    return el("div", { class: "picks" }, el("p", { class: "picks-title", text: T("picksTitle") }),
      el("ul", { class: "list" }, ...picks.slice(0, 4).map((p) =>
        el("li", null, el("button", { class: "item cat-item", type: "button", onclick: p.go },
          el("span", { class: "thumb none sym" }, svg(ICO.sym)),
          el("span", { class: "item-body" }, el("span", { class: "item-name", text: p.title }), el("span", { class: "item-sub", text: p.sub })),
          el("span", { class: "pf-chev", text: "›" }))))));
  }

  // ---------- навигация: стек экранов ----------
  // Экран — {tab, cat (стопка каталога), card (id карточки или null), q (запрос поиска), kind, y (прокрутка)}.
  // nav[0] — главная; nav[i] лежит в history.state.nav = i. Переход — push (pushState), «Назад» — history.back(),
  // popstate обрезает стек и показывает верхний экран. Так системный жест, кнопка Telegram, «‹ Назад» и свайп
  // ведут одним путём, а кнопка «Назад» Telegram видна ровно тогда, когда есть куда вернуться.
  const nav = [{ tab: "search", cat: [], card: null, q: "", kind: "home", y: 0 }];
  let shownCat = null, shownCard = null, afterPop = null;
  const top = () => nav[nav.length - 1];
  const sameScreen = (a, b) => a.tab === b.tab && a.card === b.card && a.q === b.q
    && a.cat.length === b.cat.length && a.cat.every((n, i) => n === b.cat[i]);
  const url = (e) => (e.card ? `#/d/${e.card}` : location.pathname + location.search);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";   // прокрутку возвращает show(), не браузер

  function saveY() {
    const t = top();
    t.y = t.card ? cardView.scrollTop : window.scrollY;
    if (t.tab === "search" && !t.card) tabScroll.search = t.y;
  }
  function push(patch, kind) {
    saveY();
    const e = { ...top(), ...patch, kind, y: patch.y || 0 };
    nav.push(e);
    history.pushState({ nav: nav.length - 1 }, "", url(e));
    show(e);
  }
  function replaceTop(patch, kind) {
    const e = { ...top(), ...patch, kind: kind || top().kind, y: patch.y || 0 };
    nav[nav.length - 1] = e;
    history.replaceState({ nav: nav.length - 1 }, "", url(e));
    show(e);
  }
  function back() {
    if (nav.length > 1) history.back();
  }
  function goTo(i, then) {                       // вернуться к экрану nav[i] (ниже текущего), затем then()
    const steps = i - (nav.length - 1);
    if (!steps) return then && then();
    afterPop = then || null;
    history.go(steps);
  }
  window.addEventListener("popstate", (ev) => {
    const i = ev.state && Number.isInteger(ev.state.nav) ? ev.state.nav : 0;
    nav.length = Math.min(nav.length, i + 1);    // «Вперёд» в браузере не восстанавливаем — остаёмся на верхнем
    show(top());
    const then = afterPop;
    afterPop = null;
    if (then) then();
  });

  function show(e) {
    const closing = !e.card && !cardView.hidden;
    if (e.tab !== tab) {
      tab = e.tab;
      for (const [k, node] of Object.entries(tabs)) node.hidden = k !== tab;
      document.querySelectorAll(".nav-item").forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle("active", on);
        if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
      });
      if (tab === "fav") renderFav();
      if (tab === "profile") renderProfile();
    } else if (closing) {                          // вернулись из карточки: звёздочку могли снять, история пополнилась
      if (tab === "fav") renderFav();
      if (tab === "profile") renderProfile();
    }
    catPath = e.cat;
    if (tab === "catalog" && shownCat !== catPath) renderCatalog();
    if (input.value !== e.q) {
      input.value = e.q;
      clearTimeout(timer);
      renderList();
    }
    if (e.card) {
      if (shownCard !== e.card) {
        renderCard(byId.get(e.card));
        shownCard = e.card;
      }
      cardView.hidden = false;
      document.body.style.overflow = "hidden";     // вкладка под карточкой не прокручивается
      cardView.scrollTop = e.y;
    } else {
      cardView.hidden = true;
      shownCard = null;
      document.body.style.overflow = "";
      window.scrollTo(0, e.y);
    }
    syncSearchUi();
  }

  // ---------- вкладки ----------
  // Вкладка — тоже экран стека. Вкладки подряд не копятся: следующая заменяет предыдущую, и «Назад» с любой
  // вкладки ведёт туда, откуда на вкладки ушли (обычно на главную).
  function setTab(name) {
    const t = top();
    if (name === t.tab && !t.card) {               // повторное нажатие — наверх, как в Jurabekapp
      if (name === "catalog" && catPath.length && window.scrollY < 40) {   // в каталоге уже наверху — к списку групп
        let i = nav.length - 1;
        while (i > 0 && nav[i - 1].tab === "catalog" && !nav[i - 1].card) i--;
        if (nav[i].cat.length) goTo(i, () => replaceTop({ cat: [] }));
        else goTo(i);
        return;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (t.tab === "search" && !t.card) tabScroll.search = window.scrollY;
    const e = { tab: name, cat: [], card: null, q: input.value, y: name === "search" ? tabScroll.search : 0 };
    const below = nav[nav.length - 2];
    if (below && sameScreen(below, e)) back();    // вкладка, с которой пришли, — просто шаг назад
    else if (t.kind === "tab") replaceTop(e, "tab");
    else push(e, "tab");
  }
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => { haptic(); setTab(b.dataset.tab); }));

  function syncBackButton() {
    if (!tg) return;
    if (nav.length > 1) tg.BackButton.show(); else tg.BackButton.hide();
  }

  // ---------- кнопка «‹ Назад» и свайп вправо ----------
  $("back").addEventListener("click", back);

  let sx = 0, sy = 0, dx = 0, mode = "";           // mode: "" — ещё не ясно, "x" — свайп, "y" — прокрутка
  cardView.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    dx = 0;
    mode = "";
    cardView.classList.remove("settle");
  }, { passive: true });
  cardView.addEventListener("touchmove", (e) => {
    if (mode === "y") return;
    const mx = e.touches[0].clientX - sx, my = e.touches[0].clientY - sy;
    if (!mode) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      mode = mx > 0 && Math.abs(mx) > Math.abs(my) * 1.5 ? "x" : "y";   // только явное движение вправо
      if (mode === "y") return;
      cardView.classList.add("dragging");
    }
    dx = Math.max(0, mx);
    cardView.style.transform = `translateX(${dx}px)`;
    e.preventDefault();
  }, { passive: false });
  cardView.addEventListener("touchend", () => {
    if (mode !== "x") return;
    cardView.classList.remove("dragging");
    cardView.classList.add("settle");
    const done = dx > Math.min(120, window.innerWidth * 0.3);
    cardView.style.transform = done ? `translateX(${window.innerWidth}px)` : "";
    if (done) {
      setTimeout(() => {
        cardView.hidden = true;                    // спрятать сразу: history.back() сработает не мгновенно, иначе карточка мелькнёт
        cardView.classList.remove("settle");
        cardView.style.transform = "";
        back();
      }, 200);
    }
    mode = "";
  });

  // ---------- крестик в поиске ----------
  function syncSearchUi() {
    clearBtn.hidden = !input.value;
    syncBackButton();
  }
  clearBtn.addEventListener("click", () => {
    input.value = "";
    onQuery(true);
    input.focus();
  });

  // запрос на поиске — тоже экран: первый символ кладёт его в стек, и «Назад» очищает поиск; дальше запрос
  // правится на месте, а стёртый до пустого снимает этот экран
  let timer;
  function onQuery(now) {
    const q = input.value, t = top();
    if (t.tab === "search" && !t.card) {
      if (q && !t.q) push({ q, y: window.scrollY }, "q");
      else if (!q && t.kind === "q") back();
      else t.q = q;
    }
    syncSearchUi();
    clearTimeout(timer);
    if (now) renderList(); else timer = setTimeout(renderList, 120);
  }
  input.addEventListener("input", () => onQuery());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });   // спрятать клавиатуру
  // пустой экран поиска (примеры, группы, памятка) не зависит от данных — рисуем сразу, не дожидаясь справочника (~0,8 МБ)
  // открыли по ссылке на препарат: кнопка бота (?d=<id>) или ссылка t.me/<бот>/…?startapp=d_<id>
  // (или #/d/<id> — адрес карточки, если страницу перезагрузили); открывает load() после загрузки справочника
  const startId = Number(new URLSearchParams(location.search).get("d")
    || ((inTelegram && tg.initDataUnsafe && /^d_(\d+)$/.exec(tg.initDataUnsafe.start_param || "")) || [])[1]
    || (/^#\/d\/(\d+)$/.exec(location.hash) || [])[1]) || 0;
  history.replaceState({ nav: 0 }, "", url(nav[0]));   // главная — дно стека

  // язык — до первой отрисовки: тексты страницы, примеры запросов; плитки групп ведут в каталог, «Все» — весь каталог
  const tgLang = ((inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user) || {}).language_code || "";
  setLang(store.get("lang", /^uz/i.test(tgLang) ? "uz" : "ru"));
  tabs.search.querySelectorAll(".cat").forEach((b) => b.addEventListener("click", () => {
    haptic();
    openCatalog(b.dataset.g ? { type: "g", code: b.dataset.g } : { type: "s", code: b.dataset.s });
  }));
  tabs.search.querySelector("[data-all]").addEventListener("click", () => setTab("catalog"));
  document.querySelectorAll(".lang-sw button").forEach((b) => b.addEventListener("click", () => switchLang(b.dataset.lang)));

  renderList();
  if (!inTelegram && !startId) input.focus();
  load();
  // service worker: справочник и сборка остаются в телефоне — следующий запуск быстрее и работает без интернета
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    // Telegram на телефоне не закрывает мини-апп, а сворачивает: при возврате проверяем, не вышла ли новая сборка.
    // Новый service worker сам берёт управление (skipWaiting) — тогда перезагружаемся, но только пока человек
    // ещё ничего не нажал: иначе перезагрузка выбросит его из каталога или карточки обратно на поиск.
    // Нажал — новая сборка подождёт, пока приложение свернут и снова откроют.
    const hadController = !!navigator.serviceWorker.controller;
    let updateReady = false, touched = false;
    for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => { touched = true; }, { capture: true, passive: true });
    const reloadIfIdle = () => {
      if (updateReady && !touched) location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;                  // первая установка — страница и так свежая
      updateReady = true;
      reloadIfIdle();
    });
    const checkUpdate = () => {
      if (document.hidden) {                       // свернули: следующий возврат — как новый запуск
        touched = false;
        return;
      }
      navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
      reloadIfIdle();
    };
    document.addEventListener("visibilitychange", checkUpdate);
    if (tg && tg.onEvent) {
      tg.onEvent("activated", checkUpdate);        // мини-апп развернули из свёрнутого
      tg.onEvent("deactivated", () => { touched = false; });
    }
  }
})();
