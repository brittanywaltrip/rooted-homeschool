/* global __AUTH_VERSION__ */
// Harness: the app's real browser client singleton (lib/supabase.ts, which
// also installs the session lifeboat) and its real getUserWithRetry.
import { supabase } from '@/lib/supabase'
import { getUserWithRetry } from '@/lib/auth-retry'
const w = window
w.__events = []; w.__rejections = []
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason
  w.__rejections.push({ name: r?.name ?? null, ctor: r?.constructor?.name ?? null, message: String(r?.message ?? r).slice(0, 200), isAcquireTimeout: r?.isAcquireTimeout === true })
})
supabase.auth.onAuthStateChange((event, session) => {
  w.__events.push({ event, t: Date.now(), tokenTail: session?.access_token?.slice(-6) ?? null })
})
const auth = supabase.auth
w.h = {
  version: __AUTH_VERSION__,
  verify: async (token_hash) => { const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }); return { user: data?.user?.id ?? null, error: error?.message ?? null } },
  getUserWithRetry: async () => { const r = await getUserWithRetry(supabase, { delaysMs: [500, 1000] }); return { kind: r.kind, user: (r).user?.id ?? null, reason: (r).reason ?? null } },
  getSession: async () => { try { const { data, error } = await supabase.auth.getSession(); return { has: !!data.session, tokenTail: data.session?.access_token?.slice(-6) ?? null, error: error?.message ?? null } } catch (e) { return { threw: e?.name, message: e?.message } } },
  getUser: async () => { try { const { data, error } = await supabase.auth.getUser(); return { user: data.user?.id ?? null, error: error?.name ?? null } } catch (e) { return { threw: e?.name, message: e?.message } } },
  protectedRead: async (uid) => { const { data, error } = await supabase.from('profiles').select('id').eq('id', uid); return { rows: data?.length ?? null, error: error?.message ?? null } },
  // Rewrite expires_at in the real storage adapter (the @supabase/ssr cookie
  // storage) so the next session read must refresh. Only this test session.
  expireNow: async () => {
    const raw = await auth.storage.getItem(auth.storageKey)
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw
    s.expires_at = Math.floor(Date.now() / 1000) - 5
    await auth.storage.setItem(auth.storageKey, JSON.stringify(s))
    return true
  },
  // The real client's own refresh tick (the code path behind the production
  // stolen-lock AbortError), invoked once directly so its outcome is observable.
  tick: async () => { try { await auth._autoRefreshTokenTick(); return { ok: true } } catch (e) { return { ok: false, name: e?.name ?? null, ctor: e?.constructor?.name ?? null, isAcquireTimeout: e?.isAcquireTimeout === true, message: String(e?.message).slice(0, 160) } } },
  setVisible: (visible) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible }); document.dispatchEvent(new Event('visibilitychange')) },
  signOutLocal: async () => { const { error } = await supabase.auth.signOut({ scope: 'local' }); return { error: error?.message ?? null } },
  lifeboat: () => { try { return !!localStorage.getItem('rooted-session-lifeboat') } catch { return null } },
}
