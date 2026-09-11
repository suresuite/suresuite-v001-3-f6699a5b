// Public "About us" page at `/about`. No sidebar, no auth required.
// Matches the design file 1:1. Same vocabulary as Landing.tsx: mono kickers,
// #BF2330 accent, hairline grids, serif-italic tail on headings.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ FUNDING ATTRIBUTION RULE — do not break this.                            │
// │                                                                          │
// │ The programme logo (ACCURATE, later euroFMX) and the "Funded by the      │
// │ European Union" logo must ALWAYS appear together, side by side.          │
// │                                                                          │
// │ That is why EU_LOGO is rendered OUTSIDE the cross-fade: only the         │
// │ programme logo swaps, the EU logo is permanent. If you ever move the     │
// │ EU logo inside the fading panel, one programme could render without it.  │
// │                                                                          │
// │ When euroFMX replaces ACCURATE for good, set PROGRAMMES to the single    │
// │ euroFMX entry — the EU logo stays untouched.                             │
// └──────────────────────────────────────────────────────────────────────────┘

import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import HeroLattice from '@/components/about/HeroLattice';

const ACCENT = '#BF2330';
const KICKER = 'font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground';

// Permanent. Never conditional, never inside the cross-fade. See rule above.
const EU_LOGO = { src: '/funding/funded-by-eu.png', alt: 'Funded by the European Union' };

// The programme half of the pair. Add/remove entries here only.
const PROGRAMMES = [
  {
    key: 'accurate',
    logo: '/funding/accurate-logo.webp',
    alt: 'ACCURATE',
    line: 'Horizon Europe',
    status: 'Running',
    statusClass: 'text-[#BF2330] border-[#BF2330]/30',
    detail: 'GA 101138269 · 01/12/2023 → 30/11/2026',
  },
  {
    key: 'eurofmx',
    logo: '/funding/EUF-MX-Logo.png',
    alt: 'euroFMX',
    line: 'Horizon Europe',
    status: 'Next',
    statusClass: 'text-muted-foreground border-border',
    // HORIZON-CL4-2025-03-DIGITAL-EMERGING-07 · 48 months from 01/06/2026
    detail: 'GA 101299128 · 01/06/2026 → 31/05/2030',
  },
];

type Person = {
  slug: string;
  num: string;
  role: string;
  name: string;
  title: string;
  bio: React.ReactNode;
  photo: string | null; // null → monogram tile renders instead
  initials: string;
  monogramGlow: string;
  tags: string[];
};

const PEOPLE: Person[] = [
  {
    slug: 'phu-nguyen',
    num: '01',
    role: 'Technical lead & Product Owner',
    name: 'Phu Nguyen',
    title: 'Research associate, Digital-AI Supply Chain Lab',
    bio: (
      <>
        He designs and builds SuReSuite end to end — the discrete-event simulation engine, the
        three-lens network model, the policy library, the supply chain intelligent agents, and the
        workspace around them. Co-author of{' '}
        <em>Introduction to Operations and Supply Chain Simulation with AnyLogic</em> (Springer,
        2025).
      </>
    ),
    photo: "/team/phu-nguyen.jpg",
    initials: 'PN',
    monogramGlow: 'rgba(255,255,255,0.24)',
    tags: ['Simulation engine', 'Network modelling', 'Platform architecture', 'AI agents'],
  },
  {
    slug: 'dmitry-ivanov',
    num: '02',
    role: 'Scientific lead',
    name: 'Prof. Dr. Dr. habil. Dmitry Ivanov',
    title: 'Professor of Supply Chain & Operations Management',
    bio: (
      <>
        He leads the Digital-AI Supply Chain Lab and is academic director of the M.A. Global Supply
        Chain and Operations Management. His work introduced the ripple effect and supply chain
        viability to the field, and it sets the scientific direction behind SuReSuite's engine.
      </>
    ),
    photo: "/team/dmitry-ivanov.jpg",
    initials: 'DI',
    monogramGlow: 'rgba(191,35,48,0.4)',
    tags: [
      'Supply chain resilience',
      'Ripple effect & viability',
      'Digital twins',
      'Simulation & control',
    ],
  },
];

const CONTRIBUTORS = [
  { group: 'Engineering', name: 'Ngan Ho', body: 'App layout developer and the MRP module extending SuReSuite.', org: 'Digital-AI SC Lab' },
  { group: 'Research', name: 'Name to add', body: 'Network data, case studies, and validation of the firm-level model.', org: 'HWR Berlin' },
  { group: 'Engineering', name: 'Name to add', body: 'Data pipelines, the public API, and the simulation worker.', org: 'Digital-AI SC Lab' },
  { group: 'Project', name: 'Name to add', body: 'WP4 coordination, reporting, and consortium liaison.', org: 'ACCURATE' },
  { group: 'Advisory', name: 'Name to add', body: 'Industry pilots and feedback on resilience strategies in practice.', org: 'Consortium partners' },
];

const FADE = 'transition-[opacity,transform] duration-[560ms] ease-out';

function FundingStrip() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const single = PROGRAMMES.length === 1;

  useEffect(() => {
    if (!auto || single) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % PROGRAMMES.length), 5400);
    return () => clearInterval(t);
  }, [auto, single]);

  return (
    <div className="relative border-t border-border bg-border">
      {/* hairline grid: the divider IS the 1px gap, so it turns horizontal when
          the two columns stack instead of leaving a stray left border */}
      <div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fit,minmax(min(100%,330px),1fr))] gap-px bg-border-strong">
        {/* Home — HWR / lab identity */}
        <div className="bg-border px-6 py-8">
          <span className={KICKER}>Home</span>
          <img
            src="/funding/Hochschule_für_Wirtschaft_und_Recht_Berlin_logo.svg.webp"
            alt="HWR Berlin"
            className="mt-3.5 h-10 w-auto max-w-[150px] object-contain object-left"
          />
          <div className="mt-3.5">
            <span className="block text-[15px] font-semibold">Digital-AI Supply Chain Lab</span>
            <span className="mt-0.5 block text-[13.5px] text-muted-foreground">
              HWR Berlin · Campus Schöneberg
            </span>
          </div>
        </div>

        {/* Funded by — programme logo + EU logo, always paired */}
        <div className="bg-border px-6 py-8">
          <div className="flex items-center justify-between gap-4">
            <span className={`${KICKER} whitespace-nowrap`}>Funded by</span>
            {!single && (
              <div className="flex items-center gap-[7px]">
                {PROGRAMMES.map((p, n) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-label={`Show ${p.alt}`}
                    onClick={() => {
                      setAuto(false);
                      setI(n);
                    }}
                    className={`h-1.5 rounded-full transition-all duration-[400ms] ${
                      i === n ? 'w-[22px] bg-[#BF2330]' : 'w-1.5 bg-border'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-5">
          {/* <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5"> */}
          {/* <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2"> */}
            {/* programme logo — the only thing that swaps */}
            {/* <div className="relative h-[46px] w-[168px] flex-none"> */}
            <div className="relative h-9 w-[120px] flex-none md:h-[46px] md:w-[168px]">
              {PROGRAMMES.map((p, n) => (
                <img
                  key={p.key}
                  src={p.logo}
                  alt={p.alt}
                  className={`absolute inset-0 h-full w-full object-contain object-left ${FADE} ${
                    i === n ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1.5 opacity-0'
                  }`}
                />
              ))}
            </div>
            {/* EU logo — permanent partner of whichever programme shows */}
            <img
              src={EU_LOGO.src}
              alt={EU_LOGO.alt}
              className="h-9 w-[110px] flex-none object-contain object-left md:h-[46px] md:w-[158px]"
              // className="h-[46px] w-[158px] flex-none object-contain object-left"
            />
          </div>

          <div className="relative mt-4 min-h-[64px] md:min-h-[48px]">
            {PROGRAMMES.map((p, n) => (
              <div
                key={p.key}
                className={`absolute inset-0 ${FADE} ${
                  i === n
                    ? 'translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-1.5 opacity-0'
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                  <span className="text-[length:clamp(15px,4vw,16px)] leading-normal md:text-[14.5px]">
                    {p.line}
                  </span>
                  <span
                    className={`whitespace-nowrap rounded-sm border px-[7px] py-[3px] font-mono text-[9px] uppercase tracking-[0.18em] ${p.statusClass}`}
                  >
                    {p.status}
                  </span>
                </div>
                {/* v2 §5.6: below `md` this is the ONLY place the funding
                    credit appears — Footer.tsx no longer renders there — so it
                    is body copy, not fine print. `md:` keeps the 11px the
                    desktop band has always had. */}
                <span className="mt-[5px] block font-mono text-[10px] tracking-[0.05em] text-muted-foreground tabular-nums md:text-[11px]">
                {/* <span className="mt-[5px] block font-mono text-[length:var(--fs-body)] leading-[1.5] tracking-[0.05em] text-muted-foreground tabular-nums md:text-[11px]"> */}
                  {p.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Portrait({ p }: { p: Person }) {
  const box = 'float-left mr-6 mb-3 mt-1 h-[116px] w-[92px] overflow-hidden rounded';

  if (!p.photo) {
    return (
      <div className={`${box} relative grid place-items-center bg-black`}>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `radial-gradient(circle at 80% 16%, ${p.monogramGlow}, transparent 62%)` }}
        />
        <span className="relative text-[30px] font-semibold tracking-[-0.03em] text-white">
          {p.initials}
        </span>
      </div>
    );
  }
  return (
    <div className={`${box} bg-secondary`}>
      <img src={p.photo} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
    </div>
  );
}

export default function About() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Top bar — same as Landing */}
      <header className="sticky top-0 z-40 border-b border-[--hair-rule] bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:h-16 md:px-6">
          <Link to="/" className="flex items-center">
            <img
              src="/logo-mark.png"
              alt="SuReSuite — Supply Chain Resilience Suite"
              className="h-[19px] w-auto object-contain md:hidden"
            />
            <img
              src="/logo-lockup.png"
              alt="SuReSuite — Supply Chain Resilience Suite"
              className="hidden h-[58px] object-contain md:block"
            />
          </Link>
          <nav className="flex items-center gap-1 whitespace-nowrap md:gap-2">
            <Button asChild variant="secondary" size="sm" className="hidden md:inline-flex">
              <Link to="/about">About</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link to="/#video">Demo</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link to="/help">Docs</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
              <Link to="/auth">Log in</Link>
            </Button>
            <Button asChild size="sm" className="h-11 whitespace-nowrap md:ml-1 md:h-8">
              <Link to="/auth">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[--hair-rule]">
          {/* Desktop's 60px headline leaves the right half of the hero clear, so the
              lattice sits beside the copy; a 390px frame puts the copy over the whole
              figure, so it recedes (opacity-50) and tucks into the top-right corner
              (-top-[2%]) below md. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -top-[2%] overflow-hidden opacity-50 md:top-0 md:opacity-100"
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(420px circle at 92% 2%, rgba(191,35,48,0.09), rgba(191,35,48,0.022) 34%, transparent 62%)',
              }}
            />
            <HeroLattice />
          </div>
          <div className="relative mx-auto max-w-6xl px-5 pt-12 pb-9 md:px-6 md:pt-20 md:pb-24">
            <span className="inline-flex items-center gap-2 whitespace-nowrap rounded border border-border bg-card px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              <span className={KICKER}>About us</span>
            </span>

            <h1 className="mt-9 max-w-[20ch] text-[length:clamp(30px,8.5vw,60px)] leading-[1.08] tracking-[-0.024em] text-balance font-semibold
                           md:text-[clamp(36px,5vw,60px)] md:leading-[1.03] md:tracking-[-0.022em]">
              Built inside a research lab,{' '}
              <span className="font-serif font-medium italic">shipped as a product.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[length:clamp(15px,4vw,18px)] leading-[1.62] text-muted-foreground text-pretty
                          md:mt-7 md:text-lg md:leading-relaxed">
              SuReSuite is built at the Digital-AI Supply Chain Lab at HWR Berlin — the group
              behind the ripple-effect and supply chain viability research. The same small team
              writes the science, the engine, and the interface.
            </p>
          </div>

          <FundingStrip />
        </section>

        {/* Key people */}
        <section id="people" className="border-b border-[--hair-rule]">
          <div className="mx-auto max-w-6xl px-5 py-[clamp(48px,12vw,96px)] md:px-6">
            <div className="max-w-[600px]">
              <span
                className="inline-flex items-center gap-[7px] whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em]"
                style={{ color: ACCENT }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
                Key people
              </span>
              <h2 className="mt-3 text-[length:clamp(22px,5.5vw,30px)] font-semibold leading-[1.14] tracking-[-0.022em]">
                The science and the build,{' '}
                <span className="font-serif font-medium italic">core team.</span>
              </h2>
            </div>
            

            <div className="mt-[26px] grid grid-cols-1 items-stretch gap-px overflow-hidden rounded-sm border border-border bg-border md:grid-cols-[repeat(auto-fit,minmax(370px,1fr))]">
            {/* <div className="mt-[26px] grid grid-cols-[repeat(auto-fit,minmax(370px,1fr))] items-stretch gap-px overflow-hidden rounded-sm border border-border bg-border"> */}
              {PEOPLE.map((p) => (
                <article key={p.slug} className="relative flex flex-col bg-card p-8">
                  <span className="absolute right-8 top-8 font-mono text-[9px] tracking-[0.16em] text-muted-foreground/50">
                    {p.num}
                  </span>

                  {/* overflow-hidden contains the float; the bio clears it */}
                  <div className="overflow-hidden">
                    <Portrait p={p} />
                    <span
                      className="block whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em]"
                      style={{ color: ACCENT }}
                    >
                      {p.role}
                    </span>
                    <h3 className="mt-3 text-[22px] font-semibold leading-[1.22] tracking-[-0.026em] text-balance">
                      {p.name}
                    </h3>
                    <p className="mt-2 text-sm leading-[1.55] text-foreground/80 text-pretty">
                      {p.title}
                    </p>
                    <p className="clear-left mt-5 text-[14.5px] leading-[1.72] text-muted-foreground text-pretty">
                      {p.bio}
                    </p>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-[7px]">
                    {p.tags.map((t) => (
                      <span
                        key={t}
                        className="whitespace-nowrap rounded-sm border border-border px-2 py-1 text-xs text-foreground/70"
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  <div className="min-h-[20px] flex-1" />
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Contributors */}
        <section className="bg-secondary">
          <div className="mx-auto max-w-6xl px-5 py-[clamp(48px,12vw,96px)] md:px-6">
            <div className="max-w-[600px]">
              <span className={`${KICKER} whitespace-nowrap`}>Contributors</span>
              <h2 className="mt-3 text-[length:clamp(22px,5.5vw,30px)] font-semibold leading-[1.14] tracking-[-0.022em]">
                And the people around them.
              </h2>
            </div>

            <div className="mt-7 border-t border-[--hair-rule]">
              {CONTRIBUTORS.map((c, n) => (
                <div
                  key={`${c.group}-${n}`}
                  className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-b border-[--hair-rule] py-5
                             md:grid-cols-[minmax(104px,150px)_minmax(0,1fr)_minmax(0,max-content)]
                             md:items-center md:gap-y-4"
                >
                  <span className={`${KICKER} whitespace-nowrap`}>{c.group}</span>
                  <div>
                    <span className="block text-[14.5px] font-semibold text-muted-foreground">
                      {c.name}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] leading-[1.55] text-muted-foreground">
                      {c.body}
                    </span>
                  </div>
                  <span className="text-[12.5px] text-muted-foreground md:justify-self-end md:whitespace-nowrap">
                    {c.org}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Slim footer — same as Landing */}
      <footer className="border-t border-[--hair-rule]">
        <div className="pb-safe mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 whitespace-nowrap px-6 py-3.5 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} SuReSuite</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/#video" className="hover:text-foreground md:hidden">
              Demo
            </Link>
            <Link to="/help" className="hover:text-foreground">
              Docs
            </Link>
            <Link to="/auth" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
