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

  function catalogQuery(context, query = {}) {
    return new URLSearchParams(Object.entries({ ...(context ? { workspaceId: context.workspaceId } : {}), ...query })
      .filter(([, value]) => value !== undefined && value !== '')).toString();
  }

  function catalogPath(path, context, query) {
    const encoded = catalogQuery(context, query);
    return `${path}${encoded ? `?${encoded}` : ''}`;
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
    courses: (context, query = {}) => request(`${pathFor(context, '/courses')}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '')).toString()}`, { context }),
    course: (context, id) => request(pathFor(context, `/courses/${encodeURIComponent(id)}`), { context }),
    createCourse: (context, body) => request(pathFor(context, '/courses'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateCourse: (context, course, body) => request(pathFor(context, `/courses/${encodeURIComponent(course.id)}`), { method: 'PATCH', context, revision: course.revision, body }),
    courseAction: (context, course, action) => request(pathFor(context, `/courses/${encodeURIComponent(course.id)}/${action}`), { method: 'POST', context, revision: course.revision, body: {} }),
    courseTeachers: (context, courseId) => request(pathFor(context, `/courses/${encodeURIComponent(courseId)}/teachers`), { context }),
    addCourseTeacher: (context, courseId, body) => request(pathFor(context, `/courses/${encodeURIComponent(courseId)}/teachers`), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateCourseTeacher: (context, courseId, link, body) => request(pathFor(context, `/courses/${encodeURIComponent(courseId)}/teachers/${encodeURIComponent(link.id)}`), { method: 'PATCH', context, revision: link.revision, body }),
    courseEnrollments: (context, courseId) => request(pathFor(context, `/courses/${encodeURIComponent(courseId)}/enrollments`), { context }),
    addCourseEnrollment: (context, courseId, body) => request(pathFor(context, `/courses/${encodeURIComponent(courseId)}/enrollments`), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateCourseEnrollment: (context, courseId, enrollment, body) => request(pathFor(context, `/courses/${encodeURIComponent(courseId)}/enrollments/${encodeURIComponent(enrollment.id)}`), { method: 'PATCH', context, revision: enrollment.revision, body }),
    previewEnrollmentBatch: (context, body) => request(pathFor(context, '/enrollment-batches/preview'), { method: 'POST', context, body }),
    applyEnrollmentBatch: (context, body) => request(pathFor(context, '/enrollment-batches'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    subjects: (context, query) => request(catalogPath('/subjects', context, query), { context }),
    createSubject: (context, body) => request('/subjects', { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body: { ...(context ? { workspaceId: context.workspaceId } : {}), ...body } }),
    updateSubject: (context, item, name) => request(`/subjects/${encodeURIComponent(item.id)}`, { method: 'PATCH', context, revision: item.revision, body: { name } }),
    archiveSubject: (context, item) => request(`/subjects/${encodeURIComponent(item.id)}/archive`, { method: 'POST', context, revision: item.revision, body: {} }),
    programs: (context, query) => request(catalogPath('/programs', context, query), { context }),
    createProgram: (context, body) => request('/programs', { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body: { ...(context ? { workspaceId: context.workspaceId } : {}), ...body } }),
    updateProgram: (context, item, name) => request(`/programs/${encodeURIComponent(item.id)}`, { method: 'PATCH', context, revision: item.revision, body: { name } }),
    archiveProgram: (context, item) => request(`/programs/${encodeURIComponent(item.id)}/archive`, { method: 'POST', context, revision: item.revision, body: {} }),
    versions: (context, programId, query) => request(catalogPath(`/programs/${encodeURIComponent(programId)}/versions`, context, query), { context }),
    version: (context, id) => request(`/program-versions/${encodeURIComponent(id)}`, { context }),
    createVersion: (context, programId, body) => request(`/programs/${encodeURIComponent(programId)}/versions`, { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateVersion: (context, item, body) => request(`/program-versions/${encodeURIComponent(item.id)}`, { method: 'PATCH', context, revision: item.revision, body }),
    publishVersion: (context, item) => request(`/program-versions/${encodeURIComponent(item.id)}/publish`, { method: 'POST', context, revision: item.revision, body: {} }),
    archiveVersion: (context, item) => request(`/program-versions/${encodeURIComponent(item.id)}/archive`, { method: 'POST', context, revision: item.revision, body: {} }),
    catalogTasks: (context, versionId, query) => request(catalogPath(`/program-versions/${encodeURIComponent(versionId)}/tasks`, context, query), { context }),
    createCatalogTask: (context, version, body) => request(`/program-versions/${encodeURIComponent(version.id)}/tasks`, { method: 'POST', context, revision: version.revision, body }),
    updateCatalogTask: (context, version, task, body) => request(`/program-versions/${encodeURIComponent(version.id)}/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', context, revision: version.revision, body }),
    deleteCatalogTask: (context, version, task) => request(`/program-versions/${encodeURIComponent(version.id)}/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE', context, revision: version.revision }),
    setScoringRule: (context, version, body) => request(`/program-versions/${encodeURIComponent(version.id)}/scoring-rule`, { method: 'POST', context, revision: version.revision, body }),
    taskMappings: (context, fromVersionId, toVersionId, query) => request(catalogPath('/task-mappings', context, { fromVersionId, toVersionId, ...query }), { context }),
    createTaskMapping: (context, body) => request('/task-mappings', { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    revokeTaskMapping: (context, item, reason) => request(`/task-mappings/${encodeURIComponent(item.id)}/revoke`, { method: 'POST', context, revision: item.revision, body: { reason } }),
    async acceptNew(tokenValue, displayName, password) {
      const result = await request('/invitations/accept-new', { method: 'POST', body: { token: tokenValue, displayName, password } });
      setToken(result.session.token);
      return result;
    },
    acceptExisting: tokenValue => request('/invitations/accept-existing', { method: 'POST', body: { token: tokenValue } }),
  };
}
