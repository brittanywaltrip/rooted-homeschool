// Actual hook, runner, daily client and React notice, with a synthetic transport.
// No signed-in route or live backend is claimed. All browser network stays local.
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import webpack from 'webpack';
import ts from 'typescript';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),cwd=process.cwd(),scratch=mkdtempSync('/tmp/rooted-calendar-ui-');
writeFileSync(path.join(scratch,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;}`);
writeFileSync(path.join(scratch,'telemetry.js'),'export const captureMessage=()=>{};export const captureException=()=>{};');
const planSource=readFileSync('app/components/PlanV2/index.tsx','utf8');const ast=ts.createSourceFile('Plan.tsx',planSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const dialog=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CascadeChoiceDialog');assert.ok(dialog);
writeFileSync(path.join(scratch,'dialog.tsx'),`import React from 'react';import {CASCADE_CALENDAR_NOTE} from '${cwd}/app/lib/calendar-refusal.ts';const X=()=>null;export default ${dialog.getText(ast)}`);
writeFileSync(path.join(scratch,'entry.jsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Dialog from './dialog.tsx';
import {useDailyReconcile} from '${cwd}/app/hooks/useDailyReconcile.ts';
import Notice from '${cwd}/app/components/DateSyncNotice.tsx';
import {makeMemorySupabase} from '${cwd}/app/lib/test-helpers/memory-supabase.ts';
import {addDays,ymdInTz} from '${cwd}/app/lib/timezone.ts';
const day=ymdInTz(new Date(),'UTC');const seed={curriculum_goals:[{id:'g',user_id:'u',total_lessons:2,current_lesson:0,lessons_per_day:1,lessons_per_day_overrides:null,school_days:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],start_date:day,archived:false}],vacation_blocks:[],lessons:[1,2].map(n=>({id:'L'+n,user_id:'u',curriculum_goal_id:'g',lesson_number:n,queue_position:n,completed:false,queue_pinned:false,queue_preserved:false,skipped:false,is_backfill:false,scheduled_date:addDays(day,n-2),date:addDays(day,n-2)}))};
const memory=makeMemorySupabase(seed);const state=window.syncFixture={calls:[],corrected:false,rows:memory.tables.lessons,refreshes:0};
const client={...memory.client,rpc:async(name,args)=>{state.calls.push(name);
 if(!state.corrected)return {data:{status:'invalid',reason:'day_window'},error:null};
 if(name==='read_cascade_snapshot')return {data:{status:'ready',snapshot:{dayStartIso:args.p_day_start,dayEndIso:args.p_day_end}},error:null};
 for(const w of args.p_writes){const r=state.rows.find(r=>r.id===w.id);r.date=r.scheduled_date=w.to;}
 return {data:{status:'applied',written:args.p_writes.length},error:null};}};
function Surface(){const sync=useDailyReconcile(client,'u',{onRedated:()=>{state.refreshes++;}});return <Notice note={sync.failureNote} {...sync}/>;}
function App(){const [page,setPage]=useState('Today'),[open,setOpen]=useState(false);return <main><h1>{page}</h1><button onClick={()=>setPage(v=>v==='Today'?'Plan':'Today')}>Switch surface</button><button onClick={()=>setOpen(true)}>Preview shift</button><Surface key={page}/>{open&&<Dialog choice={{shiftUnavailable:true,calendarMismatch:true,lessonId:'L1',fromDateStr:day,toDateStr:addDays(day,1),goalId:'g',shiftDays:1,futureLessonsToShift:0,projectedFinishDate:null}} onCancel={()=>setOpen(false)} onMoveJustThis={()=>{}} onShiftAll={()=>{throw Error('disabled shift fired');}}/>}</main>;}
createRoot(document.getElementById('root')).render(<App/>);
`);
await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(scratch,'entry.jsx'),output:{path:scratch,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.jsx','.js'],modules:[path.join(cwd,'node_modules'),'node_modules'],alias:{'@':cwd,'@sentry/nextjs$':path.join(scratch,'telemetry.js')}},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:path.join(scratch,'loader.cjs')}]},optimization:{minimize:false}},(error,stats)=>{if(error||stats.hasErrors())reject(error??new Error(stats.toString({all:false,errors:true})));else resolve();}));
const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(readFileSync(path.join(scratch,'bundle.js')));}else res.end('<html><head><style>body{font:16px system-ui;margin:40px;background:#faf8f4}section{padding:20px;border:1px solid #b8a783;max-width:620px}button{margin:10px;padding:10px}button:disabled{opacity:.5}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({timezoneId:'UTC',viewport:{width:1100,height:800}});
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
 await page.clock.install();await page.goto(url);
 await page.getByText('Plan date sync needs attention.').waitFor();const before=await page.evaluate(()=>JSON.stringify(window.syncFixture.rows));
 assert.equal(await page.evaluate(()=>window.syncFixture.calls.length),1);
 mkdirSync('../investigation-evidence/calendar-browser',{recursive:true});await page.screenshot({path:'../investigation-evidence/calendar-browser/mismatch.png'});
 await page.getByRole('button',{name:'Preview shift'}).click();await page.getByText(/different calendar-day boundaries/).waitFor();
 assert.equal(await page.getByRole('button',{name:/Shift all remaining lessons forward/}).isDisabled(),true);
 await page.getByRole('button',{name:'Cancel',exact:true}).last().click();
 await page.getByText('Plan date sync needs attention.').waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(window.syncFixture.rows)),before);
 await page.getByRole('button',{name:'Preview shift'}).click();await page.getByText(/different calendar-day boundaries/).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).last().click();

 await page.getByRole('button',{name:'Hide explanation'}).click();await page.getByText('Plan date sync needs attention.').waitFor();
 assert.equal(await page.getByText(/this device's calendar day differs/).count(),0);
 await page.getByRole('button',{name:'Switch surface'}).click();await page.getByRole('heading',{name:'Plan'}).waitFor();await page.getByText('Plan date sync needs attention.').waitFor();assert.equal(await page.evaluate(()=>window.syncFixture.calls.length),1);
 await page.reload();await page.getByText('Plan date sync needs attention.').waitFor();assert.equal(await page.evaluate(()=>window.syncFixture.calls.length),0,'reload does not auto-retry');
 await page.getByRole('button',{name:'Retry date sync'}).click();await page.getByText('Please wait 30 seconds between retries.').waitFor();assert.equal(await page.evaluate(()=>window.syncFixture.calls.length),1);
 assert.equal(await page.evaluate(()=>JSON.stringify(window.syncFixture.rows)),before);
 assert.equal(await page.getByRole('button',{name:'Retry date sync'}).isDisabled(),true);
 await page.reload();await page.getByText('Plan date sync needs attention.').waitFor();assert.equal(await page.getByRole('button',{name:'Retry date sync'}).isDisabled(),true,'cooldown survives reload');
 await page.evaluate(()=>{window.syncFixture.corrected=true;});await page.clock.fastForward(31_000);
 assert.equal(await page.evaluate(()=>window.syncFixture.calls.length),0,'correction does not cause background polling');
 await page.getByRole('button',{name:'Retry date sync'}).click();await page.getByText('Plan date sync needs attention.').waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.syncFixture.calls),['read_cascade_snapshot','apply_daily_reconcile']);
 assert.equal(await page.evaluate(()=>window.syncFixture.refreshes),1);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('rooted:date-sync:u')),null);
 assert.notEqual(await page.evaluate(()=>JSON.stringify(window.syncFixture.rows)),before);
 mkdirSync('../investigation-evidence/calendar-browser',{recursive:true});await page.screenshot({path:'../investigation-evidence/calendar-browser/retry-success.png'});
 await page.reload();await page.getByText('Plan date sync needs attention.').waitFor();
 await page.evaluate(()=>{const f=window.syncFixture;f.corrected=true;for(const row of f.rows){const d=new Date(row.scheduled_date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);row.date=row.scheduled_date=d.toISOString().slice(0,10);}});
 const correctedRows=await page.evaluate(()=>JSON.stringify(window.syncFixture.rows));
 await page.getByRole('button',{name:'Retry date sync'}).click();await page.getByText('Plan date sync needs attention.').waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.syncFixture.calls),['apply_daily_reconcile','read_cascade_snapshot']);
 assert.equal(await page.evaluate(()=>window.syncFixture.refreshes),1,'verified no-write retry refreshes the surface');
 assert.equal(await page.evaluate(()=>JSON.stringify(window.syncFixture.rows)),correctedRows);
 console.log('PASS actual hook/notice: mismatch, cascade cancel/reopen, hide explanation, Today/Plan remount, reload including cooldown, bounded retry, correction, successful retry and unchanged rows on refusal (synthetic transport)');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
