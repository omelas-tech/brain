import type { Metadata } from "next";
import Header from "../components/Header";
import Footer from "../components/Footer";

export const metadata: Metadata = {
  title: "Blog — Brain Memory",
  description:
    "Notes on memory systems for AI agents — design decisions, security work, and what we learned building Brain Memory.",
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto max-w-3xl px-5 pt-28 pb-[var(--space-section)] sm:px-6">
        {children}
      </main>
      <Footer />
    </div>
  );
}
