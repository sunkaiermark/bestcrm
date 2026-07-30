import { Router } from 'express';
import {
  createWebsiteInquiry,
  verifyInquiryIntakeSignature
} from '../services/inquiryIntakeService.mjs';

function jsonError(res, status, error) {
  res.status(status).json({ error });
}

export function inquiryIntakeRoutes({
  inquiryRepository,
  intakeSecret,
  now
}) {
  const router = Router();

  router.post('/api/inquiries/website', async (req, res, next) => {
    const rawBody = req.rawBody || Buffer.from('');
    const verification = verifyInquiryIntakeSignature({
      secret: intakeSecret,
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
      const inquiry = await createWebsiteInquiry(inquiryRepository, req.body || {});
      res.status(201).json({
        id: inquiry.id,
        status: inquiry.status,
        source: inquiry.source
      });
    } catch (error) {
      if (error.message === 'Requirement is required') {
        jsonError(res, 400, error.message);
        return;
      }
      next(error);
    }
  });

  return router;
}
