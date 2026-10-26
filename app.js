/* Мини-апп «Предельные цены»: поиск по реестру, карточка с ценами и фото, аналоги по МНН,
   избранное и профиль (нижние вкладки — как в Jurabekapp).
   Данные — data.json (собирает miniapp/build.py), поиск — search.js. Карточка открывается поверх вкладки
   через history.pushState (#/d/<id>), чтобы работали «Назад» в Telegram, кнопка «‹ Назад» и свайп вправо. */
(function () {
  "use strict";
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.initData);
  const NO_INN = /^отсутствует утвержд[её]нное мнн$/i;
  const EXAMPLES = ["Парацетамол", "Анальгин", "Цитрамон", "Амоксициллин", "Дротаверин"];   // все есть в реестре
  const FAV_CLOUD = "favs";          // ключ в Telegram CloudStorage: {v: [id…], t: время изменения}
  const FAV_MAX = 300;               // значение в CloudStorage — до 4096 символов, id ~6 символов
  const VIEWED_MAX = 30;

  const $ = (id) => document.getElementById(id);
  const input = $("q"), statusEl = $("status"), results = $("results"), clearBtn = $("clear");
  const cardView = $("card-view"), cardBody = $("card");
  const tabs = { search: $("tab-search"), fav: $("tab-fav"), profile: $("tab-profile") };

  let drugs = [], byId = new Map(), byInn = new Map();
  let tab = "search";
  const tabScroll = { search: 0, fav: 0, profile: 0 };

  // ---------- хранилище в телефоне: всегда через try — в приватном режиме оно может не работать ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без сохранения */ } },
  };
  let favs = store.get("favIds", []);            // id карточек, последние добавленные — первыми
  let viewed = store.get("viewedIds", []);

  if (tg) {
    tg.ready();
    tg.expand();
    if (inTelegram) document.documentElement.classList.add("tg");
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();   // как в Jurabekapp: прокрутка вниз не сворачивает приложение
    // кнопка «Назад» Telegram (и системный жест «назад» на Android): из карточки — назад, в поиске — очистить запрос
    tg.BackButton.onClick(() => {
      if (!cardView.hidden) goBack();
      else if (tab === "search" && input.value) clearSearch();
    });
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
  };
  const sum = (x) => Math.round(x).toLocaleString("ru-RU").replace(/ /g, " ") + " сум";
  const date = (s) => (s && s.length >= 10 ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—");
  const minPrice = (d) => d.prices.reduce((m, p) => (p[1] && (m == null || p[1] < m) ? p[1] : m), null);
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  function thumb(d) {
    if (!d.photo) return el("span", { class: "thumb none" }, svg(ICO.pill));
    const t = el("span", { class: "thumb", role: "img", "aria-label": "Фото упаковки" });
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
      const r = await fetch("data.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      const f = Object.fromEntries(data.fields.map((name, i) => [name, i]));
      drugs = data.drugs.map((a) => {
        const d = {
          id: a[f.id], trade: a[f.name], inn: a[f.inn], form: a[f.form], dosage: a[f.dosage], maker: a[f.maker],
          rx: !!a[f.rx], indefinite: !!a[f.indefinite], expires: a[f.expires], photo: a[f.photo], level: a[f.level],
          prices: a[f.prices],
        };
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
        if (!d.innKey) continue;
        if (!byInn.has(d.innKey)) byInn.set(d.innKey, []);
        byInn.get(d.innKey).push(d);
      }
      $("updated").textContent = `${drugs.length.toLocaleString("ru-RU")} препаратов`;
      input.disabled = false;
      if (!inTelegram) input.focus();
      route();
      pullFavs();
      // индекс для поиска с опечатками (~0,3 с на 18 тыс. карточек) строим заранее, пока человек ещё не печатает
      (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => UzSearch.prepare(drugs));
    } catch (e) {
      statusEl.textContent = "Не удалось загрузить справочник. Проверьте интернет и откройте снова.";
      statusEl.classList.add("warn");
    }
  }

  // ---------- строки списков ----------
  function row(d, withStar) {
    const p = minPrice(d);
    const item = el("button", { class: "item", type: "button", onclick: () => open(d.id) },
      thumb(d),
      el("span", { class: "item-body" }, el("span", { class: "item-name", text: d.trade }),
        el("span", { class: "item-sub", text: d.maker, title: d.maker })),   // под названием — сразу производитель
      el("span", { class: "item-price" }, p ? el("b", { text: sum(p) }) : null, p ? "не дороже" : "цена не уст."));
    return el("li", { class: withStar ? "with-star" : "" }, item, withStar ? favButton(d, "row-star") : null);
  }

  // ---------- вкладка «Поиск» ----------
  function renderList() {
    const q = input.value;
    results.replaceChildren();
    statusEl.classList.remove("warn");
    const old = tabs.search.querySelector(".chips");
    if (old) old.remove();
    const empty = UzSearch.normalize(q).replace(/ /g, "").length < 3;
    $("scene").hidden = !empty;                    // сканер-анимация — только на пустом экране поиска
    if (empty) {
      statusEl.textContent = "Напишите хотя бы 3 буквы. Можно латиницей и с опечатками.";
      const chips = el("ul", { class: "chips" }, ...EXAMPLES.map((x) =>
        el("li", null, el("button", { type: "button", text: x, onclick: () => { input.value = x; syncSearchUi(); renderList(); } }))));
      statusEl.after(chips);
      return;
    }
    const { items, exact, total } = UzSearch.search(drugs, q);
    if (!items.length) {
      statusEl.textContent = "Ничего не нашлось. Проверьте название или попробуйте действующее вещество.";
      return;
    }
    statusEl.textContent = !exact ? "Точно не нашёл. Возможно, вы искали:"
      : total > items.length ? `Найдено: ${total}, показаны первые ${items.length} — уточните запрос` : `Найдено: ${total}`;
    if (!exact) statusEl.classList.add("warn");
    results.append(...items.map((d) => row(d)));
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
    btn.setAttribute("aria-label", on ? "Убрать из избранного" : "В избранное");
  }
  function toggleFav(id) {
    const adding = !isFav(id);
    favs = adding ? [id, ...favs].slice(0, FAV_MAX) : favs.filter((x) => x !== id);
    const at = Date.now();
    saveFavs(at);
    pushFavs(at);
    haptic();
    toast(adding ? "Добавлено в избранное" : "Убрано из избранного");
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
        el("p", { class: "empty-title", text: "Здесь будут ваши препараты" }),
        el("p", { class: "muted", text: "Нажмите на звёздочку в карточке препарата, чтобы быстро возвращаться к его цене." }),
        el("button", { class: "btn", type: "button", text: "Найти препарат", onclick: () => setTab("search") })));
      return;
    }
    body.replaceChildren(
      el("p", { class: "status", text: `${list.length} ${plural(list.length, "препарат", "препарата", "препаратов")}` }),
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
    const userName = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Гость";
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
          el("div", { class: "pf-role", text: u.username ? `@${u.username}` : "Пользователь UzPharm" }))),

      el("div", { class: "pf-stats" },
        el("button", { class: "pf-stat", type: "button", onclick: () => setTab("fav") },
          el("b", { text: String(nFav) }), el("span", { text: "В избранном" })),
        el("button", { class: "pf-stat", type: "button", onclick: () => $("pf-history").scrollIntoView({ behavior: "smooth" }) },
          el("b", { text: String(seen.length) }), el("span", { text: "Просмотрено" }))),

      el("div", { id: "pf-history" }, el("div", { class: "pf-label", text: "Недавно смотрели" }),
        el("div", { class: "pf-group" }, ...(seen.length
          ? [...seen.map((d) => pfRow(null, d.trade, { onclick: () => open(d.id) })),
            pfRow(null, "Очистить историю", { quiet: true, onclick: clearViewed })]
          : [el("div", { class: "pf-empty", text: "Вы ещё не открывали препараты" })]))),

      el("div", null, el("div", { class: "pf-label", text: "Памятка" }),
        el("div", { class: "pf-group" },
          pfRow(ICO.info, "Что такое предельная цена", { sub: "Максимальная розничная цена лекарства, установленная государством. Аптека не вправе продавать дороже." }))),

      el("p", { class: "source", text: "Справочная информация. Перед применением лекарства проконсультируйтесь с врачом." })));
  }
  function clearViewed() {
    const doClear = () => {
      viewed = [];
      store.set("viewedIds", viewed);
      renderProfile();
    };
    if (inTelegram && tg.showConfirm) tg.showConfirm("Очистить историю просмотров?", (ok) => ok && doClear());
    else doClear();
  }

  // ---------- карточка ----------
  function open(id) {
    history.pushState({ card: true }, "", `#/d/${id}`);   // пометка: эту карточку открыли изнутри приложения
    route();
  }
  function goBack() {
    if (history.state && history.state.card) history.back();
    else location.replace("#");                  // карточку открыли по прямой ссылке — назад, а не из приложения
  }

  function renderCard(d) {
    viewed = [d.id, ...viewed.filter((x) => x !== d.id)].slice(0, VIEWED_MAX);
    store.set("viewedIds", viewed);

    const head = el("div", { class: "card-head" }, favButton(d, "card-star"));
    if (d.photo) {
      head.append(el("img", { class: "photo", src: `photos/${d.photo}`, alt: `Упаковка: ${d.trade}`, loading: "lazy" }));
      head.append(el("p", { class: "photo-note", text: d.level === "exact" ? "Фото упаковки" : "Фото упаковки — в коробке может быть другое количество" }));
    }
    head.append(el("h2", { text: d.trade }));
    const facts = el("dl", { class: "facts" });
    const fact = (k, v) => v && facts.append(el("dt", { text: k }), el("dd", { text: v }));
    fact("МНН", d.inn);
    fact("Форма", [d.form, d.dosage].filter(Boolean).join(", "));
    fact("Производитель", d.maker);
    head.append(facts);
    head.append(el("div", { class: "badges" },
      el("span", { class: d.rx ? "badge rx" : "badge otc", text: d.rx ? "По рецепту" : "Без рецепта" }),
      el("span", { class: "badge", text: d.indefinite ? "Регистрация бессрочная" : `Регистрация до ${date(d.expires)}` })));

    const prices = el("ul", { class: "prices" });
    if (!d.prices.length) prices.append(el("li", null, el("span", { class: "pack", text: "Предельная цена не установлена" })));
    for (const [pack, retail] of d.prices) {
      prices.append(el("li", null, el("span", { class: "pack", text: pack || "Упаковка" }),
        retail ? el("span", { class: "sum", text: sum(retail) }) : el("span", { class: "sum none", text: "цена не установлена" })));
    }

    // аналоги: сначала Jurabek Laboratories, затем дешевле, затем по названию
    const analogs = (byInn.get(d.innKey) || []).filter((a) => a.id !== d.id)
      .sort((a, b) => UzSearch.prio(a) - UzSearch.prio(b)
        || (minPrice(a) ?? Infinity) - (minPrice(b) ?? Infinity) || a.trade.localeCompare(b.trade, "ru"));

    cardBody.replaceChildren(
      head,
      el("section", { class: "block" }, el("h3", { text: "Предельная розничная цена" }), prices,
        minPrice(d) ? el("p", { class: "hint", text: "Аптека не вправе продавать дороже этой цены." }) : null),
      analogs.length ? el("section", { class: "block" },
        el("h3", { text: `Аналоги — то же вещество (${analogs.length})` }),
        el("ul", { class: "list", style: "margin:0" }, ...analogs.slice(0, 50).map((a) => row(a)))) : null);
  }

  // ---------- вкладки ----------
  function setTab(name) {
    if (!cardView.hidden) {                        // вкладку переключили из карточки — закрываем её
      cardView.hidden = true;
      document.body.style.overflow = "";
      history.replaceState(null, "", "#");
      lastHash = "";
    }
    if (name === tab) {                            // повторное нажатие — наверх, как в Jurabekapp
      window.scrollTo({ top: 0, behavior: "smooth" });
      syncBackButton();
      return;
    }
    tabScroll[tab] = window.scrollY;
    tab = name;
    for (const [k, node] of Object.entries(tabs)) node.hidden = k !== name;
    document.querySelectorAll(".nav-item").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (name === "fav") renderFav();
    if (name === "profile") renderProfile();
    window.scrollTo(0, name === "search" ? tabScroll.search : 0);
    syncBackButton();
  }
  document.querySelectorAll(".nav-item").forEach((b) => b.addEventListener("click", () => { haptic(); setTab(b.dataset.tab); }));

  function syncBackButton() {
    if (!tg) return;
    const show = !cardView.hidden || (tab === "search" && !!input.value);
    if (show) tg.BackButton.show(); else tg.BackButton.hide();
  }

  // ---------- маршруты ----------
  let lastHash = "";
  function route() {
    const m = location.hash.match(/^#\/d\/(\d+)$/);
    const d = m && byId.get(Number(m[1]));
    if (d) {
      if (location.hash !== lastHash) {
        renderCard(d);
        cardView.scrollTop = 0;
      }
      cardView.hidden = false;
      document.body.style.overflow = "hidden";     // вкладка под карточкой не прокручивается
    } else {
      const wasOpen = !cardView.hidden;
      cardView.hidden = true;
      document.body.style.overflow = "";
      if (drugs.length && !results.childElementCount) renderList();
      if (wasOpen && tab === "fav") renderFav();         // звёздочку могли снять в карточке
      if (wasOpen && tab === "profile") renderProfile(); // и история просмотров пополнилась
      if (m) history.replaceState(null, "", "#");   // устаревшая ссылка на карточку
    }
    syncSearchUi();
    lastHash = location.hash;
  }
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);

  // ---------- кнопка «‹ Назад» и свайп вправо ----------
  $("back").addEventListener("click", goBack);

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
        goBack();
      }, 200);
    }
    mode = "";
  });

  // ---------- крестик в поиске ----------
  function syncSearchUi() {
    clearBtn.hidden = !input.value;
    syncBackButton();
  }
  function clearSearch() {
    input.value = "";
    syncSearchUi();
    renderList();
    window.scrollTo(0, 0);
  }
  clearBtn.addEventListener("click", () => {
    clearSearch();
    input.focus();
  });

  let timer;
  input.addEventListener("input", () => {
    syncSearchUi();
    clearTimeout(timer);
    timer = setTimeout(renderList, 120);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });   // спрятать клавиатуру
  load();
})();
