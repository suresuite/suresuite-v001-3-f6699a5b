import { useCallback, useEffect, useRef, useState } from 'react';

type Slide = {
  kicker: string;
  headLead: string;
  headAccent: string;
  body: string;
  stats: { label: string; value: string }[];
};

const SLIDES: Slide[] = [
  {
    kicker: 'Why SuReSuite',
    headLead: 'Put your supply chain under pressure —',
    headAccent: 'on purpose.',
    body: 'A digital twin of your network, rigorous experiments, and the strategy that holds up under shock — in one workspace.',
    stats: [
      { label: 'Network model', value: '3 echelons · firm / product / process' },
      { label: 'Training runs', value: '5,000+' },
      { label: 'Policy library', value: '20+ built-in SC policies' },
      { label: 'Method', value: 'Monte Carlo · replications & warm-up' },
    ],
  },
  {
    kicker: 'Deep network AI',
    headLead: 'One network,',
    headAccent: 'three lenses.',
    body: 'SuReSuite reads the firm, product, and process layers at once — ranking the nodes that matter and predicting how a shock on one layer cascades to the rest.',
    stats: [
      { label: 'Firm level', value: 'Who supplies whom' },
      { label: 'Product level', value: 'Single-source exposure' },
      { label: 'Process level', value: 'Where capacity binds' },
      { label: 'Output', value: 'Ranked criticality' },
    ],
  },
  {
    kicker: 'Nexus detection',
    headLead: 'Find the weak link',
    headAccent: 'before it breaks.',
    body: 'Models trained on thousands of runs flag hidden single points of failure and raise quality-checked risk alerts as conditions shift.',
    stats: [
      { label: 'Detection', value: 'Nexus nodes' },
      { label: 'Signal', value: 'Cascade risk' },
      { label: 'Early warning', value: 'Ahead of disruption' },
      { label: 'Monitoring', value: 'Continuous, quality-checked' },
    ],
  },
  {
    kicker: 'Getting started',
    headLead: 'Start with a CSV.',
    headAccent: 'End with a decision.',
    body: 'Import nodes and edges, let AI assist map your fields, then compare resilience tactics side by side under one experiment design.',
    stats: [
      { label: 'Step 01', value: 'Import & map data' },
      { label: 'Step 02', value: 'Spot vulnerabilities' },
      { label: 'Step 03', value: 'Simulate tactics' },
      { label: 'Step 04', value: 'Compare & decide' },
    ],
  },
];

const ROTATE_MS = 7000;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Brand panel for /auth. All slides are rendered stacked in a single grid cell
 * (every child at `grid-area: 1/1`) so the container is always as tall as the
 * TALLEST slide — only opacity/transform animate. That is what keeps the login
 * form from shifting when the strip rotates; do not swap to conditional
 * rendering or a fixed pixel height.
 */
const AuthHeroStrip = () => {
  const [active, setActive] = useState(0);
  const timer = useRef<number | null>(null);

  const start = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(
      () => setActive((i) => (i + 1) % SLIDES.length),
      ROTATE_MS,
    );
  }, []);

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  const jump = (i: number) => {
    setActive(i);
    start();
  };

  return (
    <div
      onMouseEnter={stop}
      onMouseLeave={start}
      className="relative flex min-w-[340px] flex-1 flex-col justify-between overflow-hidden bg-black px-[clamp(32px,4.2vw,60px)] pb-9 pt-10 text-white"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:linear-gradient(to_right,rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_70%_30%,black,transparent_78%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_88%_6%,rgba(191,35,48,0.30),rgba(191,35,48,0.07)_28%,transparent_56%)]"
      />

      <div className="relative flex items-center gap-[14px]">
        <span className="size-[6px] shrink-0 animate-pulse rounded-full bg-[#3FB950] shadow-[0_0_0_3px_rgba(63,185,80,0.18)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/55">
          System: SureSuite-v2.0 // Active
        </span>
        <span className="h-px flex-1 bg-white/[0.14]" />
      </div>

      <div className="relative flex flex-col gap-[26px] py-8">
        <div className="grid max-w-[520px]">
          {SLIDES.map((slide, i) => (
            <div
              key={slide.kicker}
              aria-hidden={i !== active}
              className={`col-start-1 row-start-1 flex flex-col gap-6 transition-[opacity,transform] duration-300 ease-out ${
                i === active ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
              }`}
            >
              <div>
                <span className="mb-[14px] block font-mono text-[10px] uppercase tracking-[0.2em] text-[#BF2330]">
                  {slide.kicker}
                </span>
                <h2 className="m-0 text-pretty text-[clamp(26px,2.9vw,34px)] font-semibold leading-[1.09] tracking-[-0.024em] text-white">
                  {slide.headLead} <span className="font-serif italic font-medium">{slide.headAccent}</span>
                </h2>
                <p className="mt-4 max-w-[460px] text-pretty text-[14.5px] leading-[1.6] text-white/[0.62]">
                  {slide.body}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-px border border-white/[0.12] bg-white/[0.12] [grid-auto-rows:92px]">
                {slide.stats.map((s) => (
                  <div
                    key={s.label}
                    className="flex flex-col justify-center gap-1.5 overflow-hidden bg-black px-5 py-4"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/[0.45]">
                      {s.label}
                    </span>
                    <span className="text-[14.5px] font-medium leading-[1.4] text-white">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex max-w-[520px] items-center gap-[18px]">
          <span className="font-mono text-[10px] tabular-nums tracking-[0.18em] text-white/40">
            {pad(active + 1)} / {pad(SLIDES.length)}
          </span>
          <div className="flex items-center gap-2">
            {SLIDES.map((slide, i) => (
              // box-content + py-[11px] + bg-clip-content keeps the bar 3px tall
              // while the actual hit target is ~25px — do not collapse the padding.
              <button
                key={slide.kicker}
                type="button"
                onClick={() => jump(i)}
                aria-label={`Show ${slide.kicker}`}
                aria-current={i === active}
                className={`box-content h-[3px] rounded-[2px] bg-clip-content py-[11px] transition-[width,background-color] duration-[260ms] ease-out ${
                  i === active ? 'w-[30px] bg-[#BF2330]' : 'w-[13px] bg-white/[0.28]'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthHeroStrip;
