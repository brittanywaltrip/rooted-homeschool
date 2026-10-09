// Actual component rendered with fixture hook state. No app auth/network.
import {readFileSync,mkdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const source=readFileSync('app/components/PreservedWorkPanel.tsx','utf8');
const row={id:'synthetic-preserved',title:'Lesson 1',lesson_number:1,scheduled_date:'2026-09-13',curriculum_goal_id:'synthetic-goal',curriculum_goals:{curriculum_name:'Disposable weekly course'}};
const context={React,exports:{},require:(name)=>name==='react'?{...React,useState:()=>[{owner:'u',rows:[row],error:false},()=>{}],useEffect:()=>{}}:{}};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText,context);
const Component=context.exports.default;
const html=renderToStaticMarkup(Component({userId:'u'}));
assert.ok(html.includes('Still unfinished'));assert.ok(html.includes('2026-09-13'));assert.ok(html.includes('unfinishedDate=2026-09-13'));
const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:1050,height:750}});await page.route('**/*',r=>r.abort());await page.setContent(`<html><head><style>body{font:16px system-ui;background:#faf8f4;color:#213a2a;margin:35px}section{background:white;border:1px solid #ddd;border-radius:16px;padding:20px;margin:20px 0}li{margin:14px 0}a{margin-left:12px;color:#245535}</style></head><body><h1>Unfinished-work component rehearsal</h1><p>Synthetic state after a later lesson completed and the course pointer advanced. Same component is mounted by Today and Plan.</p>${html}</body></html>`);await page.getByRole('heading',{name:'Still unfinished'}).waitFor();assert.equal(await page.getByRole('link',{name:'View on Plan'}).getAttribute('href'),'/dashboard/plan?unfinishedDate=2026-09-13');mkdirSync('../investigation-evidence/preserved-browser',{recursive:true});await page.screenshot({path:'../investigation-evidence/preserved-browser/unfinished-panel.png',fullPage:true});console.log('PASS actual panel markup remains visible with a route to the original date; fixture hooks, not full-app E2E');}finally{await browser.close();}
