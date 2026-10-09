import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const evidence=path.resolve('../synthetic-runtime');
const env=Object.fromEntries(fs.readFileSync(path.join(evidence,'app-local.env'),'utf8').split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
if(env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'||env.ROOTED_EXPECTED_SUPABASE_REF!=='rooted-isolated-local'||env.PLAYWRIGHT_EMAIL!=='rooted-e2e@isolated.invalid')throw Error('Identity refused');
const failures=[],stages=[],blocked=[];const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1400,height:1000},timezoneId:'UTC',serviceWorkers:'block'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http://127.0.0.1:3106','http://127.0.0.1:54321'].includes(u.origin)&&!/^\/(ingest|monitoring|_vercel)\b/.test(u.pathname))return route.continue();blocked.push(u.origin+u.pathname);return route.abort();});
 const page=await context.newPage();
 page.on('response',async response=>{const u=new URL(response.url());if(response.status()>=400){const item={path:u.pathname,status:response.status()};if(u.origin==='http://127.0.0.1:54321'&&u.pathname.startsWith('/rest/')){try{const body=await response.json();item.code=body.code;item.message=body.message;}catch{}}failures.push(item);}});
 await page.goto('http://127.0.0.1:3106/login',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForLoadState('networkidle',{timeout:60000});
 await page.waitForFunction(()=>Object.keys(document.querySelector('#login-email')??{}).some(k=>k.startsWith('__reactFiber$')),{},{timeout:60000});
 await page.locator('#login-email').fill(env.PLAYWRIGHT_EMAIL);await page.locator('#login-password').fill(env.PLAYWRIGHT_PASSWORD);
 await page.locator('form').filter({has:page.locator('#login-password')}).locator('button[type=submit]').click();
 await page.waitForURL('**/dashboard**',{timeout:45000});stages.push('real password sign-in reached dashboard');
 await page.getByText('Synthetic Child',{exact:false}).first().waitFor({timeout:30000}).catch(()=>{});
 await page.screenshot({path:path.join(evidence,'signed-in-today.png'),fullPage:true});
 fs.writeFileSync(path.join(evidence,'signed-in-today-text.txt'),await page.locator('body').innerText());
 stages.push('real Today rendered; inspect failed dependencies before further flow');
 console.log(JSON.stringify({stages,failures,blocked},null,2));
}catch(error){stages.push('BLOCKED: '+error.name+': '+String(error.message).replaceAll(env.PLAYWRIGHT_PASSWORD,'[redacted]'));console.log(JSON.stringify({stages,failures,blocked},null,2));}
finally{fs.writeFileSync(path.join(evidence,'signed-in-browser-results.json'),JSON.stringify({stages,failures,blocked},null,2));await browser.close();}
