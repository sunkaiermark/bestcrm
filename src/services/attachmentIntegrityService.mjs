import path from 'node:path';
import {
  inspectStoredAttachmentFile,
  removeStoredAttachmentFile,
  resolveStoredPath
} from './attachmentFileService.mjs';
import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

function uploadedStoredPath(uploadDir, file) {
  if (!file?.path) throw new Error('Attachment file is required');
  return path.relative(path.resolve(uploadDir), path.resolve(file.path)).split(path.sep).join('/');
}

function ownedUploadedPath(uploadDir, file, storedPath) {
  const resolved = resolveStoredPath(uploadDir, storedPath);
  if (!resolved || path.resolve(resolved) !== path.resolve(file.path)) {
    throw new Error('Attachment path is invalid');
  }
  return resolved;
}

export async function persistUploadedOpportunityAttachment({
  attachmentRepository,
  uploadDir,
  file,
  opportunityId,
  category,
  actorUserId,
  sourceInquiryAttachmentId = null
}) {
  if (typeof attachmentRepository?.createAttachment !== 'function') {
    throw new Error('Attachment repository is unavailable');
  }

  const storedPath = uploadedStoredPath(uploadDir, file);
  const cleanupPath = ownedUploadedPath(uploadDir, file, storedPath);
  try {
    const inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
    return await attachmentRepository.createAttachment({
      opportunityId,
      category,
      originalName: normalizeUploadedFilename(file.originalname),
      storedPath,
      mimeType: file.mimetype || 'application/octet-stream',
      fileSize: inspected.fileSize,
      uploadedBy: actorUserId,
      sourceInquiryAttachmentId,
      sha256: inspected.sha256
    });
  } catch (error) {
    await removeStoredAttachmentFile(cleanupPath);
    throw error;
  }
}

export async function retireOpportunityAttachment({
  attachmentRepository,
  attachmentId,
  actorUserId,
  reason,
  replacedByAttachmentId = null
}) {
  if (typeof attachmentRepository?.retireById !== 'function') {
    throw new Error('Attachment repository is unavailable');
  }
  const retired = await attachmentRepository.retireById({
    id: attachmentId,
    actorUserId,
    reason,
    replacedByAttachmentId
  });
  if (!retired) {
    const error = new Error('Attachment was not found or is already retired');
    error.statusCode = 409;
    throw error;
  }
  return retired;
}

export async function replaceOpportunityAttachment({
  attachmentRepository,
  uploadDir,
  file,
  originalAttachment,
  actorUserId,
  reason
}) {
  if (typeof attachmentRepository?.replaceAttachment !== 'function') {
    throw new Error('Attachment repository is unavailable');
  }
  if (!originalAttachment?.id || !originalAttachment?.opportunityId || !originalAttachment?.category) {
    throw new Error('Original attachment is required');
  }

  const storedPath = uploadedStoredPath(uploadDir, file);
  const cleanupPath = ownedUploadedPath(uploadDir, file, storedPath);
  try {
    const inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
    const replaced = await attachmentRepository.replaceAttachment({
      originalAttachmentId: originalAttachment.id,
      actorUserId,
      reason,
      replacement: {
        opportunityId: originalAttachment.opportunityId,
        category: originalAttachment.category,
        originalName: normalizeUploadedFilename(file.originalname),
        storedPath,
        mimeType: file.mimetype || 'application/octet-stream',
        fileSize: inspected.fileSize,
        uploadedBy: actorUserId,
        sourceInquiryAttachmentId: null,
        sha256: inspected.sha256
      }
    });
    if (!replaced) {
      const error = new Error('Attachment was not found or is already retired');
      error.statusCode = 409;
      throw error;
    }
    return replaced;
  } catch (error) {
    await removeStoredAttachmentFile(cleanupPath);
    throw error;
  }
}
