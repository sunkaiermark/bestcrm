import {Router} from 'express';
import {inlineContentDisposition} from '../utils/contentDisposition.mjs';
export function officePreviewServiceRoutes({service}){
 const router=Router();
 router.get('/office-preview-service/:attachmentId/file',async(req,res,next)=>{
  try{const attachment=await service.source(req.params.attachmentId,req.query.token);res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Disposition':inlineContentDisposition(attachment.originalName)}).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').sendFile(attachment.absolutePath);}
  catch(error){if([400,403,404,409].includes(error.statusCode))return res.status(error.statusCode).type('text/plain').send(error.message);next(error);}
 });
 return router;
}
