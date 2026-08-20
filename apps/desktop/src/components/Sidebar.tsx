import { useMemo, useState } from "react";
import type { ProjectInfo, ThreadInfo } from "../../electron/shared";

type Props = {
  projects: ProjectInfo[];
  threads: ThreadInfo[];
  selectedProjectCwd: string | null;
  activeId: string | null;
  runningIds: Set<string>;
  grokLabel: string;
  onOpenProject: () => void;
  onSelectProject: (project: ProjectInfo) => void;
  onSelectThread: (thread: ThreadInfo) => void;
};

function same(a: string, b: string) {
  return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

function FolderIcon() {
  return (
    <svg className="folder-icon" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M2.2 4.2A1.4 1.4 0 0 1 3.6 2.8h2.6c.3 0 .6.12.8.34l.7.76c.2.22.5.34.8.34h3.9A1.4 1.4 0 0 1 14 5.64v6.76A1.4 1.4 0 0 1 12.6 13.8h-9A1.4 1.4 0 0 1 2.2 12.4V4.2z"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2 13.2 13.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar({
  projects,
  threads,
  selectedProjectCwd,
  activeId,
  runningIds,
  grokLabel,
  onOpenProject,
  onSelectProject,
  onSelectThread,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .map((project) => {
        const list = threads.filter((t) => {
          if (!same(t.projectCwd, project.cwd)) return false;
          if (!q) return true;
          return t.title.toLowerCase().includes(q);
        });
        return { project, threads: list };
      })
      .filter(({ project, threads: list }) => {
        if (!q) return true;
        return list.length > 0 || project.name.toLowerCase().includes(q);
      });
  }, [projects, threads, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title-row">
          <span className="sidebar-title">项目</span>
          <button
            className="icon-btn"
            type="button"
            title="搜索"
            onClick={() => setSearchOpen((v) => !v)}
          >
            <SearchIcon />
          </button>
        </div>
        {searchOpen ? (
          <input
            className="search"
            autoFocus
            placeholder="搜索会话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : null}
      </div>
      <div className="sidebar-list">
        {grouped.map(({ project, threads: list }) => {
          const isSelected = !!selectedProjectCwd && same(project.cwd, selectedProjectCwd);
          return (
            <div className={`project${isSelected ? " selected" : ""}`} key={project.cwd}>
              <button
                className="project-head"
                type="button"
                title={project.cwd}
                onClick={() => onSelectProject(project)}
              >
                <FolderIcon />
                <span className="project-name">{project.name}</span>
              </button>
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`thread${activeId === t.id ? " active" : ""}${runningIds.has(t.id) ? " running" : ""}`}
                  title={t.title}
                  onClick={() => onSelectThread(t)}
                >
                  {t.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <button className="btn ghost block" type="button" onClick={onOpenProject}>
          打开项目
        </button>
        <div className="status-pill" title={grokLabel}>
          {grokLabel}
        </div>
      </div>
    </aside>
  );
}
