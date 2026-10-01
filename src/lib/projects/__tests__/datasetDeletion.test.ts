/**
 * §4 D266 — one dataset at a time, from the project data viewer.
 *
 * What a tab's trash button sends and says is authored once, in
 * `datasetDeletion.ts`. These assertions hold it to the server: every
 * `p_dataset` it sends is a branch of the LIVE `delete_project_dataset` (the
 * last migration that defines it), so a renamed branch fails here rather than as
 * `invalid_dataset` in front of a user. The behaviour of each branch against a
 * real database is `supabase/rehearsal/690`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConfirmRequest } from '@/components/shared/confirm/useConfirm';
import {
  DATASET_DELETE_TARGETS,
  confirmDatasetDeletion,
  datasetDeleteLabel,
  datasetDeletedMessage,
  deletableCount,
  type DatasetTab,
} from '../datasetDeletion';

const MIGRATIONS = path.resolve(__dirname, '../../../../supabase/migrations');

function liveDeleteProjectDataset(): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files.reverse()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const at = sql.search(/CREATE OR REPLACE FUNCTION public\.delete_project_dataset\(/);
    if (at === -1) continue;
    const end = sql.indexOf('$$;', at);
    return { file, body: sql.slice(at, end) };
  }
  throw new Error('no migration defines delete_project_dataset');
}

const TABS = Object.keys(DATASET_DELETE_TARGETS) as DatasetTab[];

describe('D266 — every tab sends a dataset the live function accepts', () => {
  const { file, body } = liveDeleteProjectDataset();

  it.each(TABS)('%s', (tab) => {
    const name = DATASET_DELETE_TARGETS[tab].dataset;
    // A branch reads `lower(p_dataset) = 'x'` or `lower(p_dataset) IN (..., 'x', ...)`.
    const branch = new RegExp(`lower\\(p_dataset\\)\\s*(=\\s*'${name}'|IN\\s*\\([^)]*'${name}')`);
    expect(body, `${file} has no branch for '${name}'`).toMatch(branch);
  });

  it('the live definition keeps the owner-or-admin gate and the audit actor', () => {
    expect(body).toContain('set_current_user_context(p_user_id, p_user_email)');
    expect(body).toMatch(/v_role IN \('admin', 'super_admin'\)/);
    expect(body).toContain("RAISE EXCEPTION 'forbidden'");
  });

  it("'all' still deletes only the lane sources — the deep tier and the node list are not in it", () => {
    const all = body.slice(body.indexOf("lower(p_dataset) = 'all'"));
    expect(all).not.toMatch(/network_nodes|network_edges|network_summary|node_list/);
  });

  it('the viewer sends the target, not a literal of its own', () => {
    const viewer = readFileSync(path.resolve(__dirname, '../../../components/ProjectDataViewer.tsx'), 'utf8');
    expect(viewer).toContain("supabase.rpc('delete_project_dataset'");
    expect(viewer).toContain('p_dataset: target.dataset');
    // The gate on the button is the browser's copy of the server's rule.
    expect(viewer).toContain("rights.can('data_edit_inputs')");
  });
});

describe('D266 — what the person is told', () => {
  it('counts every row, except on Node List where it counts nodes carrying uploaded fields', () => {
    expect(deletableCount('deepNodes', [{}, {}, {}])).toBe(3);
    expect(
      deletableCount('nodeList', [
        { location_text: 'Hamburg, DE' },
        { latitude: 0 },
        { description_text: null, location_text: null, latitude: null, longitude: null },
        {},
      ]),
    ).toBe(2);
  });

  it('Node List clears; every other tab deletes', () => {
    for (const tab of TABS) {
      const label = datasetDeleteLabel(tab, 'X');
      expect(label).toBe(tab === 'nodeList' ? 'Clear uploaded X fields' : 'Delete X data');
    }
  });

  it('the confirmation names the project, the count, the consequence and that it cannot be undone', async () => {
    let asked: ConfirmRequest | null = null;
    const ok = await confirmDatasetDeletion(
      async (req) => {
        asked = req;
        return true;
      },
      { tab: 'deepNodes', label: 'Deep Nodes', projectName: 'Project A', count: 1240 },
    );
    expect(ok).toBe(true);
    expect(asked!.title).toBe('Delete Deep Nodes data for "Project A"?');
    expect(asked!.actionLabel).toBe('Delete Deep Nodes');
    expect(asked!.message).toContain('permanently deletes 1240 deep-tier node rows');
    expect(asked!.message).toMatch(/Edges that point at these nodes are not deleted/);
    expect(asked!.message).toMatch(/cannot be undone/);
  });

  it('a cancelled confirmation is reported as false', async () => {
    const ok = await confirmDatasetDeletion(async () => false, {
      tab: 'bom', label: 'BOM', projectName: 'P', count: 3,
    });
    expect(ok).toBe(false);
  });

  it('the success message uses the count the server returned', () => {
    expect(datasetDeletedMessage('deepEdges', 'Project A', 7)).toBe(
      'Deleted 7 deep-tier edge rows from "Project A". You can upload a corrected file now.',
    );
    expect(datasetDeletedMessage('nodeList', 'Project A', 2)).toBe('Cleared uploaded fields on 2 nodes in "Project A".');
  });
});
