// Browser + actual callback/coordinator + disposable SQL endpoints. The React
// application shell and Supabase HTTP transport are stubbed; not live-app E2E.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from '@playwright/test';
import {shiftCurriculumSessions,undoCurriculumShift} from '../app/lib/cascade-shift-transaction.ts';
export async function browserRehearsal({client,snapshot,goalId,lessonId,today,target,finish}) {
 const source=readFileSync('app/components/PlanV2/index.tsx','utf8');
 const ast=ts.createSourceFile('Plan.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const notices=[];let undo;
 const context={React,X:()=>null,crypto:{randomUUID},supabase:client,todayStr:today,shiftCurriculumSessions,undoCurriculumShift,
  curriculumGoals:[{id:goalId,curriculum_name:'Disposable weekly course'}],setCascadeChoice:()=>{},setBulkBusy:()=>{},flagLanded:()=>{},hapticTap:()=>{},reload:()=>{},reloadPins:()=>{},recordEvent:()=>{},flashNotice:s=>notices.push(s),setUndoAction:a=>{undo=a.onUndo;notices.push(a.message);}};
 function extract(name){let expr;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)expr=n.initializer.arguments[0].getText(ast);if(ts.isFunctionDeclaration(n)&&n.name?.text===name)expr=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(expr);runInNewContext(ts.transpileModule(`globalThis.${name}=${expr}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,context);return context[name];}
 const handler=extract('handleShiftAllForward');const Dialog=extract('CascadeChoiceDialog');
 const choice={previewSnapshot:snapshot(),lessonId,goalId,fromDateStr:today,toDateStr:target,shiftDays:1,futureLessonsToShift:2,projectedFinishDate:finish};
 const table=()=>`<table><tr><th>Lesson</th><th>Date</th><th>Pinned</th><th>Note / minutes</th></tr>${snapshot().rows.map(r=>`<tr><td>${r.lesson_number}</td><td>${r.scheduled_date}</td><td>${r.queue_pinned}</td><td>${r.notes??''} / ${r.minutes_spent??''}</td></tr>`).join('')}</table><p>${notices.join(' · ')}</p>`;
 const html=`<!doctype html><html><head><style>body{font:16px system-ui;background:#faf8f4;color:#213a2a;margin:32px;max-width:980px}button{display:block;font:inherit;margin:12px;padding:12px}td,th{border:1px solid #cbd5c0;padding:12px}table{border-collapse:collapse;margin:20px 0}#dialog{background:white;padding:20px}</style></head><body><h1>Disposable PostgreSQL reschedule rehearsal</h1><p>Actual Rooted dialog, handler, coordinator and SQL transaction; synthetic rows only.</p><div id="dialog">${renderToStaticMarkup(React.createElement(Dialog,{choice,onCancel:()=>{},onMoveJustThis:()=>{},onShiftAll:()=>{}}))}</div><button id="undo">Undo shift</button><div id="result">${table()}</div><script>document.querySelectorAll('#dialog button').forEach(b=>{if(b.textContent.includes('Shift all remaining'))b.onclick=()=>act('/shift')});document.querySelector('#undo').onclick=()=>act('/undo');async function act(path){const r=await fetch(path,{method:'POST'});document.querySelector('#result').innerHTML=await r.text();}</script></body></html>`;
 const server=createServer(async(req,res)=>{try{if(req.method==='GET'){res.end(html);return;}if(req.url==='/shift')await handler(choice);else if(req.url==='/undo')await undo();else{res.statusCode=404;}res.end(table());}catch(e){res.statusCode=500;res.end(String(e.stack));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 let browser;try{browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:900}});await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());await page.goto(url);await page.getByRole('button',{name:/Shift all remaining lessons forward/}).click();await page.getByText('Shifted 3 lessons in Disposable weekly course').waitFor();assert.equal(snapshot().rows[0].scheduled_date,target);assert.equal(snapshot().rows[2].scheduled_date,finish);assert.deepEqual(snapshot().rows.map(r=>r.queue_pinned),[true,true,false]);mkdirSync('../investigation-evidence/correctness-browser',{recursive:true});await page.screenshot({path:'../investigation-evidence/correctness-browser/pinned-gap-shift.png',fullPage:true});await page.locator('#undo').click();await page.waitForFunction(value=>document.querySelector('#result').textContent.includes(value),today);assert.equal(snapshot().rows[0].scheduled_date,today);await page.screenshot({path:'../investigation-evidence/correctness-browser/undo.png',fullPage:true});}finally{await browser?.close();await new Promise(r=>server.close(r));}
}
