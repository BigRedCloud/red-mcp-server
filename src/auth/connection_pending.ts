/** Pending connection links do not expire by time — only one-time use applies. */
export const PENDING_CONNECTION_NEVER_EXPIRES_AT = Number.MAX_SAFE_INTEGER;

export function isPendingConnectionExpired(
  expiresAt: number,
  now = Date.now()
): boolean {
  return (
    expiresAt < PENDING_CONNECTION_NEVER_EXPIRES_AT && expiresAt <= now
  );
}
