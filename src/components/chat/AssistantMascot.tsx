// Animated robot mascot for the AI launcher button.
// Pure inline SVG + CSS keyframes (see index.css, `mascot-*`). The eyes blink
// and glance around to "express feeling"; the antenna light pulses and the head
// gently bobs. On hover (parent has `group`) it switches to a happy expression.
// Honors prefers-reduced-motion via the CSS.

interface Props {
  className?: string;
}

export function AssistantMascot({ className }: Props) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mascotHead" x1="20" y1="9" x2="20" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fafafa" />
          <stop offset="1" stopColor="#d4d4d8" />
        </linearGradient>
        <filter id="mascotGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* whole mascot bobs */}
      <g className="mascot-bob">
        {/* antenna */}
        <line x1="20" y1="9" x2="20" y2="4.5" stroke="#a1a1aa" strokeWidth="1.4" strokeLinecap="round" />
        <circle className="mascot-antenna" cx="20" cy="3.6" r="1.9" fill="#ff0033" filter="url(#mascotGlow)" />

        {/* ears */}
        <rect x="5.5" y="17" width="3" height="7" rx="1.5" fill="#c7c7cc" />
        <rect x="31.5" y="17" width="3" height="7" rx="1.5" fill="#c7c7cc" />

        {/* head */}
        <rect x="8" y="9" width="24" height="25" rx="8" fill="url(#mascotHead)" stroke="#71717a" strokeWidth="0.8" />

        {/* visor */}
        <rect x="11" y="14.5" width="18" height="11" rx="5.5" fill="#0a0a0a" />

        {/* eyes (round, glowing) — shown by default, hidden on hover */}
        <g className="mascot-glance mascot-eyes-open" filter="url(#mascotGlow)">
          <circle className="mascot-blink" cx="16" cy="20" r="2.2" fill="#22d3ee" />
          <circle className="mascot-blink" cx="24" cy="20" r="2.2" fill="#22d3ee" />
        </g>

        {/* happy eyes (arcs) — shown on hover */}
        <g className="mascot-eyes-happy" filter="url(#mascotGlow)" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M13.5 21 q2.5 -3 5 0" />
          <path d="M21.5 21 q2.5 -3 5 0" />
        </g>

        {/* mouth: straight by default, smile on hover */}
        <path className="mascot-mouth-idle" d="M16.5 29 h7" stroke="#a1a1aa" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        <path className="mascot-mouth-smile" d="M16 28.5 q4 3.5 8 0" stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
