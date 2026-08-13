import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createNotificationRepository } from '../src/repositories/notificationRepository.mjs';
import { createNotificationSenders, deliverNotificationBatch } from '../src/services/notificationDeliveryService.mjs';

const once = process.argv.includes('--once');
const config = loadConfig();

if (!config.notificationDelivery.enabled) {
  console.error('Notification delivery is disabled. Set NOTIFICATION_DELIVERY_ENABLED=true before running this worker.');
  process.exit(1);
}

const pool = createPool(config);
const notificationRepository = createNotificationRepository(pool);
const deliveryConfig = { ...config.notificationDelivery, baseUrl: config.baseUrl };
const senders = createNotificationSenders({ config: deliveryConfig, notificationRepository });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  do {
    const deliveries = await deliverNotificationBatch({
      notificationRepository,
      config: deliveryConfig,
      senders
    });
    console.log(JSON.stringify({ event: 'notification_delivery_complete', deliveries }));
    if (!once) await delay(config.notificationDelivery.pollIntervalMs);
  } while (!once);
} finally {
  await pool.end();
}
