import { ReactNode } from "react";
import { changelog } from "@/lib/changelog-data";

// Per-category accent dot. Anything unmapped falls back to the tertiary text color.
const CATEGORY_DOT: Record<string, string> = {
  Security: "var(--gold)",
  Added: "var(--accent)",
  Fixed: "#7A9A7A",
  Changed: "var(--text-tertiary)",
  Removed: "var(--danger)",
  Deprecated: "var(--danger)",
};

const codeClass =
  "font-mono text-[0.8em] bg-[var(--surface-2)] border border-[var(--border)] px-1 py-0.5 rounded";

/** Minimal inline markdown → React: **bold**, `code`, [text](url). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--text-primary)]">
          {renderInline(m[1], key)}
        </strong>
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <code key={key} className={codeClass}>
          {m[2]}
        </code>
      );
    } else {
      const label = m[3];
      const url = m[4];
      // Only emit an anchor for URLs that resolve on the site; repo-relative
      // links (e.g. SECURITY.md) render as plain text to avoid dead links.
      if (/^(https?:\/\/|\/)/.test(url)) {
        const external = url.startsWith("http");
        nodes.push(
          <a
            key={key}
            href={url}
            className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {label}
          </a>
        );
      } else {
        nodes.push(label);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function ChangelogTimeline() {
  return (
    <div className="my-8 space-y-10">
      {changelog.map((entry) => (
        <section
          key={entry.version}
          className="grid gap-4 md:grid-cols-[160px_1fr] md:gap-8"
        >
          <div className="md:text-right">
            <div className="font-mono text-sm font-semibold text-[var(--text-primary)]">
              v{entry.version}
            </div>
            {entry.date && (
              <time
                dateTime={entry.date}
                className="font-mono text-xs text-[var(--text-tertiary)]"
              >
                {entry.date}
              </time>
            )}
          </div>

          <div className="min-w-0 border-l border-[var(--border)] pl-4 md:pl-6">
            {entry.note && (
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {renderInline(entry.note, `${entry.version}-note`)}
              </p>
            )}
            {entry.sections.map((section) => (
              <div key={section.category} className="mb-4 last:mb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{
                      background: CATEGORY_DOT[section.category] ?? "var(--text-tertiary)",
                    }}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                    {section.category}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {section.items.map((item, k) => (
                    <li
                      key={k}
                      className="text-sm text-[var(--text-secondary)] leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--text-tertiary)]"
                    >
                      {renderInline(item, `${entry.version}-${section.category}-${k}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
