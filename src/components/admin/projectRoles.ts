// Project roles and the date helpers the two admin access views share —
// /admin/users/:userId (UserMemberships, D211) and /admin/projects (ProjectAccess, D215).

export const PROJECT_ROLES = ['owner', 'editor', 'analyst', 'viewer'] as const;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const day = (iso: string) => new Date(iso).toLocaleDateString();
/** A date input's day → the END of that day, local time, as an instant. */
export const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);
export const toDateInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
