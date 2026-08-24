/* ============================================================
   FoodCost — логіка MVP
   Дані живуть у браузері локально (localStorage): закрив вкладку — дані на місці.
   ============================================================ */
(function () {
'use strict';

/* ═════════════════ 1. Константи ═════════════════ */

var STORE_KEY = 'fc:state:v1';
var UNITS = ['г', 'мл', 'шт'];
var PHOTO_MAX = 720;     // px — до цього розміру стискаємо фото
var PHOTO_Q = 0.72;      // якість jpeg

var ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
var ICON_TICK = '<svg class="tick" viewBox="0 0 24 24"><path d="m5 13 4.5 4.5L19 7"/></svg>';

/* ═════════════════ 2. Утиліти ═════════════════ */

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Рядок → невідʼємне число. Розуміє і кому, і крапку, і пробіли-роздільники. */
function num(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
  var s = String(v == null ? '' : v).replace(/[\s ]/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  var n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}

/** Число → «1 234,50» (завжди дві копійки). */
function fmt(n) {
  if (!isFinite(n)) n = 0;
  var p = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+$)/g, ' ') + ',' + p[1];
}

/** Кількість → без зайвих нулів: 300, 2,5. */
function qtyFmt(n) {
  if (!isFinite(n) || n === 0) return '';
  var r = Math.round(n * 1000) / 1000;
  return String(r).replace('.', ',');
}

function money(n) { return fmt(n) + ' ' + S.currency; }

/** Ціле число з валютою, без копійок — для підказки про округлення. */
function moneyShort(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ' ') + ' ' + S.currency;
}

function plural(n, one, few, many) {
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ═════════════════ 3. Стан і сховище ═════════════════ */

var S = null;     // весь стан застосунку
var draftDirty = false;

/**
 * Модель:
 *   product = { id, name, price, pack, unit }
 *   ingredient = { name, price, pack, unit, qty }   ← копія даних, не посилання
 *   expense = { name, mode, value }   mode: 'sum' (валюта) | 'pct' (% від собівартості)
 *   recipe = { id, name, photo, margin, ing[], exp[] }
 *   folder = { id, title, recipes[] }
 */
function emptyState() {
  return {
    currency: '₴',
    round: 5,
    theme: 'light',
    products: [],
    expenseBase: [],
    folders: [],
    draft: null,                                   // незбережена калькуляція
    ui: { screen: 'home', folderId: null, editing: null, folderQuery: '', folderSort: 'name' }
  };
}

/* ═════════════════ 3a. Тема ═════════════════ */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.theme === 'dark' ? 'dark' : 'light');
  $$('#seg-theme button').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-theme-val') === S.theme ? 'true' : 'false');
  });
}

/**
 * Старі сесії (до появи типу витрати) зберігали рядок витрати як {name, sum}.
 * Приводимо до {name, mode:'sum', value} скрізь, де могли лишитись такі записи:
 * у збережених рецептах і в чернетці.
 */
function migrateExpenseList(list) {
  if (!list) return list;
  list.forEach(function (e) {
    if (e.mode) return;
    e.mode = 'sum';
    e.value = e.sum || 0;
    delete e.sum;
  });
  return list;
}
/**
 * Доводить будь-який стан до поточної форми: щойно засіяний, прочитаний зі
 * сховища або взятий з файла резервної копії.
 *
 * ВАЖЛИВО: дані в localStorage живуть безстроково й записані попередніми
 * версіями застосунку. Кожне нове поле треба додавати сюди — інакше
 * користувач зі старими даними отримає збій на новій версії.
 */
function normalize(s) {
  if (!s.ui) s.ui = { screen: 'home', folderId: null, editing: null };
  if (!s.currency) s.currency = '₴';
  if (!s.round) s.round = 5;
  if (!s.theme) s.theme = 'light';
  if (!s.ui.folderSort) s.ui.folderSort = 'name';
  if (s.ui.folderQuery == null) s.ui.folderQuery = '';
  if (!s.products) s.products = [];
  if (!s.expenseBase) s.expenseBase = [];   // до появи бази витрат поля не було
  if (!s.folders) s.folders = [];
  s.folders.forEach(function (f) {
    if (!f.recipes) f.recipes = [];
    f.recipes.forEach(function (r) {
      if (!r.ing) r.ing = [];
      if (!r.exp) r.exp = [];
      migrateExpenseList(r.exp);
    });
  });
  if (s.draft) migrateExpenseList(s.draft.exp);
  return s;
}

function readStore() {
  var raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    var s = JSON.parse(raw);
    if (s && s.products && s.folders) return s;
  } catch (e) { /* нижче */ }

  // Дані є, але прочитати їх не вдалося. Далі init() підставить демо-набір
  // і одразу запише його поверх — тож відкладаємо оригінал убік, інакше
  // єдина копія роботи користувача зникне без сліду.
  try {
    localStorage.setItem(STORE_KEY + ':broken', raw);
    toast('Збережені дані пошкоджено. Копію відкладено — напишіть нам, спробуємо відновити');
  } catch (e2) { /* місця нема — зробити нічого не можемо */ }
  return null;
}

var saveTimer = null;
var storageFailed = false;   // сховище переповнене або недоступне

function persist(now) {
  clearTimeout(saveTimer);
  if (!now) { saveTimer = setTimeout(function () { persist(true); }, 300); return; }
  var failed = false;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(S));
  } catch (e) {
    // Переповнене сховище або приватний режим. Промовчати не можна: користувач
    // вважає, що дані на диску, а їх там немає — і втратить усе при закритті.
    failed = true;
    toast('Не вдалося зберегти на цьому пристрої — бракує місця');
  }
  if (failed !== storageFailed) { storageFailed = failed; updateSaveBtn(); }
}

/* ═════════════════ 4. Демо-дані ═════════════════ */

function seed() {
  var s = emptyState();

  var P = [
    ['Борошно вищий ґатунок', 45, 1000, 'г'],
    ['Мигдальне борошно', 420, 500, 'г'],
    ['Цукор білий', 32, 1000, 'г'],
    ['Цукрова пудра', 46, 500, 'г'],
    ['Масло вершкове 82%', 118, 200, 'г'],
    ['Олія соняшникова', 72, 900, 'мл'],
    ['Яйця С1', 68, 10, 'шт'],
    ['Молоко 2,5%', 38, 1000, 'мл'],
    ['Вершки 33%', 89, 500, 'мл'],
    ['Згущене молоко', 78, 370, 'г'],
    ['Сир вершковий', 145, 340, 'г'],
    ['Мед натуральний', 180, 500, 'г'],
    ['Шоколад чорний 70%', 110, 200, 'г'],
    ['Ванільний екстракт', 210, 50, 'мл'],
    ['Барвник гелевий', 95, 20, 'мл'],
    ['Полуниця заморожена', 96, 300, 'г'],
    ['Морква', 24, 1000, 'г'],
    ['Волоські горіхи', 320, 1000, 'г'],
    ['Імбир мелений', 68, 50, 'г'],
    ['Кориця мелена', 54, 50, 'г']
  ];
  s.products = P.map(function (p) {
    return { id: uid('p'), name: p[0], price: p[1], pack: p[2], unit: p[3] };
  });

  // Ті самі назви, що трапляються в демо-рецептах нижче — щоб автопідстановка спрацювала одразу.
  // Останній рядок — приклад відсоткової витрати (mode 'pct'): вважається від собівартості.
  var E = [
    ['Коробка', 'sum', 15],
    ['Доставка', 'sum', 50],
    ['Бенто-коробка', 'sum', 25],
    ['Топер', 'sum', 18],
    ['Пакування', 'sum', 20],
    ['Коробка для макарон', 'sum', 30],
    ['Амортизація обладнання', 'pct', 1]
  ];
  s.expenseBase = E.map(function (e) {
    return { id: uid('e'), name: e[0], mode: e[1], value: e[2] };
  });

  // [назва, ціна упаковки, к-сть в упаковці, одиниця, к-сть у страві]
  var F = [
    ['Торти', [
      ['Торт Вікторія', 50, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 300],
        ['Цукор білий', 32, 1000, 'г', 250],
        ['Масло вершкове 82%', 118, 200, 'г', 200],
        ['Яйця С1', 68, 10, 'шт', 4],
        ['Вершки 33%', 89, 500, 'мл', 400],
        ['Сир вершковий', 145, 340, 'г', 340],
        ['Ванільний екстракт', 210, 50, 'мл', 5],
        ['Полуниця заморожена', 96, 300, 'г', 350]
      ], [['Коробка', 15], ['Доставка', 50]]],
      ['Медовик', 60, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 400],
        ['Мед натуральний', 180, 500, 'г', 150],
        ['Цукор білий', 32, 1000, 'г', 200],
        ['Масло вершкове 82%', 118, 200, 'г', 100],
        ['Яйця С1', 68, 10, 'шт', 3],
        ['Вершки 33%', 89, 500, 'мл', 700],
        ['Згущене молоко', 78, 370, 'г', 250]
      ], [['Коробка', 15], ['Доставка', 50]]],
      ['Наполеон', 55, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 500],
        ['Масло вершкове 82%', 118, 200, 'г', 250],
        ['Яйця С1', 68, 10, 'шт', 4],
        ['Молоко 2,5%', 38, 1000, 'мл', 700],
        ['Цукор білий', 32, 1000, 'г', 200],
        ['Ванільний екстракт', 210, 50, 'мл', 5]
      ], [['Коробка', 15]]],
      ['Морквяний', 60, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 300],
        ['Морква', 24, 1000, 'г', 400],
        ['Цукор білий', 32, 1000, 'г', 250],
        ['Олія соняшникова', 72, 900, 'мл', 200],
        ['Яйця С1', 68, 10, 'шт', 4],
        ['Сир вершковий', 145, 340, 'г', 300],
        ['Волоські горіхи', 320, 1000, 'г', 100]
      ], [['Коробка', 15], ['Доставка', 50]]]
    ]],
    ['Бенто-торти', [
      ['Бенто «Ведмедик»', 80, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 120],
        ['Цукор білий', 32, 1000, 'г', 90],
        ['Масло вершкове 82%', 118, 200, 'г', 60],
        ['Яйця С1', 68, 10, 'шт', 1],
        ['Сир вершковий', 145, 340, 'г', 100],
        ['Барвник гелевий', 95, 20, 'мл', 2]
      ], [['Бенто-коробка', 25]]],
      ['Бенто «Серце»', 80, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 130],
        ['Цукор білий', 32, 1000, 'г', 100],
        ['Масло вершкове 82%', 118, 200, 'г', 70],
        ['Яйця С1', 68, 10, 'шт', 1],
        ['Вершки 33%', 89, 500, 'мл', 150],
        ['Полуниця заморожена', 96, 300, 'г', 120]
      ], [['Бенто-коробка', 25], ['Топер', 18]]],
      ['Бенто класичний', 85, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 120],
        ['Цукор білий', 32, 1000, 'г', 90],
        ['Масло вершкове 82%', 118, 200, 'г', 55],
        ['Яйця С1', 68, 10, 'шт', 1],
        ['Сир вершковий', 145, 340, 'г', 90]
      ], [['Бенто-коробка', 25]]]
    ]],
    ['Печиво', [
      ['Пряники імбирні', 70, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 500],
        ['Мед натуральний', 180, 500, 'г', 100],
        ['Масло вершкове 82%', 118, 200, 'г', 100],
        ['Цукор білий', 32, 1000, 'г', 150],
        ['Яйця С1', 68, 10, 'шт', 1],
        ['Імбир мелений', 68, 50, 'г', 8],
        ['Кориця мелена', 54, 50, 'г', 6]
      ], [['Пакування', 20]]],
      ['Макарон, 12 шт', 75, [
        ['Мигдальне борошно', 420, 500, 'г', 150],
        ['Цукрова пудра', 46, 500, 'г', 150],
        ['Яйця С1', 68, 10, 'шт', 3],
        ['Цукор білий', 32, 1000, 'г', 150],
        ['Барвник гелевий', 95, 20, 'мл', 3],
        ['Вершки 33%', 89, 500, 'мл', 120]
      ], [['Коробка для макарон', 30]]],
      ['Печиво шоколадне', 65, [
        ['Борошно вищий ґатунок', 45, 1000, 'г', 300],
        ['Масло вершкове 82%', 118, 200, 'г', 150],
        ['Цукор білий', 32, 1000, 'г', 200],
        ['Яйця С1', 68, 10, 'шт', 2],
        ['Шоколад чорний 70%', 110, 200, 'г', 150]
      ], [['Пакування', 20]]]
    ]]
  ];

  s.folders = F.map(function (f) {
    return {
      id: uid('f'),
      title: f[0],
      recipes: f[1].map(function (r) {
        return {
          id: uid('r'),
          name: r[0],
          photo: null,
          margin: r[1],
          ing: r[2].map(function (i) {
            return { name: i[0], price: i[1], pack: i[2], unit: i[3], qty: i[4] };
          }),
          exp: r[3].map(function (e) { return { name: e[0], mode: 'sum', value: e[1] }; })
        };
      })
    };
  });

  return s;
}

/* ═════════════════ 5. Розрахунок ═════════════════ */

/** вартість_у_страві = (ціна_упаковки / кількість_в_упаковці) × кількість_у_страві */
function ingCost(i) {
  if (!i || !i.pack) return 0;
  return i.price / i.pack * i.qty;
}

/**
 * Витрата буває фіксованою сумою або відсотком від собівартості —
 * наприклад, амортизація обладнання 1%. Відсоток рахується від cost
 * (тільки інгредієнти), а не від суми з іншими витратами, щоб не було
 * циклічної залежності «витрата залежить від суми витрат».
 */
function expenseCost(e, cost) {
  if (!e) return 0;
  return e.mode === 'pct' ? cost * (num(e.value) / 100) : num(e.value);
}

function totals(r) {
  var cost = 0, extra = 0, i;
  for (i = 0; i < r.ing.length; i++) cost += ingCost(r.ing[i]);
  for (i = 0; i < r.exp.length; i++) extra += expenseCost(r.exp[i], cost);
  var sub = cost + extra;
  var margin = sub * (num(r.margin) / 100);
  var price = sub + margin;
  var step = S.round || 1;
  return {
    cost: cost, extra: extra, sub: sub, margin: margin, price: price,
    round: step > 1 ? Math.ceil(price / step) * step : price
  };
}

/* Пошук по колекціях. Усі три бази (продукти, витрати, папки) шукаються
   однаково, тож сам цикл живе в одному місці, а іменовані обгортки
   лишаються заради читабельності на місцях виклику. */
function byId(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/** Збіг за назвою — без урахування регістру й крайніх пробілів. */
function byName(list, name) {
  var key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].name.trim().toLowerCase() === key) return list[i];
  }
  return null;
}

function productById(id) { return byId(S.products, id); }
function expenseById(id) { return byId(S.expenseBase, id); }
function folderById(id) { return byId(S.folders, id); }
function findProduct(name) { return byName(S.products, name); }
function findExpense(name) { return byName(S.expenseBase, name); }

/* ═════════════════ 6. Тост і модалки ═════════════════ */

var toastEl, toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2800);
}

/**
 * Універсальний діалог.
 * opts: { title, sub, value, placeholder, ok, danger, input:false }
 * cb(value|true) — при підтвердженні; при скасуванні не викликається.
 */
var askCb = null;
function ask(opts, cb) {
  var ov = $('#ask-overlay'), inp = $('#ask-input');
  $('#ask-title').textContent = opts.title || '';
  $('#ask-sub').textContent = opts.sub || '';
  $('#ask-sub').hidden = !opts.sub;
  var useInput = opts.input !== false;
  inp.hidden = !useInput;
  inp.value = opts.value || '';
  inp.placeholder = opts.placeholder || '';
  var okBtn = $('#ask-ok');
  okBtn.textContent = opts.ok || 'Готово';
  okBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
  askCb = function () {
    if (useInput) {
      var v = inp.value.trim();
      if (!v) { inp.focus(); return false; }
      cb(v);
    } else cb(true);
    return true;
  };
  ov.classList.add('is-on');
  if (useInput) setTimeout(function () { inp.focus(); inp.select(); }, 30);
  else setTimeout(function () { okBtn.focus(); }, 30);
}
function closeAsk() { $('#ask-overlay').classList.remove('is-on'); askCb = null; }

/* ═════════════════ 7. Навігація ═════════════════ */

function setNav(key) {
  $$('.nav-item').forEach(function (b) {
    var k = b.getAttribute('data-screen') ||
            (b.getAttribute('data-folder') ? 'folder:' + b.getAttribute('data-folder') : null);
    b.setAttribute('aria-current', (k && k === key) ? 'true' : 'false');
  });
}

function show(id, navKey) {
  $$('.screen').forEach(function (s) { s.classList.toggle('is-active', s.id === 's-' + id); });
  setNav(navKey === undefined ? id : navKey);
  S.ui.screen = id;
  window.scrollTo(0, 0);
  persist();
}

/* ═════════════════ 8. Сайдбар ═════════════════ */

function renderSidebar() {
  var box = $('#nav-folders');
  box.innerHTML = '';
  if (!S.folders.length) {
    box.innerHTML = '<p class="nav-hint">Папок ще немає. Створіть першу — рецепти будуть зберігатися в неї.</p>';
  } else {
    S.folders.forEach(function (f) {
      var b = document.createElement('button');
      b.className = 'nav-item is-sub';
      b.setAttribute('data-folder', f.id);
      b.innerHTML = '<span class="nav-name">' + esc(f.title) + '</span>' +
                    '<span class="nav-count">' + f.recipes.length + '</span>';
      box.appendChild(b);
    });
  }
  $('#nav-base-count').textContent = S.products.length || '';
  $('#nav-expbase-count').textContent = S.expenseBase.length || '';
}

/* ═════════════════ 9. База продуктів ═════════════════ */

function unitSelect(value) {
  return '<select class="unit-sel" data-f="unit" aria-label="Одиниця">' +
    UNITS.map(function (u) {
      return '<option value="' + u + '"' + (u === value ? ' selected' : '') + '>' + u + '</option>';
    }).join('') + '</select>';
}

/** Перемикач типу витрати: фіксована сума в валюті або відсоток від собівартості. */
function modeSelect(value) {
  return '<select class="unit-sel" data-f="mode" aria-label="Тип витрати">' +
    '<option value="sum"' + (value === 'pct' ? '' : ' selected') + '>' + esc(S.currency) + '</option>' +
    '<option value="pct"' + (value === 'pct' ? ' selected' : '') + '>%</option>' +
    '</select>';
}

/** Показує «%» біля поля значення тільки для відсоткової витрати. */
function syncExpSuffix(tr) {
  var suf = $('[data-suffix]', tr);
  if (!suf) return;
  suf.hidden = $('[data-f=mode]', tr).value !== 'pct';
}

/** Формат значення залежить від типу: сума — завжди дві копійки, відсоток — без зайвих нулів. */
function paintExpValue(tr, x) {
  var el = $('[data-f=value]', tr);
  el.value = x.mode === 'pct' ? (x.value ? qtyFmt(x.value) : '') : (x.value ? fmt(x.value) : '');
}

function renderBase() {
  var body = $('#base-body');
  var q = $('#base-search').value.trim().toLowerCase();
  body.innerHTML = '';

  var list = S.products.filter(function (p) {
    return !q || p.name.toLowerCase().indexOf(q) !== -1;
  });

  if (!list.length) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="tbl-empty"><b style="display:block;margin-bottom:6px;font-size:16px;color:var(--fg)">' +
      (q ? 'Нічого не знайшли за запитом «' + esc(q) + '»' : 'База порожня — додайте перший продукт') + '</b>' +
      (q ? 'Спробуйте коротший запит або додайте новий продукт.'
         : 'Назва, ціна упаковки, вага — і продукт почне підтягуватися в калькуляції.') + '</td>';
    body.appendChild(tr);
  } else {
    list.forEach(function (p) { body.appendChild(baseRow(p)); });
  }

  $('#base-tip').textContent = S.products.length
    ? S.products.length + ' ' + plural(S.products.length, 'продукт', 'продукти', 'продуктів') + ' у базі'
    : '';
  renderDatalist();
}

function baseRow(p) {
  var tr = document.createElement('tr');
  tr.setAttribute('data-id', p.id);
  tr.innerHTML =
    '<td><input class="inp" data-f="name" placeholder="Назва продукту"></td>' +
    '<td><input class="inp is-num" data-f="price" inputmode="decimal" placeholder="0,00"></td>' +
    '<td><input class="inp is-num" data-f="pack" inputmode="decimal" placeholder="0"></td>' +
    '<td style="text-align:center">' + unitSelect(p.unit) + '</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-product aria-label="Видалити продукт">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = p.name;
  $('[data-f=price]', tr).value = p.price ? fmt(p.price) : '';
  $('[data-f=pack]', tr).value = qtyFmt(p.pack);
  return tr;
}

function bindBase() {
  var body = $('#base-body');

  body.addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    var p = productById(tr.getAttribute('data-id')); if (!p) return;
    var f = e.target.getAttribute('data-f');
    if (f === 'name') p.name = e.target.value;
    else if (f === 'price') p.price = num(e.target.value);
    else if (f === 'pack') p.pack = num(e.target.value);
    persist();
    // підказка автопідстановки показує ціну й упаковку — оновлюємо за будь-якою правкою рядка, не тільки за назвою
    renderDatalist();
  });

  body.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') !== 'unit') return;
    var tr = e.target.closest('tr');
    var p = productById(tr.getAttribute('data-id'));
    if (p) { p.unit = e.target.value; persist(); renderDatalist(); }
  });

  // Акуратне форматування чисел після виходу з поля
  body.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f === 'price') e.target.value = num(e.target.value) ? fmt(num(e.target.value)) : '';
    if (f === 'pack') e.target.value = qtyFmt(num(e.target.value));
  }, true);

  body.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-product]'); if (!btn) return;
    var tr = btn.closest('tr');
    var p = productById(tr.getAttribute('data-id')); if (!p) return;
    ask({
      title: 'Видалити продукт?',
      sub: '«' + p.name + '» зникне з бази. Збережені калькуляції не постраждають — вони зберігають копію даних.',
      input: false, ok: 'Видалити', danger: true
    }, function () {
      S.products = S.products.filter(function (x) { return x.id !== p.id; });
      closeAsk(); renderBase(); renderSidebar(); persist(true);
      toast('Продукт видалено');
    });
  });

  $('#base-search').addEventListener('input', renderBase);

  /** toTop: кнопка над таблицею кладе рядок зверху, кнопка під таблицею — знизу. */
  function addProduct(toTop) {
    var p = { id: uid('p'), name: '', price: 0, pack: 0, unit: 'г' };
    if (toTop) S.products.unshift(p); else S.products.push(p);
    $('#base-search').value = '';
    renderBase(); renderSidebar(); persist();
    var tr = $('#base-body tr[data-id="' + p.id + '"]');
    if (tr) { tr.scrollIntoView({ block: 'center' }); $('[data-f=name]', tr).focus(); }
  }
  $('#btn-add-product').addEventListener('click', function () { addProduct(true); });
  $('#btn-add-product-2').addEventListener('click', function () { addProduct(false); });
}

function renderDatalist() {
  var dl = $('#dl-products');
  dl.innerHTML = S.products
    .filter(function (p) { return p.name.trim(); })
    .map(function (p) {
      return '<option value="' + esc(p.name) + '">' + esc(fmt(p.price) + ' ' + S.currency + ' / ' + qtyFmt(p.pack) + ' ' + p.unit) + '</option>';
    }).join('');
}

/* ═════════════════ 9a. База витрат ═════════════════
   Той самий принцип, що й база продуктів: заповнюється один раз,
   далі назва підтягує суму в «Додаткових витратах» калькуляції. */

function renderExpBase() {
  var body = $('#expbase-body');
  var q = $('#expbase-search').value.trim().toLowerCase();
  body.innerHTML = '';

  var list = S.expenseBase.filter(function (x) {
    return !q || x.name.toLowerCase().indexOf(q) !== -1;
  });

  if (!list.length) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="tbl-empty"><b style="display:block;margin-bottom:6px;font-size:16px;color:var(--fg)">' +
      (q ? 'Нічого не знайшли за запитом «' + esc(q) + '»' : 'База порожня — додайте першу витрату') + '</b>' +
      (q ? 'Спробуйте коротший запит або додайте нову витрату.'
         : 'Назва, тип і значення — і витрата почне підтягуватися в калькуляції.') + '</td>';
    body.appendChild(tr);
  } else {
    list.forEach(function (x) { body.appendChild(expBaseRow(x)); });
  }

  $('#expbase-tip').textContent = S.expenseBase.length
    ? S.expenseBase.length + ' ' + plural(S.expenseBase.length, 'витрата', 'витрати', 'витрат') + ' у базі'
    : '';
  renderExpDatalist();
}

function expBaseRow(x) {
  var tr = document.createElement('tr');
  tr.setAttribute('data-id', x.id);
  tr.innerHTML =
    '<td><input class="inp" data-f="name" placeholder="Назва витрати"></td>' +
    '<td style="text-align:center">' + modeSelect(x.mode) + '</td>' +
    '<td><span class="qty-wrap"><input class="inp is-num" data-f="value" inputmode="decimal" placeholder="0,00"><span class="unit-tag" data-suffix hidden>%</span></span></td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-expbase aria-label="Видалити витрату">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = x.name;
  paintExpValue(tr, x);
  syncExpSuffix(tr);
  return tr;
}

function bindExpBase() {
  var body = $('#expbase-body');

  body.addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    var x = expenseById(tr.getAttribute('data-id')); if (!x) return;
    var f = e.target.getAttribute('data-f');
    if (f === 'name') x.name = e.target.value;
    else if (f === 'value') x.value = num(e.target.value);
    persist();
    renderExpDatalist();
  });

  body.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') !== 'mode') return;
    var tr = e.target.closest('tr');
    var x = expenseById(tr.getAttribute('data-id'));
    if (!x) return;
    x.mode = e.target.value === 'pct' ? 'pct' : 'sum';
    syncExpSuffix(tr); paintExpValue(tr, x);
    persist(); renderExpDatalist();
  });

  body.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f !== 'value') return;
    var tr = e.target.closest('tr');
    var x = expenseById(tr.getAttribute('data-id'));
    if (x) paintExpValue(tr, x);
  }, true);

  body.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-expbase]'); if (!btn) return;
    var tr = btn.closest('tr');
    var x = expenseById(tr.getAttribute('data-id')); if (!x) return;
    ask({
      title: 'Видалити витрату?',
      sub: '«' + x.name + '» зникне з бази. Збережені калькуляції не постраждають — вони зберігають копію даних.',
      input: false, ok: 'Видалити', danger: true
    }, function () {
      S.expenseBase = S.expenseBase.filter(function (y) { return y.id !== x.id; });
      closeAsk(); renderExpBase(); renderSidebar(); persist(true);
      toast('Витрату видалено');
    });
  });

  $('#expbase-search').addEventListener('input', renderExpBase);

  function addExpBase(toTop) {
    var x = { id: uid('e'), name: '', mode: 'sum', value: 0 };
    if (toTop) S.expenseBase.unshift(x); else S.expenseBase.push(x);
    $('#expbase-search').value = '';
    renderExpBase(); renderSidebar(); persist();
    var tr = $('#expbase-body tr[data-id="' + x.id + '"]');
    if (tr) { tr.scrollIntoView({ block: 'center' }); $('[data-f=name]', tr).focus(); }
  }
  $('#btn-add-expbase').addEventListener('click', function () { addExpBase(true); });
  $('#btn-add-expbase-2').addEventListener('click', function () { addExpBase(false); });
}

function renderExpDatalist() {
  var dl = $('#dl-expenses');
  dl.innerHTML = S.expenseBase
    .filter(function (x) { return x.name.trim(); })
    .map(function (x) {
      var label = x.mode === 'pct' ? qtyFmt(x.value) + '%' : fmt(x.value) + ' ' + S.currency;
      return '<option value="' + esc(x.name) + '">' + esc(label) + '</option>';
    }).join('');
}

/* ═════════════════ 10. Папка (сітка карток) ═════════════════ */

function openFolder(id) {
  var f = folderById(id);
  if (!f) { show('home'); return; }
  S.ui.folderId = id;
  S.ui.folderQuery = '';
  $('#folder-search').value = '';
  renderFolder();
  show('folder', 'folder:' + id);
}

/** Пошук + сортування всередині папки. «Нові» — у зворотному порядку додавання. */
function visibleRecipes(f) {
  var q = (S.ui.folderQuery || '').trim().toLowerCase();
  var list = f.recipes.filter(function (r) {
    return !q || r.name.toLowerCase().indexOf(q) !== -1;
  });
  var sort = S.ui.folderSort || 'name';
  if (sort === 'name') {
    list = list.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'uk'); });
  } else if (sort === 'price') {
    list = list.slice().sort(function (a, b) { return totals(b).round - totals(a).round; });
  } else {
    list = list.slice().reverse();
  }
  return list;
}

function renderFolder() {
  var f = folderById(S.ui.folderId);
  if (!f) return;
  $('#folder-title').textContent = f.title;
  $('#folder-count').textContent = f.recipes.length
    ? f.recipes.length + ' ' + plural(f.recipes.length, 'калькуляція', 'калькуляції', 'калькуляцій')
    : 'Поки порожньо';

  $$('#seg-sort button').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-sort') === (S.ui.folderSort || 'name') ? 'true' : 'false');
  });

  var grid = $('#folder-grid');
  var list = visibleRecipes(f);
  grid.innerHTML = '';

  if (!list.length) {
    var q = (S.ui.folderQuery || '').trim();
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' +
      (q
        ? '<b>Нічого не знайшли</b><span>За запитом «' + esc(q) + '» у цій папці порожньо.</span>'
        : '<b>Тут поки порожньо</b><span>Створіть першу калькуляцію в цій папці.</span>' +
          '<button class="btn btn-soft" data-recipe="new">+ Нова калькуляція</button>') +
      '</div>';
    return;
  }

  list.forEach(function (r) {
    var t = totals(r);
    var card = document.createElement('button');
    card.className = 'rcard';
    card.setAttribute('data-open', r.id);
    card.innerHTML =
      '<span class="rcard-del" data-del-recipe="' + r.id + '" aria-label="Видалити калькуляцію">' + ICON_X + '</span>' +
      '<span class="rcard-thumb' + (r.photo ? ' has-img' : '') + '">' +
        (r.photo ? '<img src="' + r.photo + '" alt="">' : esc(r.name.trim().charAt(0).toUpperCase())) +
      '</span>' +
      '<span class="rcard-body">' +
        '<span class="rcard-title">' + esc(r.name) + '</span>' +
        '<span class="rcard-line"><span>Собівартість</span><span class="num">' + money(t.cost) + '</span></span>' +
        '<span class="rcard-line is-price"><span>Ціна</span><span class="num">' + money(t.round) + '</span></span>' +
      '</span>';
    grid.appendChild(card);
  });
}

function bindFolder() {
  $('#folder-grid').addEventListener('click', function (e) {
    var del = e.target.closest('[data-del-recipe]');
    if (del) {
      e.stopPropagation();
      var f = folderById(S.ui.folderId);
      var id = del.getAttribute('data-del-recipe');
      var r = f.recipes.filter(function (x) { return x.id === id; })[0];
      if (!r) return;
      ask({ title: 'Видалити калькуляцію?', sub: '«' + r.name + '» буде видалено безповоротно.', input: false, ok: 'Видалити', danger: true }, function () {
        f.recipes = f.recipes.filter(function (x) { return x.id !== id; });
        if (S.ui.editing && S.ui.editing.recipeId === id) S.ui.editing = null;
        closeAsk(); renderFolder(); renderSidebar(); persist(true);
        toast('Калькуляцію видалено');
      });
      return;
    }
    var card = e.target.closest('[data-open]');
    if (card) openRecipe(S.ui.folderId, card.getAttribute('data-open'));
  });

  $('#folder-rename').addEventListener('click', function () {
    var f = folderById(S.ui.folderId); if (!f) return;
    ask({ title: 'Перейменувати папку', value: f.title, placeholder: 'Назва папки', ok: 'Зберегти' }, function (v) {
      f.title = v; closeAsk(); renderFolder(); renderSidebar(); persist(true);
    });
  });

  $('#folder-delete').addEventListener('click', function () {
    var f = folderById(S.ui.folderId); if (!f) return;
    ask({
      title: 'Видалити папку?',
      sub: 'Разом з нею зникне ' + f.recipes.length + ' ' + plural(f.recipes.length, 'калькуляція', 'калькуляції', 'калькуляцій') + '.',
      input: false, ok: 'Видалити', danger: true
    }, function () {
      S.folders = S.folders.filter(function (x) { return x.id !== f.id; });
      if (S.ui.editing && S.ui.editing.folderId === f.id) S.ui.editing = null;
      S.ui.folderId = null;
      closeAsk(); renderSidebar(); persist(true);
      show('home');
      toast('Папку «' + f.title + '» видалено');
    });
  });

  $('#folder-search').addEventListener('input', function () {
    S.ui.folderQuery = this.value;
    renderFolder();
  });

  $('#seg-sort').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sort]'); if (!b) return;
    S.ui.folderSort = b.getAttribute('data-sort');
    renderFolder(); persist();
  });

  $('#nav-folders').addEventListener('click', function (e) {
    var b = e.target.closest('[data-folder]');
    if (b) openFolder(b.getAttribute('data-folder'));
  });

  $('#btn-add-folder').addEventListener('click', function () {
    ask({ title: 'Нова папка', placeholder: 'Наприклад, Чізкейки', ok: 'Створити' }, function (v) {
      var f = { id: uid('f'), title: v, recipes: [] };
      S.folders.push(f);
      closeAsk(); renderSidebar(); persist(true);
      openFolder(f.id);
      toast('Папку «' + v + '» створено');
    });
  });
}

/* ═════════════════ 11. Калькуляція ═════════════════ */

var calcPhoto = null;   // dataURL поточної калькуляції

function ingRow(data) {
  var v = data || { name: '', price: 0, pack: 0, unit: 'г', qty: 0 };
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td><input class="inp" data-f="name" list="dl-products" placeholder="Почніть вводити назву" autocomplete="off"></td>' +
    '<td><input class="inp is-num" data-f="price" inputmode="decimal" placeholder="0,00"></td>' +
    '<td><span class="cell-pair"><input class="inp is-num" data-f="pack" inputmode="decimal" placeholder="0">' + unitSelect(v.unit) + '</span></td>' +
    '<td><span class="qty-wrap"><input class="inp is-num" data-f="qty" inputmode="decimal" placeholder="0"><span class="unit-tag">' + esc(v.unit) + '</span></span></td>' +
    '<td class="t-cost t-empty">—</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-row aria-label="Видалити рядок">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = v.name;
  $('[data-f=price]', tr).value = v.price ? fmt(v.price) : '';
  $('[data-f=pack]', tr).value = qtyFmt(v.pack);
  $('[data-f=qty]', tr).value = qtyFmt(v.qty);
  return tr;
}

function expRow(data) {
  var v = data || { name: '', mode: 'sum', value: 0 };
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td><input class="inp" data-f="name" list="dl-expenses" placeholder="Наприклад, коробка" autocomplete="off"></td>' +
    '<td style="text-align:center">' + modeSelect(v.mode) + '</td>' +
    '<td><span class="qty-wrap"><input class="inp is-num" data-f="value" inputmode="decimal" placeholder="0,00"><span class="unit-tag" data-suffix hidden>%</span></span></td>' +
    '<td class="t-cost t-empty">—</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-row aria-label="Видалити рядок">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = v.name;
  paintExpValue(tr, v);
  syncExpSuffix(tr);
  return tr;
}

/** Зчитує поточний стан екрана калькуляції в обʼєкт рецепта. */
function readCalc() {
  return {
    name: $('#calc-name').value.trim(),
    photo: calcPhoto,
    margin: num($('#margin-inp').value),
    ing: $$('#ing-body tr').map(function (tr) {
      return {
        name: $('[data-f=name]', tr).value.trim(),
        price: num($('[data-f=price]', tr).value),
        pack: num($('[data-f=pack]', tr).value),
        unit: $('[data-f=unit]', tr).value,
        qty: num($('[data-f=qty]', tr).value)
      };
    }),
    exp: $$('#exp-body tr').map(function (tr) {
      return {
        name: $('[data-f=name]', tr).value.trim(),
        mode: $('[data-f=mode]', tr).value === 'pct' ? 'pct' : 'sum',
        value: num($('[data-f=value]', tr).value)
      };
    })
  };
}

/** Прибирає порожні рядки — у стан їх писати не треба. */
function cleanRecipe(d) {
  return {
    name: d.name,
    photo: d.photo,
    margin: d.margin,
    ing: d.ing.filter(function (i) { return i.name || i.price || i.pack || i.qty; }),
    exp: d.exp.filter(function (e) { return e.name || e.value; })
  };
}

/* Цифри в підсумку доїжджають до нового значення, а не стрибають:
   так видно, що саме змінилося після правки рядка. */
var disp = null, tweenRaf = null;
var TWEEN_KEYS = ['cost', 'extra', 'sub', 'margin', 'price'];

function calmMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function writeNumbers(v, t, m) {
  $('#r-cost').textContent = money(v.cost);
  $('#r-exp').textContent = '+ ' + money(v.extra);
  $('#r-sub').textContent = money(v.sub);
  $('#r-mlbl').textContent = 'Маржа ' + qtyFmt(m) + '%';
  $('#r-margin').textContent = '+ ' + money(v.margin);
  $('#r-price').textContent = money(v.price);
  $('#sum-ing').textContent = t.cost ? money(v.cost) : '—';
  $('#sum-exp').textContent = t.extra ? money(v.extra) : '—';
  $('#margin-sum').textContent = t.margin ? '= + ' + money(v.margin) : '—';
}

function paintReceipt(t, m) {
  var target = { cost: t.cost, extra: t.extra, sub: t.sub, margin: t.margin, price: t.price };

  var showNote = (S.round || 1) > 1 && t.price > 0;
  $('#r-note').hidden = !showNote;
  if (showNote) $('#r-round').textContent = moneyShort(t.round);

  $$('#margin-quick button').forEach(function (b) {
    b.setAttribute('aria-pressed', num(b.getAttribute('data-m')) === num(m) ? 'true' : 'false');
  });

  if (!disp || calmMotion()) { disp = target; writeNumbers(target, t, m); return; }

  var far = TWEEN_KEYS.some(function (k) { return Math.abs(target[k] - disp[k]) > 0.005; });
  if (!far) { writeNumbers(target, t, m); return; }

  if (tweenRaf) cancelAnimationFrame(tweenRaf);
  (function step() {
    var moving = false;
    TWEEN_KEYS.forEach(function (k) {
      var d = target[k] - disp[k];
      if (Math.abs(d) > 0.005) { disp[k] += d * 0.26; moving = true; }
      else disp[k] = target[k];
    });
    writeNumbers(disp, t, m);
    tweenRaf = moving ? requestAnimationFrame(step) : null;
  })();
}

/** Головний перерахунок: рядки → вартості → підсумок → чернетка в сесію. */
function recalc() {
  var d = readCalc();

  $$('#ing-body tr').forEach(function (tr, idx) {
    var i = d.ing[idx];
    var cell = $('.t-cost', tr);
    var ok = i.price > 0 && i.pack > 0 && i.qty > 0;
    cell.textContent = ok ? fmt(ingCost(i)) : '—';
    cell.classList.toggle('t-empty', !ok);
  });

  var t = totals(d);

  // Вартість витрати рахуємо тут: для відсоткової важлива вже готова собівартість (t.cost)
  // Показуємо суму за самим значенням, без огляду на назву: у підсумок вона
  // потрапляє в будь-якому разі, тож «—» у рядку з незаповненою назвою
  // виглядало б так, ніби рядок не рахується.
  $$('#exp-body tr').forEach(function (tr, idx) {
    var e = d.exp[idx];
    var cell = $('.t-cost', tr);
    var ok = e.value > 0;
    cell.textContent = ok ? fmt(expenseCost(e, t.cost)) : '—';
    cell.classList.toggle('t-empty', !ok);
  });

  paintReceipt(t, d.margin);

  S.draft = cleanRecipe(d);
  draftDirty = true;
  updateSaveBtn();
  persist();
}

function syncUnitTag(tr) {
  var tag = $('.unit-tag', tr);
  if (tag) tag.textContent = $('[data-f=unit]', tr).value;
}

/** Підставляє дані з бази, якщо назва точно збіглася з продуктом. */
function autofill(tr) {
  var p = findProduct($('[data-f=name]', tr).value);
  if (!p) return;
  $('[data-f=price]', tr).value = p.price ? fmt(p.price) : '';
  $('[data-f=pack]', tr).value = qtyFmt(p.pack);
  $('[data-f=unit]', tr).value = p.unit;
  syncUnitTag(tr);
}

/** Те саме для рядка витрати: назва збіглася з базою витрат — підставляємо тип і значення. */
function autofillExpense(tr) {
  var x = findExpense($('[data-f=name]', tr).value);
  if (!x) return;
  $('[data-f=mode]', tr).value = x.mode;
  paintExpValue(tr, x);
  syncExpSuffix(tr);
}

function loadCalc(rec, crumb) {
  disp = null;                       // інший рецепт — цифрам нема звідки їхати
  $('#calc-name').value = rec.name || '';
  $('#calc-crumb').textContent = crumb;
  $('#margin-inp').value = qtyFmt(rec.margin != null ? rec.margin : 50) || '0';

  setPhoto(rec.photo || null);

  var ib = $('#ing-body'); ib.innerHTML = '';
  var ing = (rec.ing || []).slice();
  while (ing.length < 5) ing.push(null);              // стартово 5 рядків
  ing.forEach(function (i) { ib.appendChild(ingRow(i)); });

  var eb = $('#exp-body'); eb.innerHTML = '';
  var exp = (rec.exp || []).slice();
  while (exp.length < 3) exp.push(null);              // стартово 3 рядки
  exp.forEach(function (e) { eb.appendChild(expRow(e)); });

  recalc();
  draftDirty = false;   // щойно завантажили — незбережених правок ще немає
  updateSaveBtn();
}

function newCalc() {
  S.ui.editing = null;
  S.draft = null;
  loadCalc({ name: '', margin: 50, ing: [], exp: [] }, 'Нова калькуляція');
  show('calc', null);
  $('#calc-name').focus();
}

function openRecipe(folderId, recipeId) {
  var f = folderById(folderId); if (!f) return;
  var r = f.recipes.filter(function (x) { return x.id === recipeId; })[0];
  if (!r) return;
  S.ui.editing = { folderId: folderId, recipeId: recipeId };
  loadCalc(r, f.title);
  show('calc', null);
}

function updateSaveBtn() {
  $('#btn-save').textContent = S.ui.editing ? 'Оновити калькуляцію' : 'Зберегти калькуляцію';
  var st = $('#save-state');
  // Поки запис на диск не проходить, писати «Збережено» — обман: показуємо це першим.
  if (storageFailed) {
    st.className = 'save-state is-warn';
    st.textContent = 'Не збережено на пристрої — бракує місця';
    return;
  }
  st.className = 'save-state' + (draftDirty ? ' is-dirty' : (S.ui.editing ? ' is-saved' : ''));
  st.textContent = draftDirty ? 'Є незбережені зміни'
                 : (S.ui.editing ? 'Збережено' : 'Чернетка — ще не в папці');
}

/** Куди веде «←»: у папку рецепта, інакше у відкриту папку, інакше на головну. */
function backFromCalc() {
  var id = (S.ui.editing && S.ui.editing.folderId) || S.ui.folderId;
  if (id && folderById(id)) openFolder(id);
  else show('home');
}

function bindCalc() {
  var ib = $('#ing-body'), eb = $('#exp-body');

  ib.addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.getAttribute('data-f') === 'name') autofill(tr);
    recalc();
  });
  ib.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') === 'unit') { syncUnitTag(e.target.closest('tr')); recalc(); }
  });
  ib.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f === 'price') e.target.value = num(e.target.value) ? fmt(num(e.target.value)) : '';
    if (f === 'pack' || f === 'qty') e.target.value = qtyFmt(num(e.target.value));
  }, true);

  eb.addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.getAttribute('data-f') === 'name') autofillExpense(tr);
    recalc();
  });
  eb.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') !== 'mode') return;
    var tr = e.target.closest('tr');
    syncExpSuffix(tr);
    // тип змінили руками — переформатувати поле під новий вигляд (2 копійки ↔ без нулів)
    var v = { mode: e.target.value === 'pct' ? 'pct' : 'sum', value: num($('[data-f=value]', tr).value) };
    paintExpValue(tr, v);
    recalc();
  });
  eb.addEventListener('blur', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-f') === 'value') {
      var tr = e.target.closest('tr');
      var mode = $('[data-f=mode]', tr).value === 'pct' ? 'pct' : 'sum';
      paintExpValue(tr, { mode: mode, value: num(e.target.value) });
    }
  }, true);

  // Видалення рядків
  [ib, eb].forEach(function (body) {
    body.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del-row]'); if (!btn) return;
      btn.closest('tr').remove();
      if (!body.children.length) body.appendChild(body === ib ? ingRow(null) : expRow(null));
      recalc();
    });
  });

  $('#btn-add-ing').addEventListener('click', function () {
    var tr = ingRow(null); ib.appendChild(tr); $('[data-f=name]', tr).focus(); recalc();
  });
  $('#btn-add-exp').addEventListener('click', function () {
    var tr = expRow(null); eb.appendChild(tr); $('[data-f=name]', tr).focus(); recalc();
  });

  $('#calc-back').addEventListener('click', backFromCalc);
  $('#calc-name').addEventListener('input', recalc);
  $('#margin-inp').addEventListener('input', recalc);
  $('#margin-inp').addEventListener('blur', function () {
    this.value = qtyFmt(num(this.value)) || '0';
  });
  $('#margin-quick').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]'); if (!b) return;
    $('#margin-inp').value = b.getAttribute('data-m');
    recalc();
  });

  $('#btn-clear-calc').addEventListener('click', function () {
    ask({ title: 'Очистити калькуляцію?', sub: 'Усі поля на цьому екрані будуть скинуті.', input: false, ok: 'Очистити', danger: true }, function () {
      closeAsk(); newCalc(); toast('Форму очищено');
    });
  });

  // Enter у полі інгредієнта → наступний рядок
  ib.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var tr = e.target.closest('tr');
    if (tr && tr === ib.lastElementChild) {
      var n = ingRow(null); ib.appendChild(n); $('[data-f=name]', n).focus(); recalc();
    } else if (tr && tr.nextElementSibling) {
      $('[data-f=name]', tr.nextElementSibling).focus();
    }
  });
}

/* ═════════════════ 12. Фото ═════════════════ */

function setPhoto(dataUrl) {
  calcPhoto = dataUrl || null;
  $('#photo-box').hidden = !calcPhoto;
  $('#photo-add').hidden = !!calcPhoto;
  if (calcPhoto) $('#photo-img').src = calcPhoto;
}

/**
 * Фото — одноразова явна дія, тому для вже збереженого рецепта пишемо його
 * одразу, не чекаючи «Оновити калькуляцію». Інакше виглядає так, ніби нічого
 * не сталося: картка в папці лишається без фото.
 */
function commitPhoto() {
  var ed = S.ui.editing;
  if (!ed) return false;
  var f = folderById(ed.folderId); if (!f) return false;
  var r = f.recipes.filter(function (x) { return x.id === ed.recipeId; })[0];
  if (!r) return false;
  r.photo = calcPhoto;
  if (S.ui.folderId === f.id) renderFolder();
  persist(true);
  return true;
}

function bindPhoto() {
  $('#photo-add').addEventListener('click', function () { $('#photo-input').click(); });
  $('#photo-change').addEventListener('click', function () { $('#photo-input').click(); });

  $('#photo-remove').addEventListener('click', function () {
    setPhoto(null);
    $('#photo-input').value = '';
    recalc();
    toast(commitPhoto() ? 'Фото прибрано зі збереженого рецепта' : 'Фото прибрано');
  });

  $('#photo-input').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Оберіть файл зображення'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        // стискаємо — localStorage має ліміт ~5 МБ на браузер
        var k = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        setPhoto(c.toDataURL('image/jpeg', PHOTO_Q));
        recalc();
        toast(commitPhoto() ? 'Фото додано і збережено' : 'Фото додано — збережеться разом з калькуляцією');
      };
      img.onerror = function () { toast('Не вдалося прочитати зображення'); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('Не вдалося прочитати файл'); };
    reader.readAsDataURL(file);
  });
}

/* ═════════════════ 13. Збереження в папку ═════════════════ */

var pickedFolderId = null;

function buildSaveList() {
  var list = $('#save-folders');
  list.innerHTML = '';
  pickedFolderId = (S.ui.editing && S.ui.editing.folderId) || S.ui.folderId || (S.folders[0] && S.folders[0].id) || null;

  S.folders.forEach(function (f) {
    var b = document.createElement('button');
    b.className = 'folder-opt';
    b.setAttribute('aria-pressed', f.id === pickedFolderId ? 'true' : 'false');
    b.setAttribute('data-pick', f.id);
    b.innerHTML = '<span>' + esc(f.title) + '</span>' +
                  '<span class="nav-count">' + f.recipes.length + '</span>' + ICON_TICK;
    list.appendChild(b);
  });

  var nb = document.createElement('button');
  nb.className = 'folder-opt is-new';
  nb.id = 'save-new-folder';
  nb.innerHTML = '<span>+ Нова папка</span>';
  list.appendChild(nb);
}

function bindSave() {
  var ov = $('#save-overlay');

  $('#btn-save').addEventListener('click', function () {
    var d = cleanRecipe(readCalc());
    if (!d.name) { toast('Спочатку вкажіть назву страви'); $('#calc-name').focus(); return; }
    if (!d.ing.length) { toast('Додайте хоча б один інгредієнт'); return; }

    $('#save-title').textContent = S.ui.editing ? 'Оновити калькуляцію' : 'Зберегти калькуляцію';
    $('#save-sub').textContent = '«' + d.name + '» — оберіть папку';
    buildSaveList();
    $('#save-confirm').textContent = S.ui.editing ? 'Оновити' : 'Зберегти';
    ov.classList.add('is-on');
  });

  $('#save-folders').addEventListener('click', function (e) {
    if (e.target.closest('#save-new-folder')) {
      ov.classList.remove('is-on');
      ask({ title: 'Нова папка', placeholder: 'Назва папки', ok: 'Створити' }, function (v) {
        var f = { id: uid('f'), title: v, recipes: [] };
        S.folders.push(f);
        closeAsk(); renderSidebar(); persist(true);
        buildSaveList();
        pickedFolderId = f.id;
        $$('[data-pick]').forEach(function (x) {
          x.setAttribute('aria-pressed', x.getAttribute('data-pick') === f.id ? 'true' : 'false');
        });
        ov.classList.add('is-on');
      });
      return;
    }
    var b = e.target.closest('[data-pick]'); if (!b) return;
    pickedFolderId = b.getAttribute('data-pick');
    $$('[data-pick]', $('#save-folders')).forEach(function (x) {
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
  });

  $('#save-confirm').addEventListener('click', function () {
    if (!pickedFolderId) { toast('Оберіть або створіть папку'); return; }
    var target = folderById(pickedFolderId);
    if (!target) { toast('Папку не знайдено'); return; }

    var d = cleanRecipe(readCalc());
    var ed = S.ui.editing;

    if (ed) {
      var old = folderById(ed.folderId);
      var idx = old ? old.recipes.map(function (r) { return r.id; }).indexOf(ed.recipeId) : -1;
      var rec = (idx > -1) ? old.recipes[idx] : { id: ed.recipeId };
      rec.name = d.name; rec.photo = d.photo; rec.margin = d.margin; rec.ing = d.ing; rec.exp = d.exp;
      if (old && old.id !== target.id && idx > -1) {   // перенесли в іншу папку
        old.recipes.splice(idx, 1);
        target.recipes.push(rec);
      } else if (idx === -1) {
        target.recipes.push(rec);
      }
      S.ui.editing = { folderId: target.id, recipeId: rec.id };
      toast('Оновлено — папка «' + target.title + '»');
    } else {
      var fresh = { id: uid('r'), name: d.name, photo: d.photo, margin: d.margin, ing: d.ing, exp: d.exp };
      target.recipes.push(fresh);
      S.ui.editing = { folderId: target.id, recipeId: fresh.id };
      toast('Збережено в папку «' + target.title + '»');
    }

    $('#calc-crumb').textContent = target.title;
    draftDirty = false;   // збережено — попереджати про втрату вже нема про що
    updateSaveBtn();
    ov.classList.remove('is-on');
    renderSidebar();
    if (S.ui.folderId === target.id) renderFolder();
    persist(true);
  });

  $('#save-cancel').addEventListener('click', function () { ov.classList.remove('is-on'); });
  ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('is-on'); });
}

/* ═════════════════ 14. Експорт PDF (А4) ═════════════════ */

function buildPdfDoc(d, t) {
  var wrap = document.createElement('div');
  wrap.className = 'pdf-doc';

  var rows = d.ing.map(function (i) {
    return '<tr>' +
      '<td>' + esc(i.name || '—') + '</td>' +
      '<td class="r">' + fmt(i.price) + '</td>' +
      '<td class="r">' + qtyFmt(i.pack) + ' ' + i.unit + '</td>' +
      '<td class="r">' + qtyFmt(i.qty) + ' ' + i.unit + '</td>' +
      '<td class="r b">' + fmt(ingCost(i)) + '</td>' +
      '</tr>';
  }).join('');

  var expRows = d.exp.map(function (e) {
    var label = e.mode === 'pct' ? (e.name || '—') + ' (' + qtyFmt(e.value) + '% від собівартості)' : (e.name || '—');
    return '<tr><td>' + esc(label) + '</td><td class="r b">' + fmt(expenseCost(e, t.cost)) + '</td></tr>';
  }).join('');

  wrap.innerHTML =
    '<div class="pdf-head"><span class="pdf-brand">FoodCost</span></div>' +

    // Фото поки свідомо не йде в експорт — повернемо пізніше
    '<h1 class="pdf-title">' + esc(d.name || 'Калькуляція') + '</h1>' +

    '<section class="pdf-block">' +
      '<h2 class="pdf-sec">Інгредієнти</h2>' +
      '<table class="pdf-tbl"><thead><tr>' +
        '<th>Назва</th><th class="r">Ціна упаковки</th>' +
        '<th class="r">В упаковці</th><th class="r">У страві</th><th class="r">Вартість</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pdf-subtotal"><span>Собівартість</span><b>' + money(t.cost) + '</b></div>' +
    '</section>' +

    (d.exp.length
      ? '<section class="pdf-block">' +
          '<h2 class="pdf-sec">Додаткові витрати</h2>' +
          '<table class="pdf-tbl"><thead><tr><th>Назва</th><th class="r">Сума, ' + esc(S.currency) + '</th></tr></thead>' +
          '<tbody>' + expRows + '</tbody></table>' +
          '<div class="pdf-subtotal"><span>Всього витрат</span><b>' + money(t.extra) + '</b></div>' +
        '</section>'
      : '') +

    // Собівартість і витрати вже стоять підсумками у своїх блоках — тут не дублюємо
    '<section class="pdf-block">' +
      '<h2 class="pdf-sec">Підсумок</h2>' +
      '<div class="pdf-line"><span>Разом з витратами</span><span class="v">' + money(t.sub) + '</span></div>' +
      '<div class="pdf-line"><span>Маржа ' + qtyFmt(d.margin) + '%</span><span class="v">+ ' + money(t.margin) + '</span></div>' +
      '<div class="pdf-rule"></div>' +
      '<div class="pdf-price"><span class="l">ЦІНА ПРОДАЖУ</span><span class="v">' + money(t.price) + '</span></div>' +
      ((S.round || 1) > 1
        ? '<div class="pdf-note">До прайсу зручно округлити вгору до ' + moneyShort(t.round) + '</div>'
        : '') +
    '</section>';

  return wrap;
}

/* html2pdf кладе документ на А4 з полями 12/12/14 мм → корисна площа 186×271 мм.
   Отже документ завширшки 700px має вміститися у 700 × 271/186 ≈ 1020px заввишки. */
var PDF_PAGE_H = Math.floor(700 * 271 / 186);
var PDF_STEPS = [12, 11.2, 10.4, 9.6, 9, 8.4, 7.8];

/**
 * Підганяє документ під одну сторінку, зменшуючи базовий кегль.
 * Усі розміри всередині .pdf-doc — в em, тож міняється лише одне число.
 * Повертає false, якщо не влізло навіть найдрібнішим (дуже довгий рецепт).
 */
function fitToPage(doc) {
  for (var i = 0; i < PDF_STEPS.length; i++) {
    doc.style.fontSize = PDF_STEPS[i] + 'px';
    if (doc.scrollHeight <= PDF_PAGE_H) return true;
  }
  return false;
}

var pdfName = 'калькуляція';

function openPdfPreview() {
  var d = cleanRecipe(readCalc());
  if (!d.ing.length) { toast('Немає що експортувати — додайте інгредієнти'); return; }

  pdfName = d.name || 'калькуляція';
  var stage = $('#pdf-stage');
  stage.innerHTML = '';
  var doc = buildPdfDoc(d, totals(d));
  stage.appendChild(doc);

  $('#pdf-modal-body').scrollTop = 0;
  $('#pdf-overlay').classList.add('is-on');   //міряти висоту можна лише на видимому

  var fits = fitToPage(doc);
  $('#pdf-sub').textContent = 'Формат А4 · ' + (fits ? 'одна сторінка' : 'не вміщається на одну сторінку');
}

function closePdfPreview() {
  $('#pdf-overlay').classList.remove('is-on');
  $('#pdf-stage').innerHTML = '';
}

function downloadPdf() {
  if (typeof html2pdf === 'undefined') {
    toast('Бібліотека PDF не завантажилась — перевірте інтернет');
    return;
  }
  var doc = $('.pdf-doc', $('#pdf-stage'));
  if (!doc) { toast('Немає що експортувати'); return; }

  var modal = $('.pdf-modal');
  var btn = $('#pdf-file');

  // Знімаємо прокрутку й обмеження висоти, щоб html2canvas побачив документ цілком
  modal.classList.add('is-exporting');
  $('#pdf-modal-body').scrollTop = 0;
  btn.disabled = true;
  btn.textContent = 'Готуємо…';

  function done(msg) {
    modal.classList.remove('is-exporting');
    btn.disabled = false;
    btn.textContent = 'Завантажити';
    toast(msg);
  }

  html2pdf().set({
    margin: [12, 12, 14, 12],
    filename: 'FoodCost — ' + pdfName + '.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    // scale 3 ≈ 290 dpi — на 2 дрібний текст у растрі помітно милився
    html2canvas: { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] }
  }).from(doc).save().then(function () {
    done('PDF збережено');
  })['catch'](function (err) {
    done('Не вдалося зібрати PDF: ' + (err && err.message ? err.message : 'невідома помилка'));
  });
}

function bindPdf() {
  $('#btn-pdf').addEventListener('click', openPdfPreview);
  $('#pdf-close').addEventListener('click', closePdfPreview);
  $('#pdf-file').addEventListener('click', downloadPdf);
  $('#pdf-overlay').addEventListener('click', function (e) {
    if (e.target === this) closePdfPreview();
  });
}

/* ═════════════════ 15. Резервна копія ═════════════════
   Дані лежать у localStorage — тобто в одному браузері на одному компʼютері.
   Очищення історії, інший ноутбук чи переїзд на інший домен їх не переживуть.
   Файл — єдиний спосіб забрати роботу з собою, поки немає акаунта. */

function stamp() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function exportData() {
  var blob, url, a;
  try {
    blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  } catch (e) { toast('Не вдалося зібрати файл копії'); return; }

  url = URL.createObjectURL(blob);
  a = document.createElement('a');
  a.href = url;
  a.download = 'FoodCost — копія ' + stamp() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  toast('Копію збережено у файл');
}

function recipeCount(s) {
  return s.folders.reduce(function (a, f) {
    return a + ((f.recipes && f.recipes.length) || 0);
  }, 0);
}

/** Імпорт замінює геть усе, тому спершу показуємо, що саме прийде з файла. */
function importData(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (e) { toast('Не вдалося прочитати файл — це точно копія FoodCost?'); return; }

    if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.folders)) {
      toast('Це не схоже на копію FoodCost');
      return;
    }

    var n = recipeCount(parsed);
    ask({
      title: 'Відновити з файла?',
      sub: 'З файла прийде ' + parsed.products.length + ' ' +
           plural(parsed.products.length, 'продукт', 'продукти', 'продуктів') + ' і ' +
           n + ' ' + plural(n, 'калькуляція', 'калькуляції', 'калькуляцій') +
           '. Поточні дані буде замінено — якщо вони потрібні, спершу збережіть їх у файл.',
      input: false, ok: 'Відновити', danger: true
    }, function () {
      closeAsk();
      S = normalize(parsed);
      persist(true);
      boot(true);
      toast('Дані відновлено з файла');
    });
  };
  reader.onerror = function () { toast('Не вдалося прочитати файл'); };
  reader.readAsText(file);
}

/* ═════════════════ 16. Налаштування ═════════════════ */

function applyCurrency() {
  $$('#seg-currency button').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-cur-val') === S.currency ? 'true' : 'false');
  });
  $$('#seg-round button').forEach(function (b) {
    b.setAttribute('aria-pressed', +b.getAttribute('data-round') === S.round ? 'true' : 'false');
  });
  // «₴»-варіант типу витрати показує символ валюти прямо в тексті опції — оновлюємо на вже відкритих рядках
  $$('[data-f=mode] option[value=sum]').forEach(function (o) { o.textContent = S.currency; });
}

/** Після зміни валюти/округлення перемальовуємо все, де є гроші. */
function repaintMoney() {
  applyCurrency();
  renderDatalist();
  renderExpDatalist();
  if (S.ui.folderId) renderFolder();
  if (S.ui.screen === 'calc' || $('#ing-body').children.length) {
    // recalc() завжди позначає чернетку як змінену — але зміна валюти чи
    // округлення не є правкою рецепта. Повертаємо позначку на місце, інакше
    // щойно збережена калькуляція раптом стає «незбереженою».
    var wasDirty = draftDirty;
    recalc();
    draftDirty = wasDirty;
    updateSaveBtn();
  }
}

function bindSettings() {
  $('#seg-currency').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cur-val]'); if (!b) return;
    S.currency = b.getAttribute('data-cur-val');
    repaintMoney(); persist(true);
  });

  $('#seg-round').addEventListener('click', function (e) {
    var b = e.target.closest('[data-round]'); if (!b) return;
    S.round = +b.getAttribute('data-round');
    repaintMoney(); persist(true);
  });

  $('#seg-theme').addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-val]'); if (!b) return;
    S.theme = b.getAttribute('data-theme-val');
    applyTheme(); persist(true);
  });

  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', function () { $('#import-input').click(); });
  $('#import-input').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';                       // щоб той самий файл можна було обрати вдруге
    if (f) importData(f);
  });

  $('#btn-reset').addEventListener('click', function () {
    ask({
      title: 'Скинути всі дані?',
      sub: 'База продуктів, папки й калькуляції повернуться до демо-набору. ' +
           'Це незворотно — якщо дані потрібні, спершу збережіть їх у файл.',
      input: false, ok: 'Скинути', danger: true
    }, function () {
      closeAsk();
      S = seed();
      persist(true);
      boot(true);
      toast('Дані скинуто до демо-набору');
    });
  });
}

/* ═════════════════ 16. Глобальні звʼязки ═════════════════ */

function bindGlobal() {
  // Перемикання екранів
  document.addEventListener('click', function (e) {
    var sc = e.target.closest('[data-screen]');
    if (sc) {
      var id = sc.getAttribute('data-screen');
      if (id === 'base') renderBase();
      if (id === 'expbase') renderExpBase();
      show(id);
      return;
    }
    if (e.target.closest('[data-recipe="new"]')) { newCalc(); return; }
    var td = e.target.closest('[data-todo]');
    if (td) toast(td.getAttribute('data-todo'));
  });

  // Модалка-запит
  $('#ask-ok').addEventListener('click', function () { if (askCb) askCb(); });
  $('#ask-cancel').addEventListener('click', closeAsk);
  $('#ask-overlay').addEventListener('click', function (e) { if (e.target === this) closeAsk(); });
  $('#ask-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && askCb) { e.preventDefault(); askCb(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeAsk();
      closePdfPreview();
      $('#save-overlay').classList.remove('is-on');
    }
  });

  // Не даємо зайвий раз втратити незбережену роботу
  window.addEventListener('beforeunload', function (e) {
    persist(true);   // запис відкладений на 300 мс — при перезавантаженні дописуємо одразу
    if (!draftDirty || !S.draft || !S.draft.name) return;
    if (S.ui.screen !== 'calc') return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/* ═════════════════ 17. Старт ═════════════════ */

function boot(fresh) {
  applyTheme();
  applyCurrency();
  renderSidebar();
  renderBase();
  renderExpBase();

  if (fresh) { show('home'); return; }

  var ui = S.ui || {};
  if (ui.screen === 'calc') {
    // відновлюємо незбережену чернетку
    var crumb = 'Нова калькуляція';
    if (ui.editing) { var f = folderById(ui.editing.folderId); if (f) crumb = f.title; }
    loadCalc(S.draft || { name: '', margin: 50, ing: [], exp: [] }, crumb);
    show('calc', null);
  } else if (ui.screen === 'folder' && folderById(ui.folderId)) {
    openFolder(ui.folderId);
  } else if (ui.screen && $('#s-' + ui.screen)) {
    show(ui.screen);
  } else {
    show('home');
  }
}

function init() {
  toastEl = $('#toast');
  S = normalize(readStore() || seed());

  bindGlobal();
  bindBase();
  bindExpBase();
  bindFolder();
  bindCalc();
  bindPhoto();
  bindSave();
  bindPdf();
  bindSettings();

  boot(false);
  persist(true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
