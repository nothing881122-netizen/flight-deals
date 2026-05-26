// 생활 알리미 — Service Worker
// push event 수신 → localStorage 대신 IndexedDB 또는 클라이언트 메시지로 prefs 확인
// (Service Worker는 localStorage 접근 불가)

const LS_TOPICS_CACHE = 'alimi_topics_cache_v1';

// install: 즉시 활성화
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 토픽 prefs 조회 — 페이지가 열려있으면 메시지로, 아니면 캐시 fallback
async function getTopicPrefs() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length > 0) {
    // 페이지가 열려있으면 거기서 가져옴
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data || {});
      clients[0].postMessage({ type: 'GET_TOPIC_PREFS' }, [channel.port2]);
      // 1초 안에 응답 없으면 캐시 사용
      setTimeout(() => resolve(null), 1000);
    }).then(async (live) => {
      if (live) {
        // 캐시 갱신
        try {
          const cache = await caches.open('alimi-prefs');
          await cache.put(LS_TOPICS_CACHE, new Response(JSON.stringify(live)));
        } catch {}
        return live;
      }
      return await getCachedPrefs();
    });
  }
  return await getCachedPrefs();
}

async function getCachedPrefs() {
  try {
    const cache = await caches.open('alimi-prefs');
    const res = await cache.match(LS_TOPICS_CACHE);
    if (res) return await res.json();
  } catch {}
  return {};  // 캐시 없으면 빈 객체 — 모든 토픽 차단
}

// push 수신
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { title: '알림', body: event.data ? event.data.text() : '' };
    }

    const topic = data.topic || 'default';
    const prefs = await getTopicPrefs();

    // 토픽이 꺼져있으면 표시 안 함 (단, prefs가 비었으면 전부 표시 — 첫 셋업 시)
    if (Object.keys(prefs).length > 0 && prefs[topic] === false) {
      console.log(`[SW] 토픽 ${topic} 꺼져있음 — 스킵`);
      return;
    }

    const title = data.title || '알리미';
    // actions 는 [{action, title, url?, icon?}] 형태로 받아서, url 은 data.action_urls 에 매핑
    const swActions = [];
    const action_urls = {};
    if (Array.isArray(data.actions)) {
      for (const a of data.actions) {
        if (!a.action) continue;
        swActions.push({ action: a.action, title: a.title || a.action, icon: a.icon });
        if (a.url) action_urls[a.action] = a.url;
      }
    }
    const options = {
      body:    data.body || '',
      icon:    data.icon || './icons/icon-192.png',
      badge:   './icons/icon-192.png',
      tag:     data.tag || topic,
      data:    { url: data.url || './', topic, action_urls },
      vibrate: [200, 100, 200],
      requireInteraction: data.requireInteraction || false,
    };
    if (swActions.length > 0) options.actions = swActions;

    await self.registration.showNotification(title, options);
  })());
});

// 알림 클릭 → 본문 탭이면 data.url, 액션 버튼 탭이면 action_urls[action] 으로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let url = data.url || './';
  if (event.action && data.action_urls && data.action_urls[event.action]) {
    url = data.action_urls[event.action];
  }
  event.waitUntil((async () => {
    // 이미 열려있는 탭이면 focus
    try {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
    } catch {}
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
