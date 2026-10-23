/*
 * OGE Tutor App — teacher cabinet router.
 * Teacher screens use stable route ids instead of Russian UI labels.
 */
import React, { useState } from 'react';
import { TEACHER_ROUTE } from '../api/contracts.js';
import { AppShell } from '../shared/ui.jsx';
import { TEACHER_NAV_ITEMS } from '../shared/constants.js';
import { NotificationInbox } from '../shared/NotificationsScreen.jsx';
import { deriveTeacherNotifications } from '../domain/productSelectors.js';
import TeacherHome from './TeacherHome.jsx';
import { CreateStudent, StudentCard, StudentsList } from './TeacherStudents.jsx';
import { CreateLesson, LessonDetail, ScheduleScreen } from './TeacherLessons.jsx';
import { CreateHomework, HomeworkDetail, HomeworkList } from './TeacherHomework.jsx';
import { MaterialsList, UploadMaterial } from './TeacherMaterials.jsx';
import TeacherProfile from './TeacherProfile.jsx';
import { CollectionPagination } from '../shared/PaginationControls.jsx';

export default function TeacherApp({ data, actions, onLogout }) {
  const [screen, setScreen] = useState(TEACHER_ROUTE.HOME);
  const [mode, setMode] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [homeworkId, setHomeworkId] = useState(null);
  const [context, setContext] = useState({});
  const [navigationError, setNavigationError] = useState('');
  const [opening, setOpening] = useState(false);
  const notifications = deriveTeacherNotifications(data, new Date(), { includeResolved: true });
  const activeNotifications = notifications.filter((item) => item.status !== 'resolved');

  async function fetchDetail(resource, id) {
    setNavigationError('');
    setOpening(true);
    try {
      await actions.loadDetail?.(resource, id);
      return true;
    } catch (error) {
      setNavigationError(error.message || 'Не удалось загрузить запись.');
      return false;
    } finally { setOpening(false); }
  }

  function clearDetails() {
    setMode(null);
    setStudentId(null);
    setLessonId(null);
    setHomeworkId(null);
    setContext({});
  }

  function navigate(next) {
    clearDetails();
    setScreen(next);
  }

  async function openStudent(id) {
    if (!(await fetchDetail('students', id))) return;
    setScreen(TEACHER_ROUTE.STUDENTS);
    setStudentId(id);
    setMode(null);
    setLessonId(null);
    setHomeworkId(null);
    setContext({});
  }

  async function openLesson(id) {
    if (!(await fetchDetail('lessons', id))) return;
    setScreen(TEACHER_ROUTE.SCHEDULE);
    setLessonId(id);
    setMode(null);
    setStudentId(null);
    setHomeworkId(null);
    setContext({});
  }

  async function openHomework(id) {
    if (!(await fetchDetail('homeworks', id))) return;
    setScreen(TEACHER_ROUTE.HOMEWORK);
    setHomeworkId(id);
    setMode(null);
    setStudentId(null);
    setLessonId(null);
    setContext({});
  }

  function openMode(nextMode, target = screen, nextContext = {}) {
    setScreen(target);
    setMode(nextMode);
    setStudentId(null);
    setLessonId(null);
    setHomeworkId(null);
    setContext(nextContext || {});
  }

  function openNotification(item) {
    if (item.homeworkId) {
      return openHomework(item.homeworkId);
    }
    if (item.lessonId) {
      return openLesson(item.lessonId);
    }
    if (item.studentId) {
      return openStudent(item.studentId);
    }
  }

  return (
    <AppShell
      navItems={TEACHER_NAV_ITEMS}
      active={screen === TEACHER_ROUTE.NOTIFICATIONS ? TEACHER_ROUTE.HOME : screen}
      onNavigate={navigate}
      topTitle="Преподаватель"
      noticeCount={notifications.filter((item) => item.status === 'unread').length}
      onOpenNotifications={() => navigate(TEACHER_ROUTE.NOTIFICATIONS)}
    >
      {opening ? <p role="status" className="subtitle">Загрузка записи…</p> : null}
      {navigationError ? <div className="inline-error" role="alert">{navigationError}</div> : null}
      {screen === TEACHER_ROUTE.NOTIFICATIONS ? (
        <NotificationInbox
          notifications={notifications}
          onBack={() => navigate(TEACHER_ROUTE.HOME)}
          onOpen={openNotification}
          onStatusChange={actions.updateNotification}
          onReadAll={actions.readAllNotifications}
        />
      ) : null}

      {screen === TEACHER_ROUTE.HOME && !mode ? (
        <TeacherHome
          data={data}
          notifications={activeNotifications}
          openStudent={openStudent}
          openLesson={openLesson}
          openHomework={openHomework}
          openMode={openMode}
          navigate={navigate}
        />
      ) : null}

      {screen === TEACHER_ROUTE.STUDENTS && mode === 'create-student' ? <CreateStudent actions={actions} onBack={clearDetails} /> : null}
      {screen === TEACHER_ROUTE.STUDENTS && studentId ? (
        <StudentCard
          data={data}
          actions={actions}
          key={studentId}
          studentId={studentId}
          openMode={openMode}
          openHomework={openHomework}
          openLesson={openLesson}
          openStudent={openStudent}
          onBack={clearDetails}
        />
      ) : null}
      {screen === TEACHER_ROUTE.STUDENTS && !mode && !studentId ? (
        <StudentsList data={data} openStudent={openStudent} openCreate={() => openMode('create-student', TEACHER_ROUTE.STUDENTS)} />
      ) : null}

      {screen === TEACHER_ROUTE.SCHEDULE && mode === 'create-lesson' ? <CreateLesson data={data} actions={actions} context={context} onBack={clearDetails} /> : null}
      {screen === TEACHER_ROUTE.SCHEDULE && lessonId ? (
        <LessonDetail
          data={data}
          actions={actions}
          lessonId={lessonId}
          openMode={openMode}
          onBack={() => setLessonId(null)}
        />
      ) : null}
      {screen === TEACHER_ROUTE.SCHEDULE && !mode && !lessonId ? (
        <ScheduleScreen data={data} openCreate={(nextContext = {}) => openMode('create-lesson', TEACHER_ROUTE.SCHEDULE, nextContext)} openLesson={openLesson} />
      ) : null}

      {screen === TEACHER_ROUTE.HOMEWORK && mode === 'create-homework' ? <CreateHomework data={data} actions={actions} context={context} onBack={clearDetails} /> : null}
      {screen === TEACHER_ROUTE.HOMEWORK && homeworkId ? <HomeworkDetail data={data} actions={actions} homeworkId={homeworkId} onBack={() => setHomeworkId(null)} /> : null}
      {screen === TEACHER_ROUTE.HOMEWORK && !mode && !homeworkId ? <HomeworkList data={data} openCreate={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK)} openHomework={openHomework} /> : null}

      {screen === TEACHER_ROUTE.MATERIALS && mode === 'upload-material' ? <UploadMaterial data={data} actions={actions} context={context} onBack={clearDetails} /> : null}
      {screen === TEACHER_ROUTE.MATERIALS && !mode ? (
        <MaterialsList
          data={data}
          actions={actions}
          openUpload={(nextContext = {}) => openMode('upload-material', TEACHER_ROUTE.MATERIALS, nextContext)}
          openLesson={openLesson}
          openHomework={openHomework}
          openStudent={openStudent}
        />
      ) : null}

      {screen === TEACHER_ROUTE.PROFILE ? <TeacherProfile data={data} actions={actions} onLogout={onLogout} /> : null}
      {screen === TEACHER_ROUTE.NOTIFICATIONS ? <CollectionPagination data={data} actions={actions} resource="notifications" label="уведомлений" /> : null}
      {screen === TEACHER_ROUTE.STUDENTS && !studentId && !mode ? <CollectionPagination data={data} actions={actions} resource="students" label="учеников" /> : null}
      {screen === TEACHER_ROUTE.SCHEDULE && !lessonId && !mode ? <CollectionPagination data={data} actions={actions} resource="lessons" label="уроков" /> : null}
      {screen === TEACHER_ROUTE.HOMEWORK && !homeworkId && !mode ? <CollectionPagination data={data} actions={actions} resource="homeworks" label="домашних заданий" /> : null}
      {screen === TEACHER_ROUTE.MATERIALS && !mode ? <CollectionPagination data={data} actions={actions} resource="materials" label="тем" /> : null}
      {['create-lesson', 'create-homework'].includes(mode) ? <>
        <CollectionPagination data={data} actions={actions} resource="students" label="учеников" />
        <CollectionPagination data={data} actions={actions} resource="materials" label="тем" />
      </> : null}
      {screen === TEACHER_ROUTE.HOME && !mode ? <div className="dashboard-pagination">
        {['students', 'lessons', 'homeworks'].filter((key) => data.pagination?.[key]?.total > data[key].length || data.pagination?.[key]?.error).map((resource) => <CollectionPagination key={resource} data={data} actions={actions} resource={resource} label={{ students: 'учеников', lessons: 'уроков', homeworks: 'домашних заданий' }[resource]} />)}
      </div> : null}
    </AppShell>
  );
}
