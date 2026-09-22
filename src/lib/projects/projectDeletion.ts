/**
 * Deleting a project — ONE confirmation, stating what it removes.
 * Audit 2026-09-22 · F-27 · §4 D117, D170.
 *
 * D170 made the deletion itself honest (one transaction, and the page shows the
 * database's answer). What it left is the question the user answers BEFORE that:
 * "Delete project X and all of its data?" was written out at three call sites and
 * said nothing about what survives. The scope is not authored here —
 * `PROJECT_DELETION` is derived by `chains.mjs` (`deriveProjectDeletion`) from the
 * schema's foreign keys and `delete_project`'s own sweep, and it is what the
 * manual's `exporting-and-deleting` page publishes.
 */
import { PROJECT_DELETION } from '@/components/docs/generated/policy.generated';

const DETACHED_LABEL: Record<string, string> = {
  chat_threads: 'chat threads',
  user_files: 'uploaded files',
};

/** The one confirmation message. Every delete button uses it. */
export function deletionConfirmMessage(name: string): string {
  const { projectScoped, neither, detached } = PROJECT_DELETION;
  const deleted = projectScoped - neither.length - detached.length;
  const detachedText = detached.map((t) => DETACHED_LABEL[t] ?? t).join(' and ');
  return [
    `Delete project "${name}" and all of its data? This cannot be undone.`,
    '',
    `Deleted: its data across ${deleted} tables — uploaded datasets, the network, ` +
      'disruption scenarios, policy decisions, simulation runs and their results.',
    `Kept: your account's usage logs (${neither.join(', ')}).`,
    `Detached, not deleted: your ${detachedText} stay yours, no longer linked to the project.`,
  ].join('\n');
}

/** `window.confirm` with the one message. */
export function confirmProjectDeletion(name: string): boolean {
  return window.confirm(deletionConfirmMessage(name));
}
