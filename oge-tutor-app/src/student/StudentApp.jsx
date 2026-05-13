/*
 * OGE Tutor App — student cabinet router.
 * Student screens use stable route ids instead of Russian UI labels.
 */
import React, { useState } from 'react';
import { STUDENT_ROUTE } from '../api/contracts.js';
import { AppShell, Card } from '../shared/ui.jsx';
import { STUDENT_NAV_ITEMS } from '../shared/constants.js';
import { selectStudent, selectStudentHomeworks, selectStudentLessons } from '../app/selectors.js';
import StudentHome from './StudentHome.jsx';
import { StudentHomeworkDetail, StudentHomeworkList } from './StudentHomework.jsx';
import { StudentLessonDetail, StudentLessons } from './StudentLessons.jsx';
import { StudentMaterialTopic, StudentMaterials } from './StudentMaterials.jsx';
import { StudentProgress, WeakTaskDetail } from './StudentProgress.jsx';
import StudentProfile from './StudentProfile.jsx';

export default function StudentApp({ data, actions, user, onLogout }) {
  const [screen, setScreen] = useState(STUDENT_ROUTE.HOME);
  const [homeworkId, setHomeworkId] = useState(null);
  const [topicId, setTopicId] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [weakTask, setWeakTask] = useState(null);
  const [returnWeakTask, setReturnWeakTask] = useState(null);
  const student = selectStudent(data, user.id);

  if (!student) {
    return <Card><strong>Профиль ученика не найден.</strong><p className="subtitle">Выйдите и войдите заново или обратитесь к преподавателю.</p></Card>;
  }

  const homeworks = selectStudentHomeworks(data, student.id);
  const lessons = selectStudentLessons(data, student.id);

  function navigate(next) {
    setScreen(next);
    setHomeworkId(null);
    setTopicId(null);
    setLessonId(null);
    setWeakTask(null);
    setReturnWeakTask(null);
  }

  function updateStudent(patch) {
    return actions.updateStudentProfile(student.id, patch);
  }

  function submitHomework(id, payload) {
    return actions.submitHomeworkSolution(id, payload);
  }

  return (
    <AppShell navItems={STUDENT_NAV_ITEMS} active={screen} onNavigate={navigate}>
      {screen === STUDENT_ROUTE.HOME && <StudentHome student={student} lessons={lessons} homeworks={homeworks} onNavigate={navigate} openWeakTask={(n) => { setWeakTask(n); setScreen(STUDENT_ROUTE.PROGRESS); }} />}
      {screen === STUDENT_ROUTE.HOMEWORK && !homeworkId && <StudentHomeworkList homeworks={homeworks} openHomework={setHomeworkId} />}
      {screen === STUDENT_ROUTE.HOMEWORK && homeworkId && <StudentHomeworkDetail homework={homeworks.find((item) => item.id === homeworkId)} onBack={() => { if (returnWeakTask) { setHomeworkId(null); setWeakTask(returnWeakTask); setReturnWeakTask(null); setScreen(STUDENT_ROUTE.PROGRESS); } else { setHomeworkId(null); } }} onSubmit={submitHomework} />}
      {screen === STUDENT_ROUTE.LESSONS && !lessonId && <StudentLessons lessons={lessons} openLesson={setLessonId} />}
      {screen === STUDENT_ROUTE.LESSONS && lessonId && <StudentLessonDetail lesson={lessons.find((item) => item.id === lessonId)} onBack={() => setLessonId(null)} />}
      {screen === STUDENT_ROUTE.MATERIALS && !topicId && <StudentMaterials materials={data.materials} openTopic={setTopicId} />}
      {screen === STUDENT_ROUTE.MATERIALS && topicId && <StudentMaterialTopic topic={data.materials.find((item) => item.id === topicId)} onBack={() => { if (returnWeakTask) { setTopicId(null); setWeakTask(returnWeakTask); setReturnWeakTask(null); setScreen(STUDENT_ROUTE.PROGRESS); } else { setTopicId(null); } }} />}
      {screen === STUDENT_ROUTE.PROGRESS && !weakTask && <StudentProgress student={student} homeworks={homeworks} materials={data.materials} openWeakTask={setWeakTask} />}
      {screen === STUDENT_ROUTE.PROGRESS && weakTask && <WeakTaskDetail taskNumber={weakTask} student={student} homeworks={homeworks} materials={data.materials} onBack={() => setWeakTask(null)} openHomework={(id) => { setReturnWeakTask(weakTask); setHomeworkId(id); setWeakTask(null); setScreen(STUDENT_ROUTE.HOMEWORK); }} openMaterial={(id) => { setReturnWeakTask(weakTask); setTopicId(id); setWeakTask(null); setScreen(STUDENT_ROUTE.MATERIALS); }} />}
      {screen === STUDENT_ROUTE.PROFILE && <StudentProfile student={student} actions={actions} updateStudent={updateStudent} onLogout={onLogout} />}
    </AppShell>
  );
}
