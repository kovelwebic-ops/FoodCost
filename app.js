/* ============================================================
   FoodCost — логіка MVP
   Дані живуть у браузері локально (localStorage): закрив вкладку — дані на місці.
   ============================================================ */
(function () {
'use strict';

/* ═════════════════ 1. Константи ═════════════════ */

var STORE_KEY = 'fc:state:v1';
/* Окремо від стану: «Скинути дані» чи відновлення з файла не мають повертати запрошення */
var INVITE_KEY = 'fc:invite:v1';
var UNITS = ['г', 'мл', 'шт'];

/* Усі 14 алергенів зі стандарту ЄС (Регламент 1169/2011) — той самий перелік,
   що на етикетках і в Open Food Facts. Порядок не абетковий: спершу ті, що в
   кондитерці трапляються щодня, далі решта. Решту (мед, какао, цитрусові…)
   людина вписує сама, і в продукті вони лежать текстом. */
var ALLERGENS = [
  ['gluten', 'Глютен'], ['eggs', 'Яйця'], ['milk', 'Молоко'], ['nuts', 'Горіхи'],
  ['peanuts', 'Арахіс'], ['soy', 'Соя'], ['sesame', 'Кунжут'], ['sulphites', 'Сульфіти'],
  ['mustard', 'Гірчиця'], ['celery', 'Селера'], ['lupin', 'Люпин'], ['fish', 'Риба'],
  ['crustaceans', 'Ракоподібні'], ['molluscs', 'Молюски']
];
/* Гачок для перейменованих або вилучених ключів: старе значення → нинішня назва.
   Зараз порожній — сім ключів, що тут лежали, повернулись у ALLERGENS вище, і
   старі дані з ними знову збігаються з базовими. */
var LEGACY_ALLERGENS = {};
var NUT_KEYS = [['kcal', 'Ккал'], ['prot', 'Білки'], ['fat', 'Жири'], ['carb', 'Вуглеводи']];

/* Open Food Facts — відкрита база фасованих продуктів. Ключ не потрібен,
   запит іде з браузера користувача, бекенду в нас як не було, так і немає.
   Джерело даних вказане в налаштуваннях та в інструкції (ліцензія ODbL). */
var OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
/* Їхні теґи алергенів — свої. Зводимо до наших ключів або до звичайних
   українських назв; далі normalizeAllergens() сам розбереться, що з них
   базове, а що своє. Невідомий теґ лишаємо читабельним рядком, а не губимо:
   «є щось англійською» краще, ніж мовчазно втрачений алерген. */
var OFF_ALLERGENS = {
  gluten: 'gluten', eggs: 'eggs', milk: 'milk',
  nuts: 'nuts', 'tree-nuts': 'nuts', peanuts: 'peanuts',
  soybeans: 'soy', soy: 'soy', 'sesame-seeds': 'sesame', sesame: 'sesame',
  celery: 'celery', mustard: 'mustard', fish: 'fish', lupin: 'lupin',
  crustaceans: 'crustaceans', molluscs: 'molluscs',
  'sulphur-dioxide-and-sulphites': 'sulphites', sulphites: 'sulphites',
  lactose: 'Лактоза', wheat: 'Пшениця', barley: 'Ячмінь', oats: 'Овес', rye: 'Жито',
  almonds: 'Мигдаль', hazelnuts: 'Фундук', walnuts: 'Волоські горіхи',
  'cashew-nuts': 'Кешʼю', pistachios: 'Фісташки', 'macadamia-nuts': 'Макадамія'
};
var PHOTO_MAX = 720;     // px — до цього розміру стискаємо фото
var PHOTO_Q = 0.72;      // якість jpeg

var ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
var ICON_TICK = '<svg class="tick" viewBox="0 0 24 24"><path d="m5 13 4.5 4.5L19 7"/></svg>';
var ICON_CHEV = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
var ICON_SYNC = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14-4.5L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14 4.5l2-2.5"/><path d="M20 19v-4h-4"/></svg>';

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
 *   product = { id, name, price, pack, unit, nutrition, allergens, pieceWeight }
 *     nutrition = null | { kcal, prot, fat, carb }      ← на 100 г; поле null — не вписане, у сумі 0
 *     allergens = null (не вказано) | [] (немає) | ['gluten', 'Мед', …] — ключ базового або назва свого
 *     pieceWeight = вага 1 шт у грамах, потрібна лише штучним продуктам
 *   ingredient = { name, price, pack, unit, qty, g? }   ← копія даних, не посилання
 *   expense = { name, mode, value }   mode: 'sum' (валюта) | 'pct' (% від собівартості)
 *   prep = { id, name, ing[], yield, unit }            ← напівфабрикат (тісто, крем)
 *   group = { id, prepId, name, take, of, unit }       ← напівфабрикат у рецепті
 *   recipe = { id, name, photo, margin, ing[], exp[], groups[], outWeight }
 *   folder = { id, title, recipes[] }
 *
 * Ціна в рецепті — копія, а КБЖУ й алергени — ні: їх беремо з бази за назвою
 * в момент показу. Ціна — це знімок, за яким рахували клієнту, і вона має
 * право застаріти. А глютен у борошні заднім числом не змінюється, тож
 * копія тут дала б лише ще одне джерело розбіжностей.
 *
 * Напівфабрикат у рецепті не згортається в один рядок: його складники лежать
 * у тому ж r.ing плоским списком і позначені міткою i.g = group.id. Завдяки
 * цьому totals(), cleanRecipe() і збірка PDF бачать звичайний список рядків
 * і нічого не знають про групи — про них знає лише промальовка таблиці.
 */
function emptyState() {
  return {
    currency: '₴',
    round: 5,
    theme: 'light',
    showNutrition: false,                          // КБЖУ й алергени потрібні не всім
    nutAsked: false,                               // чи вже пропонували ввімкнути КБЖУ в базі
    products: [],
    expenseBase: [],
    preps: [],
    folders: [],
    draft: null,                                   // незбережена калькуляція
    ui: { screen: 'home', folderId: null, editing: null, folderQuery: '', folderSort: 'name', folderCols: 1 }
  };
}

/* ═════════════════ 3a. Тема ═════════════════ */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.theme === 'dark' ? 'dark' : 'light');
  $$('#seg-theme button').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-theme-val') === S.theme ? 'true' : 'false');
  });
}

/* Один клас на <html> ховає або показує всі харчові блоки разом —
   без перемальовування екранів і без втрати вже внесених даних. */
function applyNutrition() {
  document.documentElement.classList.toggle('nut-on', !!S.showNutrition);
  $$('#seg-nut button').forEach(function (b) {
    b.setAttribute('aria-pressed', (b.getAttribute('data-nut-val') === 'on') === !!S.showNutrition ? 'true' : 'false');
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
  if (typeof s.showNutrition !== 'boolean') s.showNutrition = false;
  // Пропозицію ввімкнути КБЖУ показуємо один раз; тим, у кого воно вже ввімкнене, — ніколи
  if (typeof s.nutAsked !== 'boolean') s.nutAsked = !!s.showNutrition;
  if (!s.ui.folderSort) s.ui.folderSort = 'name';
  if (s.ui.folderQuery == null) s.ui.folderQuery = '';
  if (s.ui.folderCols !== 2) s.ui.folderCols = 1;   // картки папки на телефоні: 1 або 2 колонки
  if (!s.products) s.products = [];
  if (!s.expenseBase) s.expenseBase = [];   // до появи бази витрат поля не було
  if (!s.preps) s.preps = [];               // до появи напівфабрикатів поля не було
  if (!s.folders) s.folders = [];
  s.products.forEach(normalizeProduct);
  s.preps.forEach(function (p) {
    if (!p.ing) p.ing = [];
    if (!p.unit) p.unit = 'г';
    if (p['yield'] == null) p['yield'] = 0;
  });
  s.folders.forEach(function (f) {
    if (!f.recipes) f.recipes = [];
    f.recipes.forEach(function (r) {
      if (!r.ing) r.ing = [];
      if (!r.exp) r.exp = [];
      if (!r.groups) r.groups = [];
      r.outWeight = num(r.outWeight);
      migrateExpenseList(r.exp);
    });
  });
  if (s.draft) {
    migrateExpenseList(s.draft.exp);
    if (!s.draft.groups) s.draft.groups = [];
    s.draft.outWeight = num(s.draft.outWeight);
  }
  return s;
}

/**
 * Харчові поля продукту. Файл резервної копії могли відредагувати руками,
 * тож перевіряємо типи, а не лише наявність: сміття в алергенах тут
 * небезпечніше за сміття в ціні — воно тихо зникає зі списку.
 */
function normalizeProduct(p) {
  var n = p.nutrition, clean = null;
  if (n && typeof n === 'object') {
    clean = {};
    NUT_KEYS.forEach(function (k) { clean[k[0]] = nutValue(n[k[0]]); });
    if (NUT_KEYS.every(function (k) { return clean[k[0]] == null; })) clean = null;
  }
  p.nutrition = clean;
  p.allergens = Array.isArray(p.allergens) ? normalizeAllergens(p.allergens) : null;
  p.pieceWeight = num(p.pieceWeight);
  // Штрихкод: лише цифри. Потрібен, щоб той самий продукт не завели двічі
  p.code = typeof p.code === 'string' || typeof p.code === 'number'
    ? String(p.code).replace(/\D/g, '').slice(0, 14) : '';
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
  // Харчова цінність на 100 г: [ккал, білки, жири, вуглеводи, алергени, вага 1 шт]
  // «Барвник гелевий» тут навмисно відсутній: на таких упаковках складу часто
  // немає, і демо одразу показує, як виглядає попередження «не вказано».
  var N = {
    'Борошно вищий ґатунок': [334, 10.3, 1.1, 70.6, ['gluten']],
    'Мигдальне борошно': [579, 21.2, 49.9, 21.6, ['nuts']],
    'Цукор білий': [399, 0, 0, 99.8, []],
    'Цукрова пудра': [399, 0, 0, 99.8, []],
    'Масло вершкове 82%': [748, 0.5, 82.5, 0.8, ['milk']],
    'Олія соняшникова': [899, 0, 99.9, 0, []],
    'Яйця С1': [157, 12.7, 11.5, 0.7, ['eggs'], 52],
    'Молоко 2,5%': [52, 2.8, 2.5, 4.7, ['milk']],
    'Вершки 33%': [322, 2.2, 33, 3.3, ['milk']],
    'Згущене молоко': [320, 7.2, 8.5, 56, ['milk']],
    'Сир вершковий': [342, 6, 34, 4, ['milk']],
    'Мед натуральний': [329, 0.8, 0, 81.5, []],
    'Шоколад чорний 70%': [580, 8, 42, 33, ['soy']],
    'Ванільний екстракт': [288, 0.1, 0.1, 12.7, []],
    'Полуниця заморожена': [32, 0.7, 0.3, 7.7, []],
    'Морква': [41, 0.9, 0.2, 9.6, []],
    'Волоські горіхи': [654, 15.2, 65.2, 13.7, ['nuts']],
    'Імбир мелений': [335, 9, 4.2, 71.6, []],
    'Кориця мелена': [247, 4, 1.2, 80.6, []]
  };
  s.products = P.map(function (p) {
    var n = N[p[0]];
    return {
      id: uid('p'), name: p[0], price: p[1], pack: p[2], unit: p[3],
      nutrition: n ? { kcal: n[0], prot: n[1], fat: n[2], carb: n[3] } : null,
      allergens: n ? n[4] : null,
      pieceWeight: n && n[5] ? n[5] : 0
    };
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

  // Напівфабрикати: [назва, вихід, одиниця, [[назва, ціна уп., к-сть в уп., од., у заміс], …]]
  var K = [
    ['Медове тісто', 1200, 'г', [
      ['Борошно вищий ґатунок', 45, 1000, 'г', 400],
      ['Мед натуральний', 180, 500, 'г', 150],
      ['Цукор білий', 32, 1000, 'г', 150],
      ['Масло вершкове 82%', 118, 200, 'г', 100],
      ['Яйця С1', 68, 10, 'шт', 2]
    ]],
    ['Крем-чіз на вершках', 800, 'г', [
      ['Сир вершковий', 145, 340, 'г', 340],
      ['Вершки 33%', 89, 500, 'мл', 300],
      ['Цукрова пудра', 46, 500, 'г', 90],
      ['Ванільний екстракт', 210, 50, 'мл', 5]
    ]]
  ];
  s.preps = K.map(function (k) {
    return {
      id: uid('k'), name: k[0], 'yield': k[1], unit: k[2],
      ing: k[3].map(function (i) {
        return { name: i[0], price: i[1], pack: i[2], unit: i[3], qty: i[4] };
      })
    };
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

/** Собівартість усього замісу напівфабрикату. */
function prepCost(p) {
  var sum = 0;
  for (var i = 0; i < p.ing.length; i++) sum += ingCost(p.ing[i]);
  return sum;
}

/** Ціна однієї одиниці виходу — з неї рахується вартість у страві. */
function prepUnitCost(p) {
  var y = num(p['yield']);
  return y > 0 ? prepCost(p) / y : 0;
}

/* Порівняльна ціна для списку. Грами й мілілітри показуємо за 100 —
   «0,22 ₴/г» після округлення до копійок перетворює дешеві заготовки
   на однакові нулі. Для штук за 100 рахувати безглуздо. */
function prepUnitLabel(p) {
  return p.unit === 'шт' ? 'За 1 шт' : 'За 100 ' + p.unit;
}
function prepUnitValue(p) {
  return prepUnitCost(p) * (p.unit === 'шт' ? 1 : 100);
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
function prepById(id) { return byId(S.preps, id); }
function findProduct(name) { return byName(S.products, name); }
function findExpense(name) { return byName(S.expenseBase, name); }

/* ═════════════════ 5a. Звірка з базами ═════════════════
   Рецепт зберігає копію даних продукту, а не посилання — тому подорожчання
   борошна не міняє вже збережені калькуляції заднім числом. Це навмисно:
   збережена калькуляція — знімок, за яким виставили ціну клієнту. Але коли
   ціни таки треба підтягнути, це має бути одна свідома дія. */

/** Порівняння грошей і кількостей: обидва числа пройшли num(), різниця нижче копійки — те саме. */
function same(a, b) { return Math.abs(num(a) - num(b)) < 0.0005; }

function nameKey(n) { return String(n || '').trim().toLowerCase(); }

/**
 * Індекс «назва → запис бази». Звірка проходить по всіх рецептах на кожну
 * правку ціни, а byName() сканує базу лінійно — на сотні продуктів це вже
 * помітно гальмувало б набір тексту.
 * Перший запис виграє, як і в byName().
 */
function baseIndex() {
  var pi = Object.create(null), ei = Object.create(null);
  S.products.forEach(function (p) { var k = nameKey(p.name); if (k && !pi[k]) pi[k] = p; });
  S.expenseBase.forEach(function (x) { var k = nameKey(x.name); if (k && !ei[k]) ei[k] = x; });
  return { p: pi, e: ei };
}

/**
 * Звіряє рядки рецепта з базами продуктів і витрат.
 * dry = true — тільки рахує, нічого не міняє.
 *
 * Кількість у страві не чіпаємо ніколи — вона належить рецепту, а не базі.
 * Якщо в базі змінилась одиниця виміру, рядок пропускаємо: 300 «г» не можна
 * механічно перечитати як 300 «шт», і мовчки зіпсувати грамовку гірше, ніж
 * лишити стару ціну.
 */
function syncWithBase(r, dry, idx) {
  idx = idx || baseIndex();
  var changed = 0, skipped = 0;

  (r.ing || []).forEach(function (i) {
    var p = idx.p[nameKey(i.name)];
    if (!p) return;                                   // рядок не з бази — це власний інгредієнт
    if (p.unit !== i.unit) { skipped++; return; }
    if (same(p.price, i.price) && same(p.pack, i.pack)) return;
    changed++;
    if (!dry) { i.price = p.price; i.pack = p.pack; }
  });

  (r.exp || []).forEach(function (e) {
    var x = idx.e[nameKey(e.name)];
    if (!x) return;
    if (x.mode === e.mode && same(x.value, e.value)) return;
    changed++;
    if (!dry) { e.mode = x.mode; e.value = x.value; }
  });

  return { changed: changed, skipped: skipped };
}

/**
 * Скільки збереженого рахується за застарілими цінами.
 * Напівфабрикати рахуємо нарівні з рецептами: вони теж зберігають копії
 * цін, і якщо їх не оновити, кожна наступна вставка в калькуляцію знову
 * принесе стару ціну.
 */
function staleCount() {
  var idx = baseIndex(), recipes = 0, preps = 0;
  S.folders.forEach(function (f) {
    f.recipes.forEach(function (r) {
      if (syncWithBase(r, true, idx).changed) recipes++;
    });
  });
  S.preps.forEach(function (p) {
    if (syncWithBase(p, true, idx).changed) preps++;
  });
  return { recipes: recipes, preps: preps, total: recipes + preps };
}

/** «9 калькуляцій і 2 напівфабрикати» — залежно від того, що саме застаріло. */
function staleLabel(c) {
  var parts = [];
  if (c.recipes) parts.push(c.recipes + ' ' + plural(c.recipes, 'калькуляція', 'калькуляції', 'калькуляцій'));
  if (c.preps) parts.push(c.preps + ' ' + plural(c.preps, 'напівфабрикат', 'напівфабрикати', 'напівфабрикатів'));
  return parts.join(' і ');
}

/* ═════════════════ 5b. Харчова цінність і алергени ═════════════════
   Вмикається в налаштуваннях. Дані живуть у продуктах бази, а калькуляція
   й напівфабрикат лише складають їх за грамовками своїх рядків. */

var NUT_ROWS = [['kcal', 'Калорійність', ' ккал', 0], ['prot', 'Білки', ' г', 1],
                ['fat', 'Жири', ' г', 1], ['carb', 'Вуглеводи', ' г', 1]];

/** Ключ для порівняння: у базового — його код, у свого — назва без регістру й зайвих пробілів. */
function alKey(item) {
  var s = String(item).trim();
  if (ALLERGENS.some(function (a) { return a[0] === s; })) return s;
  return 'c:' + s.replace(/\s+/g, ' ').toLowerCase();
}

function isCustomAllergen(item) { return alKey(item).indexOf('c:') === 0; }

function alLabel(item) {
  var b = ALLERGENS.filter(function (a) { return a[0] === item; })[0];
  return b ? b[1] : item;
}

/**
 * Прибирає дублікати й сміття; базові йдуть першими в порядку ALLERGENS,
 * свої — за ними в порядку появи. Колишні стандартні ключі стають своїми
 * з людською назвою, а вписане «молоко» — базовим ключем: інакше в
 * калькуляції стояло б два «Молоко».
 */
function normalizeAllergens(list) {
  var basic = {}, custom = [], seen = {};
  list.forEach(function (raw) {
    if (typeof raw !== 'string') return;
    var s = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!s) return;
    if (LEGACY_ALLERGENS[s]) s = LEGACY_ALLERGENS[s];
    var low = s.toLowerCase();
    var hit = ALLERGENS.filter(function (a) { return a[0] === s || a[1].toLowerCase() === low; })[0];
    if (hit) { basic[hit[0]] = 1; return; }
    if (seen[low]) return;
    seen[low] = 1;
    custom.push(s);
  });
  return ALLERGENS.filter(function (a) { return basic[a[0]]; })
    .map(function (a) { return a[0]; })
    .concat(custom);
}

var sessionAllergens = [];   // свої, вписані за цей сеанс: чип не зникає, щойно його зняли

/** Свої алергени з усієї бази — вписаний раз стає вибором і в інших продуктах. */
function customAllergens() {
  var all = sessionAllergens.slice();
  S.products.forEach(function (p) {
    (p.allergens || []).forEach(function (a) { if (isCustomAllergen(a)) all.push(a); });
  });
  var seen = {};
  return all.filter(function (a) {
    var k = alKey(a);
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  }).sort(function (a, b) { return a.localeCompare(b, 'uk'); });
}

/**
 * Скільки грамів дає рядок. Мілілітри рахуємо за грами: у вершків і молока
 * похибка до 3%, для кондитерської калькуляції це нічого не міняє. Штуки —
 * через вагу 1 шт продукту. null — вагу визначити не можна.
 */
function rowGrams(i, p) {
  var qty = num(i.qty);
  if (i.unit !== 'шт') return qty;
  return p && num(p.pieceWeight) > 0 ? qty * num(p.pieceWeight) : null;
}

/**
 * Складає КБЖУ й алергени рядків калькуляції чи напівфабрикату.
 * noNut / noAl — чого бракує, поіменно і з id продукту в базі (null, якщо
 * рядка в базі немає): «для 2 продуктів не вказано» без імен змушувало б шукати.
 */
function nutritionOf(rows) {
  var idx = baseIndex();
  var t = { kcal: 0, prot: 0, fat: 0, carb: 0, mass: 0, rows: 0, counted: 0,
            allergens: [], alKnown: 0, noNut: [], noAl: [] };
  var alSet = {}, seenNut = {}, seenAl = {};

  rows.forEach(function (i) {
    var name = String(i.name || '').trim();
    if (!name && !num(i.qty)) return;
    t.rows++;
    var p = name ? idx.p[nameKey(name)] : null;
    var miss = { label: name || 'рядок без назви', id: p ? p.id : null };

    // Продукт у кількох рядках (у групі й поза нею) згадуємо один раз.
    // Безіменні рядки не зливаємо: це різні невідомі складники
    var report = function (list, seen) {
      var key = name ? nameKey(name) : null;
      if (key && seen[key]) return;
      if (key) seen[key] = 1;
      list.push(miss);
    };

    var grams = rowGrams(i, p);
    if (grams != null) t.mass += grams;

    if (p && p.nutrition && grams != null) {
      NUT_KEYS.forEach(function (n) { t[n[0]] += num(p.nutrition[n[0]]) * grams / 100; });
      t.counted++;
    } else {
      report(t.noNut, seenNut);
    }

    // «Не вказано» і «немає» — різні речі: порожній список у продукту без
    // даних читався б як «алергенів немає», а в тому борошні глютен
    if (p && Array.isArray(p.allergens)) {
      t.alKnown++;
      // Ключ — без регістру: «Мед» в одному продукті й «мед» в іншому — один алерген
      p.allergens.forEach(function (a) { var k = alKey(a); if (!alSet[k]) alSet[k] = a; });
    } else {
      report(t.noAl, seenAl);
    }
  });

  // Базові — у звичному порядку, свої — за абеткою після них
  var customs = Object.keys(alSet)
    .filter(function (k) { return k.indexOf('c:') === 0; })
    .map(function (k) { return [alSet[k], alSet[k]]; })
    .sort(function (a, b) { return a[1].localeCompare(b[1], 'uk'); });
  t.allergens = ALLERGENS.filter(function (a) { return alSet[a[0]]; }).concat(customs);
  return t;
}

/** Для кнопки в базі: 'full' — є все, що потрібно калькуляції; 'part' — щось є; 'none' — нічого. */
function nutState(p) {
  var nutOk = !!p.nutrition && (p.unit !== 'шт' || num(p.pieceWeight) > 0);
  var alOk = Array.isArray(p.allergens);
  if (nutOk && alOk) return 'full';
  return (p.nutrition || alOk || num(p.pieceWeight) > 0) ? 'part' : 'none';
}

/** Поле КБЖУ: null — не вписане, 0 — вписаний нуль (у цукру справді 0 білків). */
function nutValue(v) { return v == null || v === '' ? null : num(v); }

/** Текст у полі: вписаний нуль показуємо як «0», невписане лишаємо порожнім. */
function nutFieldText(p, key) {
  var v = p.nutrition ? p.nutrition[key] : null;
  return v == null ? '' : String(Math.round(num(v) * 10) / 10).replace('.', ',');
}

function nutNum(v, dec) {
  var r = dec ? Math.round(v * 10) / 10 : Math.round(v);
  var parts = String(r).split('.');
  return parts[0].replace(/\B(?=(\d{3})+$)/g, ' ') + (parts[1] ? ',' + parts[1] : '');
}

/* ── Редактор харчових даних продукту ─────────────────────────────
   Той самий блок живе у двох місцях: під рядком бази продуктів і в модалці,
   що відкривається прямо з калькуляції. Модалка — не зручність, а потреба:
   перехід у базу з незбереженої калькуляції прибирає її з екрана. */

/* ── Пошук за штрихкодом (Open Food Facts) ───────────────────────
   Заповнює назву, вагу упаковки, КБЖУ й алергени. Ціну — ніколи: вона в
   кожному магазині своя. Знайдене заміняє наявне без підтверджень (окрім
   назви — див. offApply), а той самий товар двічі в базу не пускає. */

/**
 * Контрольна цифра GS1: цифри справа наліво з вагами 3,1,3,1… Один і той
 * самий розрахунок для EAN-8, UPC-A, EAN-13 та ITF-14.
 */
function offCheckDigit(code) {
  var body = code.slice(0, -1), sum = 0, w = 3;
  for (var i = body.length - 1; i >= 0; i--) {
    sum += +body.charAt(i) * w;
    w = w === 3 ? 1 : 3;
  }
  return String((10 - sum % 10) % 10);
}

/**
 * Розбирає введений штрихкод. Помилку краще показати одразу, ніж питати
 * базу даремно: описка в цифрі дає таке саме «немає в базі», як і реально
 * відсутній товар, і людина шукає проблему не там.
 * Нестандартні довжини (напр. 11 цифр) пропускаємо — база вміє їх доповнювати.
 */
function offParseCode(raw) {
  var s = String(raw || '').replace(/[\s\-–—]/g, '');
  if (!s) return { err: 'len' };
  if (/\D/.test(s)) return { err: 'chars' };
  if (s.length < 8 || s.length > 14) return { err: 'len' };
  if ([8, 12, 13, 14].indexOf(s.length) !== -1 && offCheckDigit(s) !== s.charAt(s.length - 1)) {
    return { err: 'check' };
  }
  return { code: s };
}

function offNum(v) {
  if (v == null || v === '') return null;
  var n = num(v);
  return n > 0 ? Math.round(n * 10) / 10 : (n === 0 ? 0 : null);
}

/** Теґ 'en:sesame-seeds' → наш ключ, наша назва або читабельний запас. */
function offAllergenItems(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(function (t) {
    var key = String(t).replace(/^[a-z]{2}:/, '');
    if (OFF_ALLERGENS[key]) return OFF_ALLERGENS[key];
    var s = key.replace(/-/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }).filter(Boolean);
}

/**
 * Вага упаковки. Основне — числове product_quantity з одиницею; якщо його
 * немає, розбираємо текст «400 g e». Кілограми й літри зводимо до г і мл,
 * бо в застосунку одиниці саме такі. Часто ваги в базі просто немає.
 */
function offPack(prod) {
  var v = num(prod.product_quantity);
  var u = String(prod.product_quantity_unit || '').toLowerCase();
  if (!(v > 0)) {
    var m = String(prod.quantity || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|кг|g|г|ml|мл|l|л)\b/i);
    if (m) { v = num(m[1]); u = m[2].toLowerCase(); }
  }
  if (!(v > 0) || v > 100000) return null;
  if (u === 'kg' || u === 'кг') return { pack: v * 1000, unit: 'г' };
  if (u === 'l' || u === 'л') return { pack: v * 1000, unit: 'мл' };
  if (u === 'ml' || u === 'мл') return { pack: v, unit: 'мл' };
  if (u === 'g' || u === 'г' || !u) return { pack: v, unit: 'г' };
  return null;   // штуки, порції та інша екзотика — надійніше вписати руками
}

/** Витягує з відповіді лише те, що вміє показати застосунок. */
function offRead(prod) {
  var n = prod.nutriments || {};
  var nut = {
    kcal: offNum(n['energy-kcal_100g']),
    prot: offNum(n.proteins_100g),
    fat: offNum(n.fat_100g),
    carb: offNum(n.carbohydrates_100g)
  };
  var has = NUT_KEYS.some(function (k) { return nut[k[0]] != null; });
  return {
    name: String(prod.product_name_uk || prod.product_name || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    pack: offPack(prod),
    nutrition: has ? nut : null,
    allergens: offAllergenItems(prod.allergens_tags)
  };
}

/** Назва й упаковка живуть у рядку продукту, а не в редакторі — оновлюємо їх там. */
function offSyncRow(box, p) {
  var tr = box.closest('tr');
  var main = tr && tr.previousElementSibling;
  if (main && main.getAttribute('data-id') === p.id) {
    var nameInp = $('[data-f=name]', main);
    var packInp = $('[data-f=pack]', main);
    var unitSel = $('[data-f=unit]', main);
    if (nameInp) nameInp.value = p.name;
    if (packInp) packInp.value = qtyFmt(p.pack);
    if (unitSel) unitSel.value = p.unit;
    paintPeek(main, p.name, productSum(p));
  }
  if (box.id === 'nut-modal-edit') $('#nut-title').textContent = p.name || 'Продукт';
  renderDatalist();
}

/* XHR, а не fetch: тут потрібен свій таймаут, а він у XHR вбудований.
   done(err, product): err — 'none' (немає в базі), 'net' (не достукались). */
function offLookup(code, done) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', OFF_URL + encodeURIComponent(code) +
    '.json?fields=product_name,product_name_uk,quantity,product_quantity,product_quantity_unit,nutriments,allergens_tags', true);
  xhr.timeout = 12000;
  xhr.onload = function () {
    // 404 — продукту справді немає; 500/503/429 — це збій на їхньому боці,
    // і писати «немає в базі» було б брехнею: сервер просто не відповів
    if (xhr.status === 404) { done('none'); return; }
    if (xhr.status !== 200) { done('net'); return; }
    var data = null;
    try { data = JSON.parse(xhr.responseText); } catch (e) { /* нижче */ }
    // Не JSON — щось не те зі звʼязком; валідна відповідь без продукту
    // означає саме «немає в базі», навіть якщо код відповіді 200
    if (!data) { done('net'); return; }
    if (data.status !== 1 || !data.product) { done('none'); return; }
    done(null, data.product);
  };
  xhr.onerror = function () { done('net'); };
  xhr.ontimeout = function () { done('net'); };
  xhr.send();
}

function offNote(box, html, warn) {
  var el = $('[data-off-note]', box);
  el.innerHTML = html || '';
  el.className = 'off-note' + (warn ? ' is-warn' : '');
  el.hidden = !html;
}

/**
 * Пише знайдене в продукт. Новий штрихкод — новий продукт у цьому рядку,
 * тож вага, КБЖУ й алергени просто заміняються, без запитань.
 *
 * Виняток — назва: її пишемо лише в порожнє поле. Рецепти знаходять продукт
 * у базі за назвою (звірка цін, КБЖУ, алергени), і перейменування тихо
 * відірвало б від нього збережені калькуляції.
 *
 * Алергени беруться з бази цілком: є список — ставимо його, немає — ставимо
 * «Без алергенів» (рішення власника 16.09). Це єдине місце, де `[]` виникає
 * не з рук людини, тому в примітці завжди стоїть прохання звірити з етикеткою:
 * у Open Food Facts порожнє поле частіше означає «ніхто не вніс», ніж «немає».
 */
function offApply(box, p, d, code, onChange) {
  var filled = [];
  p.code = code;
  if (d.name && !String(p.name || '').trim()) { p.name = d.name; filled.push('назву'); }
  if (d.pack) {
    p.pack = d.pack.pack;
    p.unit = d.pack.unit;
    filled.push('упаковку');
  }
  if (d.nutrition) { p.nutrition = d.nutrition; filled.push('КБЖУ'); }
  p.allergens = d.allergens.length ? normalizeAllergens(d.allergens) : [];
  if (d.allergens.length) filled.push('алергени');
  normalizeProduct(p);
  fillNutEditor(box, p);
  offSyncRow(box, p);
  persist();
  onChange(p, box);

  var tail = [];
  // «Без алергенів» з бази — найризикованіше зі знайденого: просить звірки завжди
  if (!d.allergens.length) tail.push('алергенів у базі немає, поставили «Без алергенів» — звірте з етикеткою');
  if (!d.pack) tail.push('ваги упаковки в базі немає');
  if (d.name && String(p.name || '').trim() && String(p.name).trim().toLowerCase() !== d.name.toLowerCase()) {
    tail.push('у базі назва «' + esc(d.name) + '» — вашу лишили');
  }
  if (p.unit === 'шт' && !num(p.pieceWeight)) tail.push('впишіть вагу 1 шт');
  offNote(box, 'Заповнено з Open Food Facts: <b>' + esc(d.name || 'без назви') + '</b>' +
    (filled.length ? ' — ' + filled.join(', ') : '') + '. Перевірте значення' +
    (tail.length ? ': ' + tail.join('; ') : '') + '.');
}

/**
 * Чи є цей продукт у базі ще раз. За штрихкодом — надійно; за назвою — для
 * продуктів, заведених до того, як штрихкоди почали зберігатись.
 */
function offDuplicate(p, code, name) {
  var nm = String(name || '').trim().toLowerCase();
  return S.products.filter(function (x) {
    if (x.id === p.id) return false;
    if (code && x.code === code) return true;
    return !!nm && String(x.name || '').trim().toLowerCase() === nm;
  })[0] || null;
}

var OFF_CODE_ERR = {
  chars: 'У штрихкоді тільки цифри — перевірте, чи не закралась буква',
  len: 'Штрихкод — це 8–14 цифр під смужками на упаковці',
  check: 'Схоже, у штрихкоді помилка — звірте цифри з упаковкою'
};

function offSearch(box, p, onChange) {
  var inp = $('[data-off-code]', box), btn = $('[data-off-find]', box);
  var parsed = offParseCode(inp.value);
  var code = parsed.code;
  if (!code) {
    offNote(box, OFF_CODE_ERR[parsed.err] || OFF_CODE_ERR.len, true);
    inp.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Шукаю…';
  offNote(box, '');
  offLookup(code, function (err, prod) {
    btn.disabled = false;
    btn.textContent = 'Знайти';
    if (err === 'none') {
      // Це звичайна справа, а не збій: база неповна, багатьох товарів у ній просто немає
      offNote(box, 'Немає в базі Open Food Facts — там є не всі товари. ' +
        'Впишіть дані з етикетки вручну', true);
      return;
    }
    if (err) {
      offNote(box, 'Не вдалося звʼязатися з базою. Перевірте інтернет і спробуйте ще раз', true);
      return;
    }
    var d = offRead(prod);
    if (!d.nutrition && !d.allergens.length && !d.pack) {
      offNote(box, 'Знайшли «' + esc(d.name || 'без назви') + '», але даних про нього в базі немає', true);
      return;
    }
    // Той самий продукт двічі в базі — гірше, ніж незаповнений рядок: рецепти
    // шукають продукт за назвою й натраплять на випадковий із двох
    var dup = offDuplicate(p, code, d.name);
    if (dup) {
      offNote(box, '«' + esc(dup.name || 'без назви') + '» уже є в базі — не заповнювали, ' +
        'щоб не було двох однакових продуктів. Видаліть цей рядок і правте той, що вже є', true);
      return;
    }
    offApply(box, p, d, code, onChange);
  });
}

function nutEditorHtml() {
  return '<div class="nut-off">' +
      '<span class="nut-cap">Штрихкод</span>' +
      '<span class="off-body">' +
        '<span class="off-row">' +
          // maxlength із запасом: 14 цифр плюс пробіли й дефіси, якщо їх набрали
          // так, як надруковано на упаковці — offParseCode їх однаково прибере
          '<input class="inp off-inp" data-off-code inputmode="numeric" enterkeyhint="search" ' +
            'maxlength="20" autocomplete="off" placeholder="Цифри з упаковки">' +
          '<button type="button" class="btn btn-soft off-btn" data-off-find>Знайти</button>' +
        '</span>' +
        '<span class="off-note" data-off-note hidden></span>' +
      '</span>' +
    '</div>' +
    '<div class="nut-fields">' +
      '<span class="nut-cap">На 100 г</span>' +
      NUT_KEYS.map(function (n) {
        return '<label class="nut-f"><span>' + n[1] + '</span>' +
          '<input class="inp is-num" data-n="' + n[0] + '" inputmode="decimal" autocomplete="off" placeholder="—"></label>';
      }).join('') +
      '<label class="nut-f" data-pw-wrap><span>Вага 1 шт</span><span class="qty-wrap">' +
        '<input class="inp is-num" data-pw inputmode="decimal" autocomplete="off" placeholder="—"><span class="unit-tag">г</span></span></label>' +
    '</div>' +
    '<div class="nut-al">' +
      '<span class="nut-cap">Алергени</span>' +
      '<span class="al-body">' +
        // Чипи малює paintAllergens: свої алергени зʼявляються разом із базою
        '<span class="chips" data-al-chips></span>' +
        '<input class="inp al-add" data-al-add maxlength="40" autocomplete="off" enterkeyhint="done" placeholder="+ Свій алерген">' +
      '</span>' +
    '</div>' +
    '<div class="nut-hints">' +
      '<span class="nut-hint is-warn" data-al-unset>Алергени не вказані</span>' +
      '<span class="nut-hint" data-ml-note>1 мл рахуємо як 1 г</span>' +
    '</div>';
}

function syncNutHints(box) {
  var wrap = $('.nut-hints', box);
  wrap.hidden = !$$('.nut-hint', wrap).some(function (h) { return !h.hidden; });
}

function syncNutUnit(box, p) {
  $('[data-pw-wrap]', box).hidden = p.unit !== 'шт';
  $('[data-ml-note]', box).hidden = p.unit !== 'мл';
  syncNutHints(box);
}

function paintAllergens(box, p) {
  var list = Array.isArray(p.allergens) ? p.allergens : null;
  var on = {};
  (list || []).forEach(function (a) { on[alKey(a)] = 1; });

  // Базові, далі свої з усієї бази й цього продукту (свій могли щойно вписати)
  var items = ALLERGENS.map(function (a) { return a[0]; });
  var keys = items.slice();
  customAllergens().concat(list || []).forEach(function (a) {
    if (keys.indexOf(alKey(a)) === -1) { keys.push(alKey(a)); items.push(a); }
  });

  $('[data-al-chips]', box).innerHTML = items.map(function (a) {
    return '<button type="button" class="chip" data-al="' + esc(a) + '" aria-pressed="' +
      (on[alKey(a)] ? 'true' : 'false') + '">' + esc(alLabel(a)) + '</button>';
  }).join('') +
    '<button type="button" class="chip is-none" data-al-none aria-pressed="' +
      (list && !list.length ? 'true' : 'false') + '">Без алергенів</button>';
  $('[data-al-unset]', box).hidden = !!list;
  syncNutHints(box);
}

function fillNutEditor(box, p) {
  $$('[data-n]', box).forEach(function (inp) {
    inp.value = nutFieldText(p, inp.getAttribute('data-n'));
  });
  // Штрихкод показуємо той, з якого продукт заповнили — видно, що це за товар
  var code = $('[data-off-code]', box);
  if (code && p.code) code.value = p.code;
  $('[data-pw]', box).value = qtyFmt(num(p.pieceWeight));
  syncNutUnit(box, p);
  paintAllergens(box, p);
}

function readNutFields(box, p) {
  var inputs = $$('[data-n]', box);
  // Усі чотири порожні — «не вказано». Порожнє поле поруч із заповненими
  // зберігаємо як null, а не 0: у сумі воно однаково дає нуль, зате нуль ніколи
  // не зʼявляється в полі сам. Інакше витерте значення лишало б по собі «0»
  // в сусідніх полях — і продукт тихо вважався б заповненим нулями.
  if (inputs.every(function (i) { return !i.value.trim(); })) { p.nutrition = null; return; }
  var n = {};
  inputs.forEach(function (i) { n[i.getAttribute('data-n')] = nutValue(i.value.trim()); });
  p.nutrition = n;
}

function toggleAllergen(p, item) {
  var list = Array.isArray(p.allergens) ? p.allergens.slice() : [];
  var at = list.map(alKey).indexOf(alKey(item));
  if (at === -1) list.push(item); else list.splice(at, 1);
  // Зняли останній — назад у «не вказано», а не в «немає»: випадковий клік
  // не повинен тихо оголосити продукт безпечним
  p.allergens = list.length ? normalizeAllergens(list) : null;
}

/** Вписаний свій алерген позначається в продукті; повторне введення його не знімає. */
function addCustomAllergen(p, text) {
  var item = normalizeAllergens([String(text || '')])[0];
  if (!item) return false;
  var list = Array.isArray(p.allergens) ? p.allergens.slice() : [];
  list.push(item);
  p.allergens = normalizeAllergens(list);
  if (isCustomAllergen(item)) sessionAllergens.push(item);
  return true;
}

function toggleNoAllergens(p) {
  p.allergens = Array.isArray(p.allergens) && !p.allergens.length ? null : [];
}

/** Делегування на контейнер: resolve(box) знаходить продукт, onChange — хто має перемалюватись. */
function bindNutEditor(root, resolve, onChange) {
  function ctx(e) {
    var box = e.target.closest && e.target.closest('[data-nut-edit]');
    var p = box && resolve(box);
    return p ? { box: box, p: p } : null;
  }

  root.addEventListener('input', function (e) {
    var c = ctx(e); if (!c) return;
    if (e.target.hasAttribute('data-n')) readNutFields(c.box, c.p);
    else if (e.target.hasAttribute('data-pw')) c.p.pieceWeight = num(e.target.value);
    else return;
    persist(); onChange(c.p, c.box);
  });

  root.addEventListener('click', function (e) {
    var c = ctx(e); if (!c) return;
    if (e.target.closest('[data-off-find]')) { offSearch(c.box, c.p, onChange); return; }
    var chip = e.target.closest('[data-al]');
    if (chip) toggleAllergen(c.p, chip.getAttribute('data-al'));
    else if (e.target.closest('[data-al-none]')) toggleNoAllergens(c.p);
    else return;
    paintAllergens(c.box, c.p); persist(); onChange(c.p, c.box);
  });

  // Enter у полі штрихкода шукає — інакше форма просто нічого не робить
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.hasAttribute || !e.target.hasAttribute('data-off-code')) return;
    var c = ctx(e); if (!c) return;
    e.preventDefault();
    offSearch(c.box, c.p, onChange);
  });

  // Свій алерген додається Enter-ом або виходом із поля
  function addFromInput(e) {
    if (!e.target.hasAttribute || !e.target.hasAttribute('data-al-add')) return;
    var c = ctx(e); if (!c) return;
    if (!addCustomAllergen(c.p, e.target.value)) return;
    e.target.value = '';
    paintAllergens(c.box, c.p); persist(); onChange(c.p, c.box);
  }
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.hasAttribute || !e.target.hasAttribute('data-al-add')) return;
    e.preventDefault();
    addFromInput(e);
  });
  root.addEventListener('change', addFromInput);

  root.addEventListener('blur', function (e) {
    var c = ctx(e); if (!c) return;
    if (e.target.hasAttribute('data-n')) {
      e.target.value = nutFieldText(c.p, e.target.getAttribute('data-n'));
    } else if (e.target.hasAttribute('data-pw')) {
      e.target.value = qtyFmt(num(c.p.pieceWeight));
    }
  }, true);
}

/* ── Рядок бази продуктів ─────────────────────────────────────── */

var nutOpen = {};   // розгорнуті рядки — переживають перемальовування таблиці при пошуку

function paintNutBtn(tr, p) {
  var b = $('[data-nut-toggle]', tr); if (!b) return;
  var st = nutState(p);
  b.className = 'nut-btn' + (st === 'full' ? ' is-full' : st === 'part' ? ' is-part' : '');
  b.title = st === 'full' ? 'КБЖУ та алергени вказані'
          : st === 'part' ? 'КБЖУ та алергени заповнені частково'
          : 'КБЖУ та алергени не вказані';
  var open = !!nutOpen[p.id];
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  tr.classList.toggle('is-open', open);
}

function nutRow(p) {
  var tr = document.createElement('tr');
  tr.className = 'nut-row nut-only';
  tr.setAttribute('data-id', p.id);
  tr.innerHTML = '<td colspan="6"><div class="nut-edit" data-nut-edit>' + nutEditorHtml() + '</div></td>';
  fillNutEditor($('[data-nut-edit]', tr), p);
  return tr;
}

function toggleNutRow(tr) {
  var p = productById(tr.getAttribute('data-id')); if (!p) return;
  var next = tr.nextElementSibling;
  if (nutOpen[p.id]) {
    delete nutOpen[p.id];
    if (next && next.classList.contains('nut-row')) {
      var leaving = next;
      collapseRow(leaving, function () { leaving.remove(); });
    }
  } else {
    nutOpen[p.id] = true;
    // Редактор КБЖУ живе всередині картки продукту — згорнута картка з
    // відкритим редактором під нею виглядала б як поля нізвідки
    rowOpen[p.id] = true;
    tr.classList.add('is-edit');
    // Швидко тицьнули «КБЖУ» двічі — попередній редактор ще згортається;
    // прибираємо його одразу, інакше під карткою лишилося б два
    if (next && next.classList.contains('nut-row')) { next.remove(); next = tr.nextElementSibling; }
    var row = nutRow(p);
    tr.parentNode.insertBefore(row, next);
    expandRow(row);
  }
  paintNutBtn(tr, p);
}

/* ── Панель у калькуляції та напівфабрикаті ───────────────────── */

function nutCells(nu, factor) {
  var known = nu.counted > 0;
  return NUT_ROWS.map(function (r) {
    return {
      key: r[0], label: r[1],
      one: known && factor ? nutNum(nu[r[0]] * factor, r[3]) + r[2] : '—',
      whole: known ? nutNum(nu[r[0]], r[3]) + r[2] : '—'
    };
  });
}

/** Імена, яким бракує даних. Продукти з бази — кнопки, що відкривають модалку. */
function missList(list) {
  var MAX = 6;
  var html = list.slice(0, MAX).map(function (m) {
    return m.id
      ? '<button type="button" class="link-btn nut-fix" data-nut-fix="' + esc(m.id) + '">' + esc(m.label) + '</button>'
      : '<span class="nut-orphan" title="Цього продукту немає в базі">' + esc(m.label) + '</span>';
  }).join(', ');
  if (list.length > MAX) html += ' та ще ' + (list.length - MAX);
  return html;
}

/** per = { label, factor, approx }: factor — множник від «весь виріб» до «на одиницю», 0 — нема з чого. */
function nutPanelHtml(nu, per, opts) {
  if (!nu.rows) return '<div class="nut-empty">' + esc(opts.empty) + '</div>';

  var body = nutCells(nu, per.factor).map(function (c) {
    return '<tr' + (c.key === 'kcal' ? ' class="is-kcal"' : '') + '><td>' + c.label + '</td>' +
      '<td class="r">' + c.one + '</td><td class="r">' + c.whole + '</td></tr>';
  }).join('');

  var al = nu.allergens.length
    ? nu.allergens.map(function (a) { return '<span class="chip is-static">' + esc(a[1]) + '</span>'; }).join('')
    : '<span class="nut-none">' + (nu.noAl.length ? '—' : 'Немає') + '</span>';

  return '<div class="nut-body">' +
    '<table class="nut-tbl"><thead><tr><th></th>' +
      '<th class="r">' + (per.approx ? '≈ ' : '') + esc(per.label) + '</th>' +
      '<th class="r">' + esc(opts.whole) + '</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
    '<div class="nut-side">' +
      '<div class="nut-al-view"><span class="nut-cap">Алергени</span><span class="chips">' + al + '</span></div>' +
      (nu.noAl.length ? '<div class="nut-warn">Алергени не вказані: ' + missList(nu.noAl) + '</div>' : '') +
      (nu.noNut.length ? '<div class="nut-miss">Без КБЖУ: ' + missList(nu.noNut) + '</div>' : '') +
      (per.approx && nu.counted ? '<div class="nut-note">' + esc(opts.approx) + '</div>' : '') +
      '<div class="nut-note">Розрахункові значення за даними бази продуктів</div>' +
    '</div>' +
  '</div>';
}

/**
 * «На 100 г» для калькуляції. Точно — лише від ваги готового виробу: у
 * духовці йде вода, і сира маса торта більша за готову. Без неї рахуємо
 * на сиру масу й чесно позначаємо це як наближення.
 */
function calcNutPer(d, nu) {
  var ow = num(d.outWeight);
  if (ow > 0) return { label: 'На 100 г', factor: 100 / ow, approx: false };
  return { label: 'На 100 г', factor: nu.mass > 0 ? 100 / nu.mass : 0, approx: nu.mass > 0 };
}

/**
 * Поле «Вага виробу» в шапці калькуляції, у кілограмах. Поки людина не вписала
 * своє число, воно само показує суму інгредієнтів — сірим, щоб було видно, що
 * це підставлене. Своє число вже не перезаписується; кнопка поруч повертає суму.
 * Ручне значення позначає data-manual: саме його, а не текст поля, читає readCalc().
 * mass — у грамах, як і outWeight у рецепті.
 */
function paintOutWeight(mass, force) {
  var ow = $('#calc-outw'), reset = $('#calc-outw-reset');
  var auto = mass > 0 ? Math.round(mass) : 0;
  if (!ow.dataset.manual) {
    // Під час набору не підміняємо текст під пальцем. force — з blur: там
    // activeElement ще може вказувати на саме поле, і суму б не підставило
    if (force || document.activeElement !== ow) ow.value = auto ? qtyFmt(auto / 1000) : '';
    ow.classList.add('is-auto');
    reset.hidden = true;
    return;
  }
  ow.classList.remove('is-auto');
  // Піввідсотка — не різниця: після перерахунку округлені грамовки дають 2,201 кг
  // замість 2,2, і підказка лізла б без причини. Усушка при випіканні — 10–20 %
  var differs = auto > 0 && Math.abs(num(ow.value) * 1000 - auto) > Math.max(1, auto * 0.005);
  reset.hidden = !differs;
  if (differs) reset.textContent = 'Сума інгредієнтів — ' + qtyFmt(auto / 1000) + ' кг';
}

/** Вага, від якої рахує перерахунок: своя, якщо вписана, інакше сума інгредієнтів. У грамах. */
function calcBaseWeight() {
  var ow = $('#calc-outw');
  if (ow.dataset.manual) return Math.round(num(ow.value) * 1000);
  return Math.round(nutritionOf(readCalc().ing).mass);
}

/**
 * Перерахунок калькуляції на іншу вагу: кожна кількість множиться на один
 * коефіцієнт. Ціни упаковок не чіпаємо — вони від ваги торта не залежать, тож
 * вартість рядків зміниться сама. Фіксовані витрати теж лишаються: коробка
 * одна на торт, хоч 1 кг, хоч 3. Відсоткові перерахуються від нової собівартості.
 * Напівфабрикату множимо й «скільки взяти», і data-take — інакше наступна
 * правка «Взяти» перерахувала б складники від старого числа.
 */
function scaleCalc(toG, fromG) {
  var s = scaleSnap, ow = $('#calc-outw');
  if (!s) {
    s = scaleSnap = {
      fromG: fromG,
      weight: { manual: !!ow.dataset.manual, value: ow.value },
      dirty: draftDirty,
      json: JSON.stringify(cleanRecipe(readCalc())),
      fields: []
    };
  }
  s.toG = toG;   // для смуги: поле ваги потім можуть змінити, а перерахували саме на цю
  ingRows().forEach(function (tr) {
    scaleField(s, $('[data-f=qty]', tr), $('[data-f=unit]', tr).value, toG, fromG);
  });
  grpRows().forEach(function (gtr) {
    var inp = $('[data-grp-take]', gtr);
    scaleField(s, inp, gtr.getAttribute('data-unit'), toG, fromG, gtr);
    gtr.setAttribute('data-take', num(inp.value));
  });
  ow.dataset.manual = '1';
  ow.value = qtyFmt(toG / 1000);
  recalc();
}

/* Перерахунок, який ще можна відмінити: що стояло в полях до нього. Живе лише
   в памʼяті, поки видно смугу «Перераховано»: після збереження, відміни чи
   відкриття іншої калькуляції відміняти вже нічого. */
var scaleSnap = null;

/**
 * Кількість після перерахунку — так, як її відважують: 444,444 г нікому не
 * потрібні. Від 10 — до цілих, від 1 — до десятих, менше — до сотих, щоб
 * щіпка ванілі не стала нулем. Штуки — щонайменше до десятих: 3,3 яйця
 * рахуються чесніше, ніж 3.
 */
function roundScaled(n, unit) {
  var step = n >= 10 && unit !== 'шт' ? 1 : n >= 1 ? 10 : 100;
  return Math.round(n * step) / step;
}

/**
 * Одне поле при перерахунку. Поки число в полі те, що поставив попередній
 * перерахунок, рахуємо від вихідного — інакше 0,9 → 1,2 → 0,9 кг через
 * округлення не повернув би рівно ті самі грами. Підправлене руками чи нове
 * поле множимо від того, що в ньому зараз, і запамʼятовуємо як вихідне.
 */
function scaleField(s, inp, unit, toG, fromG, gtr) {
  if (!(num(inp.value) > 0)) return;
  var f = null;
  for (var i = 0; i < s.fields.length; i++) if (s.fields[i].inp === inp) { f = s.fields[i]; break; }
  if (!f || inp.value !== f.set) {
    if (!f) { f = { inp: inp, orig: inp.value, gtr: gtr, take: gtr && gtr.getAttribute('data-take') }; s.fields.push(f); }
    f.base = num(inp.value);
    f.baseG = fromG;
  }
  inp.value = qtyFmt(roundScaled(f.base * toG / f.baseG, unit));
  f.set = inp.value;
}

/** «Відмінити»: поля, вага й навіть «Збережено» — як до перерахунку, якщо нічого іншого не міняли. */
function undoScale() {
  var s = scaleSnap;
  if (!s) return;
  s.fields.forEach(function (f) {
    if (!f.inp.isConnected) return;   // рядок відтоді видалили
    f.inp.value = f.orig;
    if (f.gtr) f.gtr.setAttribute('data-take', f.take);
  });
  var ow = $('#calc-outw');
  if (s.weight.manual) ow.dataset.manual = '1'; else delete ow.dataset.manual;
  ow.value = s.weight.value;
  scaleSnap = null;
  recalc();
  if (JSON.stringify(cleanRecipe(readCalc())) === s.json) { draftDirty = s.dirty; updateSaveBtn(); }
  paintScaled();
  toast('Повернули як було — ' + qtyFmt(s.fromG / 1000) + ' кг');
}

/** Смуга «Перераховано»: поки відкрита панель перерахунку, ховається — дві зелені рамки підряд зайві. */
function paintScaled() {
  var bar = $('#calc-scaled'), s = scaleSnap;
  bar.hidden = !s || !$('#calc-scale').hidden;
  if (bar.hidden) return;
  // &nbsp; — щоб «кг» на вузькому екрані не зривалось окремим рядком
  $('#calc-scaled-txt').innerHTML = ICON_TICK + '<span>Перераховано з ' + qtyFmt(s.fromG / 1000) +
    '&nbsp;кг на ' + qtyFmt(s.toG / 1000) + '&nbsp;кг</span>';
  // Не збережена ще калькуляція — лише «Відмінити»: зберігають її звичайною кнопкою
  $('#btn-scaled-new').hidden = $('#btn-scaled-replace').hidden = !S.ui.editing;
}

/** «Було» й множник у панелі. from — у грамах. */
function paintScalePanel(from) {
  $('#scale-from').textContent = from > 0 ? qtyFmt(from / 1000) + ' кг' : '—';
  var k = from > 0 ? num($('#scale-to').value) * 1000 / from : 0;
  $('#scale-k').textContent = k > 0 && Math.abs(k - 1) >= 0.005 ? '×' + qtyFmt(Math.round(k * 100) / 100) : '';
}

function openScalePanel() {
  var from = calcBaseWeight();
  if (!(from > 0)) {
    toast('Спершу додайте інгредієнти або вкажіть вагу виробу — від неї рахується перерахунок');
    $('#calc-outw').focus();
    return;
  }
  $('#scale-to').value = '';
  paintScalePanel(from);
  $('#calc-scale').hidden = false;
  $('#btn-scale').setAttribute('aria-expanded', 'true');
  paintScaled();
  $('#scale-to').focus();
}

function closeScalePanel() {
  $('#calc-scale').hidden = true;
  $('#btn-scale').setAttribute('aria-expanded', 'false');
  paintScaled();
}

function applyScale() {
  var from = calcBaseWeight();
  var to = Math.round(num($('#scale-to').value) * 1000);
  if (!(to > 0)) { toast('Вкажіть нову вагу в кілограмах, наприклад 2,5'); $('#scale-to').focus(); return; }
  closeScalePanel();
  if (to === from || !(from > 0)) return;
  scaleCalc(to, from);
  paintScaled();
}

function paintCalcNut(d) {
  if (!S.showNutrition) return;
  var nu = nutritionOf(d.ing);
  $('#calc-nut-body').innerHTML = nutPanelHtml(nu, calcNutPer(d, nu), {
    whole: 'Весь виріб',
    empty: 'Додайте інгредієнти — тут зʼявиться харчова цінність і алергени.',
    approx: 'Вага виробу — сума інгредієнтів, без урахування упікання. Впишіть вагу після випікання вгорі калькуляції — буде точно.'
  });
}

/* У напівфабрикату вага готового вже є — це вихід, тож тут наближення лише доти, доки його не вказали. */
function paintPrepNut(p) {
  if (!S.showNutrition) return;
  var nu = nutritionOf(p.ing);
  var y = num(p['yield']);
  var per = y > 0
    ? { label: p.unit === 'шт' ? 'На 1 шт' : 'На 100 ' + p.unit, factor: p.unit === 'шт' ? 1 / y : 100 / y, approx: false }
    : { label: 'На 100 г', factor: nu.mass > 0 ? 100 / nu.mass : 0, approx: nu.mass > 0 };
  $('#prep-nut-body').innerHTML = nutPanelHtml(nu, per, {
    whole: 'Весь заміс',
    empty: 'Додайте складники — тут зʼявиться харчова цінність і алергени.',
    approx: 'Рахуємо на сиру масу. Вкажіть вихід — буде точно.'
  });
}

/** Панелі перемальовуємо й тоді, коли вони приховані: наступний показ має бути вже свіжим. */
function repaintNutPanels() {
  if (!S.showNutrition) return;
  if ($('#ing-body').children.length) paintCalcNut(readCalc());
  var p = editingPrep();
  if (p) paintPrepNut(p);
}

function pdfNutBlock(d) {
  if (!S.showNutrition) return '';
  var nu = nutritionOf(d.ing);
  if (!nu.counted && !nu.alKnown) return '';
  var per = calcNutPer(d, nu);

  var rows = nutCells(nu, per.factor).map(function (c) {
    return '<tr><td>' + c.label + '</td><td class="r">' + c.one + '</td><td class="r b">' + c.whole + '</td></tr>';
  }).join('');

  var al = nu.allergens.length
    ? nu.allergens.map(function (a) { return a[1]; }).join(', ')
    : (nu.noAl.length ? '—' : 'Немає');

  var notes = [];
  if (nu.noAl.length) notes.push('Алергени не вказані: ' + nu.noAl.map(function (m) { return m.label; }).join(', '));
  if (nu.noNut.length) notes.push('Без КБЖУ: ' + nu.noNut.map(function (m) { return m.label; }).join(', '));
  if (per.approx && nu.counted) notes.push('На 100 г — на сиру масу, без урахування упікання.');
  notes.push('Розрахункові значення.');

  return '<section class="pdf-block">' +
    '<h2 class="pdf-sec">Харчова цінність</h2>' +
    '<table class="pdf-tbl"><thead><tr><th>Показник</th>' +
      '<th class="r">' + (per.approx ? '≈ ' : '') + 'На 100 г</th><th class="r">Весь виріб</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
    '<div class="pdf-line"><span>Алергени</span><span class="t">' + esc(al) + '</span></div>' +
    '<div class="pdf-note">' + notes.map(esc).join('<br>') + '</div>' +
  '</section>';
}

/* ── Модалка ──────────────────────────────────────────────────── */

function openNutModal(id) {
  var p = productById(id); if (!p) return;
  var box = $('#nut-modal-edit');
  box.setAttribute('data-id', id);
  box.innerHTML = nutEditorHtml();
  fillNutEditor(box, p);
  $('#nut-title').textContent = p.name || 'Продукт';
  $('#nut-overlay').classList.add('is-on');
}

function closeNutModal() {
  var ov = $('#nut-overlay');
  if (!ov.classList.contains('is-on')) return;
  ov.classList.remove('is-on');
  persist(true);
}

function bindNutrition() {
  // Правки з модалки йдуть одразу в продукт, панель під нею оновлюється наживо
  bindNutEditor($('#nut-overlay'), function (box) {
    return productById(box.getAttribute('data-id'));
  }, repaintNutPanels);
  $('#nut-done').addEventListener('click', closeNutModal);
  $('#nut-overlay').addEventListener('click', function (e) { if (e.target === this) closeNutModal(); });

  ['#calc-nut', '#prep-nut'].forEach(function (sel) {
    $(sel).addEventListener('click', function (e) {
      var b = e.target.closest('[data-nut-fix]');
      if (b) openNutModal(b.getAttribute('data-nut-fix'));
    });
  });
}

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
  // Вікно одне на всі запити: числу — цифрова клавіатура, назві папки — звичайна
  inp.setAttribute('inputmode', opts.inputmode || 'text');
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

/* ── Запрошення в групу тестувальників ──────────────────────────
   Один раз на пристрій. Хрестика, закриття по фону й Escape немає
   навмисно: вікно закривається лише кнопкою — щоб його прочитали. */

function maybeShowInvite() {
  // Сховище недоступне (приватний режим) — не показуємо, інакше вікно було б на кожному вході
  try { if (localStorage.getItem(INVITE_KEY)) return; } catch (e) { return; }
  $('#invite-overlay').classList.add('is-on');
}

function closeInvite() {
  try { localStorage.setItem(INVITE_KEY, '1'); } catch (e) { /* не записалось — покажемо ще раз, не страшно */ }
  $('#invite-overlay').classList.remove('is-on');
}

function bindInvite() {
  // «Приєднатись» — звичайне посилання в нову вкладку, тут лише закриваємо вікно
  $('#invite-join').addEventListener('click', closeInvite);
  $('#invite-skip').addEventListener('click', closeInvite);
}

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
  recordNav(id);
  window.scrollTo(0, 0);
  persist();
}

/* ── Історія браузера ──────────────────────────────────────────
   Для браузера весь застосунок — одна сторінка, тож «Назад» (кнопка чи
   жест на телефоні) викидав із сайту. Тепер кожен перехід між екранами —
   окремий крок історії, а popstate відкриває той екран, що в кроці. */

var fromHistory = false;   // екран відкривається з історії — новий крок не пишемо
var navReplace = false;    // перехід замість поточного кроку (напр. після видалення)
var curNav = null;         // крок, на якому стоїмо: «Назад» при відкритому вікні повертає саме його

function navState(id) {
  var st = { fc: 1, screen: id };
  if (id === 'folder') st.folderId = S.ui.folderId;
  if (id === 'prep-edit') st.prepId = editingPrepId;
  if (id === 'calc') st.editing = S.ui.editing ? { folderId: S.ui.editing.folderId, recipeId: S.ui.editing.recipeId } : null;
  return st;
}

function sameNav(a, b) {
  return !!a && !!b && a.screen === b.screen && a.folderId === b.folderId && a.prepId === b.prepId &&
    JSON.stringify(a.editing || null) === JSON.stringify(b.editing || null);
}

function recordNav(id) {
  if (fromHistory || !window.history || !history.pushState) return;
  var st = navState(id);
  // Той самий екран ще раз (перемалювали папку, клікнули пункт меню двічі) — не плодимо кроки
  if (navReplace || sameNav(history.state, st)) history.replaceState(st, '');
  else history.pushState(st, '');
  curNav = st;
}

/** Оновити поточний крок без переходу — коли в екрана змінилось, що саме в ньому відкрито. */
function replaceNav() {
  if (!window.history || !history.replaceState) return;
  curNav = navState(S.ui.screen);
  history.replaceState(curNav, '');
}

function closeOverlays() {
  closeMenu();
  closeAsk();
  closeLeave();
  closePdfPreview();
  closePrepPick();
  closeNutModal();
  $('#save-overlay').classList.remove('is-on');
}

function restoreNav(st) {
  fromHistory = true;
  try {
    var id = st && st.fc ? st.screen : 'home';
    if (id === 'folder' && folderById(st.folderId)) {
      openFolder(st.folderId);
    } else if (id === 'prep-edit' && prepById(st.prepId)) {
      openPrep(st.prepId);
    } else if (id === 'calc') {
      var ed = st.editing, f = ed && folderById(ed.folderId);
      var r = f && f.recipes.filter(function (x) { return x.id === ed.recipeId; })[0];
      if (r) {
        openRecipe(f.id, r.id);
      } else {
        // Чернетка в стані одна. Якщо відтоді відкривали збережений рецепт, S.draft
        // уже його — показати її як нову означало б дублікат при збереженні.
        var draft = S.ui.editing ? null : S.draft;
        S.ui.editing = null;
        loadCalc(draft || { name: '', margin: 50, ing: [], exp: [] }, 'Нова калькуляція');
        show('calc', null);
      }
    } else if (id !== 'folder' && id !== 'prep-edit' && $('#s-' + id)) {
      if (id === 'base') renderBase();
      if (id === 'expbase') renderExpBase();
      if (id === 'prep') renderPreps();
      show(id);
    } else {
      show('home');   // папку чи напівфабрикат з кроку вже видалили
    }
  } finally {
    fromHistory = false;
  }
  replaceNav();   // крок міг вказувати на вже видалене — фіксуємо, що відкрили насправді
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
  $('#nav-prep-count').textContent = S.preps.length || '';
}

/* ── Меню на телефоні ──────────────────────────────────────────
   Та сама панель, що й на компʼютері: на вузькому екрані вона просто
   виїжджає збоку по бургеру, а не з'їдає перший екран. */

function menuOpen() { return $('#sidebar').classList.contains('is-open'); }

function setMenu(open) {
  $('#sidebar').classList.toggle('is-open', open);
  $('#nav-scrim').hidden = !open;
  $('#btn-menu').setAttribute('aria-expanded', open ? 'true' : 'false');
  // Фон не має їхати під відкритим меню
  document.documentElement.classList.toggle('nav-open', open);
}

function closeMenu() { if (menuOpen()) setMenu(false); }

function bindMenu() {
  $('#btn-menu').addEventListener('click', function () { setMenu(!menuOpen()); });
  $('#nav-scrim').addEventListener('click', closeMenu);
  // Перехід кудись — меню своє відпрацювало
  $('#sidebar').addEventListener('click', function (e) {
    if (e.target.closest('.nav-item')) closeMenu();
  });
  // Екран став широким — сайдбар знову на місці, стан «відкрито» лише заважає
  window.addEventListener('resize', function () { if (window.innerWidth > 900) closeMenu(); });
}

/* ═════════════════ 9. База продуктів ═════════════════ */

/* autocomplete="off" на кожному полі й селекті таблиць — не косметика. Мобільний
   браузер, перезавантажуючи вивантажену вкладку, відновлює значення полів без
   імені за їхнім порядком у DOM. Рядки ж будує скрипт, тож цифри розʼїжджались
   по чужих рядках, а «Зберегти» записувало цю кашу в рецепт. */
function unitSelect(value) {
  return '<select class="unit-sel" autocomplete="off" data-f="unit" aria-label="Одиниця">' +
    UNITS.map(function (u) {
      return '<option value="' + u + '"' + (u === value ? ' selected' : '') + '>' + u + '</option>';
    }).join('') + '</select>';
}

/** Перемикач типу витрати: фіксована сума в валюті або відсоток від собівартості. */
function modeSelect(value) {
  return '<select class="unit-sel" autocomplete="off" data-f="mode" aria-label="Тип витрати">' +
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

/* ── Згорнута картка рядка (тільки телефон) ─────────────────────
   Повний рядок бази на вузькому екрані — це шість полів, які лягають
   у три-чотири лінії, і список перетворюється на суцільну кашу. Тому
   там рядок згорнутий до назви з коротким підсумком, а поля
   відкриваються тапом. На компʼютері обидві кнопки сховані CSS —
   розмітка одна, поведінка різна. */

var rowOpen = {};   // розгорнуті картки — переживають перемальовування при пошуку

function peekHtml() {
  return '<button type="button" class="row-peek" data-row-toggle aria-expanded="false">' +
           '<span class="peek-name"></span><span class="peek-sum"></span>' +
           '<span class="peek-caret">' + ICON_CHEV + '</span>' +
         '</button>' +
         '<button type="button" class="row-fold" data-row-toggle aria-label="Згорнути">' + ICON_CHEV + '</button>';
}

function paintPeek(tr, name, sum) {
  var b = $('.row-peek', tr); if (!b) return;
  var nm = String(name || '').trim();
  var el = $('.peek-name', b);
  el.textContent = nm || 'Без назви';
  el.classList.toggle('is-empty', !nm);
  $('.peek-sum', b).textContent = sum;
  b.setAttribute('aria-expanded', tr.classList.contains('is-edit') ? 'true' : 'false');
}

function productSum(p) {
  if (!p.price && !p.pack) return 'Порожній';
  return fmt(p.price) + ' ' + S.currency + ' · ' + qtyFmt(p.pack) + ' ' + p.unit;
}

function expenseSum(x) {
  if (!x.value) return 'Порожня';
  return x.mode === 'pct' ? qtyFmt(x.value) + ' %' : fmt(x.value) + ' ' + S.currency;
}

/** Звідки ціна інгредієнта й скільки його взято — у згорнутому рядку це єдиний опис. */
function ingSum(i) {
  var src = i.price > 0 && i.pack > 0
    ? fmt(i.price) + ' ' + S.currency + ' за ' + qtyFmt(i.pack) + ' ' + i.unit
    : 'Ціна не вказана';
  return i.qty > 0 ? src + ' / ' + qtyFmt(i.qty) + ' ' + i.unit : src;
}

/**
 * Опис згорнутої витрати в калькуляції. У фіксованої суми його немає: число
 * праворуч уже все каже, і рядок лишається однорядковим. Відсоток пояснюємо —
 * без «від собівартості» сума праворуч виглядала б узятою нізвідки.
 */
function expRowSum(e) {
  if (e.mode !== 'pct') return '';
  return e.value > 0 ? qtyFmt(e.value) + ' % від собівартості' : 'Відсоток не вказаний';
}

/* ── Розкриття карток ──────────────────────────────────────────
   Анімуємо саму висоту рядка й нічого більше: один короткий перехід на
   картку, без тіней і трансформацій, тож навіть на слабкому телефоні це
   недорого. «Зменшити рух» у системі вимикає анімацію повністю.
   На широкому екрані карток немає — рядок там звичайний рядок таблиці,
   і його висоту анімувати ні до чого. */

var ROW_MOTION = { duration: 170, easing: 'cubic-bezier(.2,.7,.3,1)' };

function rowMotionOff(row) {
  return calmMotion() || !row.animate || getComputedStyle(row).display !== 'grid';
}

/** apply() міняє вміст рядка, а ми проводимо висоту від старої до нової. */
function animateRow(row, apply) {
  if (rowMotionOff(row)) { apply(); return; }
  var from = row.getBoundingClientRect().height;
  apply();
  var to = row.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  playRowMotion(row, from, to);
}

/** Новий рядок (редактор КБЖУ) виїжджає з нуля, а не зʼявляється ривком. */
function expandRow(row) {
  if (rowMotionOff(row)) return;
  playRowMotion(row, 0, row.getBoundingClientRect().height);
}

/** Згортає рядок і лише потім віддає його — done зазвичай прибирає рядок із DOM. */
function collapseRow(row, done) {
  if (rowMotionOff(row)) { done(); return; }
  playRowMotion(row, row.getBoundingClientRect().height, 0).onfinish = done;
}

function playRowMotion(row, from, to) {
  // Тицьнули ще раз, поки їде попередня — знімаємо її одразу, інакше вона
  // потім зніме overflow уже під новою анімацією й рядок смикнеться
  row.getAnimations().forEach(function (a) { a.cancel(); });
  row.style.overflow = 'hidden';
  var anim = row.animate(
    [{ height: from + 'px', opacity: from ? 1 : 0 }, { height: to + 'px', opacity: to ? 1 : 0 }],
    ROW_MOTION
  );
  anim.addEventListener('finish', function () { row.style.overflow = ''; });
  anim.addEventListener('cancel', function () { row.style.overflow = ''; });
  return anim;
}

/** Розгортає/згортає картку. Разом із карткою ховається і редактор КБЖУ:
    лишити його відкритим під згорнутим рядком — значить показати поля нізвідки. */
function toggleRowCard(tr) {
  // Рядки калькуляції не мають id: їхній стан живе лише в класі й
  // скидається разом із перемальовуванням рецепта — так і треба
  var id = tr.getAttribute('data-id');
  var open = !tr.classList.contains('is-edit');
  if (id) { if (open) rowOpen[id] = true; else delete rowOpen[id]; }
  animateRow(tr, function () {
    tr.classList.toggle('is-edit', open);
    var b = $('.row-peek', tr);
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open && id && nutOpen[id]) toggleNutRow(tr);
  });
  if (open) {
    var n = $('[data-f=name]', tr);
    if (n && !n.value) n.focus();
  }
}

/** Рядок, який треба розгорнути цим тапом. Згорнутий інгредієнт на телефоні
    не має жодного поля, тож відкривається тапом будь-де, а не лише по назві. */
function rowTapTarget(e) {
  var t = e.target.closest('[data-row-toggle]');
  if (t) return t.closest('tr');
  var tr = e.target.closest('tr');
  if (tr && $('.row-peek', tr) && !tr.classList.contains('is-edit') &&
      window.matchMedia('(max-width: 760px)').matches) return tr;
  return null;
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
    tr.innerHTML = '<td colspan="6" class="tbl-empty"><b style="display:block;margin-bottom:6px;font-size:16px;color:var(--fg)">' +
      (q ? 'Нічого не знайшли за запитом «' + esc(q) + '»' : 'База порожня — додайте перший продукт') + '</b>' +
      (q ? 'Спробуйте коротший запит або додайте новий продукт.'
         : 'Назва, ціна упаковки, вага — і продукт почне підтягуватися в калькуляції.') + '</td>';
    body.appendChild(tr);
  } else {
    list.forEach(function (p) {
      body.appendChild(baseRow(p));
      if (nutOpen[p.id]) body.appendChild(nutRow(p));
    });
  }

  $('#base-tip').textContent = S.products.length
    ? S.products.length + ' ' + plural(S.products.length, 'продукт', 'продукти', 'продуктів') + ' у базі'
    : '';
  renderDatalist();
  updateBaseStale();
  paintNutOffer();
}

/* Пропозиція ввімкнути КБЖУ — лише поки функція вимкнена й людину ще не питали.
   Відмовились — більше не показуємо, вмикання лишається в налаштуваннях. */
function paintNutOffer() {
  $('#nut-offer').hidden = !!S.showNutrition || !!S.nutAsked;
}

/* Пропозиція підтягнути нові значення в раніше збережені калькуляції.
   Смуга однакова на обох базах — витрати впливають на підсумок так само,
   як ціни продуктів, тож ховати її на одному з екранів було б непослідовно. */
function updateBaseStale() {
  var c = staleCount();
  var html = c.total ? ICON_SYNC + '<span>' + esc(staleLabel(c) + ' ' +
    plural(c.total, 'рахується', 'рахуються', 'рахуються') + ' за старими цінами') + '</span>' : '';
  $$('[data-stale]').forEach(function (bar) {
    bar.hidden = !c.total;
    if (c.total) $('.stale-txt', bar).innerHTML = html;
  });
}

function refreshAllRecipes() {
  var c = staleCount();
  if (!c.total) { updateBaseStale(); toast('Усе вже рахується за поточними цінами'); return; }

  ask({
    title: 'Перерахувати все?',
    sub: staleLabel(c) + ' ' + plural(c.total, 'отримає', 'отримають', 'отримають') +
         ' поточні ціни з бази. Грамовки у стравах не зміняться. ' +
         'Повернути старі ціни потім не вийде — якщо вони потрібні, спершу збережіть копію у файл.',
    input: false, ok: 'Перерахувати'
  }, function () {
    closeAsk();
    var idx = baseIndex(), changed = 0, skipped = 0, touched = 0;

    S.folders.forEach(function (f) {
      f.recipes.forEach(function (r) {
        var res = syncWithBase(r, false, idx);
        if (res.changed) touched++;
        changed += res.changed; skipped += res.skipped;
      });
    });

    S.preps.forEach(function (p) {
      var res = syncWithBase(p, false, idx);
      if (res.changed) touched++;
      changed += res.changed; skipped += res.skipped;
    });

    // Відкрита чернетка — той самий рецепт, тільки ще не в папці
    if (S.draft) {
      var dres = syncWithBase(S.draft, false, idx), wasDirty = draftDirty;
      // Відкрита збережена калькуляція — копія запису з папки, який уже пораховано
      // вище: без цього «1 запис — 2 рядки», хоча змінився один
      if (!S.ui.editing) { changed += dres.changed; skipped += dres.skipped; }
      if (dres.changed && $('#ing-body').children.length) {
        loadCalc(S.draft, $('#calc-crumb').textContent);
        // Нова чернетка розійшлася з тим, що було на екрані. Збережена ж отримала
        // в папці ті самі ціни — «Є незбережені зміни» лише якщо вони були й до того
        draftDirty = S.ui.editing ? wasDirty : true;
        // Знімок тепер — уже з правками; невідомо, яка там збережена версія, тож «змінено»
        if (S.ui.editing && wasDirty) calcBaseline = null;
        updateSaveBtn();
      }
    }

    persist(true);
    updateBaseStale();
    renderPreps();
    if (S.ui.screen === 'prep-edit' && editingPrep()) openPrep(editingPrepId);
    if (S.ui.folderId) renderFolder();

    var msg = 'Оновлено ' + touched + ' ' + plural(touched, 'запис', 'записи', 'записів') +
              ' — ' + changed + ' ' + plural(changed, 'рядок', 'рядки', 'рядків');
    if (skipped) {
      msg += '. ' + skipped + ' ' + plural(skipped, 'рядок', 'рядки', 'рядків') +
             ' пропущено — у базі інша одиниця виміру';
    }
    toast(msg);
  });
}

/**
 * Інший продукт із такою ж назвою. Це не дрібниця: збережені калькуляції
 * шукають продукт у базі за назвою — і натраплять на випадковий із двох.
 */
function sameNameProduct(p) {
  var nm = String(p.name || '').trim().toLowerCase();
  if (!nm) return null;
  return S.products.filter(function (x) {
    return x.id !== p.id && String(x.name || '').trim().toLowerCase() === nm;
  })[0] || null;
}

function paintDup(tr, p) {
  var el = $('[data-dup]', tr);
  if (el) el.hidden = !sameNameProduct(p);
}

function paintAllDups() {
  $$('#base-body tr[data-id]:not(.nut-row)').forEach(function (tr) {
    var p = productById(tr.getAttribute('data-id'));
    if (p) paintDup(tr, p);
  });
}

function baseRow(p) {
  var tr = document.createElement('tr');
  tr.setAttribute('data-id', p.id);
  if (rowOpen[p.id]) tr.className = 'is-edit';
  tr.innerHTML =
    '<td>' + peekHtml() + '<input class="inp" data-f="name" placeholder="Назва продукту" autocomplete="off">' +
      '<span class="row-warn" data-dup hidden>Такий продукт уже є в базі — назви мають бути різними, інакше калькуляції плутатимуть їх</span></td>' +
    '<td data-lbl="Ціна"><input class="inp is-num" data-f="price" inputmode="decimal" autocomplete="off" placeholder="0,00"></td>' +
    '<td data-lbl="Упаковка"><input class="inp is-num" data-f="pack" inputmode="decimal" autocomplete="off" placeholder="0"></td>' +
    '<td class="t-mid" data-lbl="Одиниця">' + unitSelect(p.unit) + '</td>' +
    '<td class="nut-only t-mid"><button type="button" class="nut-btn" data-nut-toggle aria-expanded="false">КБЖУ</button></td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-product aria-label="Видалити продукт">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = p.name;
  $('[data-f=price]', tr).value = p.price ? fmt(p.price) : '';
  $('[data-f=pack]', tr).value = qtyFmt(p.pack);
  paintPeek(tr, p.name, productSum(p));
  paintNutBtn(tr, p);
  paintDup(tr, p);
  return tr;
}

function bindBase() {
  var body = $('#base-body');

  // Харчові поля обробляє редактор нижче — ціну й автопідказку вони не зачіпають
  bindNutEditor(body, function (box) {
    return productById(box.closest('tr').getAttribute('data-id'));
  }, function (p, box) {
    var main = box.closest('tr').previousElementSibling;
    if (main) paintNutBtn(main, p);
  });

  body.addEventListener('input', function (e) {
    if (e.target.closest('[data-nut-edit]')) return;
    var tr = e.target.closest('tr'); if (!tr) return;
    var p = productById(tr.getAttribute('data-id')); if (!p) return;
    var f = e.target.getAttribute('data-f');
    if (f === 'name') p.name = e.target.value;
    else if (f === 'price') p.price = num(e.target.value);
    else if (f === 'pack') p.pack = num(e.target.value);
    paintPeek(tr, p.name, productSum(p));
    // Попередження про однакову назву стосується обох рядків, тож перемальовуємо всі
    if (f === 'name') paintAllDups();
    persist();
    // підказка автопідстановки показує ціну й упаковку — оновлюємо за будь-якою правкою рядка, не тільки за назвою
    renderDatalist();
    updateBaseStale();
  });

  body.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') !== 'unit') return;
    var tr = e.target.closest('tr');
    var p = productById(tr.getAttribute('data-id'));
    if (!p) return;
    p.unit = e.target.value;
    paintPeek(tr, p.name, productSum(p));
    persist(); renderDatalist(); updateBaseStale();
    // Вага 1 шт потрібна лише штучним продуктам — поле зʼявляється й зникає разом з одиницею
    var nr = tr.nextElementSibling;
    if (nr && nr.classList.contains('nut-row')) syncNutUnit($('[data-nut-edit]', nr), p);
    paintNutBtn(tr, p);
  });

  // Акуратне форматування чисел після виходу з поля
  body.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f === 'price') e.target.value = num(e.target.value) ? fmt(num(e.target.value)) : '';
    if (f === 'pack') e.target.value = qtyFmt(num(e.target.value));
  }, true);

  body.addEventListener('click', function (e) {
    var card = e.target.closest('[data-row-toggle]');
    if (card) { toggleRowCard(card.closest('tr')); return; }
    var tog = e.target.closest('[data-nut-toggle]');
    if (tog) { toggleNutRow(tog.closest('tr')); return; }
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
    var p = { id: uid('p'), name: '', price: 0, pack: 0, unit: 'г', code: '', nutrition: null, allergens: null, pieceWeight: 0 };
    if (toTop) S.products.unshift(p); else S.products.push(p);
    rowOpen[p.id] = true;   // новий продукт одразу з відкритими полями — його ж прийшли заповнювати
    // КБЖУ ввімкнено — редактор теж одразу: новий продукт заповнюють за раз,
    // і зайвий тап по «КБЖУ» щоразу лише заважає
    if (S.showNutrition) nutOpen[p.id] = true;
    $('#base-search').value = '';
    renderBase(); renderSidebar(); persist();
    var tr = $('#base-body tr[data-id="' + p.id + '"]');
    if (tr) { tr.scrollIntoView({ block: 'center' }); $('[data-f=name]', tr).focus(); }
  }
  $('#nut-offer-on').addEventListener('click', function () {
    S.showNutrition = true;
    S.nutAsked = true;
    applyNutrition();
    paintNutOffer();
    repaintNutPanels();
    persist(true);
    toast('Увімкнено. КБЖУ й алергени вносяться тут, у рядку продукту');
  });

  $('#nut-offer-off').addEventListener('click', function () {
    S.nutAsked = true;
    paintNutOffer();
    persist(true);
  });

  $('#btn-add-product').addEventListener('click', function () { addProduct(true); });
  $('#btn-add-product-2').addEventListener('click', function () { addProduct(false); });
  $$('[data-refresh-all]').forEach(function (b) { b.addEventListener('click', refreshAllRecipes); });
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
  updateBaseStale();
}

function expBaseRow(x) {
  var tr = document.createElement('tr');
  tr.setAttribute('data-id', x.id);
  if (rowOpen[x.id]) tr.className = 'is-edit';
  tr.innerHTML =
    '<td>' + peekHtml() + '<input class="inp" data-f="name" placeholder="Назва витрати" autocomplete="off"></td>' +
    '<td class="t-mid" data-lbl="Тип">' + modeSelect(x.mode) + '</td>' +
    '<td data-lbl="Значення"><span class="qty-wrap"><input class="inp is-num" data-f="value" inputmode="decimal" autocomplete="off" placeholder="0,00"><span class="unit-tag" data-suffix hidden>%</span></span></td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-expbase aria-label="Видалити витрату">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = x.name;
  paintExpValue(tr, x);
  syncExpSuffix(tr);
  paintPeek(tr, x.name, expenseSum(x));
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
    paintPeek(tr, x.name, expenseSum(x));
    persist();
    renderExpDatalist();
    updateBaseStale();
  });

  body.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') !== 'mode') return;
    var tr = e.target.closest('tr');
    var x = expenseById(tr.getAttribute('data-id'));
    if (!x) return;
    x.mode = e.target.value === 'pct' ? 'pct' : 'sum';
    syncExpSuffix(tr); paintExpValue(tr, x); paintPeek(tr, x.name, expenseSum(x));
    persist(); renderExpDatalist(); updateBaseStale();
  });

  body.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f !== 'value') return;
    var tr = e.target.closest('tr');
    var x = expenseById(tr.getAttribute('data-id'));
    if (x) paintExpValue(tr, x);
  }, true);

  body.addEventListener('click', function (e) {
    var card = e.target.closest('[data-row-toggle]');
    if (card) { toggleRowCard(card.closest('tr')); return; }
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
    rowOpen[x.id] = true;
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

/* ═════════════════ 9b. Напівфабрикати ═════════════════
   Заготовка зі своїм складом і виходом: тісто, крем, начинка. У калькуляцію
   потрапляє не одним рядком, а всіма складниками — перерахованими під потрібну
   кількість. Редактор навмисне побудований на тих самих ingRow()/autofill(),
   що й калькуляція: та сама таблиця, ті самі звички. */

function renderPreps() {
  var body = $('#prep-body');
  var q = $('#prep-search').value.trim().toLowerCase();
  body.innerHTML = '';

  var list = S.preps.filter(function (p) {
    return !q || p.name.toLowerCase().indexOf(q) !== -1;
  });

  if (!list.length) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="tbl-empty"><b style="display:block;margin-bottom:6px;font-size:16px;color:var(--fg)">' +
      (q ? 'Нічого не знайшли за запитом «' + esc(q) + '»' : 'Напівфабрикатів ще немає') + '</b>' +
      (q ? 'Спробуйте коротший запит або створіть новий напівфабрикат.'
         : 'Заведіть тісто чи крем один раз — далі додаватимете його в страви однією дією.') + '</td>';
    body.appendChild(tr);
  } else {
    list.forEach(function (p) { body.appendChild(prepRow(p)); });
  }

  $('#prep-tip').textContent = S.preps.length
    ? S.preps.length + ' ' + plural(S.preps.length, 'напівфабрикат', 'напівфабрикати', 'напівфабрикатів') + ' у базі'
    : '';
}

function prepRow(p) {
  var tr = document.createElement('tr');
  var n = p.ing.length;
  var ready = num(p['yield']) > 0;
  tr.setAttribute('data-id', p.id);
  var sum = n + ' ' + plural(n, 'складник', 'складники', 'складників') +
            (ready ? ' · ' + qtyFmt(p['yield']) + ' ' + p.unit : '') +
            (n ? ' · ' + money(prepCost(p)) : '') +
            (ready && n ? ' · ' + fmt(prepUnitValue(p)) + ' за 100' : '');
  tr.innerHTML =
    '<td><button class="prep-name-btn" data-open-prep>' + esc(p.name || 'Без назви') + '</button>' +
      '<span class="m-sum">' + esc(sum) + '</span></td>' +
    '<td class="t-mono" data-lbl="Складників">' + n + '</td>' +
    '<td class="t-mono' + (ready ? '' : ' t-empty') + '" data-lbl="Вихід">' + (ready ? qtyFmt(p['yield']) + ' ' + p.unit : '—') + '</td>' +
    '<td class="t-cost' + (n ? '' : ' t-empty') + '" data-lbl="Собівартість">' + (n ? fmt(prepCost(p)) : '—') + '</td>' +
    '<td class="t-mono' + (ready ? '' : ' t-empty') + '" data-lbl="За 100">' + (ready ? fmt(prepUnitValue(p)) : '—') + '</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-prep aria-label="Видалити напівфабрикат">' + ICON_X + '</button></td>';
  return tr;
}

/* Скільки рецептів уже спираються на цю заготовку — питаємо перед видаленням.
   Самі рецепти не постраждають: у них лежать копії рядків, а не посилання. */
function prepUsage(id) {
  var n = 0;
  S.folders.forEach(function (f) {
    f.recipes.forEach(function (r) {
      if ((r.groups || []).some(function (g) { return g.prepId === id; })) n++;
    });
  });
  return n;
}

function deletePrep(p) {
  var used = prepUsage(p.id);
  ask({
    title: 'Видалити напівфабрикат?',
    sub: '«' + (p.name || 'Без назви') + '» зникне з бази.' +
         // Формулювання навмисне безособове: «1 калькуляція … вони не постраждають»
         // не узгоджується, а число тут може бути будь-яке
         (used ? ' Калькуляції, які його використовують (' + used + '), не постраждають — у них лежить копія складників.' : ''),
    input: false, ok: 'Видалити', danger: true
  }, function () {
    S.preps = S.preps.filter(function (x) { return x.id !== p.id; });
    closeAsk();
    if (editingPrepId === p.id) { editingPrepId = null; S.ui.prepId = null; show('prep'); }
    renderPreps(); renderSidebar(); persist(true);
    toast('Напівфабрикат видалено');
  });
}

function bindPreps() {
  var body = $('#prep-body');

  body.addEventListener('click', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    var p = prepById(tr.getAttribute('data-id')); if (!p) return;
    if (e.target.closest('[data-del-prep]')) { deletePrep(p); return; }
    if (e.target.closest('[data-open-prep]')) openPrep(p.id);
  });

  $('#prep-search').addEventListener('input', renderPreps);

  function addPrep() {
    var p = { id: uid('k'), name: '', ing: [], 'yield': 0, unit: 'г' };
    S.preps.unshift(p);
    $('#prep-search').value = '';
    renderPreps(); renderSidebar(); persist();
    openPrep(p.id);
    $('#prep-name').focus();
  }
  $('#btn-add-prep').addEventListener('click', addPrep);
  $('#btn-add-prep-2').addEventListener('click', addPrep);
}

/* ── Редактор ───────────────────────────────────────────────── */

var editingPrepId = null;

function editingPrep() { return prepById(editingPrepId); }

function openPrep(id) {
  var p = prepById(id); if (!p) return;
  editingPrepId = id;
  S.ui.prepId = id;

  $('#prep-name').value = p.name || '';
  $('#prep-unit').innerHTML = UNITS.map(function (u) {
    return '<option value="' + u + '"' + (u === p.unit ? ' selected' : '') + '>' + u + '</option>';
  }).join('');
  $('#prep-yield').value = qtyFmt(p['yield']);

  var ib = $('#prep-ing-body'); ib.innerHTML = '';
  var ing = p.ing.slice();
  while (ing.length < 4) ing.push(null);
  ing.forEach(function (i) { ib.appendChild(ingRow(i)); });

  prepRecalc();
  updatePrepStale();
  show('prep-edit', 'prep');
}

/* Як і на калькуляції — перевіряємо тільки на відкритті, інакше смуга
   спливала б у відповідь на власну ж правку ціни користувачем. */
function updatePrepStale() {
  var p = editingPrep();
  var bar = $('#prep-stale');
  if (!p) { bar.hidden = true; return; }
  var res = syncWithBase(p, true);
  bar.hidden = !res.changed;
  if (!res.changed) return;
  $('#prep-stale-txt').innerHTML = ICON_SYNC + '<span>' + esc(res.changed + ' ' +
    plural(res.changed, 'складник рахується', 'складники рахуються', 'складників рахуються') +
    ' за старими цінами') + '</span>';
}

function refreshPrepPrices() {
  var p = editingPrep(); if (!p) return;
  var res = syncWithBase(p, false);
  if (!res.changed) { updatePrepStale(); toast('Тут уже поточні ціни'); return; }

  openPrep(p.id);          // перемальовує склад із новими цінами
  persist(true);
  renderPreps();

  var msg = 'Оновлено ' + res.changed + ' ' + plural(res.changed, 'складник', 'складники', 'складників');
  if (res.skipped) {
    msg += ', ' + res.skipped + ' ' + plural(res.skipped, 'складник', 'складники', 'складників') +
           ' пропущено — у базі інша одиниця виміру';
  }
  toast(msg);
}

/** Зчитує таблицю складу в об'єкт напівфабрикату й перемальовує підсумки. */
function prepRecalc() {
  var p = editingPrep(); if (!p) return;

  var rows = $$('#prep-ing-body tr').map(function (tr) {
    return {
      name: $('[data-f=name]', tr).value.trim(),
      price: num($('[data-f=price]', tr).value),
      pack: num($('[data-f=pack]', tr).value),
      unit: $('[data-f=unit]', tr).value,
      qty: num($('[data-f=qty]', tr).value)
    };
  });

  $$('#prep-ing-body tr').forEach(function (tr, idx) {
    var i = rows[idx];
    paintPeek(tr, i.name, ingSum(i));
    var cell = $('.t-cost', tr);
    var ok = i.price > 0 && i.pack > 0 && i.qty > 0;
    cell.textContent = ok ? fmt(ingCost(i)) : '—';
    cell.classList.toggle('t-empty', !ok);
  });

  p.name = $('#prep-name').value.trim();
  p.unit = $('#prep-unit').value;
  p['yield'] = num($('#prep-yield').value);
  p.ing = rows.filter(function (i) { return i.name || i.price || i.pack || i.qty; });

  var cost = prepCost(p);
  var ready = num(p['yield']) > 0;

  $('#prep-sum').textContent = p.ing.length ? money(cost) : '—';
  $('#prep-r-count').textContent = p.ing.length;
  $('#prep-r-cost').textContent = money(cost);
  $('#prep-r-unit-lbl').textContent = prepUnitLabel(p);
  $('#prep-r-unit').textContent = ready ? money(prepUnitValue(p)) : '—';

  // Підказка про вихід має сенс, лише поки всі складники в одній одиниці:
  // яйця в штуках у грами не додаються.
  var auto = autoYield(p);
  var btn = $('#prep-yield-auto');
  var showAuto = auto > 0 && Math.abs(auto - num(p['yield'])) > 0.005;
  btn.hidden = !showAuto;
  if (showAuto) btn.textContent = 'Сума складників — ' + qtyFmt(auto) + ' ' + p.unit + '. Підставити';

  paintPrepNut(p);
  persist();
}

/** Сума ваги складників — лише якщо всі вони в тій самій одиниці, що й вихід. */
function autoYield(p) {
  var sum = 0;
  for (var i = 0; i < p.ing.length; i++) {
    if (p.ing[i].unit !== p.unit) return 0;
    sum += num(p.ing[i].qty);
  }
  return sum;
}

function bindPrepEdit() {
  var ib = $('#prep-ing-body');

  ib.addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.getAttribute('data-f') === 'name') autofill(tr);
    prepRecalc();
  });
  ib.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') === 'unit') { syncUnitTag(e.target.closest('tr')); prepRecalc(); }
  });
  ib.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f === 'price') e.target.value = num(e.target.value) ? fmt(num(e.target.value)) : '';
    if (f === 'pack' || f === 'qty') e.target.value = qtyFmt(num(e.target.value));
  }, true);

  ib.addEventListener('click', function (e) {
    var rt = rowTapTarget(e);
    if (rt) { toggleRowCard(rt); return; }
    if (!e.target.closest('[data-del-row]')) return;
    e.target.closest('tr').remove();
    if (!ib.children.length) ib.appendChild(ingRow(null));
    prepRecalc();
  });

  ib.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var tr = e.target.closest('tr');
    if (tr && tr === ib.lastElementChild) {
      var n = ingRow(null); ib.appendChild(n); $('[data-f=name]', n).focus(); prepRecalc();
    } else if (tr && tr.nextElementSibling) {
      $('[data-f=name]', tr.nextElementSibling).focus();
    }
  });

  $('#btn-add-prep-ing').addEventListener('click', function () {
    var tr = ingRow(null); ib.appendChild(tr); $('[data-f=name]', tr).focus(); prepRecalc();
  });

  $('#prep-name').addEventListener('input', prepRecalc);
  $('#prep-yield').addEventListener('input', prepRecalc);
  $('#prep-yield').addEventListener('blur', function () { this.value = qtyFmt(num(this.value)); });
  $('#prep-unit').addEventListener('change', prepRecalc);

  $('#prep-yield-auto').addEventListener('click', function () {
    var p = editingPrep(); if (!p) return;
    $('#prep-yield').value = qtyFmt(autoYield(p));
    prepRecalc();
  });

  $('#btn-del-prep').addEventListener('click', function () {
    var p = editingPrep(); if (p) deletePrep(p);
  });
  $('#btn-refresh-prep').addEventListener('click', refreshPrepPrices);

  function done() {
    var p = editingPrep();
    if (p && !p.name) { toast('Вкажіть назву напівфабрикату'); $('#prep-name').focus(); return; }
    if (p && !num(p['yield'])) { toast('Вкажіть вихід — без нього не порахувати вартість у страві'); $('#prep-yield').focus(); return; }
    persist(true);
    renderPreps(); renderSidebar();
    show('prep');
  }
  $('#btn-prep-done').addEventListener('click', done);
  $('#prep-back').addEventListener('click', function () {
    persist(true); renderPreps(); renderSidebar(); show('prep');
  });
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

  $$('#seg-view button').forEach(function (b) {
    b.setAttribute('aria-pressed', +b.getAttribute('data-cols') === S.ui.folderCols ? 'true' : 'false');
  });

  var grid = $('#folder-grid');
  var list = visibleRecipes(f);
  // Клас діє лише в мобільному CSS — на компʼютері вибір нічого не міняє
  grid.classList.toggle('is-2col', S.ui.folderCols === 2);
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
  // Видаляють калькуляцію з неї самої (кнопка «Видалити» в підсумку):
  // хрестик на картці ловив випадкові тапи, коли гортаєш папку пальцем
  $('#folder-grid').addEventListener('click', function (e) {
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

  $('#seg-view').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cols]'); if (!b) return;
    S.ui.folderCols = +b.getAttribute('data-cols');
    renderFolder(); persist();
  });

  $('#nav-folders').addEventListener('click', function (e) {
    var b = e.target.closest('[data-folder]');
    if (b) leaveCalc(function () { openFolder(b.getAttribute('data-folder')); });
  });

  $('#btn-add-folder').addEventListener('click', function () {
    ask({ title: 'Нова папка', placeholder: 'Наприклад, Чізкейки', ok: 'Створити' }, function (v) {
      var f = { id: uid('f'), title: v, recipes: [] };
      S.folders.push(f);
      closeAsk(); renderSidebar(); persist(true);
      toast('Папку «' + v + '» створено');
      leaveCalc(function () { openFolder(f.id); });
    });
  });
}

/* ═════════════════ 11. Калькуляція ═════════════════ */

var calcPhoto = null;   // dataURL поточної калькуляції

function ingRow(data) {
  var v = data || { name: '', price: 0, pack: 0, unit: 'г', qty: 0 };
  var tr = document.createElement('tr');
  if (v.g) { tr.className = 'ing-child'; tr.setAttribute('data-g', v.g); }
  tr.innerHTML =
    '<td>' + peekHtml() + '<input class="inp" data-f="name" list="dl-products" placeholder="Почніть вводити назву" autocomplete="off"></td>' +
    '<td data-lbl="Ціна"><input class="inp is-num" data-f="price" inputmode="decimal" autocomplete="off" placeholder="0,00"></td>' +
    '<td data-lbl="Упаковка"><span class="cell-pair"><input class="inp is-num" data-f="pack" inputmode="decimal" autocomplete="off" placeholder="0">' + unitSelect(v.unit) + '</span></td>' +
    '<td data-lbl="Скільки"><span class="qty-wrap"><input class="inp is-num" data-f="qty" inputmode="decimal" autocomplete="off" placeholder="0"><span class="unit-tag">' + esc(v.unit) + '</span></span></td>' +
    '<td class="t-cost t-empty" data-lbl="Вартість">—</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-row aria-label="Видалити рядок">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = v.name;
  $('[data-f=price]', tr).value = v.price ? fmt(v.price) : '';
  $('[data-f=pack]', tr).value = qtyFmt(v.pack);
  $('[data-f=qty]', tr).value = qtyFmt(v.qty);
  // Рядок без назви відкритий одразу — його щойно додали, щоб заповнити
  if (!v.name) tr.classList.add('is-edit');
  paintPeek(tr, v.name, ingSum(v));
  return tr;
}

/* Шапка групи. Дані групи живуть в атрибутах самого рядка — так таблиця
   лишається єдиним джерелом правди для readCalc(), як і решта полів екрана. */
function groupRow(g) {
  var unit = g.unit || 'г';
  var tr = document.createElement('tr');
  tr.className = 'ing-group';
  tr.setAttribute('data-group', g.id);
  tr.setAttribute('data-prep', g.prepId || '');
  tr.setAttribute('data-name', g.name || '');
  tr.setAttribute('data-of', g.of || 0);
  tr.setAttribute('data-unit', unit);
  tr.setAttribute('data-take', g.take || 0);
  tr.innerHTML =
    '<td colspan="3"><span class="grp-head">' +
      '<button class="grp-chev" data-grp-toggle aria-label="Згорнути складники">' + ICON_CHEV + '</button>' +
      '<span class="grp-name">' + esc(g.name || 'Напівфабрикат') + '</span>' +
      '<span class="grp-of">із ' + qtyFmt(g.of) + ' ' + esc(unit) + '</span>' +
      '<button class="link-btn grp-unlink" data-grp-unlink>розгрупувати</button>' +
    '</span></td>' +
    '<td data-lbl="Взяти"><span class="qty-wrap"><input class="inp is-num" data-grp-take inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Скільки взяти">' +
      '<span class="unit-tag">' + esc(unit) + '</span></span></td>' +
    '<td class="t-cost t-empty" data-lbl="Вартість">—</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-grp-del aria-label="Видалити напівфабрикат">' + ICON_X + '</button></td>';
  $('[data-grp-take]', tr).value = qtyFmt(g.take);
  return tr;
}

function ingRows() { return $$('#ing-body tr:not(.ing-group)'); }
function grpRows() { return $$('#ing-body tr.ing-group'); }
function groupChildren(gtr) {
  return $$('#ing-body tr[data-g="' + gtr.getAttribute('data-group') + '"]');
}

/** Рейка обривається на половині останнього складника — так видно, де група закінчилась. */
function paintGroupRails() {
  $$('#ing-body tr.ing-child').forEach(function (tr) {
    var g = tr.getAttribute('data-g');
    var next = tr.nextElementSibling;
    tr.classList.toggle('is-last', !next || next.getAttribute('data-g') !== g);
  });
}

function expRow(data) {
  var v = data || { name: '', mode: 'sum', value: 0 };
  var tr = document.createElement('tr');
  tr.innerHTML =
    '<td>' + peekHtml() + '<input class="inp" data-f="name" list="dl-expenses" placeholder="Наприклад, коробка" autocomplete="off"></td>' +
    '<td class="t-mid" data-lbl="Тип">' + modeSelect(v.mode) + '</td>' +
    '<td data-lbl="Значення"><span class="qty-wrap"><input class="inp is-num" data-f="value" inputmode="decimal" autocomplete="off" placeholder="0,00"><span class="unit-tag" data-suffix hidden>%</span></span></td>' +
    '<td class="t-cost t-empty" data-lbl="Вартість">—</td>' +
    '<td class="t-act"><button class="icon-btn is-danger" data-del-row aria-label="Видалити рядок">' + ICON_X + '</button></td>';
  $('[data-f=name]', tr).value = v.name;
  paintExpValue(tr, v);
  syncExpSuffix(tr);
  // Як і в інгредієнта: порожній рядок відкритий, заповнений — згорнутий до підсумку
  if (!v.name) tr.classList.add('is-edit');
  paintPeek(tr, v.name, expRowSum(v));
  return tr;
}

/** Зчитує поточний стан екрана калькуляції в обʼєкт рецепта. */
function readCalc() {
  return {
    name: $('#calc-name').value.trim(),
    photo: calcPhoto,
    margin: num($('#margin-inp').value),
    // Підставлена сума інгредієнтів — не значення рецепта: 0 означає «рахувати самим».
    // У полі кілограми, у рецепті — грами, як і всі ваги застосунку
    outWeight: $('#calc-outw').dataset.manual ? Math.round(num($('#calc-outw').value) * 1000) : 0,
    ing: ingRows().map(function (tr) {
      var g = tr.getAttribute('data-g');
      var o = {
        name: $('[data-f=name]', tr).value.trim(),
        price: num($('[data-f=price]', tr).value),
        pack: num($('[data-f=pack]', tr).value),
        unit: $('[data-f=unit]', tr).value,
        qty: num($('[data-f=qty]', tr).value)
      };
      if (g) o.g = g;
      return o;
    }),
    groups: grpRows().map(function (tr) {
      return {
        id: tr.getAttribute('data-group'),
        prepId: tr.getAttribute('data-prep') || null,
        name: tr.getAttribute('data-name'),
        take: num($('[data-grp-take]', tr).value),
        of: num(tr.getAttribute('data-of')),
        unit: tr.getAttribute('data-unit')
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
  var ing = d.ing.filter(function (i) { return i.name || i.price || i.pack || i.qty; });
  return {
    name: d.name,
    photo: d.photo,
    margin: d.margin,
    outWeight: num(d.outWeight),
    ing: ing,
    // Група без жодного складника не має сенсу: рядки могли прибрати вручну
    groups: (d.groups || []).filter(function (g) {
      return ing.some(function (i) { return i.g === g.id; });
    }),
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

  ingRows().forEach(function (tr, idx) {
    var i = d.ing[idx];
    var cell = $('.t-cost', tr);
    var ok = i.price > 0 && i.pack > 0 && i.qty > 0;
    cell.textContent = ok ? fmt(ingCost(i)) : '—';
    cell.classList.toggle('t-empty', !ok);
    paintPeek(tr, i.name, ingSum(i));
  });

  // Підсумок групи — сума її складників: у згорнутому вигляді це єдина видима цифра
  grpRows().forEach(function (tr) {
    var id = tr.getAttribute('data-group'), sum = 0;
    d.ing.forEach(function (i) { if (i.g === id) sum += ingCost(i); });
    var cell = $('.t-cost', tr);
    cell.textContent = sum > 0 ? fmt(sum) : '—';
    cell.classList.toggle('t-empty', !(sum > 0));
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
    paintPeek(tr, e.name, expRowSum(e));
  });

  paintReceipt(t, d.margin);
  // Вага виробу — у шапці й потрібна всім, а не лише з увімкненим КБЖУ
  paintOutWeight(nutritionOf(d.ing).mass);
  paintCalcNut(d);
  // Змінили вагу чи продукти — «Було» в панелі не має брехати
  if (!$('#calc-scale').hidden) paintScalePanel(calcBaseWeight());

  S.draft = cleanRecipe(d);
  // Збережена калькуляція «змінена», лише поки відрізняється від того, як її відкрили:
  // змінили й повернули як було — знову «Збережено», і вихід нічого не питає
  draftDirty = calcDiffers(S.draft);
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
  var ow = $('#calc-outw');
  if (num(rec.outWeight) > 0) { ow.dataset.manual = '1'; ow.value = qtyFmt(num(rec.outWeight) / 1000); }
  else { delete ow.dataset.manual; ow.value = ''; }   // суму інгредієнтів підставить recalc()
  scaleSnap = null;                                   // інша калькуляція — відміняти перерахунок уже нічого
  $('#scale-to').value = '';
  closeScalePanel();

  setPhoto(rec.photo || null);

  var ib = $('#ing-body'); ib.innerHTML = '';
  var ing = (rec.ing || []).slice();
  var groups = rec.groups || [];
  if (!ing.length) ing.push(null);                    // порожня калькуляція — один рядок, а не купа полів
  // Шапка групи йде перед її першим складником — порядок рядків беремо зі стану
  var seenGroup = {};
  ing.forEach(function (i) {
    if (i && i.g && !seenGroup[i.g]) {
      var g = byId(groups, i.g);
      if (g) { ib.appendChild(groupRow(g)); seenGroup[i.g] = 1; }
    }
    ib.appendChild(ingRow(i));
  });
  paintGroupRails();

  var eb = $('#exp-body'); eb.innerHTML = '';
  var exp = (rec.exp || []).slice();
  if (!exp.length) exp.push(null);                    // так само тут: далі додають кнопкою
  exp.forEach(function (e) { eb.appendChild(expRow(e)); });

  recalc();
  draftDirty = false;   // щойно завантажили — незбережених правок ще немає
  calcBaseline = calcSnapshot();
  updateSaveBtn();
  updateCalcStale();
}

/**
 * Смуга «ціни змінились» над таблицею. Перевіряємо лише на завантаженні
 * рецепта, а не на кожну правку: якщо людина щойно вручну виправила ціну
 * в рядку, той рядок теж «розійшовся з базою» — і смуга спливала б у
 * відповідь на власну ж дію користувача.
 */
function updateCalcStale() {
  var res = syncWithBase(readCalc(), true);
  var bar = $('#calc-stale');
  bar.hidden = !res.changed;
  if (!res.changed) return;
  $('#calc-stale-txt').innerHTML = ICON_SYNC + '<span>' + esc(res.changed + ' ' +
    plural(res.changed, 'рядок рахується', 'рядки рахуються', 'рядків рахуються') +
    ' за старими цінами') + '</span>';
}

function refreshCalcPrices() {
  var d = cleanRecipe(readCalc());
  var res = syncWithBase(d, false);
  if (!res.changed) { updateCalcStale(); toast('Тут уже поточні ціни'); return; }

  loadCalc(d, $('#calc-crumb').textContent);
  draftDirty = true;             // рецепт розійшовся зі збереженою версією
  updateSaveBtn();

  var msg = 'Оновлено ' + res.changed + ' ' + plural(res.changed, 'рядок', 'рядки', 'рядків');
  if (res.skipped) {
    msg += ', ' + res.skipped + ' ' + plural(res.skipped, 'рядок', 'рядки', 'рядків') +
           ' пропущено — у базі інша одиниця виміру';
  }
  if (S.ui.editing) msg += '. Натисніть «Оновити калькуляцію», щоб зберегти';
  toast(msg);
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
  $('#btn-save').textContent = S.ui.editing ? 'Оновити калькуляцію' : 'Зберегти калькуляцію';  var st = $('#save-state');
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

/* ── Вихід із калькуляції з незбереженими змінами ──────────────
   Питаємо при будь-якому переході з екрана калькуляції: меню, «←», «Назад»
   браузера чи жест на телефоні. Інакше «Нова калькуляція» чи відкрита з папки
   інша мовчки затирали чернетку. */

var calcBaseline = null;   // знімок збереженої калькуляції, як її відкрили чи зберегли; null — невідомо
var leaveGo = null;        // куди йти після відповіді у вікні
var afterSave = null;      // перехід, відкладений до кінця збереження («Зберегти» у вікні)

function calcSnapshot() { return JSON.stringify(cleanRecipe(readCalc())); }

/** d — cleanRecipe поточного екрана. Нова чернетка завжди «не в папці». */
function calcDiffers(d) {
  return !S.ui.editing || calcBaseline === null || JSON.stringify(d) !== calcBaseline;
}

/**
 * Чи пропаде щось, якщо зараз піти з калькуляції. Порожня нова (нічого не
 * вписали, лише відкрили) — ні: питати про неї тільки дратувало б.
 */
function calcUnsaved() {
  if (S.ui.screen !== 'calc') return false;
  var d = cleanRecipe(readCalc());
  if (!S.ui.editing) return !!(d.name || d.photo || d.ing.length || d.exp.length);
  return calcDiffers(d);
}

/** go — сам перехід. Без незбереженого виконується одразу. */
function leaveCalc(go) {
  if (!calcUnsaved()) { go(); return; }
  leaveGo = go;
  var name = $('#calc-name').value.trim();
  $('#leave-sub').textContent = S.ui.editing
    ? '«' + (name || 'Без назви') + '» — зміни ще не збережено. Якщо вийти, вони пропадуть.'
    : (name ? '«' + name + '» ще не збережено в папку.' : 'Калькуляцію ще не збережено в папку.') +
      ' Якщо вийти, вона пропаде.';
  $('#leave-overlay').classList.add('is-on');
  setTimeout(function () { $('#leave-save').focus(); }, 30);
}

function closeLeave() { $('#leave-overlay').classList.remove('is-on'); leaveGo = null; }

/**
 * «Вийти без збереження»: екран калькуляції повертається до збереженої версії
 * (або порожнього), а не лишається з відкинутими правками. Інакше перерахунок
 * валюти чи «Назад» у браузері підняли б їх назад у чернетку.
 */
function discardCalc() {
  var ed = S.ui.editing, f = ed && folderById(ed.folderId);
  var r = f && f.recipes.filter(function (x) { return x.id === ed.recipeId; })[0];
  if (r) {
    loadCalc(r, f.title);
  } else {
    S.ui.editing = null;
    loadCalc({ name: '', margin: 50, ing: [], exp: [] }, 'Нова калькуляція');
    S.draft = null;
  }
  persist(true);
}

function bindCalc() {
  var ib = $('#ing-body'), eb = $('#exp-body');

  ib.addEventListener('input', function (e) {
    var tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.getAttribute('data-f') === 'name') autofill(tr);
    recalc();
  });
  ib.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-f') === 'unit') { syncUnitTag(e.target.closest('tr')); recalc(); return; }
    // Кількість групи міняємо на change, а не на кожну натиснуту клавішу:
    // інакше «300» під час набору встигло б перерахувати склад тричі.
    if (e.target.hasAttribute('data-grp-take')) rescaleGroup(e.target.closest('tr'));
  });
  ib.addEventListener('blur', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f === 'price') e.target.value = num(e.target.value) ? fmt(num(e.target.value)) : '';
    if (f === 'pack' || f === 'qty') e.target.value = qtyFmt(num(e.target.value));
  }, true);

  // Згорнутий інгредієнт на телефоні: тап по рядку відкриває його поля
  ib.addEventListener('click', function (e) {
    var tr = rowTapTarget(e);
    if (tr) toggleRowCard(tr);
  });

  // Дії на шапці групи
  ib.addEventListener('click', function (e) {
    var gtr = e.target.closest('tr.ing-group'); if (!gtr) return;
    if (e.target.closest('[data-grp-toggle]')) { toggleGroup(gtr); return; }
    if (e.target.closest('[data-grp-unlink]')) { unlinkGroup(gtr); return; }
    if (e.target.closest('[data-grp-del]')) deleteGroup(gtr);
  });

  // Згорнута витрата на телефоні відкривається тапом по рядку, як інгредієнт
  eb.addEventListener('click', function (e) {
    var tr = rowTapTarget(e);
    if (tr) toggleRowCard(tr);
  });

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
      var tr = btn.closest('tr');
      var gid = tr.getAttribute('data-g');
      tr.remove();
      // Пішов останній складник — шапці групи більше нема над чим стояти
      if (gid && !$$('#ing-body tr[data-g="' + gid + '"]').length) {
        var gtr = $('#ing-body tr.ing-group[data-group="' + gid + '"]');
        if (gtr) gtr.remove();
      }
      if (!body.children.length) body.appendChild(body === ib ? ingRow(null) : expRow(null));
      if (body === ib) paintGroupRails();
      recalc();
    });
  });

  $('#btn-add-ing').addEventListener('click', function () {
    var tr = ingRow(null); ib.appendChild(tr); $('[data-f=name]', tr).focus(); recalc();
  });
  $('#btn-add-group').addEventListener('click', openPrepPick);
  $('#btn-refresh-calc').addEventListener('click', refreshCalcPrices);
  $('#btn-add-exp').addEventListener('click', function () {
    var tr = expRow(null); eb.appendChild(tr); $('[data-f=name]', tr).focus(); recalc();
  });

  $('#calc-back').addEventListener('click', function () { leaveCalc(backFromCalc); });

  // Вікно «Є незбережені зміни»
  $('#leave-save').addEventListener('click', function () {
    var go = leaveGo;
    closeLeave();
    openSaveModal(false);
    // Не відкрилось (нема назви чи інгредієнтів) — лишаємось, підказку вже показано
    if ($('#save-overlay').classList.contains('is-on')) afterSave = go;
  });
  $('#leave-discard').addEventListener('click', function () {
    var go = leaveGo;
    closeLeave();
    discardCalc();
    if (go) go();
  });
  $('#leave-cancel').addEventListener('click', closeLeave);
  $('#leave-overlay').addEventListener('click', function (e) { if (e.target === this) closeLeave(); });
  $('#calc-name').addEventListener('input', recalc);
  $('#margin-inp').addEventListener('input', recalc);
  $('#margin-inp').addEventListener('blur', function () {
    this.value = qtyFmt(num(this.value)) || '0';
  });
  // Вага готового виробу: своє число — ручне значення, порожнє поле — знову сума інгредієнтів
  var ow = $('#calc-outw');
  ow.addEventListener('focus', function () {
    if (!ow.dataset.manual) ow.select();   // підставлене число замінюють, а не дописують
  });
  ow.addEventListener('input', function () {
    if (num(ow.value) > 0) ow.dataset.manual = '1'; else delete ow.dataset.manual;
    recalc();
  });
  ow.addEventListener('blur', function () {
    if (ow.dataset.manual) ow.value = qtyFmt(num(ow.value));
    // Стерли число — одразу повертаємо суму. Не recalc(): той позначив би «є зміни»
    else paintOutWeight(nutritionOf(readCalc().ing).mass, true);
  });
  $('#calc-outw-reset').addEventListener('click', function () {
    delete ow.dataset.manual;
    ow.value = '';
    recalc();
  });

  // Та сама кнопка й закриває панель — щоб не шукати «Скасувати»
  $('#btn-scale').addEventListener('click', function () {
    if ($('#calc-scale').hidden) openScalePanel(); else closeScalePanel();
  });
  var st = $('#scale-to');
  st.addEventListener('input', function () { paintScalePanel(calcBaseWeight()); });
  st.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyScale(); }
    else if (e.key === 'Escape') closeScalePanel();
  });
  $('#scale-apply').addEventListener('click', applyScale);
  $('#scale-cancel').addEventListener('click', closeScalePanel);
  $('#btn-scaled-undo').addEventListener('click', undoScale);

  // «Замінити цю» — звичайне збереження поверх; смугу прибере саме збереження
  $('#btn-scaled-replace').addEventListener('click', function () { openSaveModal(false); });

  // «Зберегти як нову»: базова лишається в папці, до назви дописується вага —
  // інакше в папці стояли б дві однакові картки. Застосовується при підтвердженні
  $('#btn-scaled-new').addEventListener('click', function () { openSaveModal(true); });
  $('#margin-quick').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]'); if (!b) return;
    $('#margin-inp').value = b.getAttribute('data-m');
    recalc();
  });

  // «Видалити» замінило «Очистити» й хрестик на картці в папці. Збережену
  // калькуляцію прибирає з папки; ще не збережену — просто відкидає.
  $('#btn-del-calc').addEventListener('click', function () {
    var ed = S.ui.editing;
    var f = ed && folderById(ed.folderId);
    var r = f && f.recipes.filter(function (x) { return x.id === ed.recipeId; })[0];

    ask(r ? {
      title: 'Видалити калькуляцію?',
      sub: '«' + r.name + '» зникне з папки «' + f.title + '» безповоротно.',
      input: false, ok: 'Видалити', danger: true
    } : {
      title: 'Видалити чернетку?',
      sub: 'Калькуляцію ще не збережено в папку — усе, що на цьому екрані, буде втрачено.',
      input: false, ok: 'Видалити', danger: true
    }, function () {
      closeAsk();
      S.draft = null;
      draftDirty = false;   // інакше beforeunload ще питав би про «незбережене»
      if (r) {
        f.recipes = f.recipes.filter(function (x) { return x.id !== r.id; });
        S.ui.editing = null;
        renderSidebar();
        persist(true);
        // Замість кроку калькуляції, а не поверх: «Назад» не має вести у видалене
        navReplace = true; openFolder(f.id); navReplace = false;
        toast('Калькуляцію «' + r.name + '» видалено');
      } else {
        persist(true);
        navReplace = true; backFromCalc(); navReplace = false;
        toast('Чернетку видалено');
      }
    });
  });

  // Enter у полі інгредієнта → наступний рядок
  ib.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // У кількості групи Enter означає «застосувати», а не «наступний рядок»
    if (e.target.hasAttribute && e.target.hasAttribute('data-grp-take')) { e.target.blur(); return; }
    var tr = e.target.closest('tr');
    if (tr && tr === ib.lastElementChild) {
      var n = ingRow(null); ib.appendChild(n); $('[data-f=name]', n).focus(); recalc();
    } else if (tr && tr.nextElementSibling) {
      $('[data-f=name]', tr.nextElementSibling).focus();
    }
  });
}

/* ═════════════════ 11a. Напівфабрикат у калькуляції ═════════════════ */

function toggleGroup(gtr) {
  var closed = gtr.classList.toggle('is-closed');
  // Приховані рядки лишаються в DOM — readCalc() бачить їх як завжди,
  // тож згортання не втрачає жодної цифри.
  groupChildren(gtr).forEach(function (tr) { tr.hidden = closed; });
  $('[data-grp-toggle]', gtr).setAttribute('aria-label', closed ? 'Показати складники' : 'Згорнути складники');
}

/**
 * Перерахунок під нову кількість. Множимо те, що зараз у полях, а не вихідні
 * грамовки замісу: якщо користувач підправив масло саме в цьому торті, правка
 * має пережити зміну кількості, а не зникнути.
 */
function rescaleGroup(gtr) {
  var inp = $('[data-grp-take]', gtr);
  var take = num(inp.value);
  var prev = num(gtr.getAttribute('data-take'));

  if (take > 0 && prev > 0 && Math.abs(take - prev) > 0.0005) {
    var k = take / prev;
    groupChildren(gtr).forEach(function (tr) {
      var q = $('[data-f=qty]', tr);
      q.value = qtyFmt(num(q.value) * k);
    });
  }
  gtr.setAttribute('data-take', take);
  inp.value = qtyFmt(take);
  recalc();
}

function unlinkGroup(gtr) {
  groupChildren(gtr).forEach(function (tr) {
    tr.removeAttribute('data-g');
    tr.classList.remove('ing-child', 'is-last');
  });
  gtr.remove();
  paintGroupRails();
  recalc();
  toast('Складники лишились у калькуляції окремими рядками');
}

function deleteGroup(gtr) {
  var ib = $('#ing-body');
  ask({
    title: 'Прибрати напівфабрикат?',
    sub: '«' + (gtr.getAttribute('data-name') || 'Напівфабрикат') + '» і всі його складники зникнуть із цієї калькуляції. ' +
         'Сам напівфабрикат у базі залишиться.',
    input: false, ok: 'Прибрати', danger: true
  }, function () {
    closeAsk();
    groupChildren(gtr).forEach(function (tr) { tr.remove(); });
    gtr.remove();
    if (!ib.children.length) ib.appendChild(ingRow(null));
    paintGroupRails();
    recalc();
    toast('Напівфабрикат прибрано');
  });
}

/* ── Модалка вставки ────────────────────────────────────────── */

function pickedPrep() { return prepById($('#prep-pick').value); }

function syncPrepPickMeta(resetTake) {
  var p = pickedPrep(); if (!p) return;
  var y = num(p['yield']);
  $('#prep-pick-meta').textContent = 'Заміс ' + qtyFmt(y) + ' ' + p.unit + ' · ' + money(prepCost(p)) +
    ' · ' + p.ing.length + ' ' + plural(p.ing.length, 'складник', 'складники', 'складників');
  $('#prep-take-unit').textContent = p.unit;
  if (resetTake) $('#prep-take').value = qtyFmt(y);
  syncPrepTakeHint();
}

function syncPrepTakeHint() {
  var p = pickedPrep();
  var hint = $('#prep-take-hint');
  if (!p) { hint.textContent = ''; return; }
  var y = num(p['yield']), take = num($('#prep-take').value);
  if (!(y > 0) || !(take > 0)) { hint.textContent = ''; return; }
  var k = take / y;
  // «1 заміс», «2 заміси», але «0,25 замісу» — дробова частка вимагає родового
  var whole = Math.abs(k - Math.round(k)) < 0.0005;
  var word = whole ? plural(Math.round(k), 'заміс', 'заміси', 'замісів') : 'замісу';
  hint.textContent = qtyFmt(k) + ' ' + word + ' · ' + money(prepCost(p) * k);
}

function openPrepPick() {
  var ready = S.preps.filter(function (p) { return p.ing.length && num(p['yield']) > 0; });
  if (!ready.length) {
    toast(S.preps.length
      ? 'У напівфабрикатів бракує складу або виходу — заповніть їх у розділі «Напівфабрикати»'
      : 'Спершу створіть напівфабрикат у розділі «Напівфабрикати»');
    return;
  }
  $('#prep-pick').innerHTML = ready.map(function (p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.name || 'Без назви') + '</option>';
  }).join('');
  syncPrepPickMeta(true);
  $('#prep-overlay').classList.add('is-on');
  $('#prep-take').focus();
  $('#prep-take').select();
}

function closePrepPick() { $('#prep-overlay').classList.remove('is-on'); }

/** Чи порожній рядок інгредієнта — щоб не лишати діру перед вставленою групою. */
function isEmptyIngRow(tr) {
  return !$('[data-f=name]', tr).value.trim() &&
         !num($('[data-f=price]', tr).value) &&
         !num($('[data-f=pack]', tr).value) &&
         !num($('[data-f=qty]', tr).value);
}

function insertPrepGroup(p, take) {
  var y = num(p['yield']);
  if (!(y > 0) || !(take > 0)) return;

  var ib = $('#ing-body');
  var k = take / y;
  var gid = uid('g');

  // Стартові порожні рядки в кінці таблиці прибираємо — інакше група
  // повисне під смугою пустоти
  var tail = ib.lastElementChild;
  while (tail && !tail.classList.contains('ing-group') && !tail.getAttribute('data-g') && isEmptyIngRow(tail)) {
    var prev = tail.previousElementSibling;
    tail.remove();
    tail = prev;
  }

  ib.appendChild(groupRow({ id: gid, prepId: p.id, name: p.name, take: take, of: y, unit: p.unit }));
  p.ing.forEach(function (i) {
    ib.appendChild(ingRow({
      name: i.name, price: i.price, pack: i.pack, unit: i.unit,
      qty: num(qtyFmt(i.qty * k)), g: gid
    }));
  });
  ib.appendChild(ingRow(null));   // куди друкувати далі

  paintGroupRails();
  recalc();

  var gtr = $('#ing-body tr.ing-group[data-group="' + gid + '"]');
  if (gtr) gtr.scrollIntoView({ block: 'center' });
}

function bindPrepPick() {
  $('#prep-pick').addEventListener('change', function () { syncPrepPickMeta(true); });
  $('#prep-take').addEventListener('input', syncPrepTakeHint);
  $('#prep-take').addEventListener('blur', function () { this.value = qtyFmt(num(this.value)); });

  $('#prep-pick-cancel').addEventListener('click', closePrepPick);
  $('#prep-overlay').addEventListener('click', function (e) { if (e.target === this) closePrepPick(); });

  function confirmPick() {
    var p = pickedPrep();
    if (!p) { closePrepPick(); return; }
    var take = num($('#prep-take').value);
    if (!(take > 0)) { toast('Вкажіть, скільки потрібно'); $('#prep-take').focus(); return; }
    insertPrepGroup(p, take);
    closePrepPick();
    toast('«' + (p.name || 'Напівфабрикат') + '» додано — ' + p.ing.length + ' ' +
          plural(p.ing.length, 'складник', 'складники', 'складників'));
  }
  $('#prep-pick-ok').addEventListener('click', confirmPick);
  $('#prep-take').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); confirmPick(); }
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
/* Модалку відкрили через «Зберегти як нову». Відвʼязка від оригіналу й нова назва
   застосовуються лише в момент підтвердження: скасували — калькуляція лишилась
   тією самою, і «Замінити цю» справді замінить оригінал, а не створить копію. */
var saveAsNew = false;

/** «Медовик 1 кг» → «Медовик 2,5 кг»: стару вагу в кінці назви замінюємо, а не дописуємо поруч. */
function scaledName(name) {
  var base = String(name || '').replace(/\s*\d+(?:[.,]\d+)?\s*кг\s*$/i, '').trim();
  return (base || 'Калькуляція') + ' ' + qtyFmt(num($('#calc-outw').value)) + ' кг';
}

function openSaveModal(asNew) {
  afterSave = null;   // перехід чекає лише збереження, розпочатого з вікна «Є незбережені зміни»
  var d = cleanRecipe(readCalc());
  if (!d.name) { toast('Спочатку вкажіть назву страви'); $('#calc-name').focus(); return; }
  if (!d.ing.length) { toast('Додайте хоча б один інгредієнт'); return; }

  saveAsNew = !!asNew;
  var updating = !!S.ui.editing && !saveAsNew;
  $('#save-title').textContent = updating ? 'Оновити калькуляцію' : 'Зберегти калькуляцію';
  $('#save-sub').textContent = '«' + (saveAsNew ? scaledName(d.name) : d.name) + '» — оберіть папку';
  buildSaveList();   // папку пропонує ту саму, що в оригіналу: editing ще не чіпали
  $('#save-confirm').textContent = updating ? 'Оновити' : 'Зберегти';
  $('#save-overlay').classList.add('is-on');
}

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

  $('#btn-save').addEventListener('click', function () { openSaveModal(false); });

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
    // «Зберегти як нову» — лише тепер, після підтвердження: нова назва й без оригіналу
    var ed = saveAsNew ? null : S.ui.editing;
    if (saveAsNew) {
      d.name = scaledName(d.name);
      $('#calc-name').value = d.name;
      // І в чернетку: вона відновлюється після перезавантаження, і зі старою назвою
      // «Оновити» перейменувало б нову картку назад на «Медовик»
      if (S.draft) S.draft.name = d.name;
    }
    saveAsNew = false;

    if (ed) {
      var old = folderById(ed.folderId);
      var idx = old ? old.recipes.map(function (r) { return r.id; }).indexOf(ed.recipeId) : -1;
      var rec = (idx > -1) ? old.recipes[idx] : { id: ed.recipeId };
      rec.name = d.name; rec.photo = d.photo; rec.margin = d.margin;
      rec.ing = d.ing; rec.exp = d.exp; rec.groups = d.groups; rec.outWeight = d.outWeight;
      if (old && old.id !== target.id && idx > -1) {   // перенесли в іншу папку
        old.recipes.splice(idx, 1);
        target.recipes.push(rec);
      } else if (idx === -1) {
        target.recipes.push(rec);
      }
      S.ui.editing = { folderId: target.id, recipeId: rec.id };
      toast('Оновлено — папка «' + target.title + '»');
    } else {
      var fresh = { id: uid('r'), name: d.name, photo: d.photo, margin: d.margin, ing: d.ing, exp: d.exp, groups: d.groups, outWeight: d.outWeight };
      target.recipes.push(fresh);
      S.ui.editing = { folderId: target.id, recipeId: fresh.id };
      toast('Збережено в папку «' + target.title + '»');
    }

    $('#calc-crumb').textContent = target.title;
    replaceNav();         // крок історії тепер про збережений рецепт, а не про чернетку
    draftDirty = false;   // збережено — попереджати про втрату вже нема про що
    calcBaseline = calcSnapshot();
    updateSaveBtn();
    scaleSnap = null;   // перераховану версію збережено — відміняти вже нічого
    paintScaled();
    ov.classList.remove('is-on');
    renderSidebar();
    if (S.ui.folderId === target.id) renderFolder();
    persist(true);

    // Зберігали, щоб піти з калькуляції, — тепер і йдемо
    var next = afterSave;
    afterSave = null;
    if (next) next();
  });

  $('#save-cancel').addEventListener('click', function () { ov.classList.remove('is-on'); afterSave = null; });
  ov.addEventListener('click', function (e) { if (e.target === ov) { ov.classList.remove('is-on'); afterSave = null; } });
}

/* ═════════════════ 14. Експорт PDF (А4) ═════════════════ */

/** Техкарта без ваги виробу неповна: «на скільки» — перше, що питають. Суму позначаємо «≈». */
function pdfWeightLine(d) {
  var g = num(d.outWeight), approx = false;
  if (!(g > 0)) { g = Math.round(nutritionOf(d.ing).mass); approx = true; }
  if (!(g > 0)) return '';
  return '<div class="pdf-weight">Вага виробу: ' + (approx ? '≈ ' : '') + qtyFmt(g / 1000) + ' кг</div>';
}

/**
 * Тіло таблиці інгредієнтів: кожна група — окремий <tbody>, суцільні
 * рядки поза групами теж збираються в свій. Це не косметика: html2pdf уміє
 * не розривати сторінкою цілий елемент, і саме tbody дає йому те, за що
 * триматися — інакше склад тіста роз'їхався б на дві сторінки.
 */
function pdfIngBody(d) {
  var groups = d.groups || [];
  var out = [], cur = null;

  function flush() {
    if (!cur) return;
    out.push('<tbody' + (cur.g ? ' class="pdf-grp-body"' : '') + '>' + cur.rows.join('') + '</tbody>');
    cur = null;
  }

  d.ing.forEach(function (i) {
    var gid = i.g || null;
    if (!cur || cur.gid !== gid) {
      flush();
      cur = { gid: gid, g: gid ? byId(groups, gid) : null, rows: [] };
      if (cur.g) {
        var g = cur.g, sum = 0;
        d.ing.forEach(function (x) { if (x.g === g.id) sum += ingCost(x); });
        cur.rows.push(
          '<tr class="pdf-grp">' +
            '<td colspan="3">' + esc(g.name || 'Напівфабрикат') + '</td>' +
            '<td class="r">' + qtyFmt(g.take) + ' ' + esc(g.unit) + ' із ' + qtyFmt(g.of) + ' ' + esc(g.unit) + '</td>' +
            '<td class="r b">' + fmt(sum) + '</td>' +
          '</tr>');
      }
    }
    cur.rows.push(
      '<tr' + (gid ? ' class="pdf-sub"' : '') + '>' +
        '<td>' + esc(i.name || '—') + '</td>' +
        '<td class="r">' + fmt(i.price) + '</td>' +
        '<td class="r">' + qtyFmt(i.pack) + ' ' + i.unit + '</td>' +
        '<td class="r">' + qtyFmt(i.qty) + ' ' + i.unit + '</td>' +
        '<td class="r b">' + fmt(ingCost(i)) + '</td>' +
      '</tr>');
  });

  flush();
  return out.join('');
}

function buildPdfDoc(d, t) {
  var wrap = document.createElement('div');
  wrap.className = 'pdf-doc';

  var rows = pdfIngBody(d);

  var expRows = d.exp.map(function (e) {
    var label = e.mode === 'pct' ? (e.name || '—') + ' (' + qtyFmt(e.value) + '% від собівартості)' : (e.name || '—');
    return '<tr><td>' + esc(label) + '</td><td class="r b">' + fmt(expenseCost(e, t.cost)) + '</td></tr>';
  }).join('');

  wrap.innerHTML =
    '<div class="pdf-head"><span class="pdf-brand">FoodCost</span></div>' +

    // Фото поки свідомо не йде в експорт — повернемо пізніше
    '<h1 class="pdf-title">' + esc(d.name || 'Калькуляція') + '</h1>' +
    pdfWeightLine(d) +

    '<section class="pdf-block">' +
      '<h2 class="pdf-sec">Інгредієнти</h2>' +
      '<table class="pdf-tbl"><thead><tr>' +
        '<th>Назва</th><th class="r">Ціна упаковки</th>' +
        '<th class="r">В упаковці</th><th class="r">У страві</th><th class="r">Вартість</th>' +
      '</tr></thead>' + rows + '</table>' +
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
    '</section>' +

    // Додаток після ціни: собівартість і ціна лишаються головним у техкарті
    pdfNutBlock(d);

  return wrap;
}

/* html2pdf кладе документ на А4 з полями 12/12/14 мм → корисна площа 186×271 мм.
   Отже документ завширшки 700px має вміститися у 700 × 271/186 ≈ 1020px заввишки. */
var PDF_PAGE_H = Math.floor(700 * 271 / 186);
var PDF_STEPS = [12, 11.2, 10.4, 9.6, 9, 8.4, 7.8];

/**
 * Підганяє документ під одну сторінку, зменшуючи базовий кегль.
 * Усі розміри всередині .pdf-doc — в em, тож міняється лише одне число.
 * Повертає кількість сторінок.
 *
 * Рецепт із напівфабрикатами на аркуш уже не тиснемо: дві читабельні
 * сторінки кращі за одну, набрану кеглем 7,8 — тому щойно стало ясно,
 * що в одну не влазить, повертаємо найбільший кегль і рахуємо сторінки.
 */
function fitToPage(doc) {
  for (var i = 0; i < PDF_STEPS.length; i++) {
    doc.style.fontSize = PDF_STEPS[i] + 'px';
    if (doc.scrollHeight <= PDF_PAGE_H) return 1;
  }
  doc.style.fontSize = PDF_STEPS[0] + 'px';
  return Math.max(2, Math.ceil(doc.scrollHeight / PDF_PAGE_H));
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

  var pages = fitToPage(doc);
  $('#pdf-sub').textContent = 'Формат А4 · ' + pages + ' ' + plural(pages, 'сторінка', 'сторінки', 'сторінок');
  fitPdfPreview();
}

/* Аркуш показуємо цілим, просто зменшеним: ширину самого документа чіпати
   не можна — html2pdf знімає цей самий вузол, і 320-піксельний аркуш поїхав
   би у файл. Тому масштабує лише прев'ю, і лише на телефоні.
   Трансформ не змінює місця в потоці, тож зайву висоту знімаємо margin'ом. */
function fitPdfPreview() {
  var stage = $('#pdf-stage');
  if (!stage.firstChild) return;
  stage.style.transform = '';
  stage.style.marginBottom = '';

  var body = $('#pdf-modal-body');
  var pad = parseFloat(getComputedStyle(body).paddingLeft) || 0;
  var k = (body.clientWidth - pad * 2) / stage.offsetWidth;
  if (k >= 1) return;
  stage.style.transform = 'scale(' + k + ')';
  stage.style.marginBottom = -Math.round(stage.offsetHeight * (1 - k)) + 'px';
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
  var stage = $('#pdf-stage');

  // Знімаємо прокрутку, обмеження висоти й масштаб прев'ю, щоб html2canvas
  // побачив документ цілком і в справжньому розмірі
  modal.classList.add('is-exporting');
  stage.style.transform = '';
  stage.style.marginBottom = '';
  $('#pdf-modal-body').scrollTop = 0;
  btn.disabled = true;
  btn.textContent = 'Готуємо…';

  function done(msg) {
    modal.classList.remove('is-exporting');
    fitPdfPreview();
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
    // tbody — це цілий напівфабрикат: розрив сторінки посеред складу тіста
    // перетворює техкарту на ребус, тому такі блоки переносимо цілком
    pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.pdf-grp-body', '.pdf-block'] }
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
  window.addEventListener('resize', fitPdfPreview);
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
    var k = (parsed.preps && parsed.preps.length) || 0;
    ask({
      title: 'Відновити з файла?',
      sub: 'З файла прийде ' + parsed.products.length + ' ' +
           plural(parsed.products.length, 'продукт', 'продукти', 'продуктів') +
           (k ? ', ' + k + ' ' + plural(k, 'напівфабрикат', 'напівфабрикати', 'напівфабрикатів') : '') +
           ' і ' + n + ' ' + plural(n, 'калькуляція', 'калькуляції', 'калькуляцій') +
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
  renderPreps();
  if (S.ui.screen === 'prep-edit' && editingPrep()) prepRecalc();
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

  $('#seg-nut').addEventListener('click', function (e) {
    var b = e.target.closest('[data-nut-val]'); if (!b) return;
    var on = b.getAttribute('data-nut-val') === 'on';
    if (on === S.showNutrition) return;
    S.showNutrition = on;
    S.nutAsked = true;            // рішення прийнято свідомо — пропозиція в базі більше не потрібна
    applyNutrition();
    paintNutOffer();
    persist(true);
    if (on) {
      repaintNutPanels();
      toast('Увімкнено. КБЖУ й алергени вносяться в базі продуктів — кнопка «КБЖУ» в рядку');
    }
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

  $('#btn-wipe').addEventListener('click', function () {
    ask({
      title: 'Очистити все?',
      sub: 'Буде видалено всі продукти, витрати, напівфабрикати, папки й калькуляції — застосунок стане порожнім. ' +
           'Налаштування залишаться. Це незворотно — якщо дані потрібні, спершу збережіть їх у файл.',
      input: false, ok: 'Очистити', danger: true
    }, function () {
      closeAsk();
      // Налаштування — не дані: людина чистить базу, а не хоче, щоб тема
      // й валюта раптом повернулись до початкових
      var keep = { currency: S.currency, round: S.round, theme: S.theme, showNutrition: S.showNutrition };
      S = normalize(emptyState());
      Object.keys(keep).forEach(function (k) { S[k] = keep[k]; });
      draftDirty = false;
      persist(true);
      boot(true);
      toast('Усі дані видалено');
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
      leaveCalc(function () {
        if (id === 'base') renderBase();
        if (id === 'expbase') renderExpBase();
        if (id === 'prep') renderPreps();
        show(id);
      });
      return;
    }
    if (e.target.closest('[data-recipe="new"]')) leaveCalc(newCalc);
  });

  // Модалка-запит
  $('#ask-ok').addEventListener('click', function () { if (askCb) askCb(); });
  $('#ask-cancel').addEventListener('click', closeAsk);
  $('#ask-overlay').addEventListener('click', function (e) { if (e.target === this) closeAsk(); });
  $('#ask-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && askCb) { e.preventDefault(); askCb(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeOverlays();
  });

  // «Назад» при відкритому меню чи вікні лише закриває його: браузер уже
  // зробив крок назад, тож повертаємо поточний — екран під вікном не міняється
  window.addEventListener('popstate', function (e) {
    if (menuOpen() || $('.overlay.is-on')) {
      closeOverlays();
      if (curNav && history.pushState) history.pushState(curNav, '');
      return;
    }
    // «Назад» із незбереженої калькуляції: браузер уже зробив крок — повертаємо
    // калькуляцію на місце й питаємо. Відповіли «вийти» — робимо той самий крок ще раз
    if (calcUnsaved()) {
      if (curNav && history.pushState) history.pushState(curNav, '');
      leaveCalc(function () { history.back(); });
      return;
    }
    restoreNav(e.state);
  });

  // Не даємо зайвий раз втратити незбережену роботу
  window.addEventListener('beforeunload', function (e) {
    persist(true);   // запис відкладений на 300 мс — при перезавантаженні дописуємо одразу
    if (!calcUnsaved()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/* ═════════════════ 17. Старт ═════════════════ */

function boot(fresh) {
  applyTheme();
  applyNutrition();
  applyCurrency();
  renderSidebar();
  renderBase();
  renderExpBase();
  renderPreps();

  if (fresh) { show('home'); return; }

  var ui = S.ui || {};
  if (ui.screen === 'prep-edit') {
    // Редактор без відкритого напівфабрикату показувати нема сенсу
    if (prepById(ui.prepId)) openPrep(ui.prepId); else show('prep');
    return;
  }
  if (ui.screen === 'calc') {
    // відновлюємо незбережену чернетку
    var crumb = 'Нова калькуляція', saved = null, draft = S.draft;
    if (ui.editing) {
      var f = folderById(ui.editing.folderId);
      if (f) {
        crumb = f.title;
        saved = f.recipes.filter(function (x) { return x.id === ui.editing.recipeId; })[0] || null;
      }
    }
    if (saved && draft) {
      // Знімок беремо зі збереженої версії, а не з чернетки: інакше правки, не
      // збережені до перезавантаження, вважались би збереженими й вихід не питав би
      loadCalc(saved, crumb);
      var base = calcSnapshot();
      loadCalc(draft, crumb);
      calcBaseline = base;
      draftDirty = calcSnapshot() !== base;
      updateSaveBtn();
    } else {
      loadCalc(draft || saved || { name: '', margin: 50, ing: [], exp: [] }, crumb);
    }
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
  bindMenu();
  bindBase();
  bindExpBase();
  bindPreps();
  bindPrepEdit();
  bindPrepPick();
  bindNutrition();
  bindFolder();
  bindCalc();
  bindPhoto();
  bindSave();
  bindPdf();
  bindSettings();
  bindInvite();

  // Відновлення екрана на старті — не новий крок: інакше перше «Назад»
  // вело б на той самий екран, а друге вже з сайту
  fromHistory = true;
  boot(false);
  fromHistory = false;
  replaceNav();
  persist(true);
  maybeShowInvite();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
