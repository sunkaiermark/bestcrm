import { existsSync } from 'node:fs';

export class EmailResponseError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'EmailResponseError';
    this.statusCode = statusCode;
  }
}

export async function acknowledgeCustomerEmail(dependencies, actor, messageId, at = new Date()) {
  const id = Number(messageId);
  if (!Number.isInteger(id) || id <= 0) throw new EmailResponseError('Invalid email message', 400);
  const message = await dependencies.emailArchiveRepository.findMessageById(id);
  if (!message || message.direction !== 'inbound') throw new EmailResponseError('Inbound email not found', 404);
  const thread = await dependencies.emailArchiveRepository.findThreadById(message.threadId);
  if (!thread?.opportunityId || thread.triageStatus !== 'linked_opportunity') {
    throw new EmailResponseError('Email is not assigned to an opportunity', 409);
  }
  const opportunity = await dependencies.opportunityRepository.getOpportunityDetail(thread.opportunityId);
  if (!opportunity) throw new EmailResponseError('Opportunity not found', 404);
  if (Number(opportunity.salespersonId) !== Number(actor?.id)) {
    throw new EmailResponseError('Only the current opportunity owner may confirm receipt', 403);
  }
  if (typeof dependencies.emailResponseRepository?.acknowledge !== 'function') {
    throw new EmailResponseError('Email receipt confirmation is unavailable', 503);
  }
  const confirmation = await dependencies.emailResponseRepository.acknowledge(id, actor.id, at);
  if (!confirmation) throw new EmailResponseError('Only new customer email can be confirmed', 409);
  return { confirmation, thread, opportunity };
}

export async function processEmailReplyReminders(repository, { at = new Date(), writeMaintenanceFlagPath = '', writeMaintenanceFlagExists = existsSync } = {}) {
  if (writeMaintenanceFlagPath && writeMaintenanceFlagExists(writeMaintenanceFlagPath)) {
    return { paused: true, linked: 0, unassigned: 0 };
  }
  const linked = await repository.queueDueLinkedReminders(at);
  const unassigned = await repository.queueDueUnassignedReminders(at);
  return {
    paused: false,
    linked: Number(linked.created || 0),
    unassigned: Number(unassigned.created || 0)
  };
}

export function startEmailReplyReminderLoop(repository, options = {}) {
  const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs : 60_000;
  const logger = options.logger || console;
  let stopped = false;
  let running = false;
  const runNow = async () => {
    if (stopped || running) return null;
    running = true;
    try {
      return await processEmailReplyReminders(repository, options);
    } catch (error) {
      logger.error?.(JSON.stringify({
        event: 'email_reply_reminder_failed',
        code: String(error?.code || error?.name || 'reminder_failed').slice(0, 80)
      }));
      return null;
    } finally {
      running = false;
    }
  };
  queueMicrotask(runNow);
  const timer = setInterval(runNow, intervalMs);
  timer.unref?.();
  return {
    runNow,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
