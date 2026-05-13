/*
 * OGE Tutor App — HTTP backend adapter.
 * Set VITE_API_BASE_URL to use the real backend instead of the mock adapter.
 */
import { ApiError } from './apiError.js';
import { mapApiErrorPayload, mapBackendResultDto, mapFileResourceDto } from './dto.js';

const TOKEN_KEY = 'oge-tutor-api-token';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function isBrowserFile(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stripRuntimeFiles(value) {
  if (Array.isArray(value)) return value.map(stripRuntimeFiles);
  if (!value || typeof value !== 'object') return value;
  if (isBrowserFile(value)) return undefined;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'file')
      .map(([key, item]) => [key, stripRuntimeFiles(item)])
      .filter(([, item]) => item !== undefined),
  );
}

export function createHttpBackend(baseUrl) {
  const root = normalizeBaseUrl(baseUrl);
  let token = typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_KEY) : '';

  function persistToken(nextToken) {
    token = nextToken || '';
    if (typeof window === 'undefined') return;
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const isFormData = options.body instanceof FormData;

    if (!isFormData && options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(`${root}${path}`, {
      ...options,
      headers,
      body: isFormData || options.body === undefined ? options.body : JSON.stringify(stripRuntimeFiles(options.body)),
    });
    const payload = await parseResponse(response);

    if (response.status === 401) persistToken('');

    if (!response.ok) {
      const apiError = mapApiErrorPayload(payload, response.status);
      throw new ApiError(apiError.message, apiError.code, apiError);
    }

    const mappedPayload = mapBackendResultDto(payload);
    if (mappedPayload?.session?.token) persistToken(mappedPayload.session.token);
    return mappedPayload;
  }

  async function uploadMaterialPayload(payload) {
    if (payload?.type === 'file' && !isBrowserFile(payload.file) && !payload.fileId) {
      throw new ApiError('Выберите реальный файл материала.', 'validation_error', { status: 422, fieldErrors: { file: 'required' } });
    }

    if (isBrowserFile(payload.file)) {
      const fileResource = await uploadFileResource(payload.file, { title: payload.fileName || payload.file.name, context: 'material-library' });
      const item = attachmentFromFileResource(payload.item || {}, fileResource);
      return request('/materials', {
        method: 'POST',
        body: {
          taskNumber: payload.taskNumber,
          topicTitle: payload.topicTitle || '',
          type: 'file',
          item,
          fileId: fileResource.id,
        },
      });
    }
    return request('/materials', { method: 'POST', body: payload });
  }


  function extractFileResource(result, _fallbackFile) {
    const candidate = result?.fileResource || result?.file || result?.resource || result?.data?.fileResource || result?.data?.file || (result?.id ? result : null);
    const mapped = mapFileResourceDto(candidate);
    if (mapped?.id) return mapped;
    throw new ApiError('Backend не вернул данные загруженного файла.', 'invalid_file_response', { status: 502 });
  }

  async function uploadFileResource(file, meta = {}) {
    if (!isBrowserFile(file)) {
      throw new ApiError('Выберите реальный файл.', 'validation_error', { status: 422, fieldErrors: { file: 'required' } });
    }

    const form = new FormData();
    form.append('file', file, file.name);
    if (meta.title) form.append('title', meta.title);
    if (meta.context) form.append('context', meta.context);
    const result = await request('/files', { method: 'POST', body: form });
    return extractFileResource(result, file);
  }

  function attachmentFromFileResource(item, fileResource) {
    return {
      ...item,
      type: item.type || 'file',
      source: item.source || 'upload',
      title: item.title || item.fileName || fileResource.originalName,
      fileName: item.fileName || item.title || fileResource.originalName,
      originalName: fileResource.originalName,
      fileId: fileResource.id,
      mimeType: fileResource.mimeType,
      size: fileResource.size,
      url: fileResource.url,
      uploadedAt: fileResource.uploadedAt,
    };
  }

  async function resolveAttachmentFiles(items = [], context = 'attachment') {
    const result = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue;
      if (isBrowserFile(item.file)) {
        const fileResource = await uploadFileResource(item.file, { title: item.title || item.fileName || item.file.name, context });
        const rest = { ...item };
        delete rest.file;
        result.push(attachmentFromFileResource(rest, fileResource));
        continue;
      }
      if ((item.type === 'file' || item.source === 'upload') && !item.fileId && !item.url) {
        throw new ApiError('Файловое вложение должно быть сначала загружено.', 'validation_error', { status: 422, fieldErrors: { attachments: 'file_required' } });
      }
      result.push(item);
    }
    return result;
  }

  async function resolvePayloadAttachments(payload = {}, fields = ['materials'], context = 'attachment') {
    const next = { ...payload };
    for (const field of fields) {
      if (field in next) next[field] = await resolveAttachmentFiles(next[field], `${context}:${field}`);
    }
    return next;
  }

  function submitHomeworkPayload(homeworkId, payload) {
    if (!isBrowserFile(payload?.file)) {
      throw new ApiError('Выберите реальный файл решения.', 'validation_error', { status: 422, fieldErrors: { file: 'required' } });
    }

    const form = new FormData();
    form.append('file', payload.file, payload.file.name);
    form.append('fileTitle', payload.fileTitle || payload.file.name);
    return request(`/homeworks/${homeworkId}/submissions`, { method: 'POST', body: form });
  }

  return {
    bootstrap: () => request('/bootstrap'),
    login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
    logout: async () => {
      const result = await request('/auth/logout', { method: 'POST' });
      persistToken('');
      return result || { session: null };
    },
    requestPasswordReset: (payload) => request('/auth/password-reset', { method: 'POST', body: payload }),

    updateTeacherProfile: (patch) => request('/teacher/profile', { method: 'PATCH', body: patch }),
    updateTeacherAccount: (payload) => request('/teacher/account', { method: 'PATCH', body: payload }),
    changeTeacherPassword: (payload) => request('/teacher/security/password', { method: 'POST', body: payload }),
    updateTeacherNotifications: (payload) => request('/teacher/notifications', { method: 'PATCH', body: payload }),

    updateStudentProfile: (studentId, patch) => request(`/students/${studentId}/profile`, { method: 'PATCH', body: patch }),
    updateStudentAccount: (studentId, payload) => request(`/students/${studentId}/account`, { method: 'PATCH', body: payload }),
    changeStudentPassword: (studentId, payload) => request(`/students/${studentId}/security/password`, { method: 'POST', body: payload }),
    updateStudentNotifications: (studentId, payload) => request(`/students/${studentId}/notifications`, { method: 'PATCH', body: payload }),
    updateStudentProgress: (studentId, payload) => request(`/students/${studentId}/progress`, { method: 'PATCH', body: payload }),
    updateTaskProgress: (studentId, taskNumber, payload) => request(`/students/${studentId}/progress/tasks/${taskNumber}`, { method: 'PATCH', body: payload }),
    resolveProgressAssessment: (studentId, taskNumber, payload) => request(`/students/${studentId}/progress/tasks/${taskNumber}/assessment`, { method: 'POST', body: payload }),

    createStudent: (payload) => request('/students', { method: 'POST', body: payload }),
    updateStudentAccess: (studentId, action) => request(`/students/${studentId}/access`, { method: 'POST', body: { action } }),

    createLesson: async (payload) => request('/lessons', { method: 'POST', body: await resolvePayloadAttachments(payload, ['materials'], 'lesson') }),
    updateLesson: async (lessonId, patch) => request(`/lessons/${lessonId}`, { method: 'PATCH', body: await resolvePayloadAttachments(patch, ['materials'], 'lesson') }),
    completeLesson: (lessonId, payload) => request(`/lessons/${lessonId}/complete`, { method: 'POST', body: payload }),

    createHomework: async (payload) => request('/homeworks', { method: 'POST', body: await resolvePayloadAttachments(payload, ['materials'], 'homework') }),
    updateHomework: async (homeworkId, patch) => request(`/homeworks/${homeworkId}`, { method: 'PATCH', body: await resolvePayloadAttachments(patch, ['materials'], 'homework') }),
    submitHomeworkSolution: submitHomeworkPayload,
    reviewHomework: async (homeworkId, payload) => request(`/homeworks/${homeworkId}/review`, { method: 'POST', body: await resolvePayloadAttachments(payload, ['reviewMaterials'], 'homework-review') }),

    addMaterial: uploadMaterialPayload,
    removeMaterialFile: (topicId, fileId) => request(`/materials/${topicId}/files/${fileId}`, { method: 'DELETE' }),
  };
}
