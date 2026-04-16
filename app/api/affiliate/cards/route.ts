import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function printCardHtml(name: string, code: string, url: string, qrDataUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooted Partner Card — ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#f8f7f4;font-family:'Inter',system-ui,sans-serif;display:flex;justify-content:center;padding:40px 20px}
  .card{width:680px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#1a3d24,#2d5a3d,#3d7a50);padding:48px 40px;position:relative;overflow:hidden}
  .header::before{content:'🌿';position:absolute;top:-20px;right:-10px;font-size:140px;opacity:0.06;transform:rotate(15deg)}
  .header::after{content:'🌿';position:absolute;bottom:-30px;left:20px;font-size:100px;opacity:0.04;transform:rotate(-20deg)}
  .brand{font-family:'Lora',serif;font-size:32px;font-weight:700;color:#fff;margin-bottom:6px}
  .tagline{color:rgba(255,255,255,0.6);font-size:13px;letter-spacing:0.5px}
  .name-section{padding:32px 40px 0;text-align:center}
  .name{font-family:'Lora',serif;font-size:28px;font-weight:700;color:#2d2926}
  .badge{display:inline-block;margin-top:8px;background:linear-gradient(135deg,#4338ca,#818cf8);color:#fff;font-size:11px;font-weight:700;padding:6px 16px;border-radius:20px;letter-spacing:1px;text-transform:uppercase}
  .body{padding:28px 40px 36px;display:flex;gap:32px;align-items:flex-start}
  .left{flex:1}
  .qr-wrap{width:180px;height:180px;background:#f8f7f4;border-radius:16px;padding:12px;flex-shrink:0}
  .qr-wrap img{width:100%;height:100%;border-radius:8px}
  .offer{background:#f0f7f0;border:1.5px solid #c8dfc9;border-radius:16px;padding:20px;margin-bottom:20px}
  .offer-title{font-size:11px;font-weight:700;color:#5c7f63;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .offer-code{font-family:monospace;font-size:28px;font-weight:700;color:#2d5a3d;letter-spacing:3px}
  .offer-desc{font-size:13px;color:#5c7f63;margin-top:6px}
  .features{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .feat{background:#faf8f4;border:1px solid #e8e2d9;border-radius:10px;padding:10px 12px;font-size:12px;color:#2d2926}
  .feat span{margin-right:6px}
  .url{text-align:center;padding:0 40px 32px;font-size:13px;color:#7a6f65}
  .url a{color:#5c7f63;font-weight:600;text-decoration:none}
  @media print{body{padding:0;background:#fff}.card{box-shadow:none;border-radius:0;width:100%}}
</style></head><body>
<div class="card">
  <div class="header">
    <div class="brand">Rooted 🌿</div>
    <div class="tagline">Stay Rooted. Teach with Intention.</div>
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
        <div class="offer-desc">15% off — works forever</div>
      </div>
      <div class="features">
        <div class="feat"><span>📸</span>Memories & photos</div>
        <div class="feat"><span>📚</span>Lesson tracking</div>
        <div class="feat"><span>🌳</span>Family garden</div>
        <div class="feat"><span>📋</span>Homeschool planner</div>
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
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rooted — ${esc(code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#1a3d24;font-family:'Inter',system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
  .card{width:360px;background:#fff;border-radius:28px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.2)}
  .top{background:linear-gradient(135deg,#1a3d24,#2d5a3d);padding:32px 24px 24px;text-align:center;position:relative;overflow:hidden}
  .top::before{content:'🌿';position:absolute;top:-10px;right:-5px;font-size:80px;opacity:0.06;transform:rotate(15deg)}
  .logo{font-family:'Lora',serif;font-size:24px;font-weight:700;color:#fff}
  .sub{color:rgba(255,255,255,0.5);font-size:11px;margin-top:4px;letter-spacing:0.5px}
  .mid{padding:24px;text-align:center}
  .qr{width:200px;height:200px;margin:0 auto 16px;background:#f8f7f4;border-radius:16px;padding:10px}
  .qr img{width:100%;height:100%;border-radius:8px}
  .code-pill{display:inline-block;background:#2d5a3d;color:#fff;font-family:monospace;font-size:22px;font-weight:700;padding:8px 24px;border-radius:12px;letter-spacing:3px;margin-bottom:8px}
  .discount{font-size:13px;color:#5c7f63;font-weight:600}
  .by{font-size:12px;color:#7a6f65;margin-top:12px}
  .by strong{color:#2d2926}
  .bottom{background:#f8f7f4;padding:16px 24px;text-align:center}
  .bottom a{font-size:12px;color:#5c7f63;font-weight:600;text-decoration:none}
</style></head><body>
<div class="card">
  <div class="top">
    <div class="logo">Rooted 🌿</div>
    <div class="sub">Capture. Plan. Remember.</div>
  </div>
  <div class="mid">
    <div class="qr"><img src="${qrDataUrl}" alt="QR Code"></div>
    <div class="code-pill">${esc(code)}</div>
    <div class="discount">15% off — forever</div>
    <div class="by">Shared by <strong>${esc(name)}</strong></div>
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
  const url = req.nextUrl.searchParams.get('url') ?? `rootedhomeschoolapp.com/upgrade?ref=${code}`

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
