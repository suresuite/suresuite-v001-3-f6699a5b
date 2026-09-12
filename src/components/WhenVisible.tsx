// Mounts its children the first time the slot scrolls into view, and never
// unmounts them again.
//
// WHY: the two WebGL surfaces in this app — NetworkVisualization3D (three.js)
// and MapView (mapbox-gl) — cost far more to MOUNT than to download. Both
// initialize a GL context, compile shaders and start a render loop. On a
// mid-tier phone that is the difference between a page that responds to a tap
// and one that does not, and both of them routinely sit below the fold or
// behind an inactive tab, where nobody is looking at them.
//
// Lazy-loading alone does not fix that: `React.lazy` defers the DOWNLOAD, but
// the moment the chunk lands the component mounts and the GL context starts.
// This defers the mount itself to the first moment the thing is actually
// visible.
//
// The slot always renders at full size, so reserving the space is the caller's
// job (an aspect ratio or a height on the wrapper) and nothing shifts when the
// real content arrives.

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface WhenVisibleProps {
  children: ReactNode;
  /** Shown until the slot is visible. Must occupy the same box as `children`. */
  placeholder?: ReactNode;
  className?: string;
  /** How far ahead of the viewport to start. One screen of warning is enough to
   *  hide the mount cost behind the scroll. */
  rootMargin?: string;
}

export function WhenVisible({
  children,
  placeholder = null,
  className,
  rootMargin = '200px',
}: WhenVisibleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;

    // Where the API is missing, show the content rather than hide it: this is
    // an optimization, and an optimization must never be the reason something
    // does not render.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} className={className}>
      {visible ? children : placeholder}
    </div>
  );
}
