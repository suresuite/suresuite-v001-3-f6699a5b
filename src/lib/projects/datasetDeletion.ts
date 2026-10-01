/**
 * Deleting ONE dataset of a project — the trash button on each tab of the project
 * data viewer. §4 D266, `20261001000024`.
 *
 * A wrong upload could not be replaced: the deep-tier node insert refuses a uid
 * already stored, the edge insert appends beside the old edges, and the only
 * function that removed either table deleted the whole project. The server half
 * is `delete_project_dataset`; this module says, once, which `p_dataset` each tab
 * sends and what the confirmation tells the person before they press it.
 */
import type { ConfirmFn } from '@/components/shared/confirm/useConfirm';

export type DatasetTab = 'bom' | 'inbound' | 'outbound' | 'nodeList' | 'deepNodes' | 'deepEdges' | 'deepSummary';

export interface DatasetDeleteTarget {
  /** The `p_dataset` argument `delete_project_dataset` takes. */
  dataset: string;
  /** What the confirmation counts. */
  noun: string;
  /** Clears uploaded fields rather than deleting rows. */
  clears?: true;
  /** What else the person should know before confirming. */
  note?: string;
}

const LANES_REBUILD = 'Supply-chain lanes and the node list rebuild from what remains.';

// The Node List tab CLEARS the uploaded fields and keeps the nodes: the nodes are
// derived from the lanes, so deleting them would only bring them back without
// anything the person had uploaded.
export const DATASET_DELETE_TARGETS: Record<DatasetTab, DatasetDeleteTarget> = {
  bom: { dataset: 'bom', noun: 'BOM rows', note: LANES_REBUILD },
  inbound: { dataset: 'inbound', noun: 'inbound rows', note: LANES_REBUILD },
  outbound: { dataset: 'outbound', noun: 'outbound rows', note: LANES_REBUILD },
  nodeList: {
    dataset: 'node_list_uploads',
    noun: 'nodes',
    clears: true,
    note: 'The nodes stay, because they come from your lanes. Only the locations and descriptions you uploaded are cleared.',
  },
  deepNodes: {
    dataset: 'network_nodes',
    noun: 'deep-tier node rows',
    note: 'Edges that point at these nodes are not deleted. Delete Deep Edges too if you are replacing the network.',
  },
  deepEdges: { dataset: 'network_edges', noun: 'deep-tier edge rows' },
  deepSummary: { dataset: 'network_summary', noun: 'deep-tier summary rows' },
};

export interface NodeListUploadFields {
  description_text?: string | null;
  location_text?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** True when a node carries something `upload_node_list_data` wrote. */
export const hasUploadedNodeFields = (row: NodeListUploadFields): boolean =>
  row.description_text != null || row.location_text != null || row.latitude != null || row.longitude != null;

/** How many rows the button would act on: every row, or on the Node List tab the
 *  nodes that carry uploaded fields (the server counts the same way). */
export function deletableCount(tab: DatasetTab, rows: readonly unknown[]): number {
  return DATASET_DELETE_TARGETS[tab].clears
    ? (rows as NodeListUploadFields[]).filter(hasUploadedNodeFields).length
    : rows.length;
}

/** The button's label and tooltip. */
export function datasetDeleteLabel(tab: DatasetTab, label: string): string {
  return DATASET_DELETE_TARGETS[tab].clears ? `Clear uploaded ${label} fields` : `Delete ${label} data`;
}

/** The one confirmation, through `useConfirm()`. */
export function confirmDatasetDeletion(
  confirm: ConfirmFn,
  o: { tab: DatasetTab; label: string; projectName: string; count: number },
): Promise<boolean> {
  const t = DATASET_DELETE_TARGETS[o.tab];
  const lead = `${datasetDeleteLabel(o.tab, o.label)} for "${o.projectName}"?`;
  const effect = t.clears
    ? `This clears the location and description of ${o.count} ${t.noun}.`
    : `This permanently deletes ${o.count} ${t.noun}.`;
  return confirm({
    message: [
      lead,
      effect,
      t.note,
      'Network metrics computed from this data become stale until you re-run analysis.',
      'This cannot be undone.',
    ]
      .filter(Boolean)
      .join(' '),
    lead,
    title: lead,
    actionLabel: t.clears ? 'Clear fields' : `Delete ${o.label}`,
  });
}

/** The success message, from the server's count rather than the client's. */
export function datasetDeletedMessage(tab: DatasetTab, projectName: string, count: number): string {
  const t = DATASET_DELETE_TARGETS[tab];
  return t.clears
    ? `Cleared uploaded fields on ${count} ${t.noun} in "${projectName}".`
    : `Deleted ${count} ${t.noun} from "${projectName}". You can upload a corrected file now.`;
}
