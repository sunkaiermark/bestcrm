import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';
import {
  copyStoredAttachmentFile,
  inspectStoredAttachmentFile,
  removeStoredAttachmentFile,
  storeAttachmentBuffer
} from './attachmentFileService.mjs';

function attachmentContentBuffer(attachment) {
  return Buffer.isBuffer(attachment?.content) ? attachment.content : null;
}

function fallbackFilename(index) {
  return `email-attachment-${index + 1}`;
}

function shouldSkipInlineAttachment(attachment) {
  return Boolean(attachment?.related && !attachment?.filename);
}

function attachmentName(attachment, index) {
  return normalizeUploadedFilename(attachment?.filename || fallbackFilename(index));
}

function maxAttachmentBytes(maxUploadMb) {
  const number = Number(maxUploadMb);
  return Number.isFinite(number) && number > 0 ? number * 1024 * 1024 : 0;
}

export async function storeEmailInquiryAttachments({
  inquiryAttachmentRepository,
  inquiryId,
  attachments = [],
  uploadDir,
  maxUploadMb
}) {
  if (!inquiryAttachmentRepository?.createAttachment || !Array.isArray(attachments) || attachments.length === 0) {
    return { stored: [], skipped: [] };
  }

  const existing = typeof inquiryAttachmentRepository.listByInquiry === 'function'
    ? await inquiryAttachmentRepository.listByInquiry(inquiryId)
    : [];
  const existingIndexes = new Set(existing.map((attachment) => Number(attachment.sourceIndex)));
  const maxBytes = maxAttachmentBytes(maxUploadMb);
  const stored = [];
  const skipped = [];

  for (const [index, attachment] of attachments.entries()) {
    if (existingIndexes.has(index)) {
      skipped.push({ sourceIndex: index, reason: 'duplicate' });
      continue;
    }
    if (shouldSkipInlineAttachment(attachment)) {
      skipped.push({ sourceIndex: index, reason: 'inline_related' });
      continue;
    }
    const content = attachmentContentBuffer(attachment);
    if (!content) {
      skipped.push({ sourceIndex: index, reason: 'missing_content' });
      continue;
    }
    if (maxBytes > 0 && content.length > maxBytes) {
      skipped.push({ sourceIndex: index, reason: 'too_large' });
      continue;
    }

    const originalName = attachmentName(attachment, index);
    const file = await storeAttachmentBuffer({
      uploadDir,
      originalName,
      content,
      prefix: 'email-inquiries'
    });
    try {
      const record = await inquiryAttachmentRepository.createAttachment({
        inquiryId,
        sourceIndex: index,
        originalName,
        storedPath: file.storedPath,
        mimeType: attachment.contentType || 'application/octet-stream',
        fileSize: file.fileSize,
        cid: attachment.cid || attachment.contentId || '',
        sha256: file.sha256
      });
      if (record) {
        stored.push(record);
      } else {
        await removeStoredAttachmentFile(file.absolutePath);
        skipped.push({ sourceIndex: index, reason: 'duplicate' });
      }
    } catch (error) {
      await removeStoredAttachmentFile(file.absolutePath);
      throw error;
    }
  }

  return { stored, skipped };
}

export async function copyInquiryAttachmentsToOpportunity({
  inquiryAttachmentRepository,
  attachmentRepository,
  inquiryId,
  opportunityId,
  actor,
  uploadDir
}) {
  if (!inquiryAttachmentRepository?.listByInquiry || !attachmentRepository?.createAttachment) {
    return [];
  }
  const inquiryAttachments = await inquiryAttachmentRepository.listByInquiry(inquiryId);
  const copied = [];

  for (const inquiryAttachment of inquiryAttachments) {
    const file = await copyStoredAttachmentFile({
      uploadDir,
      storedPath: inquiryAttachment.storedPath,
      originalName: inquiryAttachment.originalName,
      prefix: 'converted-inquiries'
    });
    try {
      if (inquiryAttachment.sha256 && inquiryAttachment.sha256 !== file.sha256) {
        throw new Error('Copied inquiry attachment digest does not match its source');
      }
      const attachment = await attachmentRepository.createAttachment({
        opportunityId,
        category: 'requirement',
        originalName: inquiryAttachment.originalName,
        storedPath: file.storedPath,
        mimeType: inquiryAttachment.mimeType || 'application/octet-stream',
        fileSize: file.fileSize,
        uploadedBy: actor.id,
        sourceInquiryAttachmentId: inquiryAttachment.id,
        sha256: file.sha256
      });
      copied.push(attachment);
    } catch (error) {
      await removeStoredAttachmentFile(file.absolutePath);
      throw error;
    }
  }

  return copied;
}

export async function referenceInquiryAttachmentsToOpportunity({
  inquiryAttachmentRepository,
  attachmentRepository,
  inquiryId,
  opportunityId,
  actor,
  uploadDir
}) {
  if (!inquiryAttachmentRepository?.listByInquiry || !attachmentRepository?.createAttachment) {
    return [];
  }
  const [inquiryAttachments, opportunityAttachments] = await Promise.all([
    inquiryAttachmentRepository.listByInquiry(inquiryId),
    typeof attachmentRepository.listByOpportunity === 'function'
      ? attachmentRepository.listByOpportunity(opportunityId)
      : []
  ]);
  const existingBySourceId = new Map(opportunityAttachments
    .filter((attachment) => attachment.sourceInquiryAttachmentId)
    .map((attachment) => [Number(attachment.sourceInquiryAttachmentId), attachment]));
  const referenced = [];

  for (const inquiryAttachment of inquiryAttachments) {
    const existing = existingBySourceId.get(Number(inquiryAttachment.id));
    if (existing) {
      referenced.push(existing);
      continue;
    }
    const inspected = await inspectStoredAttachmentFile({
      uploadDir,
      storedPath: inquiryAttachment.storedPath
    });
    if (inquiryAttachment.sha256 && inquiryAttachment.sha256 !== inspected.sha256) {
      throw new Error('Inquiry attachment digest does not match its stored file');
    }
    if (Number.isFinite(Number(inquiryAttachment.fileSize))
        && Number(inquiryAttachment.fileSize) !== inspected.fileSize) {
      throw new Error('Inquiry attachment size does not match its stored file');
    }
    const attachment = await attachmentRepository.createAttachment({
      opportunityId,
      category: 'requirement',
      originalName: inquiryAttachment.originalName,
      storedPath: inquiryAttachment.storedPath,
      mimeType: inquiryAttachment.mimeType || 'application/octet-stream',
      fileSize: inspected.fileSize,
      uploadedBy: actor.id,
      sourceInquiryAttachmentId: inquiryAttachment.id,
      sha256: inspected.sha256
    });
    referenced.push(attachment);
  }

  return referenced;
}
