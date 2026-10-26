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

  function workPath(context, resource, id, suffix = '') {
    return pathFor(context, `/${resource}${id ? `/${encodeURIComponent(id)}` : ''}${suffix}`);
  }

  function workQuery(context, resource, query = {}) {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== ''));
    return `${workPath(context, resource)}${params.size ? `?${params}` : ''}`;
  }

  async function workFileRequest(context, file, download = false) {
    const headers = { Authorization: `Bearer ${token}`, 'X-Active-Role': context.role };
    const response = await fetch(`${baseUrl()}/api/v2${workPath(context, 'files', download ? file.id : null, download ? '/download' : '')}`, {
      method: download ? 'GET' : 'POST', headers,
      body: download ? undefined : (() => { const form = new FormData(); form.append('file', file); return form; })(),
    });
    if (response.status === 401) setToken('');
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.message || 'Не удалось обработать файл.');
      error.status = response.status;
      error.code = payload?.code || 'http_error';
      throw error;
    }
    if (!download) return response.json();
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = file.originalName || 'file';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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
    lessons: (context, query = {}) => request(`${pathFor(context, '/lessons')}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '')).toString()}`, { context }),
    lesson: (context, id) => request(pathFor(context, `/lessons/${encodeURIComponent(id)}`), { context }),
    previewLesson: (context, body) => request(pathFor(context, '/lessons/preview'), { method: 'POST', context, body }),
    createLesson: (context, body) => request(pathFor(context, '/lessons'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateLesson: (context, lesson, body) => request(pathFor(context, `/lessons/${encodeURIComponent(lesson.id)}`), { method: 'PATCH', context, revision: lesson.revision, body }),
    cancelLesson: (context, lesson, reason) => request(pathFor(context, `/lessons/${encodeURIComponent(lesson.id)}/cancel`), { method: 'POST', context, revision: lesson.revision, body: { reason } }),
    completeLesson: (context, lesson, body) => request(pathFor(context, `/lessons/${encodeURIComponent(lesson.id)}/complete`), { method: 'POST', context, revision: lesson.revision, body }),
    correctLessonAttendance: (context, lesson, body) => request(pathFor(context, `/lessons/${encodeURIComponent(lesson.id)}/attendance-corrections`), { method: 'POST', context, revision: lesson.revision, body }),
    assignments: (context, query) => request(workQuery(context, 'assignments', query), { context }),
    assignment: (context, id) => request(workPath(context, 'assignments', id), { context }),
    createAssignment: (context, body) => request(workPath(context, 'assignments'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateAssignment: (context, item, body) => request(workPath(context, 'assignments', item.id), { method: 'PATCH', context, revision: item.revision, body }),
    publishAssignment: (context, item, ids, add = false) => request(workPath(context, 'assignments', item.id, add ? '/recipients' : '/publish'), { method: 'POST', context, revision: item.revision, idempotencyKey: crypto.randomUUID(), body: { recipientEnrollmentIds: ids } }),
    assignmentAction: (context, item, action, reason) => request(workPath(context, 'assignments', item.id, `/${action}`), { method: 'POST', context, revision: item.revision, body: { reason } }),
    assignmentRecipients: (context, id, query) => request(`${workPath(context, 'assignments', id, '/recipients')}?${new URLSearchParams(query)}`, { context }),
    updateAssignmentRecipient: (context, assignmentId, item, body) => request(workPath(context, 'assignments', assignmentId, `/recipients/${encodeURIComponent(item.id)}`), { method: 'PATCH', context, revision: item.revision, body }),
    submissions: (context, recipientId, query) => request(`${workPath(context, 'assignment-recipients', recipientId, '/submissions')}?${new URLSearchParams(query)}`, { context }),
    submitAssignment: (context, recipient, body) => request(workPath(context, 'assignment-recipients', recipient.id, '/submissions'), { method: 'POST', context, revision: recipient.revision, idempotencyKey: crypto.randomUUID(), body }),
    createReview: (context, submissionId, recipientRevision, body) => request(workPath(context, 'submissions', submissionId, '/reviews'), { method: 'POST', context, revision: recipientRevision, idempotencyKey: crypto.randomUUID(), body }),
    updateReview: (context, review, body) => request(workPath(context, 'reviews', review.id), { method: 'PATCH', context, revision: review.revision, body }),
    publishReview: (context, review) => request(workPath(context, 'reviews', review.id, '/publish'), { method: 'POST', context, revision: review.revision, idempotencyKey: crypto.randomUUID(), body: {} }),
    learningMaterials: (context, query) => request(workQuery(context, 'materials', query), { context }),
    learningMaterial: (context, id) => request(workPath(context, 'materials', id), { context }),
    createLearningMaterial: (context, body) => request(workPath(context, 'materials'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    updateLearningMaterial: (context, item, body) => request(workPath(context, 'materials', item.id), { method: 'PATCH', context, revision: item.revision, body }),
    publishLearningMaterial: (context, item, body) => request(workPath(context, 'materials', item.id, '/publish'), { method: 'POST', context, revision: item.revision, idempotencyKey: crypto.randomUUID(), body }),
    revokeLearningMaterial: (context, item, publication, reason) => request(workPath(context, 'materials', item.id, `/publications/${encodeURIComponent(publication.id)}/revoke`), { method: 'POST', context, revision: publication.revision, body: { reason } }),
    archiveLearningMaterial: (context, item, reason) => request(workPath(context, 'materials', item.id, '/archive'), { method: 'POST', context, revision: item.revision, body: { reason } }),
    uploadWorkFile: (context, file) => workFileRequest(context, file),
    downloadWorkFile: (context, file) => workFileRequest(context, file, true),
    deleteWorkFile: (context, id) => request(workPath(context, 'files', id), { method: 'DELETE', context }),
    enrollmentProgress: (context, id) => request(workPath(context, 'enrollments', id, '/progress'), { context }),
    progressEvents: (context, id, query) => request(`${workPath(context, 'enrollments', id, '/progress/events')}?${new URLSearchParams(Object.entries(query || {}).filter(([, value]) => value !== undefined && value !== ''))}`, { context }),
    assessProgress: (context, id, body) => request(workPath(context, 'enrollments', id, '/progress/assessments'), { method: 'POST', context, idempotencyKey: crypto.randomUUID(), body }),
    programProgress: (context, userId, versionId) => request(`${workPath(context, 'students', userId, '/program-progress')}?${new URLSearchParams({ programVersionId: versionId })}`, { context }),
    learningNotifications: (context, query) => request(workQuery(context, 'notifications', query), { context }),
    markLearningNotification: (context, item, read) => request(workPath(context, 'notifications', item.id), { method: 'PATCH', context, revision: item.revision, body: { read } }),
    readAllLearningNotifications: (context, before) => request(workPath(context, 'notifications', null, '/read-all'), { method: 'POST', context, body: { before } }),
    learningNotificationTarget: (context, id) => request(workPath(context, 'notifications', id, '/target'), { context }),
    notificationPreferences: context => request(workPath(context, 'notification-preferences'), { context }),
    setNotificationPreferences: (context, emailEnabled) => request(workPath(context, 'notification-preferences'), { method: 'PATCH', context, body: { emailEnabled } }),
    notificationDeliveries: (context, query) => request(workQuery(context, 'notification-deliveries', query), { context }),
    retryNotificationDelivery: (context, item, reason) => request(workPath(context, 'notification-deliveries', item.id, '/retry'), { method: 'POST', context, revision: item.revision, body: { reason } }),
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
