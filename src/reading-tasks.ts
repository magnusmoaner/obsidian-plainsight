import { App, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, Plugin } from "obsidian";
import { editTaskLine, withTaskStatus, withTaskText } from "./sidebar/actions";
import { localISODate } from "./sidebar/core/format";
import { taskFields } from "./sidebar/core/task-fields";
import { matchTaskLine, taskTextColumn } from "./sidebar/core/tasks";
import { tasksEditLine } from "./sidebar/internals";
import { BadgeEdits, taskBadges } from "./sidebar/task-badges";

/*
 * Reading view: a task's Tasks fields as the same badge row as in the
 * editor. Its text is drawn again without the fields, in place of Obsidian's
 * (or the Tasks plugin's) own; the checkbox, collapse arrow and sub-lists
 * stay. Tasks draws its lines asynchronously and may redraw them, so each
 * section is watched and its tasks done again when that happens.
 */

/** What a task item keeps of its own: everything else is its text, drawn again. */
const KEEP = "input.task-list-item-checkbox, ul, ol, .list-collapse-indicator, .list-bullet";

export function registerReadingTasks(plugin: Plugin, enabled: () => boolean): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    if (!enabled() || !el.querySelector("li.task-list-item")) return;
    const child = new MarkdownRenderChild(el);
    const busy = new WeakSet<HTMLElement>();
    const run = () => {
      const info = ctx.getSectionInfo(el);
      if (!info) return; // an embed or hover preview: left as drawn
      const lines = info.text.split("\n");
      for (const li of Array.from(el.querySelectorAll<HTMLElement>("li.task-list-item"))) {
        if (busy.has(li) || li.querySelector(":scope > .ps-task-badges")) continue;
        const rel = Number(li.dataset.line ?? li.querySelector<HTMLElement>(":scope > input")?.dataset.line);
        if (Number.isNaN(rel)) continue;
        busy.add(li);
        void decorate(plugin.app, li, info.lineStart + rel, lines, ctx, child).finally(() => busy.delete(li));
      }
    };
    const observer = new MutationObserver(run);
    child.register(() => observer.disconnect());
    ctx.addChild(child);
    run();
    observer.observe(el, { childList: true, subtree: true });
  });
}

async function decorate(
  app: App,
  li: HTMLElement,
  lineNo: number,
  lines: string[],
  ctx: MarkdownPostProcessorContext,
  component: MarkdownRenderChild
): Promise<void> {
  const line = lines[lineNo]?.replace(/\r$/, "");
  const task = line === undefined ? null : matchTaskLine(line);
  if (!line || !task) return;
  const text = line.slice(taskTextColumn(line));
  const { hidden, details } = taskFields(text);
  if (!hidden.length) return;

  let visible = "";
  let at = 0;
  for (const s of hidden) {
    visible += text.slice(at, s.from);
    at = s.to;
  }
  visible += text.slice(at);
  const rendered = createDiv();
  await MarkdownRenderer.render(app, visible, rendered, ctx.sourcePath, component);
  if (!li.isConnected) return;

  for (const node of Array.from(li.childNodes)) {
    if (!(node instanceof HTMLElement && node.matches(KEEP))) node.remove();
  }
  const textEl = createSpan("ps-task-text");
  textEl.append(...Array.from((rendered.querySelector("p") ?? rendered).childNodes));
  const closed = /[xX-]/.test(task.status);
  const row = createSpan({ cls: "ps-task-badges" });
  const ref = { line: lineNo, status: task.status, text: task.text };
  const inTasks = tasksEditLine(app);
  const edits: BadgeEdits = {
    app,
    status: task.status,
    change: (edit) => void editTaskLine(app, ctx.sourcePath, ref, (l) => withTaskText(l, edit)),
    setStatus: (status) => void editTaskLine(app, ctx.sourcePath, ref, (l) => withTaskStatus(l, status)),
    inTasks: inTasks ? () => void editTaskLine(app, ctx.sourcePath, ref, inTasks) : undefined,
  };
  taskBadges(row, details, closed, localISODate(), {}, edits);
  row.toggleClass("is-empty", !row.childElementCount);
  row.toggleClass("is-closed", closed);
  const sub = li.querySelector(":scope > ul, :scope > ol");
  li.insertBefore(textEl, sub);
  li.insertBefore(row, sub);
}
