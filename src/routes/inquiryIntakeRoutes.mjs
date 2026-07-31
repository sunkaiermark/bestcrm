import { Router } from 'express';
import {
  createChatwootInquiry,
  createWebsiteInquiry,
  verifyInquiryIntakeSignature
} from '../services/inquiryIntakeService.mjs';

function jsonError(res, status, error) {
  res.status(status).json({ error });
}

export function inquiryIntakeRoutes({
  inquiryRepository,
  intakeSecret,
  chatwootIntakeSecret,
  now
}) {
  const router = Router();

  function handleSignedIntake({ secret, createInquiry }) {
    return async (req, res, next) => {
      const rawBody = req.rawBody || Buffer.from('');
      const verification = verifyInquiryIntakeSignature({
        secret,
        timestamp: req.get('x-bestcrm-timestamp'),
        signature: req.get('x-bestcrm-signature'),
        rawBody,
        now: now ? now() : Date.now()
      });
      if (!verification.ok) {
        const status = verification.reason === 'disabled' ? 503 : 401;
        jsonError(res, status, verification.reason === 'disabled' ? 'Inquiry intake is not configured' : 'Invalid inquiry signature');
        return;
      }

      try {
        const inquiry = await createInquiry(inquiryRepository, req.body || {});
        const response = {
          id: inquiry.id,
          status: inquiry.status,
          source: inquiry.source
        };
        if (inquiry.wasDuplicate) {
          response.duplicate = true;
        }
        res.status(inquiry.wasDuplicate ? 200 : 201).json(response);
      } catch (error) {
        if (error.message === 'Requirement is required' || error.message === 'Conversation reference is required') {
          jsonError(res, 400, error.message);
          return;
        }
        next(error);
      }
    };
  }

  router.post('/api/inquiries/website', handleSignedIntake({
    secret: intakeSecret,
    createInquiry: createWebsiteInquiry
  }));
  router.post('/api/inquiries/chatwoot', handleSignedIntake({
    secret: chatwootIntakeSecret,
    createInquiry: createChatwootInquiry
  }));

  return router;
}
