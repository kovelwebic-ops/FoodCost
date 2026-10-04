/* FoodCost — застосунок на телефон (PWA) поки відкладено.
   Цей воркер лише прибирає за попереднім: чистить кеш, знімає себе
   й перезавантажує відкриті сторінки — далі сайт працює як звичайний.
   Не видаляти, доки в людей може лишатися старий воркер. */
'use strict';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return caches['delete'](k); }));
  }).then(function () {
    return self.registration.unregister();
  }).then(function () {
    return self.clients.matchAll({ type: 'window' });
  }).then(function (list) {
    list.forEach(function (c) { c.navigate(c.url); });
  }));
});
