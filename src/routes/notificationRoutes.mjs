import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';

function checked(value) {
  return value === 'on' || value === 'true' || value === true;
}

function preferenceInput(body) {
  const emailDelay = Math.min(Math.max(Number(body.emailDelayMinutes) || 15, 0), 1440);
  return {
    realtimeEnabled: checked(body.realtimeEnabled),
    webPushEnabled: checked(body.webPushEnabled),
    emailEnabled: checked(body.emailEnabled),
    smsEnabled: checked(body.smsEnabled),
    emailDelayMinutes: emailDelay
  };
}

function validSubscription(subscription) {
  return Boolean(
    subscription
    && typeof subscription.endpoint === 'string'
    && subscription.endpoint.startsWith('https://')
    && typeof subscription.keys?.p256dh === 'string'
    && typeof subscription.keys?.auth === 'string'
  );
}

export function notificationRoutes({ notificationRepository, webPushPublicKey = '' }) {
  const router = Router();

  router.use(['/notifications', '/api/notifications'], requireLogin);

  router.get('/notifications', async (req, res, next) => {
    try {
      const [notifications, unreadCount, preference] = await Promise.all([
        notificationRepository.listForUser(req.currentUser.id, { limit: 100 }),
        notificationRepository.countUnread(req.currentUser.id),
        notificationRepository.getPreference(req.currentUser.id)
      ]);
      res.render('notifications/index', {
        activeNav: 'notifications',
        notifications,
        unreadCount,
        preference,
        webPushAvailable: Boolean(webPushPublicKey)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/notifications/:id/read', async (req, res, next) => {
    try {
      const notification = await notificationRepository.markRead(req.currentUser.id, req.params.id);
      if (!notification) {
        res.status(404).send('Notification not found');
        return;
      }
      res.redirect(notification.actionUrl || '/notifications');
    } catch (error) {
      next(error);
    }
  });

  router.post('/notifications/read-all', async (req, res, next) => {
    try {
      await notificationRepository.markAllRead(req.currentUser.id);
      res.redirect('/notifications');
    } catch (error) {
      next(error);
    }
  });

  router.post('/notifications/preferences', async (req, res, next) => {
    try {
      await notificationRepository.savePreference(req.currentUser.id, preferenceInput(req.body));
      res.redirect('/notifications');
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/notifications/summary', async (req, res, next) => {
    try {
      const afterId = Number(req.query.afterId) || 0;
      const [notifications, unreadCount] = await Promise.all([
        afterId
          ? notificationRepository.listAfterId(req.currentUser.id, afterId, 20)
          : notificationRepository.listForUser(req.currentUser.id, { limit: 5 }),
        notificationRepository.countUnread(req.currentUser.id)
      ]);
      res.json({ notifications, unreadCount });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/notifications/stream', async (req, res, next) => {
    try {
      const preference = await notificationRepository.getPreference(req.currentUser.id);
      if (!preference.realtimeEnabled) {
        res.status(204).end();
        return;
      }

      let lastId = Number(req.query.afterId) || 0;
      let checking = false;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write('retry: 5000\n\n');

      const sendNewNotifications = async () => {
        if (checking || res.writableEnded) return;
        checking = true;
        try {
          const notifications = await notificationRepository.listAfterId(req.currentUser.id, lastId, 20);
          for (const notification of notifications) {
            lastId = Math.max(lastId, notification.id);
            res.write(`id: ${notification.id}\n`);
            res.write(`event: notification\n`);
            res.write(`data: ${JSON.stringify(notification)}\n\n`);
          }
          res.write(': keepalive\n\n');
        } catch (error) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        } finally {
          checking = false;
        }
      };

      await sendNewNotifications();
      const timer = setInterval(sendNewNotifications, 5000);
      req.on('close', () => clearInterval(timer));
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/notifications/:id/read', async (req, res, next) => {
    try {
      const notification = await notificationRepository.markRead(req.currentUser.id, req.params.id);
      if (!notification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      res.json({ notification });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/notifications/push-subscriptions', async (req, res, next) => {
    try {
      if (!webPushPublicKey) {
        res.status(503).json({ error: 'Web Push is not configured' });
        return;
      }
      if (!validSubscription(req.body)) {
        res.status(400).json({ error: 'Invalid Web Push subscription' });
        return;
      }
      await notificationRepository.upsertPushSubscription(
        req.currentUser.id,
        req.body,
        req.get('user-agent')
      );
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/notifications/push-subscriptions/revoke', async (req, res, next) => {
    try {
      if (typeof req.body.endpoint !== 'string') {
        res.status(400).json({ error: 'Endpoint is required' });
        return;
      }
      await notificationRepository.revokePushSubscription(req.currentUser.id, req.body.endpoint);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
