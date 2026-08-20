import { useEffect, useRef } from "react";
import type { StreamItem } from "../../electron/shared";
import { Markdown } from "../lib/markdown";
import { toolStatusLabel } from "../lib/i18n";

type Turn = {
  user?: Extract<StreamItem, { kind: "user" }>;
  thought?: Extract<StreamItem, { kind: "thought" }>;
  tool?: Extract<StreamItem, { kind: "tool" }>;
  rest: StreamItem[];
};

function groupTurns(items: StreamItem[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { rest: [] };
  const flush = () => {
    if (cur.user || cur.thought || cur.tool || cur.rest.length) turns.push(cur);
  };
  for (const item of items) {
    if (item.kind === "user") {
      flush();
      cur = { user: item, rest: [] };
    } else if (item.kind === "thought") {
      cur.thought = item;
    } else if (item.kind === "tool") {
      cur.tool = item;
    } else {
      cur.rest.push(item);
    }
  }
  flush();
  return turns;
}

function ToolCard({
  item,
  onOpenFile,
}: {
  item: Extract<StreamItem, { kind: "tool" }>;
  onOpenFile?: (path: string) => void;
}) {
  const open = Boolean(item.path && onOpenFile);
  return (
    <div
      className={`tool${open ? " clickable" : ""}`}
      onClick={() => {
        if (item.path && onOpenFile) onOpenFile(item.path);
      }}
    >
      <div className="tool-top">
        <span className="tool-name" title={item.path || item.title}>
          {item.title}
        </span>
        <span className={`tool-status ${item.status}`}>{toolStatusLabel(item.status)}</span>
      </div>
    </div>
  );
}

function RestItem({
  item,
  onOpenFile,
}: {
  item: StreamItem;
  onOpenFile?: (path: string) => void;
}) {
  if (item.kind === "agent") {
    return (
      <div className="msg agent">
        <div className="msg-role">Grok</div>
        <div className="body">
          <Markdown text={item.text} />
        </div>
      </div>
    );
  }
  if (item.kind === "plan") {
    return (
      <ol className="plan">
        {item.entries.map((e, j) => (
          <li key={j} className={e.status}>
            {e.content}
          </li>
        ))}
      </ol>
    );
  }
  if (item.kind === "tool") {
    return <ToolCard item={item} onOpenFile={onOpenFile} />;
  }
  if (item.kind === "thought") {
    return (
      <div className="msg thought">
        <div className="msg-role">思考</div>
        <div className="body">{item.text}</div>
      </div>
    );
  }
  return <div className="msg thought">{item.kind === "status" ? item.text : ""}</div>;
}

export function MessageStream({
  items,
  emptyTitle,
  emptyBody,
  onOpenFile,
}: {
  items: StreamItem[];
  emptyTitle: string;
  emptyBody: string;
  onOpenFile?: (path: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items]);

  if (!items.length) {
    return (
      <div className="stream">
        <div className="empty">
          <h2>{emptyTitle}</h2>
          <p>{emptyBody}</p>
        </div>
      </div>
    );
  }

  const turns = groupTurns(items);

  return (
    <div className="stream">
      <div className="stream-col">
        {turns.map((turn, ti) => (
          <div className="turn" key={turn.user ? `u-${ti}-${turn.user.text.slice(0, 24)}` : `t-${ti}`}>
            {turn.user ? (
              <div className="msg user">
                <div className="msg-role">你</div>
                <div className="bubble">{turn.user.text}</div>
              </div>
            ) : null}
            {turn.thought || turn.tool ? (
              <div className="turn-live">
                {turn.thought ? (
                  <div className="msg thought">
                    <div className="msg-role">思考</div>
                    <div className="body">{turn.thought.text}</div>
                  </div>
                ) : null}
                {turn.tool ? <ToolCard item={turn.tool} onOpenFile={onOpenFile} /> : null}
              </div>
            ) : null}
            {turn.rest.map((item, i) => (
              <RestItem key={`${ti}-${item.kind}-${i}`} item={item} onOpenFile={onOpenFile} />
            ))}
          </div>
        ))}
      </div>
      <div ref={end} />
    </div>
  );
}
