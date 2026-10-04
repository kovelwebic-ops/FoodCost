/* ============================================================
   FoodCost — сервіс-воркер: застосунок відкривається й без інтернету.

   Свої файли — спершу з мережі, кеш лише запасний: після пушу всі одразу
   отримують нову версію, а стара не «залипає» (найчастіша біда PWA).
   Немає мережі — віддаємо збережене. Шрифти й html2pdf з CDN — навпаки,
   спершу з кешу: адреси в них з версією, і вміст за ними не міняється.
   Open Food Facts та інше чуже не чіпаємо взагалі — це живі дані.
   ============================================================ */
'use strict';

var CACHE = 'foodcost-v1';

/* Каркас — кладемо в кеш одразу при встановленні, щоб перший же офлайн-
   запуск відкрився. Демо-фото — бо демо-набір без них виглядає зламаним */
var SHELL = [
  './', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'demo/snickers.jpg', 'demo/pistachio-raspberry.jpg', 'demo/strawberry-trio.jpg',
  'demo/napoleon.jpg', 'demo/cupcakes-classic.jpg', 'demo/cupcakes-chocolate.jpg'
];

/* Чужі адреси, які можна тримати в кеші: шрифти й бібліотека PDF */
var CDN = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'];

self.addEventListener('install', function (e) {
  // cache: 'reload' — повз HTTP-кеш браузера, щоб у запас лягла справді свіжа версія
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (r) { if (r.ok) return c.put(u, r); })['catch'](function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  // Кеші попередніх версій воркера — геть, щоб не займали місце на телефоні
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches['delete'](k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(fromNetwork(req));
  } else if (CDN.some(function (o) { return url.origin === o; })) {
    e.respondWith(fromCache(req));
  }
  // решта (Open Food Facts тощо) — браузер сам, без воркера
});

/** Спершу мережа, свіже — у кеш; без мережі — збережене, а сторінка — завжди каркас. */
function fromNetwork(req) {
  return fetch(req).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  })['catch'](function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html');
      return Response.error();
    });
  });
}

/** Спершу кеш; немає — з мережі й у кеш. Шрифти віддаються «непрозорими» — їх теж можна. */
function fromCache(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok || res.type === 'opaque') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}
