/**
 * SC Intelligences — chat management (screens 14/15/16/17, mobile handoff
 * pass). Mobile translation of `ChatSidebar.tsx` + `SidebarPanels.tsx`: the
 * same thread store, the same folders/pin/archive/delete actions, laid out as
 * a pushed screen with a bottom-sheet actions menu instead of a hover menu.
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { MobilePageHeader, MobileHeaderSearch, MobilePanel, MobileRow, MobileButton } from "@/components/mobile";
import { MobileSheet, MobileSheetRow } from "@/components/shared/MobileSheet";
import type { Thread, ChatFolder } from "@/hooks/useChatThreads";
import { QUICK_THREAD_ID } from "@/hooks/useChatThreads";
import { IntelBadge } from "../primitives";
import { personaToIntelId } from "../intel";

export interface ChatsScreenProps {
  threads: Thread[];
  projects: Array<{ id: string; name: string }>;
  onBack: () => void;
  onOpenThread: (id: string) => void;
  onOpenFiles: () => void;
  folders: ChatFolder[];
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveToFolder: (threadId: string, folderId: string | null) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onAttachProject: (id: string, projectId: string | null) => void;
  onTogglePin: (threadId: string, pinned: boolean) => void;
  onToggleArchive: (threadId: string, archived: boolean) => void;
  onBulkSetFlags: (ids: string[], flags: { pinned?: boolean | null; archived?: boolean | null }) => void;
  onBulkDelete: (ids: string[]) => void;
}

export function ChatsScreen({
  threads,
  projects,
  onBack,
  onOpenThread,
  onOpenFiles,
  folders,
  onCreateFolder,
  onMoveToFolder,
  onDeleteThread,
  onRenameThread,
  onAttachProject,
  onTogglePin,
  onToggleArchive,
  onBulkSetFlags,
  onBulkDelete,
}: ChatsScreenProps) {
  const [query, setQuery] = React.useState("");
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [openSheetFor, setOpenSheetFor] = React.useState<string | null>(null);
  const [movingId, setMovingId] = React.useState<string | null>(null);
  const [attachingId, setAttachingId] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [folderDraft, setFolderDraft] = React.useState("");
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const notQuick = (t: Thread) => t.id !== QUICK_THREAD_ID;
  const q = query.trim().toLowerCase();
  const matches = (t: Thread) => !q || t.title.toLowerCase().includes(q);

  const { pinned, projectGroups, folderList, recent, archived, total } = React.useMemo(() => {
    const live = threads.filter((t) => !t.archived && notQuick(t) && matches(t));
    const pinnedList = live.filter((t) => t.pinned);
    const byProject: Record<string, Thread[]> = {};
    live.forEach((t) => {
      if (t.projectId) (byProject[t.projectId] ??= []).push(t);
    });
    const groups = projects
      .map((p) => ({ id: p.id, label: p.name, rows: byProject[p.id] ?? [] }))
      .filter((g) => g.rows.length > 0);
    const grouped = new Set<string>([...pinnedList.map((t) => t.id), ...Object.values(byProject).flat().map((t) => t.id)]);
    const fList = folders.map((f) => {
      const rows = live.filter((t) => t.folderId === f.id);
      rows.forEach((r) => grouped.add(r.id));
      return { id: f.id, name: f.name, rows };
    });
    return {
      pinned: pinnedList,
      projectGroups: groups,
      folderList: fList,
      recent: live.filter((t) => !grouped.has(t.id)),
      archived: threads.filter((t) => t.archived && notQuick(t) && matches(t)),
      total: threads.filter(notQuick).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, projects, folders, q]);

  const openThreadForActions = threads.find((t) => t.id === openSheetFor) ?? null;
  const renamingThread = threads.find((t) => t.id === renamingId) ?? null;

  const toggleSelected = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const Row = ({ thread }: { thread: Thread }) => {
    const intelId = personaToIntelId(thread.agentId);
    return (
      <MobileRow
        leading={
          selectMode ? (
            <span
              aria-hidden
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] border"
              style={{
                borderColor: selected.includes(thread.id) ? "#18181b" : "#d4d4d4",
                background: selected.includes(thread.id) ? "#18181b" : "transparent",
              }}
            >
              {selected.includes(thread.id) && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
          ) : (
            <IntelBadge id={intelId} />
          )
        }
        label={thread.title}
        sub={thread.pinned ? "pinned" : undefined}
        onClick={selectMode ? () => toggleSelected(thread.id) : () => onOpenThread(thread.id)}
        chevron={!selectMode}
        trailing={
          !selectMode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenSheetFor(thread.id);
              }}
              aria-label={`Options for ${thread.title}`}
              className="grid h-11 w-11 shrink-0 place-items-center text-[15px] text-[#9a9a9a]"
            >
              ⋯
            </button>
          )
        }
      />
    );
  };

  return (
    <>
      <MobilePageHeader
        variant="detail"
        title={selectMode ? `${selected.length} selected` : "Chats"}
        subtitle={selectMode ? `of ${total} chats` : undefined}
        onBack={onBack}
        meta={
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected([]);
              setConfirmDelete(false);
            }}
            className="font-mono text-[11px] text-[#525252]"
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        }
      >
        {!selectMode && <MobileHeaderSearch value={query} onChange={setQuery} placeholder="Search chats" />}
      </MobilePageHeader>

      <div className="flex flex-col gap-3 px-[var(--m-gutter)] pb-4">
        {pinned.length > 0 && (
          <MobilePanel label="Pinned" counter={pinned.length} accent="#e0930b">
            {pinned.map((t) => (
              <Row key={t.id} thread={t} />
            ))}
          </MobilePanel>
        )}

        {projectGroups.map((g) => (
          <MobilePanel key={g.id} label={g.label} counter={g.rows.length}>
            {g.rows.map((t) => (
              <Row key={t.id} thread={t} />
            ))}
          </MobilePanel>
        ))}

        <MobilePanel
          label="My folders"
          counter={folderList.reduce((n, f) => n + f.rows.length, 0)}
        >
          {folderList.length === 0 && !creatingFolder && (
            <div className="px-3 py-3 text-[13px] text-[#525252]">No folders yet.</div>
          )}
          {folderList.map((f) => (
            <div key={f.id} className="border-b border-[#e8e8ea] last:border-b-0">
              <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8a8a]">
                {f.name} · {f.rows.length}
              </div>
              {f.rows.map((t) => (
                <Row key={t.id} thread={t} />
              ))}
            </div>
          ))}
          {creatingFolder ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                autoFocus
                value={folderDraft}
                onChange={(e) => setFolderDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && folderDraft.trim()) {
                    onCreateFolder(folderDraft.trim());
                    setFolderDraft("");
                    setCreatingFolder(false);
                  }
                  if (e.key === "Escape") setCreatingFolder(false);
                }}
                placeholder="Folder name"
                className="h-9 min-h-11 flex-1 rounded-[4px] border border-[#18181b] px-2.5 text-[13px] outline-none md:min-h-0"
              />
              <MobileButton
                weight="secondary"
                compact
                onClick={() => {
                  if (folderDraft.trim()) onCreateFolder(folderDraft.trim());
                  setFolderDraft("");
                  setCreatingFolder(false);
                }}
              >
                Add
              </MobileButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingFolder(true)}
              className="flex min-h-11 w-full items-center gap-1.5 px-3 text-[13px] font-medium text-[#525252]"
            >
              <Plus className="h-3.5 w-3.5" /> New folder
            </button>
          )}
        </MobilePanel>

        <MobilePanel label="Recent" counter={recent.length}>
          {recent.length === 0 && <div className="px-3 py-4 text-[13.5px] text-[#525252]">Nothing here yet.</div>}
          {recent.map((t) => (
            <Row key={t.id} thread={t} />
          ))}
        </MobilePanel>

        <MobileRow onClick={() => setArchiveOpen((v) => !v)} label="Archive" sub={`${archived.length} chats`} chevron />
        {archiveOpen && archived.length > 0 && (
          <MobilePanel label="Archived" counter={archived.length}>
            {archived.map((t) => (
              <Row key={t.id} thread={t} />
            ))}
          </MobilePanel>
        )}

        <MobileRow onClick={onOpenFiles} label="Files & project memory" chevron />
      </div>

      {/* 16 · select mode — pinned bulk bar. */}
      {selectMode && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-[#d4d4d4] bg-white px-[var(--m-gutter)] pb-2.5 pt-2">
          <MobileButton
            weight="secondary"
            block
            onClick={() => {
              onBulkSetFlags(selected, { pinned: true });
              setSelectMode(false);
              setSelected([]);
            }}
          >
            Pin
          </MobileButton>
          <MobileButton
            weight="secondary"
            block
            onClick={() => {
              onBulkSetFlags(selected, { archived: true });
              setSelectMode(false);
              setSelected([]);
            }}
          >
            Archive
          </MobileButton>
          {confirmDelete ? (
            <MobileButton
              block
              className="bg-[#bf2330] active:bg-[#a01d29]"
              onClick={() => {
                onBulkDelete(selected);
                setSelectMode(false);
                setSelected([]);
                setConfirmDelete(false);
              }}
            >
              Confirm ({selected.length})
            </MobileButton>
          ) : (
            <MobileButton weight="secondary" block className="border-[#f0c7cb] text-[#bf2330]" onClick={() => setConfirmDelete(true)}>
              Delete
            </MobileButton>
          )}
        </div>
      )}

      {/* 15 · thread actions sheet. */}
      <MobileSheet
        open={Boolean(openThreadForActions)}
        title={openThreadForActions?.title ?? ""}
        onClose={() => setOpenSheetFor(null)}
      >
        {openThreadForActions && (
          <>
            <MobileSheetRow
              title="Rename"
              onClick={() => {
                setRenamingId(openThreadForActions.id);
                setRenameValue(openThreadForActions.title);
                setOpenSheetFor(null);
              }}
            />
            <MobileSheetRow
              title={openThreadForActions.pinned ? "Unpin" : "Pin"}
              onClick={() => {
                onTogglePin(openThreadForActions.id, !openThreadForActions.pinned);
                setOpenSheetFor(null);
              }}
            />
            <MobileSheetRow
              title="Move to folder"
              meta={folders.find((f) => f.id === openThreadForActions.folderId)?.name ?? "No folder"}
              onClick={() => {
                setMovingId(openThreadForActions.id);
                setOpenSheetFor(null);
              }}
            />
            <MobileSheetRow
              title="Attach to project"
              meta={projects.find((p) => p.id === openThreadForActions.projectId)?.name ?? "No project"}
              onClick={() => {
                setAttachingId(openThreadForActions.id);
                setOpenSheetFor(null);
              }}
            />
            <MobileSheetRow
              title={openThreadForActions.archived ? "Unarchive" : "Archive"}
              onClick={() => {
                onToggleArchive(openThreadForActions.id, !openThreadForActions.archived);
                setOpenSheetFor(null);
              }}
            />
            <MobileSheetRow
              title="Delete"
              danger
              onClick={() => {
                onDeleteThread(openThreadForActions.id);
                setOpenSheetFor(null);
              }}
            />
            <p className="px-3 pb-4 pt-1 text-[12px] leading-[1.45] text-[#525252] [text-wrap:pretty]">
              Deleting removes the thread and its answers. Accepted proposals and the policy versions they wrote stay.
            </p>
          </>
        )}
      </MobileSheet>

      {/* 17 · rename. */}
      <MobileSheet open={Boolean(renamingThread)} title="Rename chat" onClose={() => setRenamingId(null)}>
        <div className="p-3.5">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renamingId && renameValue.trim()) {
                onRenameThread(renamingId, renameValue.trim());
                setRenamingId(null);
              }
            }}
            className="h-[46px] w-full rounded-[4px] border border-[#18181b] px-3 text-[15px] outline-none"
            style={{ boxShadow: "0 0 0 3px rgba(24,24,27,.09)" }}
          />
          <MobileButton
            block
            className="mt-3"
            onClick={() => {
              if (renamingId && renameValue.trim()) onRenameThread(renamingId, renameValue.trim());
              setRenamingId(null);
            }}
          >
            Save
          </MobileButton>
        </div>
      </MobileSheet>

      {/* Move to folder. */}
      <MobileSheet open={Boolean(movingId)} title="Move to folder" onClose={() => setMovingId(null)}>
        <MobileSheetRow
          title="No folder"
          checked={movingId != null && !threads.find((t) => t.id === movingId)?.folderId}
          onClick={() => {
            if (movingId) onMoveToFolder(movingId, null);
            setMovingId(null);
          }}
        />
        {folders.map((f) => (
          <MobileSheetRow
            key={f.id}
            title={f.name}
            checked={movingId != null && threads.find((t) => t.id === movingId)?.folderId === f.id}
            onClick={() => {
              if (movingId) onMoveToFolder(movingId, f.id);
              setMovingId(null);
            }}
          />
        ))}
      </MobileSheet>

      {/* Attach to project. */}
      <MobileSheet open={Boolean(attachingId)} title="Attach to project" onClose={() => setAttachingId(null)}>
        <MobileSheetRow
          title="No project"
          checked={attachingId != null && !threads.find((t) => t.id === attachingId)?.projectId}
          onClick={() => {
            if (attachingId) onAttachProject(attachingId, null);
            setAttachingId(null);
          }}
        />
        {projects.map((p) => (
          <MobileSheetRow
            key={p.id}
            title={p.name}
            checked={attachingId != null && threads.find((t) => t.id === attachingId)?.projectId === p.id}
            onClick={() => {
              if (attachingId) onAttachProject(attachingId, p.id);
              setAttachingId(null);
            }}
          />
        ))}
      </MobileSheet>
    </>
  );
}
