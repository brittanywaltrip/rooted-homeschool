type CardUser = { id: string; email?: string; email_confirmed_at?: string; is_anonymous?: boolean };
type CardPartner = { name: string; code: string; user_id: string | null; is_active: boolean | null };
type Result<T> = { data: T | null; error: unknown };

export type CardDependencies = {
  getUser: (token: string) => Promise<Result<CardUser>>;
  findPartner: (code: string, ownerId: string | null) => Promise<Result<CardPartner>>;
  render: (name: string, code: string, url: string) => Promise<{ cardHtml: string; shareHtml: string; qrDataUrl: string }>;
};

const ADMIN_EMAILS = new Set(['garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com', 'hello@rootedhomeschoolapp.com']);
const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export async function handlePartnerCard(req: Request, deps: CardDependencies): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
  const match = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return json({ error: 'Sign in to download a partner card.' }, 401);

  try {
    const { data: user, error: authError } = await deps.getUser(match[1]);
    if (authError || !user || user.is_anonymous) return json({ error: 'Unauthorized' }, 401);
    const code = new URL(req.url).searchParams.get('code')?.trim().toUpperCase();
    if (!code || code.length > 128) return json({ error: 'A partner code is required.' }, 400);

    // Email comes from Auth's verified user, never editable user_metadata.
    const admin = !!user.email_confirmed_at && ADMIN_EMAILS.has(user.email ?? '');
    const { data: partner, error } = await deps.findPartner(code, admin ? null : user.id);
    if (error) return json({ error: 'Partner cards are temporarily unavailable.' }, 503);
    // Repeat the ownership/active checks before any branded output is produced.
    if (!partner || !partner.is_active || (!admin && partner.user_id !== user.id)) {
      return json({ error: 'Forbidden' }, 403);
    }
    if (!partner.name || !partner.code) return json({ error: 'Partner cards are temporarily unavailable.' }, 503);

    // Caller-provided name/url are intentionally ignored, including legacy parameters.
    const url = `rootedhomeschoolapp.com/?ref=${encodeURIComponent(partner.code)}`;
    return json(await deps.render(partner.name, partner.code, url));
  } catch {
    return json({ error: 'Partner cards are temporarily unavailable.' }, 503);
  }
}
