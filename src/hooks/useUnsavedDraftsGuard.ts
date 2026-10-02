/**
 * Leaving /policies with unsaved edits asks first — PLAN.md §23 WP 13.4.
 *
 * An unsaved edit on /policies is a DRAFT in the page and reaches nothing: not the
 * policy version, not a run. The grid used to drop every draft silently when the
 * stage changed or the page was left, so a planner could type a cost, switch to
 * the Plant stage, and run — believing the run used it. While drafts exist this
 * asks before:
 *
 *   · closing or reloading the tab (`beforeunload`, the browser's own dialog);
 *   · any in-app navigation — the app mounts a `BrowserRouter`, which has no
 *     `useBlocker`, so the router's navigator is wrapped for as long as there are
 *     drafts (the react-router v6 `usePrompt` pattern) and restored after;
 *   · switching stage on the page (the caller asks with `confirmLeave`).
 *
 * Not covered, and said: the browser's Back button (a `popstate` cannot be held
 * by a BrowserRouter); the drafts are lost there, as before.
 */
import { useCallback, useContext, useEffect } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { useConfirm } from "@/components/shared/confirm/useConfirm";
import type { ConfirmRequest } from "@/components/shared/confirm/useConfirm";

export function unsavedDraftsRequest(lines: number): ConfirmRequest {
  return {
    message:
      `You have unsaved changes on ${lines} line(s). They are drafts in this page and reach no ` +
      "policy version and no run. Leave without saving them?",
    title: "Leave without saving?",
    actionLabel: "Leave without saving",
    cancelLabel: "Stay",
  };
}

type Nav = { push: (...a: unknown[]) => void; replace: (...a: unknown[]) => void };

/** Hold a router navigator's `push`/`replace` behind `ask`; returns the undo.
 *  Pure, so the hold is tested without a DOM (`unsavedDraftsGuard.test.ts`). */
export function holdNavigator(nav: Nav, ask: () => Promise<boolean>): () => void {
  const push = nav.push;
  const replace = nav.replace;
  const held =
    (fn: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      void ask().then((ok) => {
        if (ok) fn.apply(nav, args);
      });
    };
  nav.push = held(push);
  nav.replace = held(replace);
  return () => {
    nav.push = push;
    nav.replace = replace;
  };
}

export function useUnsavedDraftsGuard(dirtyLines: number): { confirmLeave: () => Promise<boolean> } {
  const confirm = useConfirm();
  const { navigator } = useContext(UNSAFE_NavigationContext);

  useEffect(() => {
    if (!dirtyLines) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirtyLines]);

  useEffect(() => {
    if (!dirtyLines) return;
    return holdNavigator(navigator as unknown as Nav, () => confirm({ ...unsavedDraftsRequest(dirtyLines) }));
  }, [dirtyLines, navigator, confirm]);

  const confirmLeave = useCallback(
    async () => (dirtyLines ? confirm({ ...unsavedDraftsRequest(dirtyLines) }) : true),
    [dirtyLines, confirm],
  );
  return { confirmLeave };
}
