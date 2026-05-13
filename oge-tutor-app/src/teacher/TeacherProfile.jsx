/*
 * OGE Tutor App — teacher profile wrapper.
 * Uses the shared profile module and separate backend profile/account/security actions.
 */
import React from 'react';
import ProfileScreen from '../profile/ProfileScreen.jsx';

export default function TeacherProfile({ data, actions, onLogout }) {
  return (
    <ProfileScreen
      profile={data.teacher}
      role="teacher"
      onSaveVisual={actions.updateTeacherProfile}
      onSaveAccount={actions.updateTeacherAccount}
      onSaveSecurity={actions.changeTeacherPassword}
      onSaveNotifications={actions.updateTeacherNotifications}
      onLogout={onLogout}
    />
  );
}
