export async function verifyCrmHealth(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {redirect:'manual',signal:AbortSignal.timeout(5000)});
  if(response.status !== 200) throw new Error(`CRM health returned HTTP ${response.status}`);
  const body = await response.json();
  if(body?.ok !== true || body?.app !== 'BESTCRM') throw new Error('CRM health response is invalid');
  return body;
}
