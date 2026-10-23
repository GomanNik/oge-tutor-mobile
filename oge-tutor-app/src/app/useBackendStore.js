/*
 * OGE Tutor App — backend-backed application store.
 * The store keeps resources separately and lets screens receive only the resources needed for the current role.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient } from '../api/apiClient.js';
import { STUDENT_ACCESS_ACTION } from '../api/contracts.js';
import { getErrorMessage } from '../api/apiError.js';
import {
  isUnauthorizedApiError,
  mapDataDto,
  mapHomeworkDto,
  mapLessonDto,
  mapMaterialTopicDto,
  mapNotificationDto,
  mapStudentDto,
  mapTeacherDto,
  mapResourceChangesDto,
} from '../api/dto.js';

const EMPTY_RESOURCES = Object.freeze({
  teacher: null,
  students: [],
  lessons: [],
  homeworks: [],
  materials: [],
  notifications: [],
});

function createSafeApiClient() {
  try {
    return createApiClient();
  } catch (error) {
    return { __configurationError: error };
  }
}

function resourcesFromData(data) {
  return mapDataDto(data);
}

function upsertById(items, item) {
  if (!item?.id) return items;
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) return [item, ...items];
  return items.map((current, currentIndex) => (currentIndex === index ? item : current));
}

function removeById(items, id) {
  if (!id) return items;
  return items.filter((current) => current.id !== id);
}


function mapResourcePartial(resources) {
  const patch = {};
  if (!resources || typeof resources !== 'object') return patch;
  if (resources.teacher !== undefined) patch.teacher = resources.teacher === null ? null : mapTeacherDto(resources.teacher);
  if (resources.students !== undefined) patch.students = (Array.isArray(resources.students) ? resources.students : []).map(mapStudentDto).filter(Boolean);
  if (resources.lessons !== undefined) patch.lessons = (Array.isArray(resources.lessons) ? resources.lessons : []).map(mapLessonDto).filter(Boolean);
  if (resources.homeworks !== undefined) patch.homeworks = (Array.isArray(resources.homeworks) ? resources.homeworks : []).map(mapHomeworkDto).filter(Boolean);
  if (resources.materials !== undefined) patch.materials = (Array.isArray(resources.materials) ? resources.materials : []).map(mapMaterialTopicDto).filter(Boolean);
  if (resources.notifications !== undefined) patch.notifications = (Array.isArray(resources.notifications) ? resources.notifications : []).map(mapNotificationDto).filter(Boolean);
  return patch;
}

function mergeResourcePatch(previous, patch) {
  const next = { ...previous };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value !== undefined && key in EMPTY_RESOURCES) next[key] = value;
  });
  return next;
}

function resourcePatchFromBulkResult(result) {
  if (result.changes !== undefined) {
    const changes = mapResourceChangesDto(result.changes);
    return (previous) => {
      const next = { ...previous };
      Object.entries(changes).forEach(([key, value]) => {
        next[key] = key === 'teacher' ? value : value.reduce(upsertById, previous[key]);
      });
      Object.entries(result.removals || {}).forEach(([key, ids]) => {
        if (Array.isArray(next[key]) && Array.isArray(ids)) next[key] = next[key].filter((item) => !ids.includes(item.id));
      });
      return next;
    };
  }
  if (result.data !== undefined) return { mode: 'replace', patch: resourcesFromData(result.data) };
  if (result.resources && typeof result.resources === 'object') return { mode: 'merge', patch: mapResourcePartial(result.resources) };

  const patch = mapResourcePartial(result);
  return Object.keys(patch).length ? { mode: 'merge', patch } : null;
}

function singularPatchApplier(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.teacherProfile !== undefined || result.teacher !== undefined) {
    const teacher = mapTeacherDto(result.teacherProfile ?? result.teacher);
    return (previous) => ({ ...previous, teacher: teacher || previous.teacher });
  }
  if (result.student !== undefined) {
    const student = mapStudentDto(result.student);
    return (previous) => ({ ...previous, students: upsertById(previous.students, student) });
  }
  if (result.lesson !== undefined) {
    const lesson = mapLessonDto(result.lesson);
    return (previous) => ({ ...previous, lessons: upsertById(previous.lessons, lesson) });
  }
  if (result.homework !== undefined) {
    const homework = mapHomeworkDto(result.homework);
    return (previous) => ({ ...previous, homeworks: upsertById(previous.homeworks, homework) });
  }
  if (result.materialTopic !== undefined || result.material !== undefined) {
    const topic = mapMaterialTopicDto(result.materialTopic ?? result.material);
    return (previous) => ({ ...previous, materials: upsertById(previous.materials, topic) });
  }
  if (result.notification !== undefined) {
    const notification = mapNotificationDto(result.notification);
    return (previous) => ({ ...previous, notifications: upsertById(previous.notifications, notification) });
  }
  if (result.removedMaterialFile !== undefined) {
    const { topicId, fileId } = result.removedMaterialFile || {};
    return (previous) => ({
      ...previous,
      materials: previous.materials.map((topic) => (topic.id === topicId ? { ...topic, files: removeById(topic.files || [], fileId) } : topic)),
    });
  }
  return null;
}

function resourcePatchFromResult(result) {
  if (!result || typeof result !== 'object') return null;
  return resourcePatchFromBulkResult(result) || singularPatchApplier(result);
}

export function useBackendStore() {
  const api = useMemo(createSafeApiClient, []);
  const [resources, setResources] = useState(EMPTY_RESOURCES);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({});
  const resourcesRef = useRef(EMPTY_RESOURCES);
  const paginationRef = useRef({});
  const generation = useRef(0);
  const requests = useRef({});
  const refreshVersion = useRef({});

  const updateResources = useCallback((update) => {
    resourcesRef.current = typeof update === 'function' ? update(resourcesRef.current) : update;
    setResources(resourcesRef.current);
  }, []);

  const updatePagination = useCallback((update) => {
    paginationRef.current = typeof update === 'function' ? update(paginationRef.current) : update;
    setPagination(paginationRef.current);
  }, []);

  const busy = busyCount > 0;

  const resetAuthState = useCallback(() => {
    generation.current += 1;
    requests.current = {};
    refreshVersion.current = {};
    setSession(null);
    updateResources(EMPTY_RESOURCES);
    updatePagination({});
  }, [updateResources, updatePagination]);

  const applyResult = useCallback((result) => {
    const nextPatch = resourcePatchFromResult(result);
    if (typeof nextPatch === 'function') {
      updateResources((previous) => nextPatch(previous));
    } else if (nextPatch?.mode === 'replace') {
      updateResources(nextPatch.patch);
      updatePagination(result.pagination || {});
    } else if (nextPatch?.mode === 'merge') {
      updateResources((previous) => mergeResourcePatch(previous, nextPatch.patch));
    }

    if ('session' in (result || {})) {
      const nextSession = result.session || null;
      setSession(nextSession);
      if (!nextSession) resetAuthState();
    }
  }, [updateResources, updatePagination, resetAuthState]);

  const refreshCollection = useCallback(async (key) => {
    const meta = paginationRef.current[key];
    if (!meta || !api.list) return;
    const epoch = generation.current;
    const version = (refreshVersion.current[key] || 0) + 1;
    refreshVersion.current[key] = version;
    updatePagination((previous) => ({ ...previous, [key]: { ...previous[key], loading: true, error: '' } }));
    try {
      const pages = await Promise.all(Array.from({ length: meta.page }, (_, index) => api.list(key, { page: index + 1, pageSize: meta.pageSize })));
      if (epoch !== generation.current || version !== refreshVersion.current[key]) return;
      const items = [...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()];
      updateResources((previous) => ({ ...previous, [key]: items }));
      updatePagination((previous) => ({ ...previous, [key]: { page: meta.page, pageSize: meta.pageSize, total: pages[0].total, loading: false, error: '' } }));
    } catch (err) {
      if (epoch !== generation.current || version !== refreshVersion.current[key]) return;
      if (isUnauthorizedApiError(err)) resetAuthState();
      else updatePagination((previous) => ({ ...previous, [key]: { ...previous[key], loading: false, error: getErrorMessage(err), needsRefresh: true } }));
    }
  }, [api, resetAuthState, updatePagination, updateResources]);

  const loadMore = useCallback(async (key) => {
    if (requests.current[key]) return requests.current[key];
    const meta = paginationRef.current[key];
    if (!meta || meta.loading || !api.list) return;
    if (meta.needsRefresh) return refreshCollection(key);
    if (meta.page * meta.pageSize >= meta.total) return;
    const epoch = generation.current;
    const version = refreshVersion.current[key] || 0;
    updatePagination((previous) => ({ ...previous, [key]: { ...meta, loading: true, error: '' } }));
    const pending = (async () => {
      try {
        const page = await api.list(key, { page: meta.page + 1, pageSize: meta.pageSize });
        if (epoch !== generation.current || version !== (refreshVersion.current[key] || 0)) return;
        updateResources((previous) => ({ ...previous, [key]: [...new Map([...previous[key], ...page.items].map((item) => [item.id, item])).values()] }));
        updatePagination((previous) => ({ ...previous, [key]: { page: page.page, pageSize: page.pageSize, total: page.total, loading: false, error: '' } }));
      } catch (err) {
        if (epoch !== generation.current) return;
        if (isUnauthorizedApiError(err)) resetAuthState();
        else updatePagination((previous) => ({ ...previous, [key]: { ...meta, loading: false, error: getErrorMessage(err) } }));
      } finally {
        if (epoch === generation.current) delete requests.current[key];
      }
    })();
    requests.current[key] = pending;
    return pending;
  }, [api, refreshCollection, resetAuthState, updatePagination, updateResources]);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        if (api.__configurationError) throw api.__configurationError;
        const result = await api.bootstrap();
        if (!alive) return;
        applyResult(result);
        setError('');
      } catch (err) {
        if (!alive) return;
        if (isUnauthorizedApiError(err)) {
          resetAuthState();
          setError('');
        } else {
          setError(getErrorMessage(err));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [api, applyResult, resetAuthState]);

  const run = useCallback(async function run(operation, options = {}) {
    const { globalError = true } = options;
    const epoch = generation.current;
    try {
      setBusyCount((value) => value + 1);
      if (globalError) setError('');
      if (api.__configurationError) throw api.__configurationError;
      const result = await operation();
      if (epoch !== generation.current) return result;
      applyResult(result);
      if (result?.invalidated) await Promise.all(result.invalidated.map(refreshCollection));
      return result;
    } catch (err) {
      const message = getErrorMessage(err);
      if (epoch === generation.current) {
        if (isUnauthorizedApiError(err)) resetAuthState();
        if (globalError) setError(message);
      }
      throw err;
    } finally {
      setBusyCount((value) => Math.max(0, value - 1));
    }
  }, [api, applyResult, refreshCollection, resetAuthState]);

  const read = useCallback(async (operation) => {
    const epoch = generation.current;
    try {
      const result = await operation();
      if (epoch !== generation.current) throw new Error('Сессия изменилась.');
      return result;
    } catch (err) {
      if (epoch === generation.current && isUnauthorizedApiError(err)) resetAuthState();
      throw err;
    }
  }, [resetAuthState]);

  const actions = useMemo(() => ({
    loadMore,
    list: api.list ? (key, filters) => read(() => api.list(key, filters)) : undefined,
    progressHistory: api.progressHistory ? (studentId, filters) => read(() => api.progressHistory(studentId, filters)) : undefined,
    loadDetail: async (key, id) => {
      if (!api.detail) return resourcesRef.current[key]?.find((item) => item.id === id);
      const result = await read(() => api.detail(key, id));
      updateResources((previous) => ({ ...previous, [key]: upsertById(previous[key], result.item) }));
      return result.item;
    },
    updateNotification: api.updateNotification ? (id, status) => run(() => api.updateNotification(id, status), { globalError: false }) : undefined,
    readAllNotifications: api.readAllNotifications ? () => run(() => api.readAllNotifications(), { globalError: false }) : undefined,
    updateTeacherProfile: (patch) => run(() => api.updateTeacherProfile(patch)),
    updateTeacherAccount: (payload) => run(() => api.updateTeacherAccount(payload)),
    changeTeacherPassword: (payload) => run(() => api.changeTeacherPassword(payload)),
    updateTeacherNotifications: (payload) => run(() => api.updateTeacherNotifications(payload)),

    updateStudentProfile: (studentId, patch) => run(() => api.updateStudentProfile(studentId, patch)),
    updateStudentAccount: (studentId, payload) => run(() => api.updateStudentAccount(studentId, payload)),
    changeStudentPassword: (studentId, payload) => run(() => api.changeStudentPassword(studentId, payload)),
    updateStudentNotifications: (studentId, payload) => run(() => api.updateStudentNotifications(studentId, payload)),
    updateStudentProgress: (studentId, payload) => run(() => api.updateStudentProgress(studentId, payload)),
    updateTaskProgress: (studentId, taskNumber, payload) => run(() => api.updateTaskProgress(studentId, taskNumber, payload)),
    resolveProgressAssessment: (studentId, taskNumber, payload) => run(() => api.resolveProgressAssessment(studentId, taskNumber, payload)),

    createStudent: (payload) => run(() => api.createStudent(payload)),
    resendStudentInvite: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.RESEND_INVITE)),
    resetStudentPassword: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.RESET_PASSWORD)),
    disableStudentAccess: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.DISABLE)),
    enableStudentAccess: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.ENABLE)),

    createLesson: (payload) => run(() => api.createLesson(payload)),
    updateLesson: (lessonId, patch) => run(() => api.updateLesson(lessonId, patch)),
    completeLesson: (lessonId, payload) => run(() => api.completeLesson(lessonId, payload)),

    createHomework: (payload) => run(() => api.createHomework(payload)),
    updateHomework: (homeworkId, patch) => run(() => api.updateHomework(homeworkId, patch)),
    submitHomeworkSolution: (homeworkId, payload) => run(() => api.submitHomeworkSolution(homeworkId, payload)),
    reviewHomework: (homeworkId, payload) => run(() => api.reviewHomework(homeworkId, payload)),

    addMaterial: (payload) => run(() => api.addMaterial(payload)),
    updateMaterialFile: (topicId, fileId, payload) => run(() => api.updateMaterialFile(topicId, fileId, payload)),
    removeMaterialFile: (topicId, fileId) => run(() => api.removeMaterialFile(topicId, fileId)),
  }), [api, run, loadMore, read, updateResources]);

  const authActions = useMemo(() => ({
    login: (email, password) => run(() => api.login({ email, password }), { globalError: false }),
    logout: () => run(() => api.logout()),
    requestPasswordReset: (email) => run(() => api.requestPasswordReset({ email }), { globalError: false }),
    verifyAccessToken: (token) => run(() => api.verifyAccessToken({ token }), { globalError: false }),
    completeAccessToken: (token, password) => run(() => api.completeAccessToken({ token, password }), { globalError: false }),
  }), [api, run]);

  return {
    resources: session ? { ...resources, pagination } : null,
    session,
    loading,
    busy,
    error,
    ...authActions,
    actions,
  };
}
