// Default SLA is expressed in Shanghai business days.  A task created on Friday
// with a one-business-day SLA is therefore due by the end of the following Monday.
export const WORK_ITEM_SLA_BUSINESS_DAYS = Object.freeze({
  'Submit opportunity initiation': 1,
  'Revise and resubmit opportunity': 2,
  'Approve opportunity initiation': 1,
  'Revise opportunity initiation': 2,
  'Prepare technical solution': 3,
  'Revise technical solution': 2,
  'Revise technical solution for supplemental requirement': 2,
  'Approve technical solution': 1,
  'Prepare commercial quote': 2,
  'Revise commercial quote': 1,
  'Approve commercial quote': 1,
  'Send approved quote to customer': 1,
  'Submit contract approval': 2,
  'Review contract': 1,
  'Revise contract': 2,
  'Start Project Execution': 1,
  'Confirm Project Execution creation': 1
});

function shanghaiDateParts(referenceAt) {
  const timestamp = new Date(referenceAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Invalid SLA reference time');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(timestamp);
  const valueFor = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(valueFor('year')),
    month: Number(valueFor('month')),
    day: Number(valueFor('day'))
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function addShanghaiBusinessDays(referenceAt, businessDays) {
  const { year, month, day } = shanghaiDateParts(referenceAt);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  let remaining = businessDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      remaining -= 1;
    }
  }
  return `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}T23:59:59+08:00`;
}

export function defaultWorkItemDueAt(title, referenceAt = new Date()) {
  const businessDays = WORK_ITEM_SLA_BUSINESS_DAYS[title];
  return Number.isInteger(businessDays)
    ? addShanghaiBusinessDays(referenceAt, businessDays)
    : null;
}
