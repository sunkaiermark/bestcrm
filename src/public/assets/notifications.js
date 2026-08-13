(() => {
  const root = document.documentElement;
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const vapidPublicKey = document.querySelector('meta[name="web-push-public-key"]')?.content || '';
  const badge = document.querySelector('[data-notification-badge]');
  const toastRegion = document.querySelector('[data-notification-toasts]');
  const copy = document.documentElement.lang === 'zh'
    ? {
        unavailable: '此浏览器或服务器尚不支持 Web Push。',
        denied: '未获得浏览器通知权限。',
        failed: 'Web Push 订阅失败。',
        enabled: '此设备已启用浏览器 Push。'
      }
    : {
        unavailable: 'This browser or server does not support Web Push.',
        denied: 'Browser notification permission was not granted.',
        failed: 'Web Push subscription failed.',
        enabled: 'Browser Push is enabled on this device.'
      };
  let lastNotificationId = Number(root.dataset.lastNotificationId || 0);

  function updateBadge(count) {
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count <= 0;
  }

  function showToast(notification) {
    if (!toastRegion) return;
    const toast = document.createElement('a');
    toast.className = `notification-toast priority-${notification.priority || 'normal'}`;
    toast.href = notification.actionUrl || '/notifications';
    toast.innerHTML = `<strong></strong><span></span>`;
    toast.querySelector('strong').textContent = notification.title;
    toast.querySelector('span').textContent = notification.body;
    toastRegion.prepend(toast);
    setTimeout(() => toast.remove(), 10000);
  }

  async function loadSummary(afterId = 0) {
    const suffix = afterId ? `?afterId=${encodeURIComponent(afterId)}` : '';
    const response = await fetch(`/api/notifications/summary${suffix}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    updateBadge(data.unreadCount || 0);
    for (const notification of data.notifications || []) {
      lastNotificationId = Math.max(lastNotificationId, notification.id);
    }
  }

  function connectStream() {
    if (!window.EventSource) return;
    const stream = new EventSource(`/api/notifications/stream?afterId=${encodeURIComponent(lastNotificationId)}`);
    stream.addEventListener('notification', (event) => {
      const notification = JSON.parse(event.data);
      lastNotificationId = Math.max(lastNotificationId, notification.id);
      showToast(notification);
      loadSummary(lastNotificationId).catch(() => {});
    });
  }

  function base64UrlToUint8Array(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  }

  async function subscribeToPush() {
    const status = document.querySelector('#push-subscribe-status');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !vapidPublicKey) {
      if (status) status.textContent = copy.unavailable;
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (status) status.textContent = copy.denied;
      return;
    }
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey)
      });
    }
    const response = await fetch('/api/notifications/push-subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(subscription)
    });
    if (!response.ok) throw new Error(copy.failed);
    if (status) status.textContent = copy.enabled;
  }

  document.querySelector('#push-subscribe-button')?.addEventListener('click', () => {
    subscribeToPush().catch((error) => {
      const status = document.querySelector('#push-subscribe-status');
      if (status) status.textContent = error.message;
    });
  });

  loadSummary().then(connectStream).catch(() => {});
})();
