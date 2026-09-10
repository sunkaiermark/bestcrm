const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function text(value) {
  return String(value || '').trim();
}

function safeLocation(value) {
  const location = text(value);
  return location.startsWith('/') && !location.startsWith('//') ? location : '';
}

function requestToken(req) {
  return text(req.body?._submissionToken || req.query?._submissionToken || req.get?.('idempotency-key'));
}

function requestPath(req) {
  return text(req.originalUrl).split('?')[0] || text(req.path) || '/';
}

function finishResponse(repository, identity, res, logger) {
  const statusCode = Number(res.statusCode || 200);
  const location = safeLocation(res.getHeader?.('location'));
  if (statusCode >= 400 && statusCode < 500) {
    return repository.release(identity);
  }
  return repository.complete({
    ...identity,
    state: statusCode >= 500 ? 'uncertain' : 'completed',
    responseStatus: statusCode,
    responseLocation: location
  }).catch((error) => {
    logger.error?.('Failed to finalize form submission idempotency record', error);
  });
}

export function submissionGuard({ repository, logger = console } = {}) {
  return async (req, res, next) => {
    if (!repository || !MUTATING_METHODS.has(req.method) || !req.currentUser?.id) {
      next();
      return;
    }

    const token = requestToken(req);
    if (!token) {
      next();
      return;
    }
    if (!TOKEN_PATTERN.test(token)) {
      res.status(400).send('Invalid submission token');
      return;
    }

    const identity = {
      token,
      actorUserId: Number(req.currentUser.id),
      requestMethod: req.method,
      requestPath: requestPath(req)
    };

    try {
      const record = await repository.claim(identity);
      if (!record) {
        res.status(503).send('Submission protection is temporarily unavailable');
        return;
      }
      const sameAction = record.actorUserId === identity.actorUserId
        && record.requestMethod === identity.requestMethod
        && record.requestPath === identity.requestPath;
      if (!sameAction) {
        res.status(409).send('Submission token does not belong to this action');
        return;
      }
      if (!record.newlyClaimed) {
        const redirectLocation = safeLocation(record.responseLocation);
        if (record.state === 'completed' && redirectLocation) {
          res.redirect(303, redirectLocation);
          return;
        }
        res.status(409).send(record.state === 'uncertain'
          ? 'The previous submission outcome requires review before retrying.'
          : record.state === 'completed'
            ? 'This action has already been processed.'
            : 'This action is already being processed.');
        return;
      }

      const originalEnd = res.end.bind(res);
      let ending = false;
      res.end = function guardedEnd(chunk, encoding, callback) {
        if (ending) return originalEnd(chunk, encoding, callback);
        ending = true;
        Promise.resolve(finishResponse(repository, identity, res, logger))
          .catch((error) => logger.error?.('Failed to release form submission idempotency record', error))
          .finally(() => originalEnd(chunk, encoding, callback));
        return res;
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
