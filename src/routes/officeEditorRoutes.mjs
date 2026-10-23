import { BASE_CONTENT_SECURITY_POLICY } from '../middleware/securityHeaders.mjs';
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import { officeError } from '../services/officeEditingService.mjs';
export function officeServiceRoutes({service,uploadDir}) {
  const router=Router();
  router.get('/office-service/:sessionId/file',async(req,res,next)=>{try{const a=await service.source(req.params.sessionId,req.query.token);const file=resolveStoredPath(uploadDir,a.storedPath);if(!file)throw officeError('Not found',404);res.set('Cache-Control','private, no-store').type(a.mimeType).sendFile(file);}catch(e){next(e);}});
  router.post('/office-service/:sessionId/callback',async(req,res)=>{try{const token=req.get('authorization')?.replace(/^Bearer\s+/i,'')||req.body?.token;await service.callback(req.params.sessionId,token);res.json({error:0});}catch(e){res.status(e.statusCode||500).json({error:1});}});
  return router;
}
export function officeEditorRoutes({service,attachmentRepository}) {
  const router=Router();router.use(requireLogin);
  router.post('/opportunities/:id/attachments/:attachmentId/edit',async(req,res,next)=>{try{const a=await attachmentRepository.findById(req.params.attachmentId);if(!a||a.opportunityId!==Number(req.params.id))throw officeError('Not found',404);const id=await service.start(a,req.currentUser);res.redirect(`/office-editor/${id}`);}catch(e){next(e);}});
  router.get('/office-editor/:sessionId/status',async(req,res,next)=>{try{const data=await service.editor(req.params.sessionId,req.currentUser);res.set('Cache-Control','private, no-store').json({versionNo:data.session.version_no,currentAttachmentId:data.session.current_attachment_id});}catch(e){next(e);}});
  router.get('/office-editor/:sessionId',async(req,res,next)=>{try{const data=await service.editor(req.params.sessionId,req.currentUser);const origin=new URL(data.scriptUrl).origin;res.set('Content-Security-Policy',BASE_CONTENT_SECURITY_POLICY.replace("script-src 'self' 'unsafe-inline'","script-src 'self' 'unsafe-inline' "+origin).replace("frame-src 'self'","frame-src 'self' "+origin));res.set('Cache-Control','private, no-store');res.render('attachments/office-editor',{...data,history:await service.history(data.session.source_attachment_id),activeNav:'opportunities'});}catch(e){next(e);}});
  return router;
}
