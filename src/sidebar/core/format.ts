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
