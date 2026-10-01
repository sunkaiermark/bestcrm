const archiveScopes = new Set(['active', 'archived', 'all']);

function positiveId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const id = Number(normalized);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function normalizeCustomerContactListQuery(query = {}) {
  return {
    archiveScope: archiveScopes.has(query.archiveScope) ? query.archiveScope : 'active',
    salespersonId: positiveId(query.salespersonId),
    customerId: positiveId(query.customerId),
    country: String(query.country ?? '').trim().slice(0, 120),
    searchTerm: String(query.q ?? '').trim().slice(0, 200)
  };
}
