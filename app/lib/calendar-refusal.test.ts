import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readReconcileBlock,saveReconcileBlock} from './calendar-refusal.ts';
test('refusal persistence is owner scoped, survives reload, and clears only explicitly',()=>{
 const data=new Map<string,string>();const store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const block={kind:'calendar' as const,day:'2026-10-09',retryAt:100};saveReconcileBlock(store,'u1',block);
 assert.deepEqual(readReconcileBlock(store,'u1'),block);assert.equal(readReconcileBlock(store,'u2'),null);
 saveReconcileBlock(store,'u1',null);assert.equal(readReconcileBlock(store,'u1'),null);
 data.set('rooted:date-sync:u1','{"kind":"calendar","day":"bad","retryAt":100}');assert.equal(readReconcileBlock(store,'u1'),null);
});
