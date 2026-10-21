import { createHash, randomUUID } from 'node:crypto';

// AI owns draft state only. It has no mail disposition, approval or assignment methods.
export function createEmailAiDraftService({ repository, loadVisibleThread, analyze, clock = () => new Date().toISOString() }) {
  const running = new Set();
  const snapshot = thread => {
    const message = [...(thread.messages || [])].reverse().find(item => item.direction === 'inbound');
    if (!message) throw new Error('没有可分析的收件邮件。');
    const text = String(message.textBody || '');
    return { text, fingerprint: createHash('sha256').update(JSON.stringify([thread.id, message.id, text])).digest('hex') };
  };
  async function visible(actor, threadId) {
    const thread = await loadVisibleThread(actor, threadId);
    if (!thread) throw new Error('邮件不存在或无权访问。');
    return { thread, ...snapshot(thread) };
  }
  return {
    async prepare(actor, threadId, options = {}) {
      const source = await visible(actor, threadId);
      const key = String(actor.id) + ':' + String(threadId);
      if (running.has(key)) throw new Error('该邮件正在分析，请稍候。');
      const previous = await repository.latest(actor.id, threadId);
      if (previous?.fingerprint === source.fingerprint && previous.state === 'ready' && !options.refresh) return previous;
      const draft = { id: randomUUID(), actorId: actor.id, threadId, fingerprint: source.fingerprint, state: 'processing', createdAt: clock() };
      running.add(key);
      try {
        await repository.save(draft);
        const result = await analyze(source.text, options);
        const current = await visible(actor, threadId);
        if (current.fingerprint !== source.fingerprint) throw new Error('邮件已有更新，请重新分析。');
        // Existing relationships determine the suggested route, never a model guess or sender address.
        const suggestion = source.thread.opportunityId || source.thread.inquiryId ? 'supplement_existing'
          : result.qualification === 'qualified' ? 'new_lead'
          : result.qualification === 'non_business' ? 'non_business_review' : 'human_review';
        Object.assign(draft, { state: 'ready', suggestion, result, updatedAt: clock() });
        await repository.save(draft);
        return draft;
      } catch (error) {
        Object.assign(draft, { state: 'failed', updatedAt: clock() });
        await repository.save(draft);
        throw error;
      } finally { running.delete(key); }
    },
    async review(actor, threadId, draftId, input) {
      const source = await visible(actor, threadId);
      const draft = await repository.get(draftId);
      if (!draft || String(draft.actorId) !== String(actor.id) || String(draft.threadId) !== String(threadId)) throw new Error('草稿不存在或无权访问。');
      if (draft.state !== 'ready' || draft.fingerprint !== source.fingerprint) throw new Error('草稿已过期，请重新分析。');
      if (input.confirmed !== true) throw new Error('请先人工审阅。');
      // Human input is authoritative; AI output remains immutable audit evidence.
      const fields = {};
      for (const name of ['subject','sourceChannel','companyName','companyWebsite','contactName','contactEmail','contactPhone','country','priority','opportunityType','assignedUserId','requirementText','transactionRole','endUserName','endUserWebsite','projectLocation']) {
        if (typeof input.fields?.[name] === 'string') fields[name] = input.fields[name].slice(0,20000);
      }
      const reviewed = { ...draft, reviewedFields: fields, customerReport: String(input.customerReport || '').slice(0,30000), reviewedAt: clock() };
      await repository.save(reviewed);
      return reviewed;
    }
  };
}