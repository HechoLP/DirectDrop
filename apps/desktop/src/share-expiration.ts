export function millisecondsUntilExpiration(
  expiresAt: string | null,
  now = Date.now(),
): number | null {
  if (!expiresAt) return null;
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) return 0;
  return Math.max(0, expiration - now);
}

export function scheduleShareExpiration(
  expiresAt: string | null,
  onExpire: () => void,
  now = Date.now(),
): () => void {
  const remaining = millisecondsUntilExpiration(expiresAt, now);
  if (remaining === null) return () => undefined;
  if (remaining === 0) {
    onExpire();
    return () => undefined;
  }
  const timer = setTimeout(onExpire, remaining);
  return () => clearTimeout(timer);
}
