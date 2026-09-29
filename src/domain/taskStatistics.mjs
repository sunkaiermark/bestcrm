export class TaskStatisticsFilterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskStatisticsFilterError';
    this.statusCode = 400;
  }
}

function numericChoice(value, label, min, max) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new TaskStatisticsFilterError(`Invalid ${label}`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TaskStatisticsFilterError(`Invalid ${label}`);
  }
  return number;
}

function shanghaiYearMonth(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric'
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === 'year').value),
    month: Number(parts.find((part) => part.type === 'month').value)
  };
}

function dateText(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function hasValue(value) {
  return value != null && String(value).trim() !== '';
}

function periodMonth(period, unit) {
  return period === 'month' ? unit : period === 'quarter' ? (unit - 1) * 3 + 1 : 1;
}

export function parseTaskStatisticsFilters(query = {}, now = new Date()) {
  const current = shanghaiYearMonth(now);
  const period = String(query.period || 'month').trim();
  if (!['month', 'quarter', 'year'].includes(period)) {
    throw new TaskStatisticsFilterError('Invalid period');
  }
  const unitMax = period === 'month' ? 12 : 4;
  const currentUnit = period === 'month' ? current.month : Math.ceil(current.month / 3);
  // Keep previously shared single-period links working while the form uses a range.
  const hasRange = ['startYear', 'startUnit', 'endYear', 'endUnit']
    .some((key) => hasValue(query[key]));
  const legacyYear = !hasRange && hasValue(query.year)
    ? numericChoice(query.year, 'year', 1900, 2100) : current.year;
  const legacyUnit = period === 'year' ? null :
    (!hasRange && hasValue(query[period === 'month' ? 'month' : 'quarter'])
      ? numericChoice(query[period === 'month' ? 'month' : 'quarter'], 'unit', 1, unitMax)
      : legacyYear === current.year ? currentUnit : 1);
  const startYear = hasRange && hasValue(query.startYear)
    ? numericChoice(query.startYear, 'start year', 1900, 2100) : legacyYear;
  const endYear = hasRange && hasValue(query.endYear)
    ? numericChoice(query.endYear, 'end year', 1900, 2100) : startYear;
  const startUnit = period === 'year' ? null : hasRange
    ? (hasValue(query.startUnit)
      ? numericChoice(query.startUnit, 'start unit', 1, unitMax)
      : startYear === current.year ? currentUnit : 1)
    : legacyUnit;
  const endUnit = period === 'year' ? null : hasRange
    ? (hasValue(query.endUnit)
      ? numericChoice(query.endUnit, 'end unit', 1, unitMax) : startUnit)
    : legacyUnit;
  const userId = !hasValue(query.userId)
    ? null : numericChoice(query.userId, 'userId', 1, Number.MAX_SAFE_INTEGER);
  const page = !hasValue(query.page)
    ? 1 : numericChoice(query.page, 'page', 1, 10000);

  const firstMonth = periodMonth(period, startUnit);
  const nextMonth = periodMonth(period, endUnit) +
    (period === 'month' ? 1 : period === 'quarter' ? 3 : 12);
  const exclusiveEndYear = endYear + Math.floor((nextMonth - 1) / 12);
  const exclusiveEndMonth = ((nextMonth - 1) % 12) + 1;
  const startDate = dateText(startYear, firstMonth);
  const endDate = dateText(exclusiveEndYear, exclusiveEndMonth);
  if (startDate >= endDate) {
    throw new TaskStatisticsFilterError('Start period must not be after end period');
  }
  return {
    period, startYear, startUnit, endYear, endUnit, userId, page, pageSize: 50,
    startDate, endDate
  };
}
