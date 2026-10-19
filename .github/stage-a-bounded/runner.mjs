import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const APP='https://rooted-homeschool-9ug93pv96-brittanywaltrips-projects.vercel.app';
const DEPLOYMENT='dpl_AYuaHP1NRmjsvRiAKz6jLifYk5QD';
const SB='https://cvgqovweybggrqakhdtd.supabase.co';
const REF='cvgqovweybggrqakhdtd';
const raw=readFileSync(new URL('./allowlist.json',import.meta.url));
const A=JSON.parse(raw);
const env=process.env;
const contexts=[];
const tokens=[];
let originalGoals=null;
const issued=new Map();
const armedByGoal=new Map();
const blocked={third_party:0,read_rpc:0,mutation:0};
let browser, activeStart=0, dispatched=0, fatal=false, lostReplies=0, lostCompleted=0;
const safe=(code)=>{throw new Error(code)};
const eq=(a,b)=>{try{assert.deepEqual(a,b)}catch{safe('state_comparison_failed')}};
const check=(yes,code)=>{if(!yes)safe(code)};
const pass=(name)=>console.log(JSON.stringify({check:name,passed:true}));
function deadline(){check(activeStart>0&&Date.now()-activeStart<30*60*1000,'active_budget_exceeded')}
function rowsFor(index){return A.lessons.slice(index*6,index*6+6)}
function journal(rpc,args){
 deadline(); check(!fatal&&dispatched<24,'dispatch_budget_exceeded');
 check(/^[a-f0-9-]{36}$/.test(args.p_operation_id??''),'operation_id_refused');
 if(rpc==='commit_scheduler_extra_completion'){
  const armed=armedByGoal.get(args.p_goal_id);
  check(armed,'goal_not_armed');
  eq(args.p_expected,armed.snapshot);
  eq(args.p_items.map(x=>x.lessonId).sort(),[...armed.ids].sort());
  check(args.p_local_day===env.FIXTURE_DAY,'day_refused');
  const validRows=rowsFor(A.goals.indexOf(args.p_goal_id));
  eq(args.p_expected.rows.map(x=>x.id).sort(),[...validRows].sort());
  for(const x of args.p_items){
   check(validRows.includes(x.lessonId),'lesson_refused');
   const r=args.p_expected.rows.find(v=>v.id===x.lessonId);
   eq(x.placement,{curriculum_goal_id:r.curriculum_goal_id,queue_position:r.queue_position,scheduled_date:r.scheduled_date,queue_pinned:r.queue_pinned,skipped:r.skipped,completed:r.completed});
   eq(Object.keys(x.payload).sort(),['completed','completed_at','date','is_backfill','queue_pinned','scheduled_date','scheduled_source']);
   check(x.payload.completed===true&&x.payload.date===env.FIXTURE_DAY&&x.payload.scheduled_date===env.FIXTURE_DAY&&x.payload.is_backfill===false&&x.payload.queue_pinned===(r.queue_pinned===true)&&x.payload.scheduled_source==='completion_today'&&Number.isFinite(Date.parse(x.payload.completed_at)),'payload_refused');
  }
  if(issued.has(args.p_operation_id))eq(issued.get(args.p_operation_id),args);
  else issued.set(args.p_operation_id,structuredClone(args));
 }else{
  check(rpc==='undo_scheduler_action'&&issued.has(args.p_operation_id),'undo_refused');
  eq(Object.keys(args),['p_operation_id']);
 }
 dispatched++;
 // Print BEFORE sending: failed/ambiguous requests remain in the operation journal.
 console.log(JSON.stringify({dispatch:dispatched,rpc,operation_id:args.p_operation_id,goal_id:issued.get(args.p_operation_id)?.p_goal_id}));
}
function readRpcAllowed(name,args){
 return name==='read_scheduler_state'&&A.goals.includes(args.p_goal_id)
  || name==='read_scheduler_recovery'&&issued.has(args.p_operation_id)&&args.p_rpc==='commit_scheduler_extra_completion'&&(args.p_goal_id==null||A.goals.includes(args.p_goal_id));
}
async function guard(route){
 const req=route.request(), url=new URL(req.url()), method=req.method();
 try{
  deadline();
  if(url.origin===APP){
   if(method==='GET'&&(url.pathname==='/login'||url.pathname==='/dashboard'||url.pathname==='/dashboard/plan'||url.pathname.startsWith('/_next/')||url.pathname==='/favicon.ico'))return route.continue();
   if(!['GET','HEAD','OPTIONS'].includes(method)){blocked.mutation++;fatal=true}
   return route.abort();
  }
  if(url.origin!==SB){blocked.third_party++;return route.abort()}
  if(method==='OPTIONS'&&(url.pathname.startsWith('/rest/v1/')||url.pathname==='/auth/v1/user'))return route.continue();
  if(method==='GET'&&((url.pathname.startsWith('/rest/v1/')&&!url.pathname.startsWith('/rest/v1/rpc/'))||url.pathname==='/auth/v1/user'))return route.continue();
  if(method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1), args=req.postDataJSON();
   if(readRpcAllowed(name,args))return route.continue();
   if(name==='commit_scheduler_extra_completion'||name==='undo_scheduler_action'){
    journal(name,args);
    if(name==='commit_scheduler_extra_completion'&&lostReplies>0){
     lostReplies--;
     // Real server dispatch; discard ONLY the response to exercise durable recovery.
     const response=await route.fetch({maxRedirects:0,timeout:15000});
     check(response.ok(),'lost_reply_server_refused');
     check(['applied','already_applied'].includes((await response.json()).status),'lost_reply_not_confirmed');
     await route.abort(); lostCompleted++; return;
    }
    return route.continue();
   }
  }
  // Unexpected first-party mutations fail the run rather than being masked.
  if(method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/read_'))blocked.read_rpc++;
  else if(!['GET','HEAD','OPTIONS'].includes(method)){blocked.mutation++;fatal=true}
  return route.abort();
 }catch{fatal=true;await route.abort()}
}
async function api(account,path,{method='GET',body}={}){
 deadline();
 const res=await fetch(SB+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:env.STAGING_ANON_KEY,Authorization:'Bearer '+account.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 check(res.ok,'authorized_request_refused');return res.json();
}
async function rpc(account,name,args,mutate=false){
 if(mutate)journal(name,args);else check(readRpcAllowed(name,args),'read_rpc_refused');
 return api(account,'/rest/v1/rpc/'+name,{method:'POST',body:args});
}
async function state(account,index){const r=await rpc(account,'read_scheduler_state',{p_goal_id:A.goals[index]});check(r.status==='ready'&&r.localDay===env.FIXTURE_DAY,'state_not_ready');check(r.mode===(index===0?'legacy':'atomic_v2'),'fixture_mode_refused');return r.snapshot}
async function allRows(account){
 const rows=await api(account,'/rest/v1/lessons?select=*&id=in.('+A.lessons.join(',')+')&order=id');
 check(Array.isArray(rows),'rows_refused');return rows.map(({updated_at,...business})=>business);
}
async function goalRows(accounts){
 const lists=await Promise.all(accounts.map(a=>api(a,'/rest/v1/curriculum_goals?select=*&id=in.('+A.goals.join(',')+')&order=id')));
 return lists.flat().map(({updated_at,...business})=>business).sort((a,b)=>a.id.localeCompare(b.id));
}
async function snapshot(accounts){
 const rows=[...await allRows(accounts[0]),...await allRows(accounts[1])].sort((a,b)=>a.id.localeCompare(b.id));
 if(originalGoals){
  const goals=await goalRows(accounts);eq(goals.map(g=>g.id),originalGoals.map(g=>g.id));
  for(const old of originalGoals){const now=goals.find(g=>g.id===old.id),active=rows.some(r=>r.curriculum_goal_id===old.id&&r.completed);for(const key of Object.keys(old)){if(active&&['current_lesson','completed_at'].includes(key))continue;eq(now[key],old[key])}}
 }
 return rows;
}
async function arm(account,index,ids){armedByGoal.set(A.goals[index],{goal:A.goals[index],ids,snapshot:await state(account,index)})}
async function login(index){
 const ctx=await browser.newContext({timezoneId:'UTC',viewport:{width:390,height:844},serviceWorkers:'block'});
 contexts.push(ctx);
 if(env.VERCEL_AUTOMATION_BYPASS_SECRET){
  const bypass=await ctx.request.get(APP+'/api/health?x-vercel-protection-bypass='+encodeURIComponent(env.VERCEL_AUTOMATION_BYPASS_SECRET)+'&x-vercel-set-bypass-cookie=true',{maxRedirects:0,timeout:15000});
  check(bypass.status()===200||bypass.status()===307,'bypass_refused');
  const c=(await ctx.cookies(APP)).find(x=>x.name==='_vercel_jwt');
  check(c&&c.domain.replace(/^\./,'')===new URL(APP).hostname,'bypass_scope_refused');
 }
 // Fixed-origin ordinary app login, cookies stay only in this ephemeral context.
 const res=await ctx.request.post(APP+'/api/auth/login',{maxRedirects:0,timeout:15000,data:{email:env[index?'CONTROL_EMAIL':'OWNER_EMAIL'],password:env[index?'CONTROL_PASSWORD':'OWNER_PASSWORD']}});
 check(res.ok()&&(await res.json()).ok===true,'app_login_refused');
 const cookies=(await ctx.cookies(APP)).filter(c=>c.name.startsWith('sb-'+REF+'-auth-token')).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 check(cookies.length>0,'session_cookie_missing');
 const encoded=cookies.map(c=>c.value).join('');
 check(encoded.startsWith('base64-'),'session_cookie_format');
 const session=JSON.parse(Buffer.from(encoded.slice(7),'base64url').toString());
 check(typeof session.access_token==='string','session_token_missing');tokens.push(session.access_token);
 const account={ctx,token:session.access_token,page:await ctx.newPage()};
 await ctx.route('**/*',guard);
 const identity=await api(account,'/auth/v1/user');check(identity.id===A.owners[index],'account_identity_refused');
 const p=await api(account,'/rest/v1/profiles?select=id,timezone,onboarded&id=eq.'+A.owners[index]);
 check(p.length===1&&p[0].timezone==='UTC'&&p[0].onboarded===true,'profile_prerequisite');
 return account;
}
async function today(account){await account.page.goto(APP+'/dashboard',{waitUntil:'domcontentloaded',timeout:30000});await account.page.getByRole('button',{name:'+ Log extra lessons',exact:true}).waitFor({timeout:20000});check(!fatal,'network_guard_refused')}
async function choose(account,entries){
 await account.page.getByRole('button',{name:'+ Log extra lessons',exact:true}).click();
 for(const [course,lesson] of entries){
  const button=account.page.getByRole('button',{name:new RegExp('Stage A synthetic lesson '+lesson+'\\s+Stage A synthetic course '+course+'(?:\\s|$)')});
  check(await button.count()===1,'course_identity_ambiguous');await button.click();
 }
 await account.page.getByRole('button',{name:`Log ${entries.length} lesson${entries.length===1?'':'s'} as done`,exact:true}).click();
}
async function waitFor(fn){const end=Date.now()+20000;while(Date.now()<end){deadline();if(await fn())return;await new Promise(r=>setTimeout(r,250))}safe('condition_timeout')}
function selectedOnly(before,after,ids){
 eq(before.map(r=>r.id),after.map(r=>r.id));
 for(const old of before){
  const now=after.find(x=>x.id===old.id);
  for(const key of Object.keys(old)){
   if(ids.includes(old.id)&&['completed','completed_at','date','scheduled_date','scheduled_source','is_backfill'].includes(key))continue;
   // Gap preservation marker is the only permitted unselected-row change.
   if(key==='queue_preserved'){const preserve=!ids.includes(old.id)&&!old.completed&&!old.skipped&&old.queue_position!=null&&ids.some(id=>before.find(r=>r.id===id)?.curriculum_goal_id===old.curriculum_goal_id);eq(now[key],preserve?true:old[key]);continue;}
   eq(now[key],old[key]);
  }
  check(now.completed===ids.includes(old.id),'selected_completion_scope');
  if(ids.includes(old.id))check(now.date===env.FIXTURE_DAY&&now.scheduled_date===env.FIXTURE_DAY&&now.scheduled_source==='completion_today'&&Number.isFinite(Date.parse(now.completed_at)),'persisted_completion_day');
 }
}
async function undo(account,id){const r=await rpc(account,'undo_scheduler_action',{p_operation_id:id},true);check(r.status==='undone','undo_failed')}
let accounts=[];
try{
 check(createHash('sha256').update(raw).digest('hex')==='9019f84941a54f8d3ade9dc95ba350410db289c6af14a237b1cfd639524ed533','allowlist_changed');
 check(/^[a-f0-9]{40}$/.test(env.EXPECTED_SOURCE??'')&&env.ACTUAL_SOURCE===env.EXPECTED_SOURCE,'source_refused');
 check(/^[a-f0-9]{64}$/.test(env.FIXTURE_RECEIPT_SHA256??'')&&/^\d{4}-\d{2}-\d{2}$/.test(env.FIXTURE_DAY??''),'fixture_receipt_missing');
 check(env.STAGING_URL?.replace(/\/$/,'')===SB&&!!env.STAGING_ANON_KEY,'staging_config_refused');
 for(const key of ['OWNER_EMAIL','OWNER_PASSWORD','CONTROL_EMAIL','CONTROL_PASSWORD'])check(!!env[key],'credential_missing');
 if(!env.STAGING_ANON_KEY.startsWith('sb_publishable_')){const c=JSON.parse(Buffer.from(env.STAGING_ANON_KEY.split('.')[1],'base64url'));check(c.role==='anon'&&(!c.ref||c.ref===REF),'anon_key_refused')}
 browser=await chromium.launch();activeStart=Date.now();
 // Health request may use existing bypass only at this fixed staging origin.
 const health=await fetch(APP+'/api/health',{redirect:'error',signal:AbortSignal.timeout(15000),headers:env.VERCEL_AUTOMATION_BYPASS_SECRET?{'x-vercel-protection-bypass':env.VERCEL_AUTOMATION_BYPASS_SECRET}:{}});
 check(health.ok,'health_refused');const h=await health.json();check(h.env==='staging'&&h.projectRef===REF&&h.identityOk===true,'health_identity_refused');
 console.log(JSON.stringify({deployment:DEPLOYMENT,fixture_receipt_sha256:env.FIXTURE_RECEIPT_SHA256}));
 accounts.push(await login(0));accounts.push(await login(1));
 const [owner,control]=accounts;
 originalGoals=await goalRows(accounts);eq(originalGoals.map(g=>g.id).sort(),[...A.goals].sort());
 const initial=await snapshot(accounts);
 eq(initial.map(r=>r.id).sort(),[...A.lessons].sort());
 for(let g=0;g<4;g++)for(const id of rowsFor(g)){const r=initial.find(x=>x.id===id);check(r.user_id===A.owners[A.goal_owner_indices[g]]&&r.child_id===A.children[A.goal_child_indices[g]]&&r.curriculum_goal_id===A.goals[g]&&r.completed===false&&r.queue_preserved===false,'fixture_shape_refused')}
 // RLS must hide the other account's rows, not just return a blended 24-row total.
 eq((await allRows(owner)).map(x=>x.id).sort(),A.lessons.slice(0,18).sort());eq((await allRows(control)).map(x=>x.id).sort(),A.lessons.slice(18).sort());
 for(let g=0;g<4;g++)await state(g===3?control:owner,g);
 pass('two_identities_fixture_modes_and_rls');
 await today(owner);
 // Legacy later lesson, replay and exact repeated Undo.
 await arm(owner,0,[A.lessons[2]]);await choose(owner,[[1,3]]);
 await waitFor(async()=> (await allRows(owner)).find(r=>r.id===A.lessons[2])?.completed===true);
 selectedOnly(initial,await snapshot(accounts),[A.lessons[2]]);
 const legacy=[...issued.keys()].at(-1), legacyArgs=issued.get(legacy);
 check((await rpc(owner,'commit_scheduler_extra_completion',legacyArgs,true)).status==='already_applied','replay_failed');
 await undo(owner,legacy);check((await rpc(owner,'undo_scheduler_action',{p_operation_id:legacy},true)).status==='already_undone','undo_replay_failed');eq(await snapshot(accounts),initial);pass('legacy_selected_only_replay_exact_undo');
 // Atomic noncontiguous selection, two real lost responses, reload and explicit recovery.
 await today(owner);await arm(owner,1,[A.lessons[8],A.lessons[10]]);lostReplies=2;
 await choose(owner,[[2,3],[2,5]]);
 await waitFor(async()=>lostReplies===0&&lostCompleted===2&&dispatched>=6);
 await owner.page.reload({waitUntil:'domcontentloaded'});
 const recover=owner.page.getByRole('button',{name:'Check saved changes',exact:true});await recover.waitFor({timeout:20000});await recover.click();
 const undoButton=owner.page.getByRole('button',{name:'Undo schedule change',exact:true});await undoButton.waitFor({timeout:20000});
 selectedOnly(initial,await snapshot(accounts),[A.lessons[8],A.lessons[10]]);
 const atomic=[...issued.keys()].at(-1);await undoButton.click();await waitFor(async()=>{try{assert.deepEqual(await snapshot(accounts),initial);return true}catch{return false}});
 check((await rpc(owner,'undo_scheduler_action',{p_operation_id:atomic},true)).status==='already_undone','atomic_undo_replay_failed');pass('atomic_noncontiguous_reload_recovery_exact_undo');
 // Explicit foreign-owner write and Undo denials with unchanged snapshots.
 await arm(owner,0,[A.lessons[2]]);const foreign={...legacyArgs,p_expected:armedByGoal.get(A.goals[0]).snapshot,p_operation_id:randomUUID()};
 check((await rpc(control,'commit_scheduler_extra_completion',foreign,true)).status==='invalid','foreign_write_not_denied');
 check((await rpc(control,'undo_scheduler_action',{p_operation_id:legacy},true)).status==='invalid','foreign_undo_not_denied');eq(await snapshot(accounts),initial);pass('foreign_owner_denials_zero_changes');
 // One multi-course submission with identical printed numbers, exact independent IDs.
 await today(owner);await arm(owner,0,[A.lessons[2]]);await arm(owner,1,[A.lessons[8]]);
 const prior=new Set(issued.keys());await choose(owner,[[1,3],[2,3]]);
 await waitFor(async()=>{const rows=await allRows(owner);return [A.lessons[2],A.lessons[8]].every(id=>rows.find(r=>r.id===id)?.completed===true)});
 selectedOnly(initial,await snapshot(accounts),[A.lessons[2],A.lessons[8]]);
 const multi=[...issued.keys()].filter(id=>!prior.has(id));check(multi.length===2,'multi_course_dispatch_count');
 for(const id of multi)await undo(owner,id);
 eq(await snapshot(accounts),initial);pass('multi_course_overlapping_numbers_exact_ids');
 await today(owner);await owner.page.goto(APP+'/dashboard/plan?unfinishedDate='+env.FIXTURE_DAY,{waitUntil:'domcontentloaded'});check(new URL(owner.page.url()).pathname==='/dashboard/plan','plan_navigation_refused');
 await owner.page.getByRole('button',{name:'Find a lesson',exact:true}).waitFor({timeout:20000});
 eq(await snapshot(accounts),initial);check(!fatal,'network_guard_refused');pass('plan_reload_does_not_change_rows');
 console.log(JSON.stringify({result:'passed',dispatches:dispatched,blocked,operation_ids:[...issued.keys()],active_seconds:Math.round((Date.now()-activeStart)/1000),cleanup:'execution owner must now run sealed checkpoint and guarded cleanup'}));
}catch{
 // Never print request/response bodies, error stacks, URLs containing query secrets or session data.
 console.error(JSON.stringify({result:'failed_stop',dispatches:dispatched,blocked,operation_ids:[...issued.keys()],cleanup:'do not rerun; inspect journal and use sealed checkpoint/guarded cleanup'}));process.exitCode=1;
}finally{
 for(const token of tokens){try{const r=await fetch(SB+'/auth/v1/logout?scope=local',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:env.STAGING_ANON_KEY,Authorization:'Bearer '+token}});if(!r.ok)process.exitCode=1}catch{process.exitCode=1}}
 for(const c of contexts)await c.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
}
