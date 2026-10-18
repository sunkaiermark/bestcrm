import { isLeadSourceAttributionChannel } from './inquiries.mjs';

export class LeadStatisticsFilterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LeadStatisticsFilterError';
    this.statusCode = 400;
  }
}

function hasValue(value) {
  return value != null && String(value).trim() !== '';
}

function dateText({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shanghaiDate(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === 'year').value),
    month: Number(parts.find((part) => part.type === 'month').value),
    day: Number(parts.find((part) => part.type === 'day').value)
  };
}

function parseDate(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new LeadStatisticsFilterError(`Invalid ${label}`);
  }
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new LeadStatisticsFilterError(`Invalid ${label}`);
  }
  return text;
}

function nextDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return dateText({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function positiveInteger(value, label) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new LeadStatisticsFilterError(`Invalid ${label}`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new LeadStatisticsFilterError(`Invalid ${label}`);
  }
  return number;
}

export function parseLeadStatisticsFilters(query = {}, now = new Date()) {
  const today = shanghaiDate(now);
  const defaultStartOn = `${today.year}-01-01`;
  const defaultEndOn = dateText(today);
  const startOn = parseDate(hasValue(query.startOn) ? query.startOn : defaultStartOn, 'start date');
  const endOn = parseDate(hasValue(query.endOn) ? query.endOn : defaultEndOn, 'end date');
  if (startOn > endOn) throw new LeadStatisticsFilterError('Start date must not be after end date');

  const sourceChannel = hasValue(query.sourceChannel) ? String(query.sourceChannel).trim() : null;
  if (sourceChannel && !isLeadSourceAttributionChannel(sourceChannel)) {
    throw new LeadStatisticsFilterError('Invalid source channel');
  }
  const attributionOwnerUserId = !hasValue(query.attributionOwnerUserId)
    ? null : positiveInteger(query.attributionOwnerUserId, 'source owner');
  const salesOwnerUserId = !hasValue(query.salesOwnerUserId)
    ? null : positiveInteger(query.salesOwnerUserId, 'sales owner');
  const page = !hasValue(query.page) ? 1 : positiveInteger(query.page, 'page');

  return {
    startOn,
    endOn,
    endDateExclusive: nextDay(endOn),
    sourceChannel,
    attributionOwnerUserId,
    salesOwnerUserId,
    page,
    pageSize: 50
  };
}
