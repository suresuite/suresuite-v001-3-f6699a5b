// The copyright, thesis and open-access notice shown in the public footers
// (Landing and About). Authored once here so the two pages cannot drift; the
// full statement it summarises is COPYRIGHT.md, and the release itself is
// planned in docs/design/open-access-release-plan.md. Change them together.

interface ResearchNoticeProps {
  className?: string;
}

export default function ResearchNotice({ className = '' }: ResearchNoticeProps) {
  return (
    <p className={`max-w-[80ch] text-xs leading-[1.6] text-muted-foreground ${className}`}>
      <span className="text-foreground/80">© 2023–{new Date().getFullYear()} Phu Nguyen.</span>{' '}
      SuReSuite is a research prototype and part of the PhD thesis of Phu Nguyen
      (cooperative doctorate, HWR Berlin &amp; TU Berlin). Parts of this work were developed
      within the Horizon Europe project ACCURATE (Grant Agreement 101138269). Its core
      algorithms — network
      analysis, supply chain simulation and surrogate models for stress testing — will be
      published as open access: source code under an OSI-approved open-source licence,
      publications and documentation under CC&nbsp;BY&nbsp;4.0.
    </p>
  );
}
