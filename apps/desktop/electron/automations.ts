import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { log } from "./log";
import type {
  Automation,
  AutomationFrequency,
  AutomationInput,
  AutomationRun,
  IntervalUnit,
} from "./shared";

export type { Automation, AutomationInput, IntervalUnit };

function storePath() {
  return path.join(app.getPath("userData"), "automations.json");
}

function readAll(): Automation[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return Array.isArray(raw) ? (raw as Automation[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: Automation[]) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(rows, null, 2), "utf8");
}

function matchField(field: string, value: number) {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const n = Number(field.slice(2));
    return n > 0 && value % n === 0;
  }
  if (field.includes(",")) return field.split(",").some((part) => matchField(part, value));
  if (field.includes("-")) {
    const [a, b] = field.split("-").map(Number);
    return value >= a && value <= b;
  }
  return Number(field) === value;
}

function matchDow(field: string, jsDay: number) {
  if (field === "*") return true;
  if (field.includes(",")) return field.split(",").some((part) => matchDow(part, jsDay));
  if (field.includes("-")) {
    const [a, b] = field.split("-").map(Number);
    const days: number[] = [];
    for (let d = a; d <= b; d++) days.push(d === 7 ? 0 : d);
    return days.includes(jsDay);
  }
  const n = Number(field);
  return n === 7 ? jsDay === 0 : n === jsDay;
}

export function nextFromCron(cron: string, from: number) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return from + 60_000;
  const [min, hour, dom, month, dow] = parts;
  const d = new Date(from + 60_000);
  d.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 400; i++) {
    if (
      matchField(min, d.getMinutes()) &&
      matchField(hour, d.getHours()) &&
      matchField(dom, d.getDate()) &&
      matchField(month, d.getMonth() + 1) &&
      matchDow(dow, d.getDay())
    ) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return from + 86_400_000;
}

const UNIT_MS: Record<IntervalUnit, number> = {
  minute: 60_000,
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
  yearly: 365 * 86_400_000,
};

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function parseClock(time?: string | null) {
  const [h, m] = String(time || "09:00").split(":");
  const hour = Math.min(23, Math.max(0, Number(h) || 0));
  const minute = Math.min(59, Math.max(0, Number(m) || 0));
  return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function cronFromSchedule(input: Pick<AutomationInput, "frequency" | "time" | "minute" | "weekdays" | "dayOfMonth" | "interval" | "intervalUnit" | "cron">) {
  const clock = parseClock(input.time);
  const freq = input.frequency || (input.intervalUnit ? "custom" : null);
  if (!freq) return input.cron?.trim() || `${clock.minute} ${clock.hour} * * *`;
  if (freq === "hourly") return `${input.minute ?? 0} * * * *`;
  if (freq === "daily") return `${clock.minute} ${clock.hour} * * *`;
  if (freq === "weekdays") return `${clock.minute} ${clock.hour} * * 1-5`;
  if (freq === "weekly") {
    const days = (input.weekdays?.length ? input.weekdays : [5]).join(",");
    return `${clock.minute} ${clock.hour} * * ${days}`;
  }
  if (freq === "monthly") return `${clock.minute} ${clock.hour} ${input.dayOfMonth || 1} * *`;
  if (freq === "custom") {
    const unit = input.intervalUnit || "daily";
    const n = Math.max(1, input.interval || 1);
    if (unit === "minute") return n === 1 ? "* * * * *" : `*/${Math.min(n, 59)} * * * *`;
    if (unit === "hourly") return n === 1 ? `${clock.minute} * * * *` : `${clock.minute} */${Math.min(n, 23)} * * *`;
    if (unit === "daily") return `${clock.minute} ${clock.hour} * * *`;
    if (unit === "weekly") {
      const days = (input.weekdays?.length ? input.weekdays : [1]).join(",");
      return `${clock.minute} ${clock.hour} * * ${days}`;
    }
    if (unit === "monthly") return `${clock.minute} ${clock.hour} ${input.dayOfMonth || 1} * *`;
  }
  return `${clock.minute} ${clock.hour} * * *`;
}

function weekdayLabel(days: number[]) {
  return days.map((d) => WEEKDAY_NAMES[d] ?? String(d)).join("、");
}

export function scheduleLabelOf(input: AutomationInput) {
  if (input.scheduleLabel?.trim()) return input.scheduleLabel.trim();
  const clock = parseClock(input.time);
  const freq = input.frequency;
  if (freq === "hourly") return `每小时的第 ${input.minute ?? 0} 分`;
  if (freq === "daily") return `每天 ${clock.label}`;
  if (freq === "weekdays") return `每工作日 ${clock.label}`;
  if (freq === "weekly") {
    const days = input.weekdays?.length ? input.weekdays : [5];
    return `每周${weekdayLabel(days)} ${clock.label}`;
  }
  if (freq === "monthly") return `每月 ${input.dayOfMonth || 1} 号 ${clock.label}`;
  if (freq === "custom" || (input.interval && input.intervalUnit)) {
    const n = input.interval || 1;
    const unit = input.intervalUnit || "daily";
    if (unit === "minute") return `每 ${n} 分钟`;
    if (unit === "hourly") return n === 1 ? `每小时的第 ${clock.minute} 分` : `每 ${n} 小时的第 ${clock.minute} 分`;
    if (unit === "daily") return n === 1 ? `每天 ${clock.label}` : `每 ${n} 天 ${clock.label}`;
    if (unit === "weekly") {
      const days = input.weekdays?.length ? input.weekdays : [1];
      return n === 1 ? `每周${weekdayLabel(days)} ${clock.label}` : `每 ${n} 周的周${weekdayLabel(days)}，${clock.label}`;
    }
    if (unit === "monthly") return n === 1 ? `每月 ${input.dayOfMonth || 1} 号 ${clock.label}` : `每 ${n} 个月的 ${input.dayOfMonth || 1} 日，${clock.label}`;
    if (unit === "yearly") return `每 ${n} 年`;
  }
  if (input.delayMinutes && !input.recurring) return `${input.delayMinutes} 分钟后（一次）`;
  if (input.cron) {
    const parts = input.cron.trim().split(/\s+/);
    if (parts.length === 5) {
      const [min, hour, , , dow] = parts;
      if (hour !== "*" && min !== "*") {
        const t = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        if (dow === "1-5") return `每工作日 ${t}`;
        if (dow === "*") return `每天 ${t}`;
        return `每周${dow} ${t}`;
      }
    }
    return input.cron;
  }
  return "未设置计划";
}

function addCalendarMonths(from: Date, months: number) {
  const next = new Date(from.getTime());
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

function alignClock(at: Date, hour: number, minute: number) {
  at.setHours(hour, minute, 0, 0);
  return at;
}

export function computeNextRun(
  job: Pick<
    Automation,
    | "recurring"
    | "delayMinutes"
    | "cron"
    | "interval"
    | "intervalUnit"
    | "lastRunAt"
    | "createdAt"
    | "runCount"
    | "frequency"
    | "time"
    | "minute"
    | "weekdays"
    | "dayOfMonth"
    | "endsAt"
  >,
  from = Date.now(),
) {
  if (job.endsAt && job.endsAt <= from) return 0;
  if (!job.recurring && job.delayMinutes && job.runCount === 0) {
    const at = job.createdAt + job.delayMinutes * 60_000;
    if (at <= from) return from;
    if (job.endsAt && at > job.endsAt) return 0;
    return at;
  }

  const clock = parseClock(job.time);
  if (
    job.minute != null &&
    (job.frequency === "hourly" || job.intervalUnit === "hourly")
  ) {
    clock.minute = Math.min(59, Math.max(0, job.minute));
  }
  const n = Math.max(1, job.interval || 1);
  const unit = job.intervalUnit;
  const custom = job.frequency === "custom" || (!job.frequency && Boolean(unit && n > 1));

  if (custom && unit) {
    const origin = job.lastRunAt || job.createdAt || from;
    let at = 0;
    if (unit === "minute") {
      const step = n * UNIT_MS.minute;
      at = origin + step;
      while (at <= from) at += step;
    } else if (unit === "hourly") {
      const step = n * UNIT_MS.hourly;
      const d = new Date(origin);
      d.setMinutes(clock.minute, 0, 0);
      if (d.getTime() <= origin) d.setTime(d.getTime() + step);
      while (d.getTime() <= from) d.setTime(d.getTime() + step);
      at = d.getTime();
    } else if (unit === "daily") {
      const step = n * UNIT_MS.daily;
      const d = alignClock(new Date(origin), clock.hour, clock.minute);
      if (d.getTime() <= origin) d.setTime(d.getTime() + step);
      while (d.getTime() <= from) d.setTime(d.getTime() + step);
      at = d.getTime();
    } else if (unit === "weekly") {
      const step = n * UNIT_MS.weekly;
      const d = alignClock(new Date(origin), clock.hour, clock.minute);
      if (d.getTime() <= origin) d.setTime(d.getTime() + step);
      while (d.getTime() <= from) d.setTime(d.getTime() + step);
      at = d.getTime();
    } else if (unit === "monthly") {
      let d = alignClock(new Date(origin), clock.hour, clock.minute);
      if (d.getTime() <= origin) d = addCalendarMonths(d, n);
      while (d.getTime() <= from) d = addCalendarMonths(d, n);
      at = d.getTime();
    } else if (unit === "yearly") {
      const d = alignClock(new Date(origin), clock.hour, clock.minute);
      while (d.getTime() <= from) d.setFullYear(d.getFullYear() + n);
      at = d.getTime();
    }
    if (at) {
      if (job.endsAt && at > job.endsAt) return 0;
      return at;
    }
  }

  const cron = job.cron || cronFromSchedule(job);
  if (cron) {
    const at = nextFromCron(cron, from);
    if (job.endsAt && at > job.endsAt) return 0;
    return at;
  }
  return from + 60_000;
}

function normalize(input: AutomationInput, fallback?: Automation): Omit<Automation, "id" | "createdAt" | "runCount" | "lastRunAt" | "lastStatus" | "lastError" | "lastSessionId" | "runs" | "nextRunAt"> {
  const frequency: AutomationFrequency | null = input.frequency ?? fallback?.frequency ?? (input.intervalUnit ? "custom" : "daily");
  const merged: AutomationInput = {
    ...fallback,
    ...input,
    title: input.title,
    prompt: input.prompt,
    frequency,
    time: input.time ?? fallback?.time ?? "09:00",
    minute: input.minute ?? fallback?.minute ?? 0,
    weekdays: input.weekdays ?? fallback?.weekdays ?? (frequency === "weekly" ? [5] : null),
    dayOfMonth: input.dayOfMonth ?? fallback?.dayOfMonth ?? 1,
    interval: input.interval ?? fallback?.interval ?? (frequency === "custom" ? 1 : null),
    intervalUnit: input.intervalUnit ?? fallback?.intervalUnit ?? (frequency === "custom" ? "daily" : null),
  };
  merged.cron = cronFromSchedule(merged);
  merged.scheduleLabel = scheduleLabelOf(merged);
  return {
    title: (merged.title || "").trim() || merged.scheduleLabel || "未命名定时任务",
    prompt: (merged.prompt || "").trim(),
    cwd: merged.cwd?.trim() || "",
    enabled: merged.enabled !== false,
    recurring: merged.recurring !== false,
    delayMinutes: merged.delayMinutes ?? fallback?.delayMinutes ?? null,
    cron: merged.cron ?? null,
    interval: merged.interval ?? null,
    intervalUnit: merged.intervalUnit ?? null,
    maxRuns: merged.maxRuns ?? fallback?.maxRuns ?? null,
    frequency,
    time: merged.time ?? "09:00",
    minute: merged.minute ?? 0,
    weekdays: merged.weekdays ?? null,
    dayOfMonth: merged.dayOfMonth ?? 1,
    endsAt: merged.endsAt === undefined ? fallback?.endsAt ?? null : merged.endsAt,
    scheduleLabel: merged.scheduleLabel || "未设置计划",
  };
}

export function listAutomations() {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function getAutomation(id: string) {
  return readAll().find((row) => row.id === id) ?? null;
}

export function createAutomation(input: AutomationInput) {
  const now = Date.now();
  const base = normalize(input);
  const row: Automation = {
    id: `auto_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ...base,
    nextRunAt: 0,
    lastRunAt: null,
    lastStatus: null,
    lastError: "",
    lastSessionId: null,
    sessionCwd: null,
    runCount: 0,
    createdAt: now,
    runs: [],
  };
  row.nextRunAt = computeNextRun(row, now);
  const rows = readAll();
  rows.unshift(row);
  writeAll(rows);
  return row;
}

export function updateAutomation(
  id: string,
  patch: Partial<AutomationInput> &
    Partial<Pick<Automation, "enabled" | "nextRunAt" | "lastRunAt" | "lastStatus" | "lastError" | "lastSessionId" | "sessionCwd" | "runCount" | "runs">>,
) {
  const rows = readAll();
  const idx = rows.findIndex((row) => row.id === id);
  if (idx < 0) throw new Error("找不到这条自动化");
  const cur = rows[idx];
  const scheduleTouched =
    patch.cron !== undefined ||
    patch.interval !== undefined ||
    patch.intervalUnit !== undefined ||
    patch.delayMinutes !== undefined ||
    patch.recurring !== undefined ||
    patch.frequency !== undefined ||
    patch.time !== undefined ||
    patch.minute !== undefined ||
    patch.weekdays !== undefined ||
    patch.dayOfMonth !== undefined ||
    patch.endsAt !== undefined ||
    patch.maxRuns !== undefined ||
    (patch.enabled !== undefined && patch.enabled !== cur.enabled);
  const nextCwd = patch.cwd !== undefined ? (patch.cwd?.trim() || "") : cur.cwd;
  const cwdChanged = nextCwd !== cur.cwd;
  const shaped = scheduleTouched || patch.title !== undefined || patch.prompt !== undefined || patch.cwd !== undefined
    ? normalize(
        {
          title: patch.title ?? cur.title,
          prompt: patch.prompt ?? cur.prompt,
          cwd: patch.cwd !== undefined ? patch.cwd : cur.cwd,
          enabled: patch.enabled ?? cur.enabled,
          recurring: patch.recurring ?? cur.recurring,
          delayMinutes: patch.delayMinutes !== undefined ? patch.delayMinutes : cur.delayMinutes,
          cron: patch.cron !== undefined ? patch.cron : undefined,
          interval: patch.interval !== undefined ? patch.interval : cur.interval,
          intervalUnit: patch.intervalUnit !== undefined ? patch.intervalUnit : cur.intervalUnit,
          maxRuns: patch.maxRuns !== undefined ? patch.maxRuns : cur.maxRuns,
          frequency: patch.frequency !== undefined ? patch.frequency : cur.frequency,
          time: patch.time !== undefined ? patch.time : cur.time,
          minute: patch.minute !== undefined ? patch.minute : cur.minute,
          weekdays: patch.weekdays !== undefined ? patch.weekdays : cur.weekdays,
          dayOfMonth: patch.dayOfMonth !== undefined ? patch.dayOfMonth : cur.dayOfMonth,
          endsAt: patch.endsAt !== undefined ? patch.endsAt : cur.endsAt,
        },
        cur,
      )
    : null;
  const next: Automation = {
    ...cur,
    ...(shaped ?? {}),
    enabled: patch.enabled ?? cur.enabled,
    nextRunAt: patch.nextRunAt ?? cur.nextRunAt,
    lastRunAt: patch.lastRunAt !== undefined ? patch.lastRunAt : cur.lastRunAt,
    lastStatus: patch.lastStatus !== undefined ? patch.lastStatus : cur.lastStatus,
    lastError: patch.lastError !== undefined ? patch.lastError : cur.lastError,
    lastSessionId: patch.lastSessionId !== undefined ? patch.lastSessionId : cwdChanged ? null : cur.lastSessionId,
    sessionCwd: patch.sessionCwd !== undefined ? patch.sessionCwd : cwdChanged ? null : cur.sessionCwd,
    runCount: patch.runCount ?? cur.runCount,
    runs: patch.runs ?? cur.runs ?? [],
  };
  if (patch.nextRunAt === undefined) {
    if (!next.enabled) next.nextRunAt = 0;
    else if (scheduleTouched || cur.nextRunAt <= 0) next.nextRunAt = computeNextRun(next);
  }
  rows[idx] = next;
  writeAll(rows);
  return next;
}

export function deleteAutomation(id: string) {
  writeAll(readAll().filter((row) => row.id !== id));
  return true;
}

const STALE_RUNNING_MS = 30 * 60_000;

export function recoverStuckAutomations(now = Date.now(), opts?: { force?: boolean; skipIds?: Set<string> }) {
  const rows = readAll();
  let changed = false;
  const next = rows.map((row) => {
    if (row.lastStatus !== "running") return row;
    if (opts?.skipIds?.has(row.id)) return row;
    const started = row.runs?.find((item) => item.status === "running")?.at || row.lastRunAt || 0;
    if (!opts?.force && started && now - started < STALE_RUNNING_MS) return row;
    changed = true;
    const runs = [...(row.runs || [])];
    const idx = runs.findIndex((item) => item.status === "running");
    if (idx >= 0) {
      runs[idx] = { ...runs[idx], status: "error", error: "上次运行中断，已自动恢复" };
    }
    const recovered: Automation = {
      ...row,
      lastStatus: "error",
      lastError: "上次运行中断，已自动恢复",
      runs,
    };
    recovered.nextRunAt = recovered.enabled ? computeNextRun(recovered, now) : 0;
    return recovered;
  });
  if (changed) writeAll(next);
  return changed;
}

export function dueAutomations(now = Date.now(), skipIds?: Set<string>) {
  recoverStuckAutomations(now, { skipIds });
  return readAll().filter(
    (row) => row.enabled && row.lastStatus !== "running" && row.nextRunAt > 0 && row.nextRunAt <= now,
  );
}

export function markRunning(id: string, extra?: { trigger?: AutomationRun["trigger"] }) {
  const cur = getAutomation(id);
  if (!cur) throw new Error("找不到这条自动化");
  const run: AutomationRun = {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    trigger: extra?.trigger || "schedule",
    status: "running",
  };
  return updateAutomation(id, {
    lastStatus: "running",
    lastError: "",
    runs: [run, ...(cur.runs || [])].slice(0, 50),
  });
}

export function markFinished(
  id: string,
  ok: boolean,
  error?: string,
  extra?: { sessionId?: string; sessionCwd?: string; durationMs?: number },
) {
  const cur = getAutomation(id);
  if (!cur) throw new Error("找不到这条自动化");
  const runCount = cur.runCount + 1;
  const done = !cur.recurring || (cur.maxRuns != null && runCount >= cur.maxRuns) || (cur.endsAt != null && Date.now() >= cur.endsAt);
  const lastRunAt = Date.now();
  const runs = [...(cur.runs || [])];
  const idx = runs.findIndex((row) => row.status === "running");
  if (idx >= 0) {
    runs[idx] = {
      ...runs[idx],
      status: ok ? "ok" : "error",
      error: ok ? undefined : error || "运行失败",
      durationMs: extra?.durationMs,
      sessionId: extra?.sessionId,
    };
  } else {
    runs.unshift({
      id: `run_${Date.now().toString(36)}`,
      at: lastRunAt,
      trigger: "schedule",
      status: ok ? "ok" : "error",
      error: ok ? undefined : error || "运行失败",
      durationMs: extra?.durationMs,
      sessionId: extra?.sessionId,
    });
  }
  return updateAutomation(id, {
    runCount,
    lastRunAt,
    lastStatus: ok ? "ok" : "error",
    lastError: ok ? "" : error || "运行失败",
    lastSessionId: extra?.sessionId ?? cur.lastSessionId,
    sessionCwd: extra?.sessionCwd ?? cur.sessionCwd,
    enabled: done ? false : cur.enabled,
    nextRunAt: done ? 0 : computeNextRun({ ...cur, runCount, lastRunAt }),
    runs: runs.slice(0, 50),
  });
}

export function startAutomationLoop(tick: () => void) {
  const id = setInterval(() => {
    try {
      tick();
    } catch (err) {
      log("automation tick failed", err);
    }
  }, 15_000);
  return () => clearInterval(id);
}
