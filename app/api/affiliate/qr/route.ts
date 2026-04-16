import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

export async function GET(req: NextRequest) {
  const data = req.nextUrl.searchParams.get('data') ?? 'https://rootedhomeschoolapp.com'
  const size = parseInt(req.nextUrl.searchParams.get('size') ?? '200')

  const buffer = await QRCode.toBuffer(data, {
    width: size,
    margin: 1,
    color: { dark: '#2d5a3d', light: '#ffffff' },
    type: 'png',
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
