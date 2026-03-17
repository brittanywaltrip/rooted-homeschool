import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const family   = searchParams.get('family')   || 'A Rooted Family'
  const dateFrom = searchParams.get('from')      || ''
  const dateTo   = searchParams.get('to')        || ''

  const dateLabel = dateFrom && dateTo
    ? `${dateFrom} – ${dateTo}`
    : 'Homeschool Family Update'

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '1200px',
          height: '630px',
          background: 'linear-gradient(135deg, #2d5c38 0%, #3d7a4a 30%, #5c7f63 60%, #4a9e6a 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* Decorative leaf ellipses */}
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 380, height: 260,
          background: 'white', opacity: 0.06, borderRadius: '50%',
          transform: 'rotate(-30deg)',
          display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: -80, left: -60,
          width: 340, height: 230,
          background: 'white', opacity: 0.06, borderRadius: '50%',
          transform: 'rotate(20deg)',
          display: 'flex',
        }} />

        {/* Main content — centered column */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          padding: '60px 80px',
          gap: 0,
        }}>
          {/* Leaf icon */}
          <div style={{
            width: 72, height: 72,
            background: 'rgba(255,255,255,0.2)',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            marginBottom: 28,
          }}>
            🌿
          </div>

          {/* Label */}
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.65)',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            marginBottom: 20,
            display: 'flex',
          }}>
            Rooted Homeschool · Family Update
          </div>

          {/* Family name */}
          <div style={{
            fontSize: 72,
            fontWeight: 800,
            color: 'white',
            textAlign: 'center',
            lineHeight: 1.1,
            marginBottom: 20,
            display: 'flex',
          }}>
            {family}
          </div>

          {/* Date range pill */}
          <div style={{
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 40,
            padding: '12px 32px',
            fontSize: 26,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.85)',
            marginBottom: 44,
            display: 'flex',
          }}>
            {dateLabel}
          </div>

          {/* Bottom tagline */}
          <div style={{
            fontSize: 20,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.05em',
            display: 'flex',
          }}>
            Stay Rooted. Teach with Intention. · rootedhomeschoolapp.com
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}

