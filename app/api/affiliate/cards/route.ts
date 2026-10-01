import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { printCardHtml, shareCardHtml } from '@/lib/partner-cards'

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
