// Sprinter — data model and sprint rules.
//
// Sprints are never "rolled over" by a background job. Every sprint is derived
// from the calendar and the task log, so an open task simply keeps occupying
// its row in each new sprint until it is done or given up.
//
// Rules (agreed with Gustavo):
// - Weekly sprints run Monday → Sunday; monthly sprints run 1st → last day.
// - Every sprint has `slots` rows. Done and given-up tasks keep their row until
//   the end of the sprint where they were closed; the row frees up in the next
//   sprint.
// - A task keeps its row while it is carried, so the line linking its circles
//   stays straight.
// - Tasks are never edited or deleted. They can only be completed (undo allowed
//   within the current sprint), carried over, or given up.
// - Settings (cadence, tasks per sprint) can change, but only from the next
//   sprint on: past sprints keep the settings they had. Each stretch of sprints
//   sharing settings is an "era".

const KEY = 'sprinter.v1';
const THEME_KEY = 'sprinter.theme';
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// ---------- Dates (local time) ----------

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function sprintStart(date, cadence) {
  const d = startOfDay(date);
  if (cadence === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1);
  const fromMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - fromMonday);
}

export function addSprints(start, n, cadence) {
  return cadence === 'monthly'
    ? new Date(start.getFullYear(), start.getMonth() + n, 1)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n);
}

const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

/** Whole sprints between two sprint starts of the same cadence. */
const sprintsBetween = (a, b, cadence) => (cadence === 'monthly'
  ? (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
  : Math.round(daysBetween(a, b) / 7));

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / DAY + 1) / 7);
}

const toKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const mon = (d) => MONTHS[d.getMonth()].slice(0, 3).toUpperCase();

// ---------- State ----------

const empty = () => ({ config: null, tasks: [], debugDays: 0, lastBackupAt: null });

/** Older saves kept one fixed config; turn it into a single era. */
function migrate(d) {
  const s = { ...empty(), ...d };
  if (s.config && !s.config.eras) {
    s.config = { eras: [{ from: 0, start: s.config.anchor, cadence: s.config.cadence, slots: s.config.slots }] };
  }
  delete s.debugOffset;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

let state = load();
const listeners = new Set();

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function commit(next) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  listeners.forEach((fn) => fn());
}

/** Re-render without changing data (e.g. a new day started). */
export const refresh = () => listeners.forEach((fn) => fn());

// Ask Safari to keep our storage even under disk pressure.
navigator.storage?.persist?.().catch(() => {});

// ---------- Eras ----------

const erasOf = (s) => s.config.eras;

/** Settings in force for sprint `i`. */
export const eraAt = (i, s = state) => erasOf(s).filter((e) => e.from <= i).at(-1) ?? erasOf(s)[0];

/** Era in force on a given day. */
const eraOn = (date, s) => erasOf(s).filter((e) => fromKey(e.start) <= date).at(-1) ?? erasOf(s)[0];

// ---------- Derived ----------

/** "Now", shifted by the debug time travel. */
export function now(s = state) {
  const real = new Date();
  return s.debugDays ? new Date(real.getTime() + s.debugDays * DAY) : real;
}

export function currentSprint(s = state) {
  if (!s.config) return 0;
  const n = now(s);
  const e = eraOn(n, s);
  const base = sprintStart(fromKey(e.start), e.cadence);
  return e.from + Math.max(0, sprintsBetween(base, sprintStart(n, e.cadence), e.cadence));
}

/**
 * Dates of sprint `i`. The first sprint of an era may start mid-period (e.g. a
 * switch to monthly on Nov 9 gives a first sprint of Nov 9 – 30).
 */
export function interval(i, s = state) {
  const e = eraAt(i, s);
  const k = i - e.from;
  const base = sprintStart(fromKey(e.start), e.cadence);
  const start = k === 0 ? fromKey(e.start) : addSprints(base, k, e.cadence);
  const next = erasOf(s).find((x) => x.from === i + 1);
  return { start, end: next ? fromKey(next.start) : addSprints(base, k + 1, e.cadence) };
}

/** The sprint that would start if the user finished onboarding right now. */
export function firstInterval(cadence) {
  const start = sprintStart(new Date(), cadence);
  return { start, end: addSprints(start, 1, cadence) };
}

const closedSprint = (t) => t.done ?? t.gaveUp ?? null;

const activeIn = (i, s, cur) => s.tasks.filter((t) => i >= t.start && i <= (closedSprint(t) ?? cur));

/**
 * The rows of sprint `i`, each with its task (if any) and its state there.
 * Usually one row per slot; if the slot count went down while tasks were being
 * carried, those tasks keep their (higher) row until they close.
 * Empty rows past the slot count are `hidden`; empty rows of a full current
 * sprint are `blocked` (nothing can be added).
 */
export function slots(i, s = state) {
  const cur = currentSprint(s);
  const count = eraAt(i, s).slots;
  const active = activeIn(i, s, cur);
  const rows = Math.max(count, ...active.map((t) => t.row + 1));
  const full = active.length >= count;
  return Array.from({ length: rows }, (_, row) => {
    const t = active.find((x) => x.row === row);
    if (!t) {
      return { row, task: null, state: null, fromPrevious: false, toNext: false,
        hidden: row >= count, blocked: i === cur && full };
    }
    const st = t.done === i ? 'done' : t.gaveUp === i ? 'abandoned' : i < cur ? 'missed' : 'open';
    return { row, task: t, state: st, fromPrevious: i > t.start, toNext: i < (closedSprint(t) ?? cur) };
  });
}

/** Rows to lay out so every sprint lines up: the most any sprint needs. */
export function maxRows(s = state) {
  const cur = currentSprint(s);
  return Math.max(...erasOf(s).filter((e) => e.from <= cur + 1).map((e) => e.slots), ...s.tasks.map((t) => t.row + 1));
}

export const doneCount = (i, s = state) => slots(i, s).filter((x) => x.state === 'done').length;

/** Open tasks right now (they'll be carried into the next sprint). */
export const openCount = (s = state) => slots(currentSprint(s), s).filter((x) => x.state === 'open').length;

// ---------- Labels ----------

export function shortLabel(i, s = state) {
  const { start } = interval(i, s);
  return eraAt(i, s).cadence === 'weekly' ? `W${isoWeek(start)}` : mon(start);
}

export function longLabel(i, s = state) {
  const { start } = interval(i, s);
  return eraAt(i, s).cadence === 'weekly'
    ? `Week ${isoWeek(start)}`
    : `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
}

export function rangeLabel({ start, end }, month = mon) {
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  const tail = last.getMonth() === start.getMonth() ? `${last.getDate()}` : `${month(last)} ${last.getDate()}`;
  return `${month(start)} ${start.getDate()} – ${tail}`;
}

/** "Nov 2 – 8", for headings. */
export const rangeTitle = (range) => rangeLabel(range, (d) => MONTHS[d.getMonth()].slice(0, 3));

/** "Nov 9", for sentences. */
export const dayTitle = (d) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;

/** Whole days from today until `end` (the next sprint's first day). */
export const daysUntil = (end, s = state) => Math.max(0, daysBetween(now(s), end));

export function daysLeft(end, s = state) {
  const d = daysBetween(now(s), end);
  return d <= 1 ? 'Last day' : `${d} days left`;
}

/** "today", "yesterday", "3 days ago". */
export function ago(iso) {
  const d = daysBetween(new Date(iso), new Date());
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

// ---------- Statistics ----------

export function stats(s = state) {
  const cur = currentSprint(s);
  const done = s.tasks.filter((t) => t.done !== null).length;
  const gaveUp = s.tasks.filter((t) => t.gaveUp !== null).length;
  const open = s.tasks.length - done - gaveUp;

  // Finished sprints in a row (counting back from the last one) where every task got done:
  // nothing carried over, nothing given up.
  let streak = 0;
  for (let i = cur - 1; i >= 0; i--) {
    const rows = slots(i, s).filter((x) => x.task);
    if (!rows.length || rows.some((x) => x.state !== 'done')) break;
    streak++;
  }

  // The task that has been carried across the most sprints.
  let longest = null;
  for (const t of s.tasks) {
    const span = (closedSprint(t) ?? cur) - t.start + 1;
    if (span > 1 && (!longest || span > longest.span)) longest = { task: t, span };
  }

  const history = Array.from({ length: cur + 1 }, (_, i) => ({
    i, done: doneCount(i, s), slots: eraAt(i, s).slots, label: shortLabel(i, s), current: i === cur,
  }));

  return {
    total: s.tasks.length, done, gaveUp, open, streak, longest, history,
    rate: s.tasks.length ? Math.round((done / s.tasks.length) * 100) : null,
  };
}

// ---------- Mutations ----------

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const newTask = (emoji, title, row, start) => ({
  id: uid(), emoji, title, row, start,
  createdAt: now().toISOString(), done: null, doneAt: null, gaveUp: null,
});

export function completeOnboarding(cadence, count, drafts) {
  commit({
    ...empty(),
    config: { eras: [{ from: 0, start: toKey(sprintStart(new Date(), cadence)), cadence, slots: count }] },
    tasks: drafts.slice(0, count).map((d, row) => newTask(d.emoji, d.title, row, 0)),
  });
}

export function addTask(emoji, title) {
  const cur = currentSprint();
  const free = slots(cur).find((x) => !x.task && !x.hidden && !x.blocked);
  if (!free) return;
  commit({ ...state, tasks: [...state.tasks, newTask(emoji, title, free.row, cur)] });
}

/** Marks an open task as done, or undoes a check made in the current sprint. */
export function toggleDone(id) {
  const cur = currentSprint();
  commit({
    ...state,
    tasks: state.tasks.map((t) => {
      if (t.id !== id) return t;
      if (t.done === cur) return { ...t, done: null, doneAt: null };
      if (closedSprint(t) === null) return { ...t, done: cur, doneAt: now().toISOString() };
      return t;
    }),
  });
}

export function giveUp(id) {
  const cur = currentSprint();
  commit({
    ...state,
    tasks: state.tasks.map((t) => (t.id === id && closedSprint(t) === null ? { ...t, gaveUp: cur } : t)),
  });
}

/** Settings waiting for the next sprint, if any. */
export function pendingSettings(s = state) {
  return erasOf(s).find((e) => e.from === currentSprint(s) + 1) ?? null;
}

/**
 * Change cadence and/or tasks per sprint starting with the next sprint.
 * The next sprint begins when the current one ends, whatever the new cadence.
 */
export function scheduleSettings(cadence, count) {
  const cur = currentSprint();
  const kept = erasOf(state).filter((e) => e.from <= cur);
  const active = kept.at(-1);
  const eras = active.cadence === cadence && active.slots === count
    ? kept
    : [...kept, { from: cur + 1, start: toKey(interval(cur).end), cadence, slots: count }];
  commit({ ...state, config: { ...state.config, eras } });
}

export const reset = () => commit(empty());

// ---------- Backup ----------

export const exportJSON = () =>
  JSON.stringify({ app: 'sprinter', version: 2, exportedAt: new Date().toISOString(), ...state }, null, 2);

export const markBackup = () => commit({ ...state, lastBackupAt: new Date().toISOString() });

export function importJSON(text) {
  const d = JSON.parse(text);
  const c = d?.config;
  const valid = d && Array.isArray(d.tasks) && (c === null || (c && (Array.isArray(c.eras) || (c.anchor && c.slots))));
  if (!valid) throw new Error('Not a Sprinter backup');
  const { app, version, exportedAt, ...rest } = d;
  commit(migrate(rest));
}

// ---------- Appearance (per device, not part of backups) ----------

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
}

export function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  refresh();
}

// ---------- Developer tools ----------

/** Jump to the first day of the next sprint. */
export const advanceSprint = () =>
  commit({ ...state, debugDays: state.debugDays + daysUntil(interval(currentSprint()).end) });

/** Four weeks of history, for trying the timeline (open the app with ?demo). */
export function seedDemo() {
  const anchor = addSprints(sprintStart(new Date(), 'weekly'), -3, 'weekly');
  const t = (emoji, title, row, start, done = null, gaveUp = null) =>
    ({ ...newTask(emoji, title, row, start), done, gaveUp, doneAt: done === null ? null : anchor.toISOString() });
  commit({
    ...empty(),
    config: { eras: [{ from: 0, start: toKey(anchor), cadence: 'weekly', slots: 5 }] },
    tasks: [
      t('🏃', 'Run 10k', 0, 0, 1),
      t('📚', 'Finish Dune', 1, 0),
      t('🎨', 'Termoli poster', 2, 0, 0),
      t('🧾', 'Pay taxes', 3, 0, null, 2),
      t('🗣️', 'Italian lesson', 4, 0, 3),
      t('☕️', 'Coffee with Rafa', 2, 1, 1),
      t('💻', 'Portfolio update', 0, 2),
      t('🎬', 'Edit motion reel', 2, 2, 2),
    ],
  });
}
