/* Поиск для мини-аппа — тот же алгоритм, что uzpharm/normalize.py и uzpharm/search.py, только в браузере.
   1) Точный: все слова запроса (от 3 букв) встречаются в названии или МНН (часть слова тоже считается).
   2) Если ничего — с опечатками: каждое слово запроса похоже по тройкам букв на какое-то слово записи.
   Работает и в браузере (window.UzSearch), и в Node (для теста tests/test_miniapp.py). */
(function (root) {
  "use strict";

  // Сначала двух- и трёхбуквенные сочетания, потом одиночные буквы — как _LAT в normalize.py
  const LAT = [
    ["shch", "щ"], ["sch", "щ"],
    ["yo'", "йо"], ["yoʻ", "йо"], ["yo`", "йо"], ["yo‘", "йо"],   // узбекское yo‘ (yo‘tal) — й + о, а не ё
    ["o'", "о"], ["g'", "г"], ["oʻ", "о"], ["gʻ", "г"], ["o`", "о"], ["g`", "г"], ["o‘", "о"], ["g‘", "г"],
    ["ce", "це"], ["ci", "ци"], ["cy", "ци"],
    ["sh", "ш"], ["ch", "ч"], ["zh", "ж"], ["ts", "ц"], ["kh", "х"],
    ["yo", "ё"], ["yu", "ю"], ["ya", "я"], ["ye", "е"],
    ["a", "а"], ["b", "б"], ["c", "к"], ["d", "д"], ["e", "е"], ["f", "ф"], ["g", "г"], ["h", "х"],
    ["i", "и"], ["j", "ж"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"],
    ["q", "к"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"], ["w", "в"], ["x", "х"],
    ["y", "й"], ["z", "з"],
  ];
  const LAT_MAP = new Map(LAT);
  const LAT_RE = new RegExp(LAT.map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");

  function normalize(text, x) {
    x = x || "х";
    let t = (text || "").toLowerCase().replace(/ʼ/g, "'").replace(/’/g, "'");
    t = t.replace(LAT_RE, (m) => (m === "x" ? x : LAT_MAP.get(m)));
    t = t.replace(/ё/g, "е").replace(/э/g, "е");
    t = t.replace(/[^0-9а-я]+/g, " ");
    return t.replace(/\s+/g, " ").trim();
  }

  const gramCache = new Map();   // слово → его тройки; слов в базе ~20 тыс., а поиск с опечатками перебирает все карточки
  function grams(word) {
    let out = gramCache.get(word);
    if (!out) {
      out = new Set();
      for (let i = 0; i + 3 <= word.length; i++) out.add(word.slice(i, i + 3));
      gramCache.set(word, out);
    }
    return out;
  }

  function sim(a, b) {
    const ga = grams(a), gb = grams(b);
    if (!ga.size || !gb.size) return 0;
    let inter = 0;
    for (const g of ga) if (gb.has(g)) inter++;
    return inter / (ga.size + gb.size - inter);
  }

  const MIN_SIM = 0.4;
  // препараты этого производителя показываем первыми (то же правило в uzpharm/search.py)
  const PRIORITY_MAKER = "jurabek laboratories";
  const prio = (d) => ((d.maker || "").toLowerCase().includes(PRIORITY_MAKER) ? 0 : 1);
  const LIMIT = 30;

  function cmp(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  // Индекс для поиска с опечатками: тройка букв → слова, слово → карточки. Строится один раз на массив карточек.
  // Карточка проходит фильтр, только если для КАЖДОГО слова запроса в ней есть слово с похожестью ≥ MIN_SIM/2,
  // поэтому смотреть остальные незачем: результат тот же, что при полном переборе, но в разы быстрее (18 тыс. карточек).
  const indexes = new WeakMap();
  function index(drugs) {
    let idx = indexes.get(drugs);
    if (idx) return idx;
    const wordDrugs = new Map(), gramWords = new Map();
    for (const d of drugs) {
      for (const w of new Set(d.text.split(" "))) {
        if (!wordDrugs.has(w)) {
          wordDrugs.set(w, []);
          for (const g of grams(w)) {
            if (!gramWords.has(g)) gramWords.set(g, []);
            gramWords.get(g).push(w);
          }
        }
        wordDrugs.get(w).push(d);
      }
    }
    idx = { wordDrugs, gramWords };
    indexes.set(drugs, idx);
    return idx;
  }
  function fuzzyCandidates(drugs, words) {
    const { wordDrugs, gramWords } = index(drugs);
    let cand = null;
    for (const w of words) {
      const near = new Set();
      for (const g of grams(w)) for (const t of gramWords.get(g) || []) near.add(t);
      const hit = new Set();
      for (const t of near) if (sim(w, t) >= MIN_SIM / 2) for (const d of wordDrugs.get(t)) hit.add(d);
      cand = cand ? new Set([...cand].filter((d) => hit.has(d))) : hit;
      if (!cand.size) break;
    }
    return cand || [];
  }

  // drugs: [{id, name, text}], где text = normalize(название + МНН), name = normalize(название) — готовит miniapp/build.py
  function search(drugs, query, limit) {
    limit = limit || LIMIT;
    const variants = [...new Set(["х", "кс"].map((x) => normalize(query, x)))];   // Xelikaf / Amoxicillin
    const words = variants[0].split(" ").filter((w) => w.length >= 3);
    if (!words.length) return { items: [], exact: true, total: 0 };
    for (const v of variants) {
      const vw = v.split(" ").filter((w) => w.length >= 3);
      const hits = drugs.filter((d) => vw.every((w) => d.text.includes(w)));
      if (hits.length) {
        // сначала Jurabek Laboratories, затем те, где слово — в торговом названии (а не только в МНН), потом короткие
        const key = (d) => [prio(d), d.name.startsWith(vw[0]) ? 0 : d.name.includes(vw[0]) ? 1 : 2, d.name.length, d.name];
        const items = hits.map((d) => [key(d), d]).sort((a, b) => cmp(a[0], b[0])).slice(0, limit).map((p) => p[1]);
        return { items, exact: true, total: hits.length };
      }
    }
    const scored = [];
    for (const d of fuzzyCandidates(drugs, words)) {
      const tw = d.words || (d.words = d.text.split(" "));
      const sims = words.map((w) => Math.max(0, ...tw.map((t) => sim(w, t))));
      const total = sims.reduce((a, b) => a + b, 0);
      if (total / sims.length < MIN_SIM || Math.min(...sims) < MIN_SIM / 2) continue;
      const nw = d.nameWords || (d.nameWords = d.name.split(" "));
      const inName = words.reduce((s, w) => s + Math.max(0, ...nw.map((t) => sim(w, t))), 0);
      scored.push([[-total, prio(d), -inName, d.rawLen, d.id], d]);   // Jurabek — только при равной похожести
    }
    scored.sort((a, b) => cmp(a[0], b[0]));
    return { items: scored.slice(0, limit).map((p) => p[1]), exact: false, total: Math.min(scored.length, limit) };
  }

  const api = { normalize, search, sim, prepare: index, prio };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UzSearch = api;
})(typeof window !== "undefined" ? window : globalThis);
