// PWA 알리미 — 설정 페이지 로직
// VAPID 공개키 (서버 비밀키와 쌍)
const VAPID_PUBLIC_KEY = 'BDyrDta5TrnKneW5dO7htzM7ddVz5dRuBkRq2un94q4Lzr0D8t1stWPZz5PLV7dgtI08407aKxmrfV0zdw2RKoQ';

const LS_TOPICS = 'alimi.topics';   // { flight: true, ppomppu: false, ... }
const LS_LASTSUB = 'alimi.last_sub'; // 마지막 구독 endpoint hash (변경 감지)

// ─── DOM refs ───────────────────────────────────────
const $dot   = document.getElementById('status-dot');
const $label = document.getElementById('status-label');
const $sub   = document.getElementById('status-sub');
const $btn   = document.getElementById('subscribe-btn');
const $endpoint = document.getElementById('endpoint-box');
const $copyRow  = document.getElementById('copy-row');
const $copyBtn  = document.getElementById('copy-btn');
const $topicsCard = document.getElementById('topics-card');
const $toast = document.getElementById('toast');

// ─── 유틸 ──────────────────────────────────────────
function toast(msg, isError=false) {
  $toast.textContent = msg;
  $toast.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => $toast.className = 'toast', 2500);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

function loadTopicPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_TOPICS) || '{}'); }
  catch { return {}; }
}
function saveTopicPrefs(prefs) {
  localStorage.setItem(LS_TOPICS, JSON.stringify(prefs));
  // Service Worker가 페이지 닫힌 상태에서도 읽을 수 있도록 Cache API에도 저장
  if ('caches' in window) {
    caches.open('alimi-prefs').then(cache =>
      cache.put('alimi_topics_cache_v1', new Response(JSON.stringify(prefs)))
    ).catch(() => {});
  }
}

// Service Worker가 prefs를 요청할 때 응답
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_TOPIC_PREFS' && event.ports[0]) {
    event.ports[0].postMessage(loadTopicPrefs());
  }
});

// ─── 상태 표시 ──────────────────────────────────────
function setStatus(state, label, sub) {
  $dot.className = 'status-dot ' + state;
  $label.textContent = label;
  $sub.textContent = sub || '';
}

// ─── Service Worker 등록 ───────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker 미지원 브라우저');
  const reg = await navigator.serviceWorker.register('./service-worker.js');
  await navigator.serviceWorker.ready;
  return reg;
}

// ─── 구독 ──────────────────────────────────────────
async function subscribe() {
  $btn.disabled = true;
  try {
    if (!('PushManager' in window)) throw new Error('Push API 미지원');
    if (Notification.permission === 'denied') {
      throw new Error('알림 권한이 차단됨. 브라우저 설정에서 허용 후 새로고침');
    }
    const reg = await registerSW();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    showSubscription(sub);
    toast('구독 완료! 구독 정보를 복사해서 등록하세요.');
  } catch (e) {
    console.error(e);
    toast(e.message || '구독 실패', true);
    setStatus('off', '구독 실패', e.message || '');
    $btn.disabled = false;
    $btn.textContent = '다시 시도';
  }
}

function showSubscription(sub) {
  const json = JSON.stringify(sub.toJSON(), null, 2);
  $endpoint.textContent = json;
  $endpoint.style.display = 'block';
  $copyRow.style.display = 'block';
  setStatus('on', '구독 중', sub.endpoint.slice(0, 50) + '...');
  $btn.style.display = 'none';
  localStorage.setItem(LS_LASTSUB, sub.endpoint);
}

async function checkExistingSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setStatus('off', '미지원 브라우저', 'Chrome / Edge 권장');
    $btn.disabled = true;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        showSubscription(sub);
        return;
      }
    }
    setStatus('off', '미구독', '아래 버튼으로 시작');
    $btn.disabled = false;
  } catch (e) {
    console.error(e);
    setStatus('off', '확인 실패', e.message);
  }
}

// ─── 토픽 UI ───────────────────────────────────────
async function renderTopics() {
  try {
    const res = await fetch('./topics.json', { cache: 'no-cache' });
    const data = await res.json();
    const prefs = loadTopicPrefs();
    let html = '';
    data.topics.forEach((t, idx) => {
      // 기본값: 저장된 값이 있으면 그것, 없으면 t.default
      const on = prefs[t.id] === undefined ? t.default : prefs[t.id];
      prefs[t.id] = on;
      const reportLink = t.report_url
        ? `<a class="topic-report" href="${t.report_url}" target="_blank" rel="noopener">📋 리포트 보기 →</a>`
        : '';
      html += `
        <div class="topic-row">
          <div class="topic-emoji">${t.emoji}</div>
          <div class="topic-info">
            <div class="topic-name">${t.name}</div>
            <div class="topic-desc">${t.description || ''}</div>
            ${reportLink}
          </div>
          <label class="switch">
            <input type="checkbox" data-topic="${t.id}" ${on ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>`;
    });
    saveTopicPrefs(prefs);
    $topicsCard.innerHTML = html;
    // 토글 핸들러
    $topicsCard.querySelectorAll('input[data-topic]').forEach(el => {
      el.addEventListener('change', () => {
        const p = loadTopicPrefs();
        p[el.dataset.topic] = el.checked;
        saveTopicPrefs(p);
        toast(el.checked ? `${el.dataset.topic} 알림 켜짐` : `${el.dataset.topic} 알림 꺼짐`);
      });
    });
  } catch (e) {
    console.error(e);
    $topicsCard.innerHTML = '<p style="color:#B0502C">토픽 목록 로드 실패: ' + e.message + '</p>';
  }
}

// ─── 복사 버튼 ─────────────────────────────────────
$copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($endpoint.textContent);
    toast('복사됨!');
  } catch {
    // fallback
    const range = document.createRange();
    range.selectNode($endpoint);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    toast('수동으로 선택해서 복사하세요');
  }
});

$btn.addEventListener('click', subscribe);

// ─── init ──────────────────────────────────────────
(async () => {
  await renderTopics();
  await checkExistingSubscription();
})();
