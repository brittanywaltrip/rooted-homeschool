/** Resolve catalog paths without depending on the cron request's host. */
export function linkCheckUrl(raw: string): string {
  const url = new URL(raw, "https://www.rootedhomeschoolapp.com");
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Unsupported resource URL protocol");
  }
  return url.href;
}
