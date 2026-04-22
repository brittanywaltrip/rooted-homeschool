import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { readFileSync } from 'fs'
import { join } from 'path'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

let cachedLogoB64: string | null = null
function getLogoBase64(): string {
  if (!cachedLogoB64) {
    const logoPath = join(process.cwd(), 'public', 'rooted-logo-white.png')
    const logoBuffer = readFileSync(logoPath)
    cachedLogoB64 = `data:image/png;base64,${logoBuffer.toString('base64')}`
  }
  return cachedLogoB64
}

function printCardHtml(name: string, code: string, url: string, qrDataUrl: string): string {
  const logoB64 = getLogoBase64()
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooted Partner Card — ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f8f7f4;font-family:'Inter',system-ui,sans-serif;display:flex;justify-content:center;padding:72px 20px 40px}
  .rooted-navbar{position:fixed;top:0;left:0;right:0;background:rgba(255,255,255,0.96);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #e8e2d9;z-index:100;font-family:'Inter',system-ui,sans-serif}
  .rooted-navbtn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;text-decoration:none;font-family:inherit}
  .rooted-navbtn-back{background:#f8f7f4;color:#2d5a3d;border:1px solid #e8e2d9}
  .rooted-navbtn-print{background:#2d5a3d;color:#fff}
  .card{width:680px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(145deg,#162e1f 0%,#1a3d24 30%,#2d5a3d 70%,#1a3d24 100%);padding:48px 40px;position:relative;overflow:hidden;text-align:center}
  .header::before{content:'🌿';position:absolute;top:-20px;right:-10px;font-size:140px;opacity:0.06;transform:rotate(15deg)}
  .header::after{content:'🌿';position:absolute;bottom:-30px;left:20px;font-size:100px;opacity:0.04;transform:rotate(-20deg) scaleX(-1)}
  .logo-img{height:80px;width:auto;margin:0 auto;display:block;position:relative;z-index:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.15))}
  .name-section{padding:32px 40px 0;text-align:center}
  .name{font-family:'Lora',serif;font-size:28px;font-weight:700;color:#2d2926}
  .badge{display:inline-block;margin-top:8px;background:#5c7f63;color:#fff;font-size:11px;font-weight:700;padding:6px 16px;border-radius:20px;letter-spacing:1px;text-transform:uppercase}
  .body{padding:28px 40px 36px;display:flex;gap:32px;align-items:flex-start}
  .left{flex:1}
  .qr-wrap{width:180px;height:180px;background:#f8f7f4;border-radius:16px;padding:12px;flex-shrink:0;box-shadow:0 2px 12px rgba(0,0,0,0.06)}
  .qr-wrap img{width:100%;height:100%;border-radius:8px}
  .offer{background:#f0f7f0;border:1.5px solid #c8dfc9;border-radius:16px;padding:20px;margin-bottom:20px}
  .offer-title{font-size:11px;font-weight:700;color:#5c7f63;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .offer-code{font-family:'Inter',system-ui,sans-serif;font-size:28px;font-weight:800;color:#2d5a3d;letter-spacing:3px}
  .offer-desc{font-size:13px;color:#5c7f63;margin-top:6px}
  .features{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .feat{background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:10px 12px;font-size:12px;color:#2d2926}
  .feat span{margin-right:6px}
  .url{text-align:center;padding:0 40px 32px;font-size:13px;color:#7a6f65}
  .url a{color:#5c7f63;font-weight:600;text-decoration:none}
  @media print{body{padding:0;background:#fff}.card{box-shadow:none;border-radius:0;width:100%}.rooted-navbar{display:none}}
</style></head><body>
<div class="rooted-navbar">
  <button onclick="window.close()" class="rooted-navbtn rooted-navbtn-back" type="button">← Close</button>
  <button onclick="window.print()" class="rooted-navbtn rooted-navbtn-print" type="button">🖨️ Print</button>
</div>
<div class="card">
  <div class="header">
    <img class="logo-img" src="${logoB64}" alt="Rooted">
  </div>
  <div class="name-section">
    <div class="name">${esc(name)}</div>
    <div class="badge">🤝 Rooted Partner</div>
  </div>
  <div class="body">
    <div class="left">
      <div class="offer">
        <div class="offer-title">Your exclusive code</div>
        <div class="offer-code">${esc(code)}</div>
        <div class="offer-desc">15% off Rooted+</div>
      </div>
      <div class="features">
        <div class="feat"><span>📸</span>Memories & photos</div>
        <div class="feat"><span>📚</span>Lesson tracking</div>
        <div class="feat"><span>🌳</span>Family garden</div>
        <div class="feat"><span>📋</span>Planner & reports</div>
      </div>
    </div>
    <div class="qr-wrap">
      <img src="${qrDataUrl}" alt="QR Code">
    </div>
  </div>
  <div class="url">Scan or visit <a href="https://${esc(url)}">${esc(url)}</a></div>
</div>
</body></html>`
}

function shareCardHtml(name: string, code: string, url: string, qrDataUrl: string): string {
  const logoB64 = getLogoBase64()
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooted — ${esc(code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#1a3d24;font-family:'Inter',system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:84px 20px 20px}
  .rooted-navbar{position:fixed;top:0;left:0;right:0;background:rgba(26,61,36,0.92);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:100;font-family:'Inter',system-ui,sans-serif}
  .rooted-navbtn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;text-decoration:none;font-family:inherit;background:#fff;color:#2d5a3d}
  .rooted-hint{font-size:11px;color:rgba(255,255,255,0.75);font-family:'Inter',system-ui,sans-serif}
  .card{width:380px;background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 16px 60px rgba(0,0,0,0.3)}
  .top{background:linear-gradient(145deg,#162e1f 0%,#1a3d24 30%,#2d5a3d 70%,#1a3d24 100%);padding:36px 24px 28px;text-align:center;position:relative;overflow:hidden}
  .top::before{content:'🌿';position:absolute;top:-15px;right:-10px;font-size:90px;opacity:0.08;transform:rotate(20deg)}
  .top::after{content:'🌿';position:absolute;bottom:-20px;left:-15px;font-size:70px;opacity:0.06;transform:rotate(-30deg) scaleX(-1)}
  .logo-img{height:100px;width:auto;margin:0 auto;display:block;position:relative;z-index:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.15))}
  .mid{padding:28px 24px 20px;text-align:center}
  .qr{width:210px;height:210px;margin:0 auto 20px;background:#f8f7f4;border-radius:18px;padding:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06)}
  .qr img{width:100%;height:100%;border-radius:10px}
  .code-pill{display:inline-block;background:#2d5a3d;color:#fff;font-family:'Inter',system-ui,sans-serif;font-size:20px;font-weight:800;padding:10px 28px;border-radius:14px;letter-spacing:3px;margin-bottom:10px}
  .discount{font-size:14px;color:#5c7f63;font-weight:600}
  .by{font-size:12px;color:#7a6f65;margin-top:10px}
  .by strong{color:#2d2926}
  .features{display:flex;justify-content:center;gap:16px;padding:16px 24px;background:#f8f7f4;border-top:1px solid #ede8e0}
  .feat{text-align:center;font-size:10px;color:#5c7f63;font-weight:500;line-height:1.3}
  .feat-icon{font-size:18px;margin-bottom:3px;display:block}
  .bottom{background:#f0ede6;padding:14px 24px;text-align:center;border-top:1px solid #e3ded5}
  .bottom a{font-size:12px;color:#5c7f63;font-weight:600;text-decoration:none}
</style></head><body>
<div class="rooted-navbar">
  <button onclick="window.close()" class="rooted-navbtn" type="button">← Close</button>
  <span class="rooted-hint">Screenshot to share</span>
</div>
<div class="card">
  <div class="top">
    <img class="logo-img" src="${logoB64}" alt="Rooted">
  </div>
  <div class="mid">
    <div class="qr"><img src="${qrDataUrl}" alt="QR Code"></div>
    <div class="code-pill">${esc(code)}</div>
    <div class="discount">15% off Rooted+</div>
    <div class="by">Shared by <strong>${esc(name)}</strong></div>
  </div>
  <div class="features">
    <div class="feat"><span class="feat-icon">📸</span>Memories<br>&amp; Photos</div>
    <div class="feat"><span class="feat-icon">📚</span>Lesson<br>Tracking</div>
    <div class="feat"><span class="feat-icon">🌳</span>Family<br>Garden</div>
    <div class="feat"><span class="feat-icon">📋</span>Planner<br>&amp; Reports</div>
  </div>
  <div class="bottom">
    <a href="https://${esc(url)}">${esc(url)}</a>
  </div>
</div>
</body></html>`
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') ?? 'Partner'
  const code = req.nextUrl.searchParams.get('code') ?? 'ROOTED'
  const url = req.nextUrl.searchParams.get('url') ?? `rootedhomeschoolapp.com/?ref=${code}`

  const fullUrl = 'https://' + url

  const [printQr, shareQr] = await Promise.all([
    QRCode.toDataURL(fullUrl, { width: 260, margin: 1, color: { dark: '#2d5a3d', light: '#ffffff' } }),
    QRCode.toDataURL(fullUrl, { width: 400, margin: 1, color: { dark: '#2d5a3d', light: '#ffffff' } }),
  ])

  return NextResponse.json({
    cardHtml: printCardHtml(name, code, url, printQr),
    shareHtml: shareCardHtml(name, code, url, shareQr),
    qrDataUrl: printQr,
  })
}
