import type { Metadata } from "next";
import { Geist, Geist_Mono, Quicksand } from "next/font/google";
import Link from "next/link";
import ChatBubble from "@/components/assistant/ChatBubble";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PawFinder | Find local pet care",
  description: "Search vets, groomers, walkers, and pet care near you with real local context.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${quicksand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#FAF7F1] text-[#20261F]">
        <main className="flex-1">{children}</main>
        <ChatBubble />
        <footer className="border-t border-[#DCD3BE] bg-[#FCF8F2]">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-[#5B6258] sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <div className="font-display text-lg tracking-[-0.03em] text-[#20261F]">PawFinder</div>
              <p className="mt-1 max-w-xl text-sm leading-6 text-[#646B61]">
                Transparent pet-care discovery with clear platform policies and direct support access.
              </p>
            </div>
            <div className="flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
              <Link href="/privacy" className="transition-colors hover:text-[#B14A2B]">
                Privacy Policy
              </Link>
              <Link href="/terms" className="transition-colors hover:text-[#B14A2B]">
                Terms &amp; Conditions
              </Link>
              <a
                href="mailto:support@pawfinder.app"
                className="font-medium text-[#20261F] transition-colors hover:text-[#B14A2B]"
              >
                Contact Support: support@pawfinder.app
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
