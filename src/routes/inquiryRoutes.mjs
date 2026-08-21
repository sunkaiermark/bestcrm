import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import { DuplicateCustomerError } from '../services/customerService.mjs';
import {
  canAccessInquiryInbox,
  canDeleteInquiry,
  canProcessInquiry,
  canViewInquiry,
  convertInquiryToOpportunity,
  createInquiry,
  deleteInquiry,
  inquiryFormOptions,
  inquiryListFilterFor,
  markInquiryAsSpam,
  saveInquiryAsContact,
  saveInquiryAsCustomer,
  updateInquiryReview
} from '../services/inquiryService.mjs';
import { attachmentPreviewKind, extractDocxPlainText, renderDxfPreview } from '../utils/attachmentPreview.mjs';
import { attachmentContentDisposition, inlineContentDisposition } from '../utils/contentDisposition.mjs';

function forbidden(res) {
  res.status(403).send('Forbidden');
}

async function loadInquiryOrSend(inquiryRepository, req, res) {
  const inquiry = await inquiryRepository.findById(req.params.id);
  if (!inquiry) {
    res.status(404).send('Inquiry not found');
    return null;
  }
  if (!canViewInquiry(req.currentUser, inquiry)) {
    forbidden(res);
    return null;
  }
  return inquiry;
}

async function listAssignableUsers(userRepository) {
  if (typeof userRepository?.listUsersWithRoles !== 'function') {
    return [];
  }
  const users = await userRepository.listUsersWithRoles();
  return users.filter((user) => user.isActive !== false);
}

async function loadCrmOptions({ customerRepository, contactRepository, userRepository }, user) {
  const customerFilter = hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)
    ? {}
    : { ownerUserId: user.id };
  const customers = typeof customerRepository?.listCustomers === 'function'
    ? await customerRepository.listCustomers(customerFilter)
    : [];
  const contacts = typeof contactRepository?.listContacts === 'function'
    ? await contactRepository.listContacts(customerFilter)
    : [];
  const assignableUsers = await listAssignableUsers(userRepository);
  if (assignableUsers.length === 0) {
    assignableUsers.push(user);
  }
  return { customers, contacts, assignableUsers };
}

function renderInquiryForm(res, data = {}) {
  res.render('inquiries/form', {
    ...inquiryFormOptions,
    countryOptions: CUSTOMER_COUNTRIES,
    ...data
  });
}

function renderInquiryDetail(res, data = {}) {
  res.render('inquiries/detail', {
    ...inquiryFormOptions,
    countryOptions: CUSTOMER_COUNTRIES,
    ...data
  });
}

async function renderInquiryDetailPage(dependencies, req, res, inquiry, data = {}, status = 200) {
  const options = await loadCrmOptions(dependencies, req.currentUser);
  const inquiryAttachments = typeof dependencies.inquiryAttachmentRepository?.listByInquiry === 'function'
    ? await dependencies.inquiryAttachmentRepository.listByInquiry(inquiry.id)
    : [];
  res.status(status);
  renderInquiryDetail(res, {
    inquiry,
    inquiryAttachments,
    canDeleteInquiry: canDeleteInquiry(req.currentUser),
    canProcessInquiry: canProcessInquiry(inquiry),
    duplicateCustomers: [],
    ...options,
    ...data
  });
}

function handleInquiryError(error, res, next) {
  if (error.message === 'Forbidden') {
    forbidden(res);
    return;
  }
  if (['Inquiry not found', 'Customer not found', 'Contact not found'].includes(error.message)) {
    res.status(404).send(error.message);
    return;
  }
  if ([
    'Contact does not belong to customer',
    'Requirement is required',
    'Customer is required',
    'Customer name is required',
    'Contact name is required'
  ].includes(error.message)) {
    res.status(400).send(error.message);
    return;
  }
  if (error.message === 'Inquiry already processed') {
    res.status(409).send(error.message);
    return;
  }
  next(error);
}

async function handleInquiryActionError(error, dependencies, req, res, next, inquiry) {
  if (error instanceof DuplicateCustomerError) {
    await renderInquiryDetailPage(dependencies, req, res, inquiry, {
      duplicateCustomers: error.duplicates
    }, 409);
    return;
  }
  handleInquiryError(error, res, next);
}

export function inquiryRoutes({
  inquiryRepository,
  inquiryAttachmentRepository,
  customerRepository,
  contactRepository,
  opportunityRepository,
  attachmentRepository,
  userRepository,
  uploadDir = './var/uploads'
}) {
  const router = Router();
  const dependencies = {
    inquiryRepository,
    inquiryAttachmentRepository,
    customerRepository,
    contactRepository,
    opportunityRepository,
    attachmentRepository,
    userRepository,
    uploadDir
  };

  router.use('/inquiries', requireLogin);
  router.use('/inquiries', (req, res, next) => {
    if (!canAccessInquiryInbox(req.currentUser)) {
      forbidden(res);
      return;
    }
    next();
  });

  router.get('/inquiries', async (req, res, next) => {
    try {
      const inquiries = await inquiryRepository.listInquiries(inquiryListFilterFor(req.currentUser, req.query));
      res.render('inquiries/index', {
        inquiries,
        filters: req.query,
        ...inquiryFormOptions
      });
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.get('/inquiries/new', async (req, res, next) => {
    try {
      const options = await loadCrmOptions({ customerRepository, contactRepository, userRepository }, req.currentUser);
      renderInquiryForm(res, {
        inquiry: {
          source: 'manual',
          priority: 'normal',
          status: 'new',
          assignedUserId: req.currentUser.id
        },
        action: '/inquiries',
        ...options
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/inquiries', async (req, res, next) => {
    try {
      const inquiry = await createInquiry(inquiryRepository, req.currentUser, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.get('/inquiries/:id', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await renderInquiryDetailPage(dependencies, req, res, inquiry);
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.post('/inquiries/:id/review', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await updateInquiryReview({
        inquiryRepository,
        customerRepository,
        contactRepository
      }, req.currentUser, inquiry, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.post('/inquiries/:id/convert', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      const opportunity = await convertInquiryToOpportunity(dependencies, req.currentUser, inquiry, req.body);
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      await handleInquiryActionError(error, dependencies, req, res, next, inquiry);
    }
  });

  router.post('/inquiries/:id/save-customer', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await saveInquiryAsCustomer(dependencies, req.currentUser, inquiry, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      await handleInquiryActionError(error, dependencies, req, res, next, inquiry);
    }
  });

  router.post('/inquiries/:id/save-contact', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await saveInquiryAsContact(dependencies, req.currentUser, inquiry, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      await handleInquiryActionError(error, dependencies, req, res, next, inquiry);
    }
  });

  router.post('/inquiries/:id/spam', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await markInquiryAsSpam(inquiryRepository, req.currentUser, inquiry, req.body);
      res.redirect('/inquiries');
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.post('/inquiries/:id/delete', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await deleteInquiry(dependencies, req.currentUser, inquiry);
      res.redirect('/inquiries');
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  async function sendInquiryAttachment(req, res, next, disposition) {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      const attachment = await inquiryAttachmentRepository.findById(req.params.attachmentId);
      if (!attachment || attachment.inquiryId !== inquiry.id) {
        res.status(404).send('Attachment not found');
        return;
      }
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!filePath) {
        res.status(404).send('Attachment not found');
        return;
      }
      if (disposition === 'download') {
        res.type(attachment.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.originalName));
        res.sendFile(filePath);
        return;
      }
      const kind = attachmentPreviewKind(attachment);
      const downloadUrl = `/inquiries/${inquiry.id}/attachments/${attachment.id}/download`;
      const previewContext = {
        activeNav: 'inquiries',
        inquiry,
        attachment,
        downloadUrl,
        contextLabelKey: 'inquiries',
        contextText: inquiry.subject || inquiry.companyName || `${res.locals.t('inquiry')} #${inquiry.id}`,
        backUrl: `/inquiries/${inquiry.id}`,
        backLabelKey: 'backToInquiry'
      };
      if (kind === 'unsupported-dwg') {
        res.status(200).render('attachments/unsupported-preview', {
          ...previewContext,
          messageKey: 'dwgPreviewRequiresDxfOrPdf'
        });
        return;
      }
      if (kind === 'unsupported-doc') {
        res.status(200).render('attachments/unsupported-preview', {
          ...previewContext,
          messageKey: 'docPreviewRequiresDocx'
        });
        return;
      }
      if (kind === 'dxf') {
        const dxfText = await readFile(filePath, 'utf8');
        res.status(200).render('attachments/dxf-preview', {
          ...previewContext,
          preview: renderDxfPreview(dxfText)
        });
        return;
      }
      if (kind === 'docx') {
        const docxBuffer = await readFile(filePath);
        res.status(200).render('attachments/docx-preview', {
          ...previewContext,
          paragraphs: extractDocxPlainText(docxBuffer)
        });
        return;
      }
      if (kind === 'download-only') {
        res.status(200).render('attachments/unsupported-preview', {
          ...previewContext,
          messageKey: 'previewNotAvailableDownload'
        });
        return;
      }
      res.type(attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', inlineContentDisposition(attachment.originalName));
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  router.get('/inquiries/:id/attachments/:attachmentId/download', (req, res, next) => {
    sendInquiryAttachment(req, res, next, 'download');
  });

  router.get('/inquiries/:id/attachments/:attachmentId/preview', (req, res, next) => {
    sendInquiryAttachment(req, res, next, 'preview');
  });

  return router;
}
