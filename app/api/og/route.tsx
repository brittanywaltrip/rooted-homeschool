import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const family  = searchParams.get('family')  || 'A Rooted Family'
  const from    = searchParams.get('from')    || ''
  const to      = searchParams.get('to')      || ''
  const preview = searchParams.get('preview') || ''

  const dateLabel = from && to ? `${from} – ${to}` : ''

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
          transform: 'rotate(-30deg)', display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: -80, left: -60,
          width: 340, height: 230,
          background: 'white', opacity: 0.06, borderRadius: '50%',
          transform: 'rotate(20deg)', display: 'flex',
        }} />

        {/* Main content — centered column */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          padding: '60px 100px',
          gap: 0,
        }}>

          {/* Top label — small caps */}
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            marginBottom: 32,
            display: 'flex',
          }}>
            Rooted · Family Update
          </div>

          {/* Family name — large + bold */}
          <div style={{
            fontSize: family.length > 28 ? 60 : 76,
            fontWeight: 800,
            color: 'white',
            textAlign: 'center',
            lineHeight: 1.05,
            marginBottom: 28,
            display: 'flex',
          }}>
            {family}
          </div>

          {/* Date range pill */}
          {dateLabel ? (
            <div style={{
              background: 'rgba(255,255,255,0.18)',
              borderRadius: 40,
              padding: '10px 30px',
              fontSize: 24,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.9)',
              marginBottom: preview ? 20 : 48,
              display: 'flex',
            }}>
              {dateLabel}
            </div>
          ) : null}

          {/* Preview stats line */}
          {preview ? (
            <div style={{
              fontSize: 22,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.7)',
              textAlign: 'center',
              marginBottom: 48,
              display: 'flex',
            }}>
              {preview}
            </div>
          ) : null}

          {/* Bottom tagline */}
          <div style={{
            fontSize: 19,
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.04em',
            display: 'flex',
          }}>
            Stay Rooted. Teach with Intention. · rootedhomeschoolapp.com
          </div>

        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
