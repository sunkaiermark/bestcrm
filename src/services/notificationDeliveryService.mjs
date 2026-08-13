function configured(...values) {
  return values.every((value) => String(value || '').trim());
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeSmsPhone(phone) {
  const value = String(phone || '').replace(/[\s()-]/g, '');
  if (!value) return '';
  if (value.startsWith('+')) return /^\+[1-9]\d{6,14}$/.test(value) ? value : '';
  if (/^1\d{10}$/.test(value)) return `+86${value}`;
  return '';
}

export function createNotificationSenders({ config, notificationRepository }) {
  let webPushClient;
  let emailTransport;
  let smsClient;

  return {
    async webPush(delivery) {
      const webPushConfig = config.webPush || {};
      if (!configured(webPushConfig.publicKey, webPushConfig.privateKey, webPushConfig.subject)) {
        return { status: 'skipped', error: 'Web Push is not configured' };
      }
      const subscriptions = await notificationRepository.listActivePushSubscriptions(delivery.userId);
      if (!subscriptions.length) {
        return { status: 'skipped', error: 'User has no active Web Push subscription' };
      }
      if (!webPushClient) {
        const imported = await import('web-push');
        webPushClient = imported.default || imported;
        webPushClient.setVapidDetails(webPushConfig.subject, webPushConfig.publicKey, webPushConfig.privateKey);
      }
      const payload = JSON.stringify({
        title: delivery.title,
        body: delivery.body,
        url: delivery.actionUrl,
        notificationId: delivery.notificationId,
        priority: delivery.priority
      });
      let sent = 0;
      for (const subscription of subscriptions) {
        try {
          await webPushClient.sendNotification(subscription, payload);
          sent += 1;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await notificationRepository.revokePushEndpoint(subscription.endpoint);
            continue;
          }
          throw error;
        }
      }
      return sent
        ? { status: 'sent', providerMessageId: `subscriptions:${sent}` }
        : { status: 'skipped', error: 'All Web Push subscriptions were expired' };
    },

    async email(delivery) {
      const smtp = config.smtp || {};
      if (delivery.readAt) {
        return { status: 'skipped', error: 'Notification was read before email fallback' };
      }
      if (!delivery.email) {
        return { status: 'skipped', error: 'User has no email address' };
      }
      if (!configured(smtp.host, smtp.user, smtp.password, smtp.from)) {
        return { status: 'skipped', error: 'SMTP is not configured' };
      }
      if (!emailTransport) {
        const imported = await import('nodemailer');
        const nodemailer = imported.default || imported;
        emailTransport = nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: { user: smtp.user, pass: smtp.password }
        });
      }
      const actionUrl = new URL(delivery.actionUrl || '/notifications', config.baseUrl).toString();
      const result = await emailTransport.sendMail({
        from: smtp.from,
        to: delivery.email,
        subject: `[BESTCRM] ${delivery.title}`,
        text: `${delivery.body}\n\n${actionUrl}`,
        html: `<p>${escapeHtml(delivery.body)}</p><p><a href="${escapeHtml(actionUrl)}">Open BESTCRM</a></p>`
      });
      return { status: 'sent', providerMessageId: result.messageId || null };
    },

    async sms(delivery) {
      const sms = config.sms || {};
      const phone = normalizeSmsPhone(delivery.phone);
      if (!phone) {
        return { status: 'skipped', error: 'User has no valid E.164 or mainland China phone number' };
      }
      if (!configured(sms.secretId, sms.secretKey, sms.sdkAppId, sms.signName, sms.templateId)) {
        return { status: 'skipped', error: 'Tencent Cloud SMS is not configured' };
      }
      if (!smsClient) {
        const imported = await import('tencentcloud-sdk-nodejs');
        const tencentcloud = imported.default || imported;
        const Client = tencentcloud.sms.v20210111.Client;
        smsClient = new Client({
          credential: { secretId: sms.secretId, secretKey: sms.secretKey },
          region: sms.region,
          profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } }
        });
      }
      const result = await smsClient.SendSms({
        PhoneNumberSet: [phone],
        SmsSdkAppId: sms.sdkAppId,
        SignName: sms.signName,
        TemplateId: sms.templateId,
        TemplateParamSet: [delivery.title, new URL(delivery.actionUrl || '/notifications', config.baseUrl).toString()]
      });
      const status = result.SendStatusSet?.[0];
      if (status?.Code && status.Code !== 'Ok') {
        throw new Error(`${status.Code}: ${status.Message || 'SMS delivery failed'}`);
      }
      return { status: 'sent', providerMessageId: status?.SerialNo || result.RequestId || null };
    }
  };
}

export async function deliverNotificationBatch({ notificationRepository, config, senders }) {
  const deliveries = await notificationRepository.claimDueDeliveries(config.batchSize);
  const results = [];
  for (const delivery of deliveries) {
    try {
      const senderName = delivery.channel === 'web_push' ? 'webPush' : delivery.channel;
      const sender = senders[senderName];
      const outcome = delivery.channelEnabled === false
        ? { status: 'skipped', error: `${delivery.channel} is disabled in user preferences` }
        : sender
        ? await sender(delivery)
        : { status: 'skipped', error: `Unsupported notification channel: ${delivery.channel}` };
      await notificationRepository.completeDelivery(delivery.id, outcome);
      results.push({ id: delivery.id, channel: delivery.channel, status: outcome.status });
    } catch (error) {
      await notificationRepository.completeDelivery(delivery.id, {
        status: delivery.attempts >= 5 ? 'skipped' : 'failed',
        error: error.message
      });
      results.push({ id: delivery.id, channel: delivery.channel, status: 'failed', error: error.message });
    }
  }
  return results;
}
