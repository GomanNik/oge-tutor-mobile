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

export default function TeacherApp({ data, actions, onLogout }) {
  const [screen, setScreen] = useState(TEACHER_ROUTE.HOME);
  const [mode, setMode] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [homeworkId, setHomeworkId] = useState(null);
  const [context, setContext] = useState({});
  const notifications = deriveTeacherNotifications(data);

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

  function openStudent(id) {
    setScreen(TEACHER_ROUTE.STUDENTS);
    setStudentId(id);
    setMode(null);
    setLessonId(null);
    setHomeworkId(null);
    setContext({});
  }

  function openLesson(id) {
    setScreen(TEACHER_ROUTE.SCHEDULE);
    setLessonId(id);
    setMode(null);
    setStudentId(null);
    setHomeworkId(null);
    setContext({});
  }

  function openHomework(id) {
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
      openHomework(item.homeworkId);
      return;
    }
    if (item.lessonId) {
      openLesson(item.lessonId);
      return;
    }
    if (item.studentId) {
      openStudent(item.studentId);
    }
  }

  return (
    <AppShell
      navItems={TEACHER_NAV_ITEMS}
      active={screen === TEACHER_ROUTE.NOTIFICATIONS ? TEACHER_ROUTE.HOME : screen}
      onNavigate={navigate}
      topTitle="Преподаватель"
      noticeCount={notifications.length}
      onOpenNotifications={() => navigate(TEACHER_ROUTE.NOTIFICATIONS)}
    >
      {screen === TEACHER_ROUTE.NOTIFICATIONS ? (
        <NotificationInbox
          notifications={notifications}
          onBack={() => navigate(TEACHER_ROUTE.HOME)}
          onOpen={openNotification}
        />
      ) : null}

      {screen === TEACHER_ROUTE.HOME && !mode ? (
        <TeacherHome
          data={data}
          notifications={notifications}
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
    </AppShell>
  );
}
