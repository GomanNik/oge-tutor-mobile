/*
 * OGE Tutor App — selectors.
 * Selectors never fall back to a random first entity; missing data is handled explicitly by screens.
 */
export function selectStudent(data, id) {
  return data.students.find((item) => item.id === id) || null;
}

export function selectHomework(data, id) {
  return data.homeworks.find((item) => item.id === id) || null;
}

export function selectLesson(data, id) {
  return data.lessons.find((item) => item.id === id) || null;
}

export function selectStudentHomeworks(data, studentId) {
  return data.homeworks.filter((item) => item.studentId === studentId);
}

export function selectStudentLessons(data, studentId) {
  return data.lessons.filter((item) => item.studentId === studentId);
}

export function selectTeacherByEmail(data, email) {
  return email.toLowerCase() === data.teacher.email.toLowerCase() ? data.teacher : null;
}

export function selectStudentByEmail(data, email) {
  return data.students.find((item) => item.email.toLowerCase() === email.toLowerCase()) || null;
}
