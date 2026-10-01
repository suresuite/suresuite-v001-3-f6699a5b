/**
 * ResponsiveDialog — a shadcn `Dialog` that renders as the mobile bottom sheet on
 * phones (mobile redesign handoff §2.2).
 *
 * The parts mirror shadcn's one for one (`ResponsiveDialog`, `…Content`,
 * `…Header`, `…Title`, `…Description`, `…Footer`, `…Trigger`, `…Close`), so a
 * dialog moves over by renaming its imports. Above the mobile query each part
 * IS the original shadcn part, with the caller's props untouched: same DOM, same
 * classes, same behaviour. That is what keeps the desktop pixel-identical.
 *
 * On a phone the same Radix dialog keeps its focus trap, Escape and aria wiring
 * but takes the sheet's geometry:
 *  - anchored above the tab bar (flush to the bottom edge on a pushed route,
 *    which has no tab bar), white header, `#f4f4f5` body, 16px top radius and
 *    the skin's one shadow; the scrim is rgba(0,0,0,.32), no blur,
 *  - content-sized up to 76% of the space above the tab bar, or `size="full"`
 *    for data and long lists; a phone on its side always gets full, because
 *    76% of a 390px screen has no room left for content,
 *  - a 20px grab zone above the header; dragging it or the header down past
 *    DISMISS_PX closes,
 *  - the body is the ONLY scroll container; header and footer stay pinned
 *    (sticky) at either end of it,
 *  - nothing is focused on open — neither Radix's auto-focus nor a field's own
 *    `autoFocus` — so the keyboard appears only when the user taps a field,
 *  - a sheet opened from a sheet stacks with the same geometry and no second
 *    scrim.
 *
 * The caller's `className` on Content / Header / Footer / Title / Description
 * describes the desktop dialog (and `DIALOG_AS_SHEET`'s retired phone layout),
 * so the phone branch does not apply it. Use `mobileClassName` for the rare
 * phone-only tweak.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  MOBILE_TABBAR_BORDER,
  MOBILE_TABBAR_H,
  MOBILE_TABBAR_H_LANDSCAPE,
  isMobileRootRoute,
} from '@/components/MobileNav';
import { useIsLandscapePhone, useIsMobile } from '@/hooks/use-is-mobile';
import { useCompactChrome } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

/** Drag distance that dismisses instead of springing back — MobileSheet's. */
const DISMISS_PX = 90;

/** The skin's one shadow, under a bottom sheet (handoff §2.2). */
export const SHEET_SHADOW = '0 -6px 24px rgba(0,0,0,.14)';

interface SheetContext {
  mobile: boolean;
  /** How many responsive dialogs enclose this one; a nested sheet draws no scrim. */
  depth: number;
  requestClose: () => void;
  /** `env(safe-area-inset-bottom)` when the sheet reaches the bottom edge (no
   *  tab bar under it), else 0 — the footer pads by it. */
  safeBottom: string;
  drag: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  } | null;
}

const NO_DRAG = null;
const DESKTOP: SheetContext = { mobile: false, depth: 0, requestClose: () => undefined, safeBottom: '0px', drag: NO_DRAG };
const Ctx = React.createContext<SheetContext>(DESKTOP);

type RootProps = React.ComponentProps<typeof Dialog>;

export function ResponsiveDialog(props: RootProps) {
  const isMobile = useIsMobile();
  const parent = React.useContext(Ctx);
  const { open, defaultOpen, onOpenChange } = props;
  // The sheet closes itself on a drag, so it needs to drive `open` even for an
  // uncontrolled dialog (a `DialogTrigger` with no `open` prop).
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen ?? false);
  const controlled = open !== undefined;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (!controlled) setInnerOpen(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );
  const ctx = React.useMemo<SheetContext>(
    () => ({
      mobile: true,
      depth: parent.mobile ? parent.depth + 1 : 0,
      requestClose: () => setOpen(false),
      safeBottom: '0px',
      drag: NO_DRAG,
    }),
    [parent.mobile, parent.depth, setOpen],
  );

  if (!isMobile) {
    return (
      <Ctx.Provider value={DESKTOP}>
        <Dialog {...props} />
      </Ctx.Provider>
    );
  }
  return (
    <Ctx.Provider value={ctx}>
      <Dialog {...props} open={controlled ? open : innerOpen} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}

export const ResponsiveDialogTrigger = DialogTrigger;
export const ResponsiveDialogClose = DialogClose;

type ContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Phone only: `full` for data and long lists; content-sized otherwise. */
  size?: 'auto' | 'full';
  /** Phone-only classes for the sheet container. */
  mobileClassName?: string;
};

export const ResponsiveDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ContentProps
>(({ size = 'auto', mobileClassName, ...props }, ref) => {
  const { mobile } = React.useContext(Ctx);
  if (!mobile) return <DialogContent ref={ref} {...props} />;
  return <SheetContent forwardedRef={ref} size={size} mobileClassName={mobileClassName} {...props} />;
});
ResponsiveDialogContent.displayName = 'ResponsiveDialogContent';

function SheetContent({
  forwardedRef,
  size,
  mobileClassName,
  className: _desktopClassName,
  style,
  children,
  onOpenAutoFocus,
  ...props
}: Omit<ContentProps, 'size'> & {
  size: 'auto' | 'full';
  forwardedRef: React.ForwardedRef<React.ElementRef<typeof DialogPrimitive.Content>>;
}) {
  const parent = React.useContext(Ctx);
  const { pathname } = useLocation();
  const compact = useCompactChrome();
  const landscape = useIsLandscapePhone();
  const startY = React.useRef<number | null>(null);
  const travelled = React.useRef(0);
  const [dragY, setDragY] = React.useState(0);

  const onRoot = isMobileRootRoute(pathname);
  const barPx = (compact ? MOBILE_TABBAR_H_LANDSCAPE : MOBILE_TABBAR_H) + MOBILE_TABBAR_BORDER;
  const bottom = onRoot ? `calc(${barPx}px + env(safe-area-inset-bottom, 0px))` : '0px';
  const above = `(100dvh - ${bottom})`;
  const maxHeight = size === 'full' || landscape ? `calc(${above} - 28px)` : `calc(${above} * 0.76)`;
  const safeBottom = onRoot ? '0px' : 'env(safe-area-inset-bottom, 0px)';

  const { requestClose } = parent;
  const drag = React.useMemo<SheetContext['drag']>(
    () => ({
      onTouchStart: (e) => {
        startY.current = e.touches[0].clientY;
      },
      onTouchMove: (e) => {
        if (startY.current == null) return;
        // Downward only — an upward drag must not lift the sheet off its edge.
        travelled.current = Math.max(0, e.touches[0].clientY - startY.current);
        setDragY(travelled.current);
      },
      onTouchEnd: () => {
        const dismiss = travelled.current > DISMISS_PX;
        startY.current = null;
        travelled.current = 0;
        setDragY(0);
        if (dismiss) requestClose();
      },
    }),
    [requestClose],
  );
  const ctx = React.useMemo<SheetContext>(() => ({ ...parent, safeBottom, drag }), [parent, safeBottom, drag]);

  // A field's own `autoFocus` runs during React's commit, before Radix's focus
  // scope mounts — and when focus is already inside, Radix never fires
  // `onOpenAutoFocus` at all. So the sheet clears it here, as its node attaches
  // (children commit first), and the keyboard stays down until a tap.
  const setNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node && document.activeElement instanceof HTMLElement && node.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  return (
    <DialogPortal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-[45] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          // One scrim, however deep the stack.
          parent.depth === 0 ? 'bg-black/[.32]' : 'bg-transparent',
        )}
      />
      <DialogPrimitive.Content
        ref={setNode}
        {...props}
        onOpenAutoFocus={(e) => {
          onOpenAutoFocus?.(e);
          e.preventDefault();
        }}
        // Above the pinned action bar (z-40), below the tab bar (z-50) the
        // sheet stops short of — MobileSheet's layer.
        className={cn(
          'fixed inset-x-0 z-[45] flex flex-col overflow-hidden rounded-t-[16px] bg-[#f4f4f5] outline-none',
          'duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          mobileClassName,
        )}
        style={{
          ...style,
          bottom,
          maxHeight,
          boxShadow: SHEET_SHADOW,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? 'none' : 'transform 0.2s cubic-bezier(0.2,0,0,1)',
        }}
      >
        <div
          {...drag}
          aria-hidden
          className="flex h-5 shrink-0 items-center justify-center bg-white [touch-action:none]"
        >
          <span className="h-1 w-9 rounded-[2px] bg-[#d4d4d4]" />
        </div>
        <div
          data-sheet-scroll=""
          // 12px under the last item — unless a footer is pinned there, which
          // must sit flush on the sheet's bottom edge (padding under a sticky
          // footer is a strip the content scrolls through).
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-[var(--m-gutter)] pb-[var(--sheet-pb)] text-[14.5px] [-webkit-overflow-scrolling:touch] has-[[data-sheet-footer]]:pb-0"
          style={{ '--sheet-pb': `calc(12px + ${safeBottom})` } as React.CSSProperties}
        >
          <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function ResponsiveDialogHeader({
  className,
  mobileClassName,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { mobileClassName?: string }) {
  const { mobile, drag } = React.useContext(Ctx);
  if (!mobile) return <DialogHeader className={className} {...props}>{children}</DialogHeader>;
  return (
    <div
      {...props}
      {...drag}
      className={cn(
        // Sticky at the top of the one scroll container; bleeds to the sheet's
        // edges through the body's gutter.
        'sticky top-0 z-10 -mx-[var(--m-gutter)] flex items-start gap-2 border-b border-[#e8e8ea] bg-white pb-3 pl-[var(--m-gutter)] pr-1.5 text-left',
        mobileClassName,
      )}
    >
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
      <DialogPrimitive.Close
        aria-label="Close"
        title="Close"
        className="-mt-2.5 grid h-11 w-11 shrink-0 place-items-center text-[#525252] outline-none"
      >
        <X className="h-[18px] w-[18px]" />
      </DialogPrimitive.Close>
    </div>
  );
}

export const ResponsiveDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => {
  const { mobile } = React.useContext(Ctx);
  if (!mobile) return <DialogTitle ref={ref} className={className} {...props} />;
  return (
    <DialogPrimitive.Title
      ref={ref}
      {...props}
      // Wraps, never truncates: the title names the object.
      className="text-[17px] font-semibold leading-[1.25] tracking-[-0.019em] text-[#171717] [overflow-wrap:anywhere]"
    />
  );
});
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle';

export const ResponsiveDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const { mobile } = React.useContext(Ctx);
  if (!mobile) return <DialogDescription ref={ref} className={className} {...props} />;
  return (
    <DialogPrimitive.Description
      ref={ref}
      {...props}
      className="mt-1 text-[12px] leading-[1.4] text-[#525252] [text-wrap:pretty]"
    />
  );
});
ResponsiveDialogDescription.displayName = 'ResponsiveDialogDescription';

export function ResponsiveDialogFooter({
  className,
  mobileClassName,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { mobileClassName?: string }) {
  const { mobile, safeBottom } = React.useContext(Ctx);
  if (!mobile) return <DialogFooter className={className} style={style} {...props} />;
  return (
    <div
      {...props}
      data-sheet-footer=""
      className={cn(
        // Pinned at the bottom of the scroll container: secondary then primary,
        // equal flex, 46px — the action bar's buttons.
        'sticky bottom-0 z-10 -mx-[var(--m-gutter)] mt-auto flex gap-2 border-t border-[#e8e8ea] bg-white px-[var(--m-gutter)] pt-[9px]',
        '[&>*]:min-w-0 [&>*]:flex-1 [&>button]:h-[46px] [&>button]:rounded-[4px] [&>button]:text-[15px]',
        mobileClassName,
      )}
      style={{ ...style, paddingBottom: `calc(9px + ${safeBottom})` }}
    />
  );
}
