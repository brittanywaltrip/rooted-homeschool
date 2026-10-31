const rec = (kind, a) => { const w = window; (w.__sentry ||= []).push({ kind, a: JSON.parse(JSON.stringify(a ?? null)) }); };
export const addBreadcrumb = (b) => rec('breadcrumb', b);
export const captureMessage = (m, o) => rec('message', { m, o });
export const captureException = (e) => rec('exception', { name: e?.name, message: e?.message });
export const setUser = () => {};
export const getGlobalScope = () => ({ setTag() {} });
