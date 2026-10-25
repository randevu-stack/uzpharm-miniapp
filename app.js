/* Мини-апп «Предельные цены»: поиск по реестру, карточка с ценами и фото, аналоги по МНН.
   Данные — data.json (собирает miniapp/build.py), поиск — search.js. Навигация через #/d/<id>,
   чтобы работали кнопка «Назад» в Telegram и в браузере. */
(function () {
  "use strict";
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.initData);
  const HOTLINE_PHONE = "1003";
  const HOTLINE_TG = "uzpharmcontrol";
  const NO_INN = /^отсутствует утвержд[её]нное мнн$/i;
  const EXAMPLES =["Парацетамол", "Анальгин", "Цитрамон", "Амоксициллин", "Дротаверин"];   // все есть в реестре

  const $ = (id) => document.getElementById(id);
  const input = $("q"), statusEl = $("status"), results = $("results"), clearBtn = $("clear");
  const cardView = $("card-view"), cardBody = $("card");

  let drugs = [], byId = new Map(), byInn = new Map(), updated = "";

  if (tg) {
    tg.ready();
    tg.expand();
    if (inTelegram) document.documentElement.classList.add("tg");
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();   // как в Jurabekapp: прокрутка вниз не сворачивает приложение
    // кнопка «Назад» Telegram (и системный жест «назад» на Android): из карточки — к списку, из поиска — очистить запрос
    tg.BackButton.onClick(() => (cardView.hidden ? clearSearch() : goBack()));
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
  const sum = (x) => Math.round(x).toLocaleString("ru-RU").replace(/ /g, " ") + " сум";
  const date = (s) => (s && s.length >= 10 ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—");
  const minPrice = (d) => d.prices.reduce((m, p) => (p[1] && (m == null || p[1] < m) ? p[1] : m), null);
  const pillIcon = () => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.innerHTML = '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="m9.2 7.9 5.6 8.2"/>';
    return s;
  };
  function thumb(d) {
    if (!d.photo) return el("span", { class: "thumb none", "aria-hidden": "true" }, pillIcon());
    const t = el("span", { class: "thumb", role: "img", "aria-label": "Фото упаковки" });
    t.style.backgroundImage = `url("photos/${d.photo}")`;
    return t;
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
      updated = data.updated;
      $("updated").textContent = `Реестр Минздрава РУз от ${date(updated)} · ${drugs.length.toLocaleString("ru-RU")} препаратов`;
      input.disabled = false;
      if (!inTelegram) input.focus();
      route();
    } catch (e) {
      statusEl.textContent = "Не удалось загрузить реестр. Проверьте интернет и откройте снова.";
      statusEl.classList.add("warn");
    }
  }

  // ---------- список ----------
  function renderList() {
    const q = input.value;
    results.replaceChildren();
    statusEl.classList.remove("warn");
    const old = document.querySelector(".chips");
    if (old) old.remove();
    if (UzSearch.normalize(q).replace(/ /g, "").length < 3) {
      statusEl.textContent = "Напишите хотя бы 3 буквы. Можно латиницей и с опечатками.";
      const chips = el("ul", { class: "chips" }, ...EXAMPLES.map((x) =>
        el("li", null, el("button", { type: "button", text: x, onclick: () => { input.value = x; syncClear(); renderList(); } }))));
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
    results.append(...items.map(row));
  }

  function row(d) {
    const p = minPrice(d);
    const sub = [d.dosage, d.maker].filter(Boolean).join(" · ");
    return el("li", null, el("button", { class: "item", type: "button", onclick: () => open(d.id) },
      thumb(d),
      el("span", { class: "item-body" }, el("span", { class: "item-name", text: d.trade }), el("span", { class: "item-sub", text: sub })),
      el("span", { class: "item-price" }, p ? el("b", { text: sum(p) }) : null, p ? "не дороже" : "цена не уст.")));
  }

  // ---------- карточка ----------
  // карточка лежит поверх списка (position: fixed), поэтому список не перерисовывается и остаётся на том же месте
  function open(id) {
    history.pushState({ card: true }, "", `#/d/${id}`);   // пометка: эту карточку открыли изнутри приложения
    route();
  }
  function goBack() {
    if (history.state && history.state.card) history.back();
    else location.replace("#");                  // карточку открыли по прямой ссылке — назад в поиск, а не из приложения
  }

  function renderCard(d) {
    const head = el("div", { class: "card-head" });
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
    if (!d.prices.length) prices.append(el("li", null, el("span", { class: "pack", text: "Предельная цена в реестре не указана" })));
    for (const [pack, retail] of d.prices) {
      prices.append(el("li", null, el("span", { class: "pack", text: pack || "Упаковка" }),
        retail ? el("span", { class: "sum", text: sum(retail) }) : el("span", { class: "sum none", text: "цена не установлена" })));
    }

    const hotline = el("div", { class: "hotline" },
      el("p", { text: "В аптеке дороже предельной цены? Сообщите в Агентство фармацевтики." }),
      el("div", { class: "buttons" },
        el("a", { class: "btn", href: `tel:${HOTLINE_PHONE}`, text: `Позвонить ${HOTLINE_PHONE}` }),
        el("button", { class: "btn secondary", type: "button", text: `@${HOTLINE_TG}`, onclick: () => {
          const url = `https://t.me/${HOTLINE_TG}`;
          if (inTelegram) tg.openTelegramLink(url); else window.open(url, "_blank", "noopener");
        } })));

    const analogs = (byInn.get(d.innKey) || []).filter((a) => a.id !== d.id)
      .sort((a, b) => (minPrice(a) ?? Infinity) - (minPrice(b) ?? Infinity) || a.trade.localeCompare(b.trade, "ru"));

    cardBody.replaceChildren(
      head,
      el("section", { class: "block" }, el("h3", { text: "Предельная розничная цена" }), prices,
        minPrice(d) ? el("p", { class: "hint", text: "Аптека не вправе продавать дороже этой цены." }) : null),
      el("section", { class: "block" }, hotline),
      analogs.length ? el("section", { class: "block" },
        el("h3", { text: `Аналоги — то же вещество (${analogs.length})` }),
        el("ul", { class: "list", style: "margin:0" }, ...analogs.slice(0, 50).map(row))) : null,
      el("p", { class: "source", text: `Источник: реестр uzpharm-control.uz, данные от ${date(updated)}` }));
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
      document.body.style.overflow = "hidden";     // список под карточкой не прокручивается
      if (tg) tg.BackButton.show();
    } else {
      cardView.hidden = true;
      document.body.style.overflow = "";
      syncClear();
      if (drugs.length && !results.childElementCount) renderList();
      if (m) history.replaceState(null, "", "#");   // устаревшая ссылка на карточку
    }
    lastHash = location.hash;
  }
  window.addEventListener("popstate", route);

  // ---------- кнопка «Назад» и свайп вправо ----------
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
  function syncClear() {
    clearBtn.hidden = !input.value;
    if (tg && cardView.hidden) input.value ? tg.BackButton.show() : tg.BackButton.hide();
  }
  function clearSearch() {
    input.value = "";
    syncClear();
    renderList();
    window.scrollTo(0, 0);
  }
  clearBtn.addEventListener("click", () => {
    clearSearch();
    input.focus();
  });

  let timer;
  input.addEventListener("input", () => {
    syncClear();
    clearTimeout(timer);
    timer = setTimeout(renderList, 120);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });   // спрятать клавиатуру
  window.addEventListener("hashchange", route);
  load();
})();
