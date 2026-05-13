/*
 * OGE Tutor App — shared avatar catalog.
 * UI primitives can render avatars without depending on the profile feature module.
 */
export const PROFILE_ICONS = Object.freeze([
  { id: 'bear', label: 'Мишка', icon: '🐻', preferredBg: 'blue' },
  { id: 'cat', label: 'Кошка', icon: '🐱', preferredBg: 'rose' },
  { id: 'dog', label: 'Собака', icon: '🐶', preferredBg: 'blue' },
  { id: 'fox', label: 'Лиса', icon: '🦊', preferredBg: 'amber' },
  { id: 'panda', label: 'Панда', icon: '🐼', preferredBg: 'slate' },
  { id: 'rabbit', label: 'Заяц', icon: '🐰', preferredBg: 'violet' },
  { id: 'owl', label: 'Сова', icon: '🦉', preferredBg: 'emerald' },
  { id: 'tiger', label: 'Тигр', icon: '🐯', preferredBg: 'amber' },
  { id: 'lion', label: 'Лев', icon: '🦁', preferredBg: 'amber' },
  { id: 'koala', label: 'Коала', icon: '🐨', preferredBg: 'slate' },
  { id: 'penguin', label: 'Пингвин', icon: '🐧', preferredBg: 'blue' },
  { id: 'unicorn', label: 'Единорог', icon: '🦄', preferredBg: 'violet' },
]);

export function getAvatarIcon(avatarId) {
  return PROFILE_ICONS.find((item) => item.id === avatarId || item.icon === avatarId) || null;
}
