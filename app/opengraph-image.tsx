import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Rooted — plan your days, capture the moments, hold onto it all'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(155deg, #1a3d24 0%, #2a5533 45%, #3d7a50 80%, #4d8f63 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        {/* Subtle decorative ellipses */}
        <div style={{
          position: 'absolute', top: -80, right: -60,
          width: 400, height: 280,
          background: 'white', opacity: 0.04, borderRadius: '50%',
          transform: 'rotate(-25deg)', display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: -100, left: -80,
          width: 360, height: 240,
          background: 'white', opacity: 0.04, borderRadius: '50%',
          transform: 'rotate(15deg)', display: 'flex',
        }} />

        {/* Content */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          padding: '60px 80px',
        }}>
          {/* Emoji tree */}
          <div style={{ fontSize: 64, marginBottom: 28, display: 'flex' }}>🌱</div>

          {/* Headline */}
          <div style={{
            fontSize: 52,
            fontWeight: 700,
            color: 'white',
            textAlign: 'center',
            lineHeight: 1.15,
            marginBottom: 24,
            display: 'flex',
            maxWidth: 800,
          }}>
            The homeschool years go by so fast.
          </div>

          {/* Subheadline */}
          <div style={{
            fontSize: 24,
            color: 'rgba(200, 221, 184, 0.9)',
            textAlign: 'center',
            lineHeight: 1.5,
            marginBottom: 40,
            display: 'flex',
            maxWidth: 680,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}>
            Plan your days, capture the moments, and hold onto it all.
          </div>

          {/* Brand */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.7)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              display: 'flex',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            }}>
              Rooted Homeschool
            </div>
          </div>

          {/* URL */}
          <div style={{
            fontSize: 16,
            color: 'rgba(255,255,255,0.35)',
            marginTop: 12,
            display: 'flex',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}>
            rootedhomeschoolapp.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
