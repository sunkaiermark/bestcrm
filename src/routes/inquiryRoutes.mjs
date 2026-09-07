import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import { DuplicateContactError } from '../services/contactService.mjs';
import { DuplicateCustomerError } from '../services/customerService.mjs';
import {
  CustomerApprovalRequiredError,
  approveInquiryCustomerApproval,
  canAccessInquiryInbox,
  canDecideInquiryCustomerApproval,
  canDeleteInquiry,
  canProcessInquiry,
  canViewInquiry,
  convertInquiryToOpportunity,
  createInquiry,
  deleteInquiry,
  inquiryAssignableUsers,
  inquirySalespersonUsers,
  inquiryFormOptions,
  inquiryListFilterFor,
  markInquiryAsSpam,
  rejectInquiryCustomerApproval,
  requestInquiryCustomerApproval,
  saveInquiryRecords,
  saveInquiryAsContact,
  saveInquiryAsCustomer,
  updateInquiryReview
} from '../services/inquiryService.mjs';
import { attachmentPreviewKind, extractDocxPlainText, renderDxfPreview } from '../utils/attachmentPreview.mjs';
import { attachmentContentDisposition, inlineContentDisposition } from '../utils/contentDisposition.mjs';

const INQUIRY_PAGE_SIZE = 50;
const FUTURE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const inquiryListDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function positivePageNumber(value) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function inquiryListViewMode(value) {
  return value === 'all' ? 'all' : 'page';
}

function inquiryListViewFilters(filter) {
  return {
    query: filter.searchTerm || '',
    source: filter.source || '',
    status: filter.status || '',
    dateFrom: filter.dateFrom || '',
    dateTo: filter.dateTo || '',
    assignedUserId: filter.assignedUserId || ''
  };
}

function inquiryListPageUrl(filters, page) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const query = params.toString();
  return query ? `/inquiries?${query}` : '/inquiries';
}

function formatInquiryListDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const parts = Object.fromEntries(
    inquiryListDateFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function inquiryListItem(inquiry, now = Date.now()) {
  const sourceDate = new Date(inquiry.sourceReceivedAt);
  const sourceDateInvalid = Boolean(inquiry.sourceReceivedAt)
    && (!Number.isFinite(sourceDate.getTime()) || sourceDate.getTime() > now + FUTURE_DATE_TOLERANCE_MS);
  const effectiveDate = sourceDateInvalid || !inquiry.sourceReceivedAt
    ? inquiry.createdAt
    : inquiry.sourceReceivedAt;
  return {
    ...inquiry,
    listReceivedAt: formatInquiryListDate(effectiveDate),
    sourceDateInvalid
  };
}

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
  const users = typeof userRepository?.listUsersWithRoles === 'function'
    ? await userRepository.listUsersWithRoles()
    : [user];
  const assignableUsers = inquiryAssignableUsers(user, users);
  const salespeople = inquirySalespersonUsers(user, users);
  return { customers, contacts, assignableUsers, salespeople };
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
  const customerApproval = typeof dependencies.inquiryCustomerApprovalRepository?.findLatestByInquiry === 'function'
    ? await dependencies.inquiryCustomerApprovalRepository.findLatestByInquiry(inquiry.id)
    : null;
  let duplicateCustomers = data.duplicateCustomers;
  if (!Array.isArray(duplicateCustomers) && inquiry.companyName
    && typeof dependencies.customerRepository?.findDuplicatesByName === 'function') {
    duplicateCustomers = await dependencies.customerRepository.findDuplicatesByName(inquiry.companyName);
  }
  res.status(status);
  renderInquiryDetail(res, {
    inquiry,
    inquiryAttachments,
    customerApproval,
    canDecideCustomerApproval: canDecideInquiryCustomerApproval(req.currentUser, customerApproval),
    canDeleteInquiry: canDeleteInquiry(req.currentUser),
    canProcessInquiry: canProcessInquiry(inquiry),
    duplicateCustomers: duplicateCustomers || [],
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
    'Contact name is required',
    'Sales owner is required'
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
  if (error instanceof DuplicateContactError) {
    await renderInquiryDetailPage(dependencies, req, res, inquiry, {
      actionError: `${res.locals.t('duplicateContactFound')}: ${res.locals.t('duplicateContactCoordinationHint')}`
    }, 409);
    return;
  }
  if (error instanceof DuplicateCustomerError) {
    await renderInquiryDetailPage(dependencies, req, res, inquiry, {
      duplicateCustomers: error.duplicates
    }, 409);
    return;
  }
  if (error instanceof CustomerApprovalRequiredError) {
    const duplicates = typeof dependencies.customerRepository?.findDuplicatesByName === 'function'
      ? await dependencies.customerRepository.findDuplicatesByName(error.customer.name)
      : [error.customer];
    await renderInquiryDetailPage(dependencies, req, res, inquiry, {
      duplicateCustomers: duplicates,
      actionError: error.message
    }, 409);
    return;
  }
  if (inquiry && [
    'Customer approval already pending',
    'Customer approval is not required',
    'Customer approval is not pending',
    'Customer approval could not be completed',
    'Sales manager is not configured',
    'Decision note is required'
  ].includes(error.message)) {
    await renderInquiryDetailPage(dependencies, req, res, inquiry, {
      actionError: error.message
    }, error.message === 'Decision note is required' ? 400 : 409);
    return;
  }
  handleInquiryError(error, res, next);
}

export function inquiryRoutes({
  inquiryRepository,
  inquiryAttachmentRepository,
  inquiryCustomerApprovalRepository,
  customerRepository,
  contactRepository,
  opportunityRepository,
  attachmentRepository,
  approvalSettingRepository,
  userRepository,
  uploadDir = './var/uploads'
}) {
  const router = Router();
  const dependencies = {
    inquiryRepository,
    inquiryAttachmentRepository,
    inquiryCustomerApprovalRepository,
    customerRepository,
    contactRepository,
    opportunityRepository,
    attachmentRepository,
    approvalSettingRepository,
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
      const filter = inquiryListFilterFor(req.currentUser, req.query);
      const viewMode = inquiryListViewMode(req.query.view);
      const totalItems = await inquiryRepository.countInquiries(filter);
      const totalPages = viewMode === 'all' ? 1 : Math.max(1, Math.ceil(totalItems / INQUIRY_PAGE_SIZE));
      const page = viewMode === 'all' ? 1 : Math.min(positivePageNumber(req.query.page), totalPages);
      const listFilter = viewMode === 'all'
        ? filter
        : {
            ...filter,
            limit: INQUIRY_PAGE_SIZE,
            offset: (page - 1) * INQUIRY_PAGE_SIZE
          };
      const [inquiries, users] = await Promise.all([
        inquiryRepository.listInquiries(listFilter),
        userRepository.listUsersWithRoles()
      ]);
      const filters = inquiryListViewFilters(filter);
      const paginationFilters = { ...filters, view: viewMode === 'all' ? 'all' : '' };
      res.render('inquiries/index', {
        inquiries: inquiries.map((inquiry) => inquiryListItem(inquiry)),
        filters,
        viewMode,
        clearFiltersUrl: viewMode === 'all' ? '/inquiries?view=all' : '/inquiries',
        assignees: inquiryAssignableUsers(req.currentUser, users),
        pagination: {
          page,
          pageSize: INQUIRY_PAGE_SIZE,
          totalItems,
          totalPages,
          firstItem: totalItems ? (viewMode === 'all' ? 1 : ((page - 1) * INQUIRY_PAGE_SIZE) + 1) : 0,
          lastItem: viewMode === 'all' ? totalItems : Math.min(page * INQUIRY_PAGE_SIZE, totalItems),
          previousUrl: viewMode === 'page' && page > 1 ? inquiryListPageUrl(paginationFilters, page - 1) : '',
          nextUrl: viewMode === 'page' && page < totalPages ? inquiryListPageUrl(paginationFilters, page + 1) : ''
        },
        ...inquiryFormOptions
      });
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.get('/inquiries/new', async (req, res, next) => {
    try {
      const options = await loadCrmOptions({ customerRepository, contactRepository, userRepository }, req.currentUser);
      const defaultAssignee = options.assignableUsers.find((user) => Number(user.id) === Number(req.currentUser.id))
        || options.assignableUsers[0];
      renderInquiryForm(res, {
        inquiry: {
          source: 'manual',
          priority: 'normal',
          status: 'new',
          assignedUserId: defaultAssignee?.id || null
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
      const inquiry = await createInquiry({ inquiryRepository, userRepository }, req.currentUser, req.body);
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
        contactRepository,
        userRepository
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

  router.post('/inquiries/:id/customer-approval', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await requestInquiryCustomerApproval(dependencies, req.currentUser, inquiry, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      await handleInquiryActionError(error, dependencies, req, res, next, inquiry);
    }
  });

  router.post('/inquiries/:id/customer-approval/:requestId/approve', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      const opportunity = await approveInquiryCustomerApproval(
        dependencies,
        req.currentUser,
        inquiry,
        req.params.requestId,
        req.body
      );
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      await handleInquiryActionError(error, dependencies, req, res, next, inquiry);
    }
  });

  router.post('/inquiries/:id/customer-approval/:requestId/reject', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await rejectInquiryCustomerApproval(
        dependencies,
        req.currentUser,
        inquiry,
        req.params.requestId,
        req.body
      );
      res.redirect(`/inquiries/${inquiry.id}`);
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

  router.post('/inquiries/:id/save-records', async (req, res, next) => {
    let inquiry;
    try {
      inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await saveInquiryRecords(dependencies, req.currentUser, inquiry, req.body);
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
