/* PT Planner service worker.
   Pages (index.html) are always loaded from the network when the phone is online,
   then saved for offline use. That way a new version shows up after it is published.
   Do not switch document requests to cache-only, and do not cache sw.js itself,
   or the home-screen app can get stuck on an old copy.
   React, ReactDOM, and Babel are pinned CDN URLs and are safe to keep offline. */
var CACHE = 'pt-planner-shell-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];
var CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js'
];

function isCdn(url) {
  return CDN.indexOf(url) !== -1;
}

function isStaticAsset(url) {
  var path = url.pathname || '';
  return path.indexOf('/icons/') !== -1 ||
    path.lastIndexOf('/manifest.webmanifest') === path.length - '/manifest.webmanifest'.length;
}

function networkFirst(request) {
  return fetch(request).then(function (response) {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) {
      if (response && response.ok) cache.put(request, copy).catch(function () {});
    }).catch(function () {});
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      if (cached) return cached;
      return caches.match('./index.html').then(function (index) {
        return index || caches.match('./');
      });
    });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) {
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, copy).catch(function () {});
        }
      }).catch(function () {});
      return response;
    });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL).then(function () {
        return Promise.all(CDN.map(function (url) {
          return cache.add(url).catch(function () { return null; });
        }));
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE) return caches.delete(key);
        return Promise.resolve(true);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (isCdn(event.request.url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(networkFirst(event.request));
  }
});
