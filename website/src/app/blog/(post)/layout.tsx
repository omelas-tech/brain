/**
 * Prose wrapper for blog posts only.
 *
 * A route group, so it adds no URL segment: `(post)/my-slug/page.mdx` still
 * serves at `/blog/my-slug`. It exists so `prose-doc` styling applies to post
 * bodies without leaking into the post index, where it would underline the
 * whole card and bullet the list.
 */
export default function BlogPostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <article className="prose-doc">{children}</article>;
}
