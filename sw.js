// MEETWISE V1.3.4 stability build: service worker intentionally disabled.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister().then(()=>self.clients.matchAll()).then(cs=>Promise.all(cs.map(c=>c.navigate(c.url))))));
