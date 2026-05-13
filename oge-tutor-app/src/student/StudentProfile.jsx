/*
 * OGE Tutor App — student profile wrapper.
 * Uses the shared profile module and separate backend profile/account/security actions.
 */
import React from 'react';
import ProfileScreen from '../profile/ProfileScreen.jsx';

export default function StudentProfile({ student, actions, updateStudent, onLogout }) {
  return (
    <ProfileScreen
      profile={student}
      role="student"
      onSaveVisual={updateStudent}
      onSaveAccount={(payload) => actions.updateStudentAccount(student.id, payload)}
      onSaveSecurity={(payload) => actions.changeStudentPassword(student.id, payload)}
      onSaveNotifications={(payload) => actions.updateStudentNotifications(student.id, payload)}
      onLogout={onLogout}
    />
  );
}
