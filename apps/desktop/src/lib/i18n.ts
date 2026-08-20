export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export function toolStatusLabel(status: string): string {
  const key = status.toLowerCase().replace(/-/g, "_");
  const map: Record<string, string> = {
    pending: "等待中",
    in_progress: "进行中",
    running: "进行中",
    completed: "已完成",
    complete: "已完成",
    success: "成功",
    failed: "失败",
    error: "出错",
    cancelled: "已取消",
    canceled: "已取消",
  };
  return map[key] || status;
}

export function permissionOptionLabel(opt: {
  name: string;
  kind: string;
  optionId: string;
}): string {
  const blob = `${opt.kind} ${opt.name} ${opt.optionId}`.toLowerCase();
  if (/(always|forever|session)/.test(blob) && /allow|approve/.test(blob)) return "始终允许";
  if (/once/.test(blob) && /allow|approve/.test(blob)) return "允许一次";
  if (/allow|approve|accept/.test(blob)) return "允许";
  if (/reject|deny|cancel|refuse/.test(blob)) return "拒绝";
  return opt.name;
}
