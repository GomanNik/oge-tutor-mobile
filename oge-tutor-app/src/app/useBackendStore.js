/*
 * OGE Tutor App — backend-backed application store.
 * The store keeps resources separately and lets screens receive only the resources needed for the current role.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApiClient } from '../api/apiClient.js';
import { logger } from '../shared/logger.js';
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
  if (result.data !== undefined) return { mode: 'replace', patch: resourcesFromData(result.data) };
  if (result.resources && typeof result.resources === 'object') return { mode: 'merge', patch: mapResourcePartial(result.resources) };

  const patch = mapResourcePartial(result);
  return Object.keys(patch).length ? { mode: 'merge', patch: mergeResourcePatch(EMPTY_RESOURCES, patch) } : null;
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
  const bulkPatch = resourcePatchFromBulkResult(result);
  const singularPatch = singularPatchApplier(result);

  if (bulkPatch && singularPatch) {
    return (previous) => {
      const base = bulkPatch.mode === 'replace'
        ? bulkPatch.patch
        : mergeResourcePatch(previous, bulkPatch.patch);
      return singularPatch(base);
    };
  }

  return singularPatch || bulkPatch;
}

function summarizePatch(result, nextPatch) {
  if (!result || typeof result !== 'object') return { mode: 'empty' };
  if (result.data) {
    return {
      mode: 'replace',
      students: result.data.students?.length || 0,
      lessons: result.data.lessons?.length || 0,
      homeworks: result.data.homeworks?.length || 0,
      materials: result.data.materials?.length || 0,
      notifications: result.data.notifications?.length || 0,
    };
  }
  if (typeof nextPatch === 'function') return { mode: 'singular' };
  return { mode: nextPatch?.mode || 'none' };
}

export function useBackendStore() {
  const api = useMemo(createSafeApiClient, []);
  const [resources, setResources] = useState(EMPTY_RESOURCES);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState('');

  const busy = busyCount > 0;

  function resetAuthState() {
    logger.state('reset auth state');
    setSession(null);
    setResources(EMPTY_RESOURCES);
  }

  function applyResult(result) {
    const nextPatch = resourcePatchFromResult(result);
    logger.state('applyResponse', { requestId: result?.requestId, ...summarizePatch(result, nextPatch) });
    if (typeof nextPatch === 'function') {
      setResources((previous) => nextPatch(previous));
    } else if (nextPatch?.mode === 'replace') {
      setResources(nextPatch.patch);
    } else if (nextPatch?.mode === 'merge') {
      setResources((previous) => mergeResourcePatch(previous, nextPatch.patch));
    }

    if ((result || {}).session !== undefined) {
      const nextSession = result.session || null;
      logger.state('applySession', { role: nextSession?.role || null, id: nextSession?.id || null });
      setSession(nextSession);
      if (!nextSession) setResources(EMPTY_RESOURCES);
    }
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        if (api.__configurationError) throw api.__configurationError;
        if (typeof api.hasSessionToken === 'function' && !api.hasSessionToken()) {
          logger.store('bootstrap.skip reason=no_token');
          resetAuthState();
          setError('');
          return;
        }
        logger.store('bootstrap.start');
        const result = await api.bootstrap();
        if (!alive) return;
        applyResult(result);
        logger.store('bootstrap.ok', { requestId: result?.requestId });
        setError('');
      } catch (err) {
        if (!alive) return;
        if (isUnauthorizedApiError(err)) {
          logger.store('bootstrap.unauthorized');
          resetAuthState();
          setError('');
        } else {
          logger.error('bootstrap failed', { code: err?.code, requestId: err?.details?.requestId, message: getErrorMessage(err) });
          setError(getErrorMessage(err));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [api]);

  const run = useCallback(async function run(operation, options = {}) {
    const { globalError = true, action = 'operation' } = options;
    try {
      logger.store(`${action}.start`);
      setBusyCount((value) => value + 1);
      if (globalError) setError('');
      if (api.__configurationError) throw api.__configurationError;
      const result = await operation();
      applyResult(result);
      logger.store(`${action}.ok`, { requestId: result?.requestId });
      return result;
    } catch (err) {
      const message = getErrorMessage(err);
      if (isUnauthorizedApiError(err)) resetAuthState();
      if (globalError) setError(message);
      logger.error(`${action} failed`, { code: err?.code, requestId: err?.details?.requestId, message });
      throw err;
    } finally {
      setBusyCount((value) => Math.max(0, value - 1));
    }
  }, [api]);

  const actions = useMemo(() => ({
    updateTeacherProfile: (patch) => run(() => api.updateTeacherProfile(patch), { action: 'updateTeacherProfile' }),
    updateTeacherAccount: (payload) => run(() => api.updateTeacherAccount(payload), { action: 'updateTeacherAccount' }),
    changeTeacherPassword: (payload) => run(() => api.changeTeacherPassword(payload), { action: 'changeTeacherPassword' }),
    updateTeacherNotifications: (payload) => run(() => api.updateTeacherNotifications(payload), { action: 'updateTeacherNotifications' }),

    updateStudentProfile: (studentId, patch) => run(() => api.updateStudentProfile(studentId, patch), { action: 'updateStudentProfile' }),
    updateStudentAccount: (studentId, payload) => run(() => api.updateStudentAccount(studentId, payload), { action: 'updateStudentAccount' }),
    changeStudentPassword: (studentId, payload) => run(() => api.changeStudentPassword(studentId, payload), { action: 'changeStudentPassword' }),
    updateStudentNotifications: (studentId, payload) => run(() => api.updateStudentNotifications(studentId, payload), { action: 'updateStudentNotifications' }),
    updateStudentProgress: (studentId, payload) => run(() => api.updateStudentProgress(studentId, payload), { action: 'updateStudentProgress' }),
    updateTaskProgress: (studentId, taskNumber, payload) => run(() => api.updateTaskProgress(studentId, taskNumber, payload), { action: 'updateTaskProgress' }),
    resolveProgressAssessment: (studentId, taskNumber, payload) => run(() => api.resolveProgressAssessment(studentId, taskNumber, payload), { action: 'resolveProgressAssessment' }),

    createStudent: (payload) => run(() => api.createStudent(payload), { action: 'createStudent' }),
    resendStudentInvite: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.RESEND_INVITE), { action: 'resendStudentInvite' }),
    resetStudentPassword: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.RESET_PASSWORD), { action: 'resetStudentPassword' }),
    disableStudentAccess: (studentId) => run(() => api.updateStudentAccess(studentId, STUDENT_ACCESS_ACTION.DISABLE), { action: 'disableStudentAccess' }),

    createLesson: (payload) => run(() => api.createLesson(payload), { action: 'createLesson' }),
    updateLesson: (lessonId, patch) => run(() => api.updateLesson(lessonId, patch), { action: 'updateLesson' }),
    completeLesson: (lessonId, payload) => run(() => api.completeLesson(lessonId, payload), { action: 'completeLesson' }),

    createHomework: (payload) => run(() => api.createHomework(payload), { action: 'createHomework' }),
    updateHomework: (homeworkId, patch) => run(() => api.updateHomework(homeworkId, patch), { action: 'updateHomework' }),
    submitHomeworkSolution: (homeworkId, payload) => run(() => api.submitHomeworkSolution(homeworkId, payload), { action: 'submitHomeworkSolution' }),
    reviewHomework: (homeworkId, payload) => run(() => api.reviewHomework(homeworkId, payload), { action: 'reviewHomework' }),

    addMaterial: (payload) => run(() => api.addMaterial(payload), { action: 'addMaterial' }),
    removeMaterialFile: (topicId, fileId) => run(() => api.removeMaterialFile(topicId, fileId), { action: 'removeMaterialFile' }),
  }), [api, run]);

  return {
    resources: session ? resources : null,
    session,
    loading,
    busy,
    error,
    login: (email, password) => run(() => api.login({ email, password }), { globalError: false, action: 'login' }),
    logout: () => run(() => api.logout(), { action: 'logout' }),
    requestPasswordReset: (email) => run(() => api.requestPasswordReset({ email }), { globalError: false, action: 'requestPasswordReset' }),
    actions,
  };
}
