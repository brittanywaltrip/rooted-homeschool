export const posthog = { capture(ev, props) { const w = window; (w.__posthog ||= []).push({ ev, props }); }, reset() {} };
export function initPostHog() {}
