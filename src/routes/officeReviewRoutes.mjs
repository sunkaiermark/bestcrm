import {Router} from 'express';
import {requireLogin} from '../middleware/auth.mjs';
import {BASE_CONTENT_SECURITY_POLICY} from '../middleware/securityHeaders.mjs';
import {resolveStoredPath} from '../services/attachmentFileService.mjs';
import {officeError} from '../services/officeEditingService.mjs';
function failure(error,res,next){if([400,403,404,409].includes(error.statusCode))return res.status(error.statusCode).type('text/plain').send(error.message);next(error);}
export function officeReviewServiceRoutes({service,uploadDir}){
 const router=Router();
 router.get('/office-review-service/:sessionId/file',async(req,res,next)=>{try{const a=await service.source(req.params.sessionId,req.query.token),file=resolveStoredPath(uploadDir,a.storedPath);if(!file)throw officeError('Not found',404);res.set('Cache-Control','private, no-store').type(a.mimeType).sendFile(file);}catch(e){failure(e,res,next);}});
 router.get('/office-review-service/snapshots/:snapshotId/file',async(req,res,next)=>{try{const a=await service.viewerSource(req.params.snapshotId,req.query.token),file=resolveStoredPath(uploadDir,a.storedPath);if(!file)throw officeError('Not found',404);res.set('Cache-Control','private, no-store').type(a.mimeType).sendFile(file);}catch(e){failure(e,res,next);}});
 router.post('/office-review-service/:sessionId/callback',async(req,res)=>{try{await service.callback(req.params.sessionId,req.get('authorization')?.replace(/^Bearer\s+/i,'')||req.body?.token);res.json({error:0});}catch(e){res.status(e.statusCode||500).json({error:1});}});
 return router;
}
export function officeReviewRoutes({service,attachmentRepository,uploadDir}){
 const router=Router();router.use(['/office-review','/opportunities/:id/attachments/:attachmentId/review'],requireLogin);
 router.post('/opportunities/:id/attachments/:attachmentId/review',async(req,res,next)=>{try{const a=await attachmentRepository.findById(req.params.attachmentId);if(!a||a.opportunityId!==Number(req.params.id))throw officeError('Not found',404);const id=await service.start(a,req.currentUser);res.redirect('/office-review/'+id);}catch(e){failure(e,res,next);}});
 router.get('/office-review/snapshots/:snapshotId/view',async(req,res,next)=>{try{const data=await service.viewer(req.params.snapshotId,req.currentUser),origin=new URL(data.scriptUrl).origin;res.set('Content-Security-Policy',BASE_CONTENT_SECURITY_POLICY.replace("script-src 'self' 'unsafe-inline'","script-src 'self' 'unsafe-inline' "+origin).replace("frame-src 'self'","frame-src 'self' "+origin)).set('Cache-Control','private, no-store');res.render('attachments/office-review-view',{...data,activeNav:'opportunities'});}catch(e){failure(e,res,next);}});
 router.get('/office-review/snapshots/:snapshotId/download',async(req,res,next)=>{try{const a=await service.snapshot(req.params.snapshotId,req.currentUser),file=resolveStoredPath(uploadDir,a.storedPath);if(!file)throw officeError('Not found',404);res.set('Cache-Control','private, no-store').download(file,'审核批注稿-'+a.originalName);}catch(e){failure(e,res,next);}});
 router.get('/office-review/:sessionId/status',async(req,res,next)=>{try{const data=await service.editor(req.params.sessionId,req.currentUser);res.set('Cache-Control','private, no-store').json({savedId:data.saved?.id||null,savedAt:data.saved?.saved_at||null});}catch(e){failure(e,res,next);}});
 router.get('/office-review/:sessionId',async(req,res,next)=>{try{const data=await service.editor(req.params.sessionId,req.currentUser),origin=new URL(data.scriptUrl).origin;res.set('Content-Security-Policy',BASE_CONTENT_SECURITY_POLICY.replace("script-src 'self' 'unsafe-inline'","script-src 'self' 'unsafe-inline' "+origin).replace("frame-src 'self'","frame-src 'self' "+origin)).set('Cache-Control','private, no-store');res.render('attachments/office-review',{...data,activeNav:'opportunities'});}catch(e){failure(e,res,next);}});
 return router;
}
