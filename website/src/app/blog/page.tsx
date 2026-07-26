import Link from "next/link";
import { getAllBlogPosts, formatPostDate } from "@/lib/blog";

const TITLE = "Blog — Brain Memory";
const DESCRIPTION =
  "Notes on memory systems for AI agents — design decisions, security work, and what we learned building Brain Memory.";

// openGraph/twitter are declared explicitly: without them Next falls back to
// the root layout's values, so shares of /blog rendered as the homepage card.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/blog",
    type: "website",
    siteName: "Brain Memory",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function BlogIndexPage() {
  const posts = getAllBlogPosts();

  return (
    <>
      <div className="mb-2 flex items-baseline gap-3">
        <span className="font-mono text-xs text-[var(--text-tertiary)]">00</span>
        <h1
          className="font-semibold tracking-tight text-[var(--text-primary)]"
          style={{ fontSize: "var(--fs-h2)" }}
        >
          Blog
        </h1>
      </div>
      <p className="mb-12 font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
        notes on memory systems for ai agents
      </p>

      <ul className="space-y-px">
        {posts.map((post) => (
          <li key={post.href}>
            <Link
              href={post.href}
              className="group block rounded-md border border-transparent px-4 py-5 transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-2)]"
            >
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                <span className="text-[var(--accent)]">{post.tag}</span>
                <span aria-hidden>·</span>
                <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                <span aria-hidden>·</span>
                <span>{post.readingTime}</span>
              </div>
              <h2 className="mb-1.5 text-lg font-semibold leading-snug tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                {post.title}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                {post.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
