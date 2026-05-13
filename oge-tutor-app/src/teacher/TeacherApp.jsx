/*
 * OGE Tutor App — teacher cabinet router.
 * Teacher screens use stable route ids instead of Russian UI labels.
 */
import React, { useState } from 'react';
import { TEACHER_ROUTE } from '../api/contracts.js';
import { AppShell } from '../shared/ui.jsx';
import { TEACHER_NAV_ITEMS } from '../shared/constants.js';
import TeacherHome from './TeacherHome.jsx';
import { CreateStudent, StudentCard, StudentsList } from './TeacherStudents.jsx';
import { CreateLesson, LessonDetail, LessonsList } from './TeacherLessons.jsx';
import { CreateHomework, HomeworkDetail, HomeworkList } from './TeacherHomework.jsx';
import { MaterialsList, UploadMaterial } from './TeacherMaterials.jsx';
import TeacherProfile from './TeacherProfile.jsx';

export default function TeacherApp({ data, actions, onLogout }) {
  const [screen, setScreen] = useState(TEACHER_ROUTE.HOME);
  const [mode, setMode] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [homeworkId, setHomeworkId] = useState(null);

  function clearDetails() {
    setMode(null);
    setStudentId(null);
    setLessonId(null);
    setHomeworkId(null);
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
  }

  function openLesson(id) {
    setScreen(TEACHER_ROUTE.LESSONS);
    setLessonId(id);
    setMode(null);
    setStudentId(null);
    setHomeworkId(null);
  }

  function openHomework(id) {
    setScreen(TEACHER_ROUTE.HOMEWORK);
    setHomeworkId(id);
    setMode(null);
    setStudentId(null);
    setLessonId(null);
  }

  function openMode(nextMode, target = screen) {
    setScreen(target);
    setMode(nextMode);
    setStudentId(null);
    setLessonId(null);
    setHomeworkId(null);
  }

  return (
    <AppShell navItems={TEACHER_NAV_ITEMS} active={screen} onNavigate={navigate}>
      {screen === TEACHER_ROUTE.HOME && !mode ? (
        <TeacherHome
          data={data}
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
          onBack={clearDetails}
        />
      ) : null}
      {screen === TEACHER_ROUTE.STUDENTS && !mode && !studentId ? (
        <StudentsList data={data} openStudent={openStudent} openCreate={() => openMode('create-student', TEACHER_ROUTE.STUDENTS)} />
      ) : null}

      {screen === TEACHER_ROUTE.LESSONS && mode === 'create-lesson' ? <CreateLesson data={data} actions={actions} onBack={clearDetails} onCreated={openLesson} /> : null}
      {screen === TEACHER_ROUTE.LESSONS && lessonId ? <LessonDetail data={data} actions={actions} lessonId={lessonId} onBack={() => setLessonId(null)} /> : null}
      {screen === TEACHER_ROUTE.LESSONS && !mode && !lessonId ? <LessonsList data={data} openCreate={() => openMode('create-lesson', TEACHER_ROUTE.LESSONS)} openLesson={openLesson} /> : null}

      {screen === TEACHER_ROUTE.HOMEWORK && mode === 'create-homework' ? <CreateHomework data={data} actions={actions} onBack={clearDetails} /> : null}
      {screen === TEACHER_ROUTE.HOMEWORK && homeworkId ? <HomeworkDetail data={data} actions={actions} homeworkId={homeworkId} onBack={() => setHomeworkId(null)} /> : null}
      {screen === TEACHER_ROUTE.HOMEWORK && !mode && !homeworkId ? <HomeworkList data={data} openCreate={() => openMode('create-homework', TEACHER_ROUTE.HOMEWORK)} openHomework={openHomework} /> : null}

      {screen === TEACHER_ROUTE.MATERIALS && mode === 'upload-material' ? <UploadMaterial data={data} actions={actions} onBack={clearDetails} /> : null}
      {screen === TEACHER_ROUTE.MATERIALS && !mode ? <MaterialsList data={data} actions={actions} openUpload={() => openMode('upload-material', TEACHER_ROUTE.MATERIALS)} /> : null}

      {screen === TEACHER_ROUTE.PROFILE ? <TeacherProfile data={data} actions={actions} onLogout={onLogout} /> : null}
    </AppShell>
  );
}
