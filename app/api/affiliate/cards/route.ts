import QRCode from 'qrcode'
import { printCardHtml, shareCardHtml } from '@/lib/partner-cards'
import { handlePartnerCard } from '@/lib/partner-card-access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handlePartnerCard(req, {
    getUser: async token => {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
      return { data: user, error }
    },
    findPartner: async (code, ownerId) => {
      let query = supabaseAdmin.from('affiliates')
        .select('name, code, user_id, is_active').eq('code', code).eq('is_active', true)
      if (ownerId) query = query.eq('user_id', ownerId)
      return query.maybeSingle()
    },
    render: async (name, code, url) => {
      const fullUrl = 'https://' + url
      const [printQr, shareQr] = await Promise.all([
        QRCode.toDataURL(fullUrl, { width: 260, margin: 1, color: { dark: '#2d5a3d', light: '#ffffff' } }),
        QRCode.toDataURL(fullUrl, { width: 400, margin: 1, color: { dark: '#2d5a3d', light: '#ffffff' } }),
      ])
      return { cardHtml: printCardHtml(name, code, url, printQr), shareHtml: shareCardHtml(name, code, url, shareQr), qrDataUrl: printQr }
    },
  })
}
