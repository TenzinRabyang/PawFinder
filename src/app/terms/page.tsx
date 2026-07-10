import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms & Conditions | PawFinder",
  description:
    "Review the terms governing access to PawFinder, including review integrity standards and platform usage rules.",
};

export default function TermsPage() {
  return (
    <LegalPageShell
      eyebrow="Platform Terms"
      title="Terms & Conditions"
      subtitle="Last Updated: July 2026"
      intro={
        <p>
          These Terms &amp; Conditions govern your use of PawFinder. By using the platform, you
          agree to use the directory, account tools, reviews, and provider information responsibly
          and in line with the standards set out below.
        </p>
      }
      sections={[
        {
          title: "Platform Purpose",
          body: (
            <>
              <p>
                PawFinder acts as an informational aggregator that incorporates live Google Places
                API data alongside platform-specific account and review features. Directory
                information is provided to help users research pet care options, not to guarantee
                outcomes, provider quality, availability, or suitability.
              </p>
              <p>
                Users engage with external vets, walkers, groomers, boarders, and other listed
                businesses at their own risk. PawFinder accepts no liability for real-world
                interactions, services, advice, appointments, or incidents involving third-party
                providers listed on the platform.
              </p>
            </>
          ),
        },
        {
          title: "Mandatory Review & AI Summary Policy",
          body: (
            <>
              <div className="rounded-[1.35rem] border border-[#D9B9A8] bg-[#FFF3EC] p-5 shadow-[0_18px_40px_-34px_rgba(122,67,45,0.38)]">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">
                  DMCC Act Compliant Standard
                </div>
                <p className="mt-3 text-sm leading-7 text-[#533F37] sm:text-[15px]">
                  Submitting fake reviews, employee-skewed ratings, or undisclosed incentivized
                  reviews is strictly prohibited and may be unlawful under the Digital Markets,
                  Competition and Consumers (DMCC) Act.
                </p>
              </div>
              <p>
                PawFinder takes active, proportional steps to prevent, detect, and remove
                fraudulent, misleading, or manipulated review content. We may moderate, suspend, or
                remove reviews or related account activity where misuse is reasonably suspected.
              </p>
              <p>
                Our automated AI review summaries are intended to represent a balanced view of the
                underlying review data. They are mathematically driven summaries of actual user
                inputs and are not intentionally manipulated or skewed to conceal negative feedback.
              </p>
            </>
          ),
        },
        {
          title: "Intellectual Property & Scraping",
          body: (
            <>
              <p>
                All platform presentation, design, copy, curation, and proprietary database
                structuring on PawFinder remain protected by applicable intellectual property and
                database rights.
              </p>
              <p>
                You must not scrape, systematically harvest, mirror, clone, index through automated
                bots, or reproduce substantial parts of the platform or its structured data without
                prior written permission from PawFinder.
              </p>
            </>
          ),
        },
        {
          title: "Governing Law",
          body: (
            <>
              <p>
                These Terms &amp; Conditions are governed by the laws of the United Kingdom. Any
                disputes, claims, or proceedings relating to PawFinder or its use will be subject to
                the jurisdiction of the courts of the United Kingdom.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
