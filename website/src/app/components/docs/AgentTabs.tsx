"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ReactNode, useCallback } from "react";

const agents = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "opencode", label: "OpenCode" },
  { id: "antigravity", label: "Antigravity" },
] as const;

type AgentId = (typeof agents)[number]["id"];

export default function AgentTabs({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const currentAgent = (searchParams.get("agent") as AgentId) || "claude";

  const setAgent = useCallback(
    (agent: AgentId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("agent", agent);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return (
    <div className="my-6">
      <div className="flex border-b border-[var(--border)]">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setAgent(agent.id)}
            className={`font-mono text-xs px-3 py-2 transition-colors border-b -mb-px ${
              currentAgent === agent.id
                ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {agent.label}
          </button>
        ))}
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}

export function TabContent({
  agent,
  children,
}: {
  agent: string;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const currentAgent = searchParams.get("agent") || "claude";

  if (currentAgent !== agent) {
    return null;
  }

  return <div>{children}</div>;
}
