const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function cardDate(time: number, now: number = Date.now()): string {
  const diff = now - time;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = new Date(time);
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

export function localISODate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Core Templates placeholders: {{title}}, {{date}}, {{time}}, {{date:FMT}},
 * {{time:FMT}}. `format` is injected (moment in the app) to keep this pure.
 */
export function applyTemplate(
  text: string,
  title: string,
  format: (pattern: string) => string,
  dateFormat: string,
  timeFormat: string
): string {
  return text.replace(
    /\{\{(title|date|time)(?::([^}]+))?\}\}/g,
    (_, key: string, custom?: string) => {
      if (key === "title") return title;
      return format(custom ?? (key === "date" ? dateFormat : timeFormat));
    }
  );
}

/** Whole days from `fromIso` to `toIso` (YYYY-MM-DD), negative if earlier. */
function dayDiff(fromIso: string, toIso: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toIso) - utc(fromIso)) / 86_400_000);
}

/**
 * A due date relative to today, in the same spirit as cardDate: "Today",
 * "Tomorrow", "Yesterday", "in 3 days", "3 days ago" within a week, then
 * "Jan 27" (this year) or "Jan 27, 2027".
 */
export function dueDateLabel(due: string, today: string): string {
  const days = dayDiff(today, due);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return `in ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  const [y, m, d] = due.split("-").map(Number);
  const label = `${MONTHS[m - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? label : `${label}, ${y}`;
}
