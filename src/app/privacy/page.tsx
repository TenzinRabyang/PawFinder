import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy | PawFinder",
  description:
    "Read how PawFinder collects, uses, and protects account, pet profile, and platform performance data.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      eyebrow="UK Data Protection"
      title="Privacy Policy"
      subtitle="Last Updated: July 2026"
      intro={
        <p>
          PawFinder is a UK pet services directory designed to help pet owners discover local care
          providers with more context, trust signals, and breed-aware search tools. This page
          explains the personal information we collect, why we process it, how session cookies are
          used to keep the platform working, and how you can raise a formal data protection concern.
        </p>
      }
      sections={[
        {
          title: "Introduction",
          body: (
            <>
              <p>
                PawFinder operates as a directory and account platform for pet owners browsing UK
                providers such as vets, walkers, groomers, boarders, and related services. We only
                collect information that is necessary to run user accounts, support search and
                profile features, and monitor whether the service is functioning reliably.
              </p>
              <p>
                We aim to process personal data responsibly, transparently, and proportionately
                under applicable UK data protection requirements. Where platform features rely on
                third-party infrastructure, we limit our use of personal data to what is needed to
                provide the service.
              </p>
            </>
          ),
        },
        {
          title: "Personal Data We Collect",
          body: (
            <>
              <p>PawFinder currently collects the following categories of information:</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.25rem] border border-[#E7DDD0] bg-[#FBF7F1] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B8075]">
                    Account Data
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#4A5147]">
                    Email addresses and related account identifiers provided through account
                    creation and sign-in.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-[#E7DDD0] bg-[#FBF7F1] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B8075]">
                    Pet Profile Data
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#4A5147]">
                    Pet profile configurations, including breed tags and related preference data
                    saved to support profile and review functionality.
                  </p>
                </div>
                <div className="rounded-[1.25rem] border border-[#E7DDD0] bg-[#FBF7F1] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B8075]">
                    Usage Statistics
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#4A5147]">
                    Anonymous local performance usage statistics used in aggregate to understand
                    platform reliability and speed.
                  </p>
                </div>
              </div>
            </>
          ),
        },
        {
          title: "Legal Basis for Processing",
          body: (
            <>
              <p>
                We process account and profile data where necessary for contractual fulfillment,
                including operating your user account, maintaining login state, and delivering the
                account-linked features you request.
              </p>
              <p>
                We also process limited operational data under our legitimate interests in keeping
                PawFinder secure, improving platform performance, diagnosing reliability issues, and
                refining service quality for pet owners using the directory.
              </p>
            </>
          ),
        },
        {
          title: "Integrated Cookie Disclosure & Opt-Out",
          body: (
            <>
              <p>
                PawFinder uses necessary technical session cookies through Supabase to manage your
                authenticated login state and maintain secure account sessions. These cookies are
                required for account access and core platform operation.
              </p>
              <p>
                We also use aggregate first-party analytics cookies strictly to monitor platform
                performance, stability, and service quality. These analytics are not used to track
                users across external apps or websites, and PawFinder does not share this analytics
                data with third-party advertising networks.
              </p>
              <p>
                You may freely opt out of analytics cookies through your browser settings, including
                by blocking or clearing cookies on your device. Disabling non-essential analytics
                cookies will not prevent access to the core directory, although session cookies may
                still be required for account login functionality.
              </p>
            </>
          ),
        },
        {
          title: "Your Rights & Complaints Procedure",
          body: (
            <>
              <p>
                You may request access to the personal data associated with your account, ask us to
                amend inaccurate information, or request deletion of account data where applicable.
              </p>
              <p>
                PawFinder maintains a dedicated Data Protection Complaints Procedure. To submit a
                formal data protection complaint, email{" "}
                <a
                  href="mailto:support@pawfinder.app"
                  className="font-medium text-[#B14A2B] underline decoration-[#D6B0A1] underline-offset-4"
                >
                  support@pawfinder.app
                </a>
                . We will formally acknowledge all complaints within 30 days and handle them
                transparently in line with UK law.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
