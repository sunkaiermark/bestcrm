function nonNegativeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export async function runEmailBackfillLoop({
  runBatch,
  wait,
  intervalMs,
  isStopping = () => false
}) {
  if (typeof runBatch !== 'function') {
    throw new TypeError('runBatch must be a function');
  }
  if (typeof wait !== 'function') {
    throw new TypeError('wait must be a function');
  }

  const pauseMs = Math.max(1, nonNegativeCount(intervalMs));
  const summary = {
    batches: 0,
    scanned: 0,
    imported: 0,
    skipped: 0,
    backfillComplete: false,
    stopped: false
  };

  while (!isStopping()) {
    const result = await runBatch();
    summary.batches += 1;
    summary.scanned += nonNegativeCount(result?.scanned);
    summary.imported += nonNegativeCount(result?.imported?.length);
    summary.skipped += nonNegativeCount(result?.skipped?.length);
    summary.backfillComplete = Boolean(result?.backfillComplete);

    if (summary.backfillComplete || isStopping()) {
      break;
    }
    await wait(pauseMs);
  }

  summary.stopped = !summary.backfillComplete && isStopping();
  return summary;
}
