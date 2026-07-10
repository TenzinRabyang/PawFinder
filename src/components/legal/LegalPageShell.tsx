import type { ReactNode } from "react";

type LegalSection = {
  title: string;
  body: ReactNode;
};

type LegalPageShellProps = {
  title: string;
  subtitle: string;
  eyebrow: string;
  intro: ReactNode;
  sections: LegalSection[];
};

function SectionCard({ title, body }: LegalSection) {
  return (
    <section className="rounded-[1.75rem] border border-[#DCD3BE] bg-[#FFFDFC] p-6 shadow-[0_18px_48px_-38px_rgba(48,41,31,0.42)] sm:p-8">
      <h2 className="font-display text-[1.7rem] tracking-[-0.03em] text-[#20261F] sm:text-[1.95rem]">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-[#4A5147] sm:text-base">
        {body}
      </div>
    </section>
  );
}

export function LegalPageShell({
  title,
  subtitle,
  eyebrow,
  intro,
  sections,
}: LegalPageShellProps) {
  return (
    <div className="min-h-screen bg-[#FAF7F1] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="overflow-hidden rounded-[2rem] border border-[#DCD3BE] bg-[linear-gradient(180deg,rgba(255,253,248,0.96)_0%,rgba(250,244,234,0.92)_100%)] px-6 py-8 shadow-[0_24px_60px_-42px_rgba(52,41,27,0.4)] sm:px-8 sm:py-10">
          <div className="inline-flex rounded-full border border-[#E6D9CA] bg-[#FFF8F1] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">
            {eyebrow}
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-[2.5rem] leading-[1.02] tracking-[-0.05em] text-[#20261F] sm:text-[3.25rem]">
            {title}
          </h1>
          <p className="mt-3 text-sm font-medium uppercase tracking-[0.18em] text-[#6B6B63]">
            {subtitle}
          </p>
          <div className="mt-6 max-w-3xl text-[15px] leading-7 text-[#4A5147] sm:text-base">
            {intro}
          </div>
        </header>

        <div className="grid gap-6">
          {sections.map((section) => (
            <SectionCard key={section.title} {...section} />
          ))}
        </div>
      </div>
    </div>
  );
}
