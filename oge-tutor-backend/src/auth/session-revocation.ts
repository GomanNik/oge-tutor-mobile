// A version change also invalidates sessions created by an in-flight login.
export function revokeAllSessions() {
  return {
    sessionVersion: { increment: 1 },
    sessions: { updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date() } } },
  };
}
