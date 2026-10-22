import { API_TOKEN_KEY, getStoredApiToken } from '../api/authToken.js';

function baseUrl() {
  return String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

export function createWorkspaceClient() {
  let token = getStoredApiToken();

  function setToken(value) {
    token = value || '';
    if (token) window.sessionStorage.setItem(API_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(API_TOKEN_KEY);
  }

  async function request(path, { method = 'GET', body, context, revision, idempotencyKey } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (context) headers['X-Active-Role'] = context.role;
    if (revision !== undefined) headers['If-Match'] = String(revision);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await fetch(`${baseUrl()}/api/v2${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.status === 401) setToken('');
    if (!response.ok) {
      const error = new Error(payload?.message || 'Не удалось выполнить запрос.');
      error.code = payload?.code || 'http_error';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function pathFor(context, suffix) {
    return `/workspaces/${encodeURIComponent(context.workspaceId)}${suffix}`;
  }

  return {
    hasToken: () => Boolean(token),
    clearToken: () => setToken(''),
    async login(email, password) {
      const result = await request('/auth/login', { method: 'POST', body: { email, password } });
      setToken(result.session.token);
      return result;
    },
    async logout() {
      try { await request('/auth/logout', { method: 'POST', body: {} }); }
      finally { setToken(''); }
    },
    me: () => request('/me'),
    contexts: () => request('/me/workspaces'),
    workspace: context => request(pathFor(context, ''), { context }),
    members: (context, query = {}) => request(`${pathFor(context, '/members')}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '')).toString()}`, { context }),
    member: (context, id) => request(pathFor(context, `/members/${encodeURIComponent(id)}`), { context }),
    updateMember: (context, member, body) => request(pathFor(context, `/members/${member.id}`), { method: 'PATCH', context, revision: member.revision, body }),
    grantRole: (context, member, role, reason) => request(pathFor(context, `/members/${member.id}/roles`), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body: { role, ...(reason ? { reason } : {}) } }),
    revokeRole: (context, member, role, reason) => request(pathFor(context, `/members/${member.id}/roles/${role}/revoke`), { method: 'POST', context, revision: member.revision, body: { reason } }),
    setSuspended: (context, member, suspend, reason) => request(pathFor(context, `/members/${member.id}/${suspend ? 'suspend' : 'resume'}`), { method: 'POST', context, revision: member.revision, body: { reason } }),
    invitations: (context, query = {}) => request(`${pathFor(context, '/invitations')}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '')).toString()}`, { context }),
    invite: (context, email, roles) => request(pathFor(context, '/invitations'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body: { email, roles } }),
    resendInvitation: (context, invite) => request(pathFor(context, `/invitations/${invite.id}/resend`), { method: 'POST', context, revision: invite.revision, body: {} }),
    revokeInvitation: (context, invite) => request(pathFor(context, `/invitations/${invite.id}/revoke`), { method: 'POST', context, revision: invite.revision, body: {} }),
    audit: (context, query = {}) => request(`${pathFor(context, '/audit-events')}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '')).toString()}`, { context }),
    async acceptNew(tokenValue, displayName, password) {
      const result = await request('/invitations/accept-new', { method: 'POST', body: { token: tokenValue, displayName, password } });
      setToken(result.session.token);
      return result;
    },
    acceptExisting: tokenValue => request('/invitations/accept-existing', { method: 'POST', body: { token: tokenValue } }),
  };
}
