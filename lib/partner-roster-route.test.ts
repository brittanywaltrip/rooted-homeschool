import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildPayoutSummary, readAllLedgerRows } from './payout-ledger.ts';
import { buildRosterAccounting } from './partner-roster-ledger.ts';
import { displayCommission } from './commission.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
type Row = Record<string, unknown> & { id: string };
type PartnerResult = { code: string; total_earned: number; total_paid: number; owed_now: number; paying_customers: number; signups_referred: number; account_email: string | null };
type Response = { status: number; headers?: Record<string,string>; body: { affiliates?: PartnerResult[]; referrals?: Row[]; payments?: Row[]; payout_summary?: { total_due: number; pending_total: number } } };
const NOW = new Date('2026-09-30T20:00:00Z');
class Clock extends Date { constructor(value?: string) { super(value ?? NOW.toISOString()); } }
function fixture(options: { rows?: number; email?: string | null; failTable?: string; failOffset?: number; failAuth?: boolean; missingAccount?: boolean; invalidCommission?: boolean } = {}) {
  const count = options.rows ?? 1;
  const data: Record<string, Row[]> = {
    affiliates: [{ id:'a', code:'TEST', name:'Fixture', user_id: options.missingAccount ? 'deleted-account' : null, is_active:true, created_at:'2026-01-01', payment_method:null, payment_notes:null }],
    referrals: Array.from({ length:count },(_,i)=>({ id:`r${String(i).padStart(5,'0')}`, user_id:`u${i}`, affiliate_code:'test', converted:true, commission_amount: options.invalidCommission ? -1 : 1, created_at:'2026-08-15T12:00:00Z' })),
    profiles: Array.from({ length:count },(_,i)=>({ id:`u${i}`, referred_by:'TEST', first_name:'Synthetic', last_name:null, display_name:null, plan_type:'pro' })),
    commission_payments: Array.from({ length:count },(_,i)=>({ id:`p${String(i).padStart(5,'0')}`, affiliate_code:'Test', amount:.1, month:'2026-08', paid_at:'2026-09-01T12:00:00Z' })),
    partner_apps: [],
  };
  const reads: { table:string; offset:number }[] = [];
  const users = data.profiles.map(p=>({ id:p.id, email:`${p.id}@example.invalid` }));
  const source = readFileSync(new URL('../app/api/admin/partners/route.ts', import.meta.url),'utf8');
  const exports: { GET?: (req:Request)=>Promise<Response> } = {};
  runInNewContext(ts.transpileModule(source,{ compilerOptions:{ module:ts.ModuleKind.CommonJS } }).outputText, {
    exports, Date:Clock,
    require:(name:string)=> {
      if(name==='next/server') return { NextResponse:{ json:(body:unknown, opts?: {status?:number;headers?:Record<string,string>})=>({body,status:opts?.status??200,headers:opts?.headers}) } };
      if(name==='@/lib/payout-ledger') return {readAllLedgerRows};
      if(name==='@/lib/partner-roster-ledger') return {buildRosterAccounting};
      if(name==='@/lib/commission') return {displayCommission};
      if(name==='@/lib/supabase-admin') return {supabaseAdmin:{
        auth:{ getUser:async()=>({data:{user:(options.email===null?null:{email:options.email??'garfieldbrittany@gmail.com'})},error:null}),
          admin:{ getUserById:async()=>({data:{user:null},error:{status:404}}),
            listUsers:async({page,perPage}:{page:number;perPage:number})=>({data:options.failAuth?null:{users:users.slice((page-1)*perPage,page*perPage)},error:options.failAuth?new Error('auth outage'):null}) } },
        from:(table:string)=>{
          let rows=data[table]; let limit=Infinity;
          const read=(offset:number,size:number)=>{
            reads.push({table,offset});
            const failed=table===options.failTable&&offset>=(options.failOffset??0);
            return Promise.resolve({data:failed?null:rows.slice(offset,offset+Math.min(size,37)),error:failed?new Error('read outage'):null});
          };
          const query={ select:()=>query, order:()=>query,
            eq:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return query;},
            not:(key:string,_op:string,value:unknown)=>{rows=rows.filter(r=>r[key]!==value);return query;},
            in:(key:string,values:unknown[])=>{rows=rows.filter(r=>values.includes(r[key]));return query;},
            limit:(value:number)=>{limit=value;return query;},
            range:(from:number,to:number)=>read(from,to-from+1),
            then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>read(0,limit).then(resolve,reject),
          }; return query;
        },
      }};
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return {reads,data,run:(token=true)=>exports.GET!(new Request('https://fixture.invalid',{headers:token?{Authorization:'Bearer fixture-token'}:{}}))};
}
test('roster authorization happens before any ledger read',async()=>{
  for(const [email,token] of [['family@example.invalid',true],[null,false]] as const){
    const f=fixture({email});assert.equal((await f.run(token)).status,403);assert.equal(f.reads.length,0);
  }
});
test('roster reads beyond 1,000 entries, including capped server pages, and agrees with payout cards',async()=>{
  const f=fixture({rows:1205});const r=await f.run();
  assert.equal(r.status,200); assert.equal(r.headers?.['cache-control'],'no-store');
  const a=r.body.affiliates![0];
  assert.equal(a.paying_customers,1205);assert.equal(a.signups_referred,1205);
  assert.equal(a.total_earned,1205);assert.equal(a.total_paid,120.5);assert.equal(a.owed_now,1084.5);
  assert.equal(r.body.payments!.length,1205);assert.equal(r.body.payout_summary!.total_due,1084.5);
  const card=buildPayoutSummary('TEST',f.data.referrals as unknown as Parameters<typeof buildPayoutSummary>[1],f.data.commission_payments as unknown as Parameters<typeof buildPayoutSummary>[2],NOW);
  assert.equal(Math.round(a.owed_now*100),card.commission_cents);
  assert.ok(f.reads.some(x=>x.table==='referrals'&&x.offset>1000));
  assert.ok(f.reads.some(x=>x.table==='commission_payments'&&x.offset>1000));
  // The recent activity feed can be capped without reducing lifetime stats.
  assert.ok(r.body.referrals!.length<=100);
});
for(const table of ['affiliates','profiles','referrals','commission_payments','partner_apps']) {
  test(`${table} read failure makes roster unavailable instead of returning partial balances`,async()=>{
    const r=await fixture({failTable:table}).run();assert.equal(r.status,503);assert.equal(r.body.affiliates,undefined);assert.equal(r.body.payout_summary,undefined);
  });
}
test('a later payments-page error refuses accumulated balances',async()=>{
  const r=await fixture({rows:205,failTable:'commission_payments',failOffset:100}).run();assert.equal(r.status,503);assert.equal(r.body.payout_summary,undefined);
});
test('referral email lookup outage refuses instead of pretending accounts are absent',async()=>{
  assert.equal((await fixture({failAuth:true}).run()).status,503);
});
test('a legitimately deleted partner account does not erase its commission ledger',async()=>{
  const r=await fixture({missingAccount:true}).run();assert.equal(r.status,200);assert.equal(r.body.affiliates![0].account_email,null);assert.equal(r.body.affiliates![0].owed_now,.9);
});
test('invalid stored commission returns unavailable rather than a plausible fallback total',async()=>{
  assert.equal((await fixture({invalidCommission:true}).run()).status,503);
});
