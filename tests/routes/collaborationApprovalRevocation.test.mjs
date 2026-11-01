import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../../src/server.mjs';
import {hashPassword} from '../../src/services/authService.mjs';
test('approval revocation route requires login, CSRF, assigned technical reviewer and explicit saved reason',async()=>{
 const user={id:2,username:'reviewer',displayName:'Reviewer',roles:['technical_manager'],isActive:true,passwordHash:await hashPassword('ReviewTest123!')};
 let owner=true,assigned=true,calls=0,failure=null;
 const app=createApp({sessionSecret:'revoke-test-only',csrfProtection:true,officeConfig:{enabled:false},aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},
  userRepository:{findByIdWithRoles:async()=>user,findByUsernameWithRoles:async()=>user},
  opportunityRepository:{getOpportunityDetail:async()=>({id:30,opportunityNo:'TEST',title:'Test',salespersonId:2,technicalManagerId:assigned?2:3,status:'commercial_quote_in_progress'})},
  opportunityResponsibilityRepository:{listTeamMembersByOpportunity:async()=>[]},
  opportunityCollaborationRepository:{findWorkPackageById:async()=>({id:1,opportunityId:owner?30:31,planKind:'internal_quote'}),revokeFileApproval:async input=>{if(failure)throw failure;calls++;assert.equal(input.actorUserId,2);assert.equal(input.note,'误批准，请复核');assert.equal(Number(input.expectedRevisionRoundId),8);}}
 });
 const url='/opportunities/30/collaboration-files/1/11/revoke_approval',agent=request.agent(app);
 await request(app).post(url).expect(403);
 const login=await agent.get('/login');const csrf=login.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
 await agent.post('/login').type('form').send({username:'reviewer',password:'ReviewTest123!',_csrf:csrf}).expect(302);
 const authenticatedPage=await agent.get('/login');const currentCsrf=authenticatedPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
 const payload={note:'误批准，请复核',expectedRevisionRoundId:8,confirmRejection:'yes',_csrf:currentCsrf};
 await agent.post(url).type('form').send({...payload,_csrf:'bad'}).expect(403);
 await agent.post(url).type('form').send({...payload,note:''}).expect(400);
 await agent.post(url).type('form').send({...payload,confirmRejection:''}).expect(400);
 assigned=false;await agent.post(url).type('form').send(payload).expect(403);assigned=true;
 owner=false;await agent.post(url).type('form').send(payload).expect(404);owner=true;
 failure=Object.assign(Error('该文件已用于正式报价'),{statusCode:409});await agent.post(url).type('form').send(payload).expect(409);failure=null;
 await agent.post(url).type('form').send(payload).expect(302).expect('Location','/opportunities/30#internal-quote');assert.equal(calls,1);
});
