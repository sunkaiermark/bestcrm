self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'BESTCRM', {
    body: data.body || '',
    tag: data.notificationId ? `bestcrm-${data.notificationId}` : 'bestcrm-notification',
    renotify: true,
    data: { url: data.url || '/notifications' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/notifications', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url === target);
    if (existing) return existing.focus();
    return clients.openWindow(target);
  })());
});
