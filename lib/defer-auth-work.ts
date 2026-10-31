/** Auth listeners run inside the SDK lock. Start API work after they return. */
export function deferAuthWork(work: () => Promise<void>, onError: () => void): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled) return;
    void work().catch(() => { if (!cancelled) onError(); });
  }, 0);
  return () => { cancelled = true; clearTimeout(timer); };
}
