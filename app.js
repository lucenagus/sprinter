import { html, render, useState, useEffect, useLayoutEffect, useRef, useReducer } from './vendor/preact-htm.js';
import * as S from './store.js';
import { suggest, normalize } from './emoji.js';
import { PHOSPHOR } from './icons.js';

// ================= Platform helpers =================

const params = new URLSearchParams(location.search);
const DEV_URL = params.has('dev');
// Demo mode (Options → Demo mode, or ?demo): sample sprints in their own storage.
if (params.has('demo') && !S.isDemo) S.setDemo(true);
else {
  if (S.isDemo && (params.has('demo') || !S.getState().config)) S.seedDemo();
  if (params.has('demo')) history.replaceState(null, '', location.pathname + (DEV_URL ? '?dev' : ''));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// Lets :active styles fire on iOS.
document.addEventListener('touchstart', () => {}, { passive: true });

// Keep bottom sheets above the iOS keyboard.
const vv = window.visualViewport;
if (vv) {
  const sync = () => document.documentElement.style.setProperty(
    '--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

/** Light tap feedback. Safari (iOS 18+) ticks when a hidden switch toggles. */
const haptic = (() => {
  let label = null;
  return () => {
    try {
      if (!label) {
        const input = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'haptic-switch', tabIndex: -1 });
        input.setAttribute('switch', '');
        label = Object.assign(document.createElement('label'), { htmlFor: 'haptic-switch' });
        const box = document.createElement('div');
        box.setAttribute('aria-hidden', 'true');
        box.style.cssText = 'position:fixed;left:-10px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
        box.append(input, label);
        document.body.append(box);
      }
      label.click();
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
    } catch { /* haptics are a nice-to-have */ }
  };
})();

/** iOS only raises the keyboard for focus() during a tap: borrow the tap. */
const primeKeyboard = () => document.getElementById('kb-proxy')?.focus({ preventScroll: true });

const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };
const pad = (n) => String(n).padStart(2, '0');

function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => S.subscribe(force), []);
  return S.getState();
}

function useLongPress(fn, ms = 650) {
  const timer = useRef();
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: () => { cancel(); timer.current = setTimeout(fn, ms); },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => e.preventDefault(),
  };
}

// ================= Icons =================

/** Phosphor icon by name; inherits the text color. */
function Ico({ n, cls = '' }) {
  const body = PHOSPHOR[n];
  return body
    ? html`<svg class=${`ico ico-${n} ${cls}`} viewBox="0 0 256 256" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: body }} />`
    : null;
}

// ================= Task circle =================

/** A slot: a task (open / done / abandoned / missed), an empty "+" slot, or an empty past slot. */
function TaskCircle({ emoji, state, addable, size, surface }) {
  const cls = ['circle', state || '', !emoji && addable ? 'addable' : '', !emoji && !addable ? 'empty' : ''].join(' ');
  return html`<span class=${cls} style=${surface ? { '--s': `${size}px`, '--surface': surface } : { '--s': `${size}px` }}>
    ${state === 'missed'
      ? html`<${Ico} n="arrowBold" />`
      : emoji
        ? html`<span class="emoji" key=${emoji}>${emoji}</span>`
        : addable ? html`<${Ico} n="plusBold" />` : null}
    ${state === 'done' && html`<span class="badge"><${Ico} n="check" /></span>`}
    ${state === 'abandoned' && html`<span class="badge skull"><${Ico} n="skull" /></span>`}
  </span>`;
}

// ================= Bottom sheet =================

function Sheet({ open, onClose, children }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const last = useRef(null);
  const sheetEl = useRef();
  const [h, setH] = useState(420);
  if (open && children) last.current = children; // keep content visible while closing

  // Track the sheet's height so the blur behind it can follow (e.g. Options → Statistics).
  useLayoutEffect(() => {
    const el = sheetEl.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    document.activeElement?.blur?.();
    setShown(false);
    const t = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted && !open) return null;
  return html`<div class=${`layer ${shown ? 'shown' : ''}`} style=${{ '--sh': `${h}px` }}>
    <div class="backdrop" onClick=${onClose} />
    <div class="sheet" ref=${sheetEl} role="dialog" aria-modal="true">${open ? children : last.current}</div>
  </div>`;
}

function SheetHead({ label, onClose }) {
  return html`<div class="sheet-head">
    <span class="mono s10 ash">${label}</span>
    <button class="close" aria-label="Close" onClick=${onClose}><${Ico} n="x" /></button>
  </div>`;
}

// ================= Emoji picker =================
// Every emoji (≈1,900), searchable in English or Portuguese. The list loads the
// first time the picker opens. Typing an emoji from the system emoji keyboard
// into the search field picks it straight away, so nothing is out of reach.

let EMOJI_ALL = null;
const loadEmoji = () => (EMOJI_ALL
  ? Promise.resolve(EMOJI_ALL)
  : import('./emoji-data.js').then(({ EMOJI_GROUPS }) => (EMOJI_ALL = EMOJI_GROUPS.map(([name, text]) => ({
    name,
    items: text.split('\n').map((line) => {
      const i = line.indexOf(' ');
      return { e: line.slice(0, i), words: ` ${line.slice(i + 1)}` };
    }),
  })))));

const GRAPHEMES = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const IS_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
/** The last emoji typed into a string, if any (keeps skin tones, flags and ZWJ sequences whole). */
function lastEmoji(s) {
  if (!s || !IS_EMOJI.test(s)) return null;
  const parts = GRAPHEMES ? [...GRAPHEMES.segment(s)].map((g) => g.segment) : [...s];
  return parts.filter((g) => IS_EMOJI.test(g)).at(-1) || null;
}

function EmojiPicker({ current, suggested, onPick }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(EMOJI_ALL);
  useEffect(() => { if (!all) loadEmoji().then(setAll); }, []);

  const onInput = (e) => {
    const v = e.currentTarget.value;
    const typed = lastEmoji(v);
    if (typed) { onPick(typed); return; }
    setQ(v);
  };

  const keep = (e) => e.preventDefault(); // tapping an emoji shouldn't close the keyboard
  const chip = (e) => html`<button key=${e} class=${`chip ${e === current ? 'on' : ''}`}
    onMouseDown=${keep} onClick=${() => onPick(e)}>${e}</button>`;

  const words = normalize(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let body;
  if (!all) {
    body = html`<p class="picker-empty mono s9 ash">Loading…</p>`;
  } else if (words.length) {
    const hits = [];
    for (const g of all) for (const it of g.items) if (words.every((w) => it.words.includes(` ${w}`))) hits.push(it.e);
    body = hits.length
      ? html`<div class="picker-grid">${hits.slice(0, 240).map(chip)}</div>`
      : html`<p class="picker-empty mono s9 ash">Nothing for “${q.trim()}”. Try the emoji keyboard.</p>`;
  } else {
    body = [
      html`<section key="sug"><span class="picker-label mono s9 ash">Suggested</span><div class="picker-grid">${suggested.map(chip)}</div></section>`,
      ...all.map((g) => html`<section key=${g.name} class="picker-group">
        <span class="picker-label mono s9 ash">${g.name}</span>
        <div class="picker-grid">${g.items.map((it) => chip(it.e))}</div>
      </section>`),
    ];
  }

  return html`<div class="picker">
    <label class="picker-search">
      <${Ico} n="search" />
      <input type="search" placeholder="Search, or type any emoji" value=${q} autocomplete="off"
        autocorrect="off" spellcheck="false" enterkeyhint="search" onInput=${onInput} />
    </label>
    <div class="picker-scroll">${body}</div>
  </div>`;
}

/** Write a task (emoji suggested while typing), then confirm the commitment. */
function AddTaskSheet({ heading = 'New task', onCommit, onClose }) {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState(null);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const input = useRef();

  const suggestions = suggest(title);
  const emoji = picked ?? suggestions[0];
  const trimmed = title.trim();

  useEffect(() => { if (!confirming) input.current?.focus({ preventScroll: true }); }, [confirming]);

  const choose = (e) => { setPicked(e); setPicking(false); input.current?.focus({ preventScroll: true }); };
  const next = () => {
    if (!trimmed) return;
    input.current?.blur();
    setPicking(false);
    setConfirming(true);
  };
  const edit = () => { primeKeyboard(); setConfirming(false); };
  const commit = () => { haptic(); onCommit(emoji, trimmed); onClose(); };
  const keepFocus = (e) => e.preventDefault(); // tapping an emoji shouldn't close the keyboard

  const chip = (e) => html`<button key=${e} class=${`chip ${e === emoji ? 'on' : ''}`}
    onMouseDown=${keepFocus} onClick=${() => choose(e)}>${e}</button>`;

  if (confirming) {
    return html`
      <${SheetHead} label="Commit to this?" onClose=${onClose} />
      <div class="stack swap" key="confirm">
        <div class="big-row">
          <${TaskCircle} emoji=${emoji} state="open" size=${60} surface="var(--paper)" />
          <span class="big-title">${trimmed}</span>
        </div>
        <p class="quiet">Once registered, a task can't be edited or deleted. You can only complete it — or give it up.</p>
        <div class="btn-row">
          <button class="pill outline" onClick=${edit}>Edit</button>
          <button class="pill" onClick=${commit}>Commit</button>
        </div>
      </div>`;
  }

  return html`
    <${SheetHead} label=${heading} onClose=${onClose} />
    <div class="stack swap" key="write">
      <div class="write-row">
        <button class="emoji-pick" aria-label="Choose emoji"
          onClick=${() => { input.current?.blur(); setPicking((p) => !p); }}>
          <${TaskCircle} emoji=${emoji} state="open" size=${60} surface="var(--paper)" />
          <span class="hint"><${Ico} n=${picking ? 'x' : 'plus'} /></span>
        </button>
        <input ref=${input} class="title-input" placeholder="What will you do?" value=${title}
          maxlength="32" enterkeyhint="next" autocomplete="off"
          onInput=${(e) => setTitle(e.currentTarget.value)}
          onFocus=${() => setPicking(false)}
          onKeyDown=${(e) => { if (e.key === 'Enter') next(); }} />
      </div>
      ${picking
        ? html`<${EmojiPicker} current=${emoji} suggested=${suggestions} onPick=${choose} />`
        : html`<div>
            <span class="mono s9 ash">Suggested · tap the circle for every emoji</span>
            <div class="chips">${suggestions.map(chip)}</div>
          </div>`}
      <div class="foot">
        <span class="mono s10 ash">${title.length}/32</span>
        <button class="pill" disabled=${!trimmed} onClick=${next}>Add task</button>
      </div>
    </div>`;
}

/**
 * Black popup next to a task in the current sprint (long-press the circle, or "•••").
 * Open task: mark as done or give up (with a confirm step). Done task: undo.
 */
function ActionPopup({ pop, onClose }) {
  const { task, rect, closing } = pop;
  const [confirm, setConfirm] = useState(!!pop.confirm);
  const [pos, setPos] = useState(null);
  const box = useRef();

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 16;
    const below = rect.bottom + 8;
    const top = below + h <= window.innerHeight - margin - 24 ? below : Math.max(margin, rect.top - 8 - h);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - margin - w);
    const ox = rect.left + rect.width / 2 - left;
    const oy = top >= rect.bottom ? 0 : h;
    setPos({ top, left, origin: `${ox}px ${oy}px` });
  }, [confirm]);

  const act = (fn) => () => { haptic(); fn(); onClose(); };
  const done = task.done !== null;

  return html`<div class=${`pop-layer ${closing ? 'closing' : ''}`}>
    <div class="pop-catcher" onClick=${onClose} onPointerDown=${(e) => e.preventDefault()} />
    <div ref=${box} class=${`pop ${pos ? 'placed' : ''}`} role="menu"
      style=${pos ? { top: `${pos.top}px`, left: `${pos.left}px`, transformOrigin: pos.origin } : { visibility: 'hidden' }}>
      <div class="pop-head">
        <span class="pop-emoji">${task.emoji}</span>
        <span class="pop-title">${task.title}</span>
      </div>
      ${confirm
        ? html`<div class="pop-confirm swap" key="confirm">
            <p>Give up for good? It stays with a skull and its slot frees up next sprint.</p>
            <div class="pop-btns">
              <button class="pop-pill ghost" onClick=${() => { haptic(); if (pop.confirm) onClose(); else setConfirm(false); }}>Keep</button>
              <button class="pop-pill" onClick=${act(() => S.giveUp(task.id))}>Give up</button>
            </div>
          </div>`
        : done
          ? html`<div class="swap" key="done">
              <button class="pop-item" role="menuitem" onClick=${act(() => S.toggleDone(task.id))}><${Ico} n="undo" /><span>Undo done</span></button>
            </div>`
          : html`<div class="swap" key="open">
              <button class="pop-item" role="menuitem" onClick=${act(() => S.toggleDone(task.id))}><${Ico} n="checkCircle" /><span>Mark as done</span></button>
              <button class="pop-item" role="menuitem" onClick=${() => { haptic(); setConfirm(true); }}><${Ico} n="skullLine" /><span>Give up</span></button>
            </div>`}
    </div>
  </div>`;
}

function OptionsSheet({ dev, onClose }) {
  const [view, setView] = useState('list'); // list | settings | stats | reset
  const [note, setNote] = useState('');
  const [theme, setThemeState] = useState(S.getTheme());
  const file = useRef();
  const last = S.getState().lastBackupAt;

  async function exportBackup() {
    haptic();
    const name = `sprinter-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const asFile = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [asFile] })) {
      try { await navigator.share({ files: [asFile], title: 'Sprinter backup' }); S.markBackup(); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    S.markBackup();
    setNote('Backup saved');
  }

  async function importBackup(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      S.importJSON(await f.text());
      haptic();
      setNote('Backup restored');
      setTimeout(onClose, 700);
    } catch {
      setNote("That file isn't a Sprinter backup");
    }
  }

  const pickTheme = (t) => { haptic(); setThemeState(t); S.setTheme(t); };
  const back = (msg = '') => { setView('list'); setNote(msg); };

  const opt = (icon, t, fn, meta) => html`<button class="opt" onClick=${fn}>
    <${Ico} n=${icon} />
    <span class="t">${t}</span>
    ${meta && html`<span class="mono s9 ash opt-meta">${meta}</span>`}
  </button>`;

  if (view === 'reset') {
    return html`
      <${SheetHead} label="Reset everything?" onClose=${onClose} />
      <div class="stack swap" key="reset">
        <p class="quiet">Every sprint and task on this phone will be erased and you'll start over. Export a backup first if you want to keep them.</p>
        <div class="btn-row">
          <button class="pill outline" onClick=${() => setView('list')}>Cancel</button>
          <button class="pill" onClick=${() => { haptic(); S.reset(); onClose(); }}>Erase</button>
        </div>
      </div>`;
  }
  if (view === 'settings') return html`<${SprintSettings} onBack=${back} onClose=${onClose} />`;
  if (view === 'stats') return html`<${Stats} onBack=${back} onClose=${onClose} />`;

  return html`
    <${SheetHead} label="Options" onClose=${onClose} />
    <div class="opts swap" key="list">
      ${opt('calendar', 'Sprint settings', () => { haptic(); setView('settings'); })}
      ${opt('stats', 'Statistics', () => { haptic(); setView('stats'); })}
      <div class="opt static">
        <${Ico} n="moon" />
        <span class="t">Appearance</span>
        <div class="seg" role="radiogroup" aria-label="Appearance">
          ${['auto', 'light', 'dark'].map((t) => html`<button role="radio" aria-checked=${theme === t}
            class=${`seg-item mono s9 ${theme === t ? 'on' : ''}`} onClick=${() => pickTheme(t)}>${t}</button>`)}
        </div>
      </div>
      ${opt('export', 'Export backup', exportBackup, last ? S.ago(last) : 'Never')}
      ${opt('import', 'Import backup', () => file.current.click())}
      ${opt('sparkle', 'Demo mode', () => { haptic(); S.setDemo(!S.isDemo); }, S.isDemo ? 'On' : 'Off')}
      ${opt('reset', S.isDemo ? 'Reset demo' : 'Reset everything', () => (S.isDemo ? (haptic(), S.seedDemo(), onClose()) : setView('reset')))}
      ${dev && html`<span class="mono s9 ash opts-label">Developer</span>`}
      ${dev && opt('forward', 'Simulate next sprint', () => { haptic(); S.advanceSprint(); onClose(); })}
    </div>
    <input type="file" accept="application/json,.json" ref=${file} style="display:none" onChange=${importBackup} />
    ${note && html`<div class="mono s10 note">${note}</div>`}`;
}

/** Cadence and tasks per sprint, applied from the next sprint on. */
function SprintSettings({ onBack, onClose }) {
  const cur = S.currentSprint();
  const active = S.eraAt(cur);
  const planned = S.pendingSettings() ?? active;
  const [cadence, setCadence] = useState(planned.cadence);
  const [count, setCount] = useState(planned.slots);
  const min = Math.max(2, S.openCount());
  const nextStart = S.interval(cur).end;
  const differs = cadence !== active.cadence || count !== active.slots;
  const dirty = cadence !== planned.cadence || count !== planned.slots;

  const save = () => { haptic(); S.scheduleSettings(cadence, count); onBack(differs ? `Starts ${S.dayTitle(nextStart)}` : 'Saved'); };
  const step = (d) => { haptic(); setCount((c) => Math.min(12, Math.max(min, c + d))); };

  return html`
    <${SheetHead} label="Sprint settings" onClose=${onClose} />
    <div class="stack swap" key="settings">
      <div class="seg wide" role="radiogroup" aria-label="Sprint length">
        ${[['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => html`<button role="radio" aria-checked=${cadence === v}
          class=${`seg-item mono s10 ${cadence === v ? 'on' : ''}`} onClick=${() => { haptic(); setCadence(v); }}>${l}</button>`)}
      </div>
      <div class="set-row">
        <span class="t">Tasks per sprint</span>
        <div class="stepper">
          <button class="round sm" aria-label="Fewer" disabled=${count <= min} onClick=${() => step(-1)}><${Ico} n="minus" /></button>
          <span class="count-sm" key=${count}>${count}</span>
          <button class="round sm" aria-label="More" disabled=${count >= 12} onClick=${() => step(1)}><${Ico} n="plus" /></button>
        </div>
      </div>
      <p class="quiet">
        ${differs
          ? `From ${S.dayTitle(nextStart)}, when the next sprint starts. Past sprints keep their settings.`
          : 'These are your current settings.'}
        ${min > 2 && ` You have ${min} open tasks, so the next sprint needs at least ${min} slots.`}
      </p>
      <div class="btn-row">
        <button class="pill outline" onClick=${() => onBack()}>Cancel</button>
        <button class="pill" disabled=${!dirty} onClick=${save}>Save</button>
      </div>
    </div>`;
}

function Stats({ onBack, onClose }) {
  const st = S.stats();
  const recent = st.history.slice(-9); // as many as fit a phone's width
  const tile = (value, label, icon) => html`<div class="tile">
    <${Ico} n=${icon} />
    <span class="tile-num">${value}</span>
    <span class="mono s9 ash">${label}</span>
  </div>`;

  return html`
    <${SheetHead} label="Statistics" onClose=${onClose} />
    <div class="stack swap" key="stats">
      <div class="tiles">
        ${tile(st.rate === null ? '—' : `${st.rate}%`, 'Completed', 'lightning')}
        ${tile(st.streak, st.streak === 1 ? 'Clean sprint' : 'Clean sprints', 'trophy')}
        ${tile(st.done, 'Done', 'checkCircle')}
        ${tile(st.gaveUp, 'Gave up', 'skullLine')}
      </div>
      <div>
        <span class="mono s9 ash">Done in recent sprints</span>
        <div class="chart">
          ${recent.map((h) => html`<div class=${`chart-col ${h.current ? 'now' : ''}`} key=${h.i}>
            <div class="chart-track"><div class="chart-fill" style=${{ height: `${(h.done / h.slots) * 100}%` }} /></div>
            <span class="mono s9 ash">${h.label}</span>
          </div>`)}
        </div>
      </div>
      ${st.longest && html`<div>
        <span class="mono s9 ash">Carried the longest</span>
        <div class="big-row longest">
          <${TaskCircle} emoji=${st.longest.task.emoji} state="open" size=${44} surface="var(--paper)" />
          <span class="t">${st.longest.task.title}</span>
          <span class="mono s9 ash">${st.longest.span} sprints</span>
        </div>
      </div>`}
      <button class="pill outline block" onClick=${() => onBack()}>Back</button>
    </div>`;
}

// ================= Timeline =================
//
// One horizontal strip, two modes:
// - wideview: every sprint is a slim bar; the centered one is emphasized.
// - sprintview: every sprint is a full card with its task list. Swiping moves
//   to the previous or next card; the header describes the centered one.
// The strip is magnetic in both modes (scroll snapping, one sprint per swipe).

/**
 * Bars fill the full height. Each slot is a card; cards share the bar's height
 * with the same gap as the bar's padding, and rows line up across sprints so
 * carry lines stay straight.
 */
function barMetrics(width, height, rows) {
  const barH = Math.max(240, height - 12 - 16 - 34); // track padding, marker under the bar
  const pad = 6;          // gap between cards = gap between sprints
  const cardW = 64;       // card width in wideview (and the emoji column when open)
  const cardH = (barH - pad * (rows - 1)) / rows;
  const cardR = Math.min(20, cardH / 2);
  return {
    pad, cardW, cardH, cardR, gap: pad, barH,
    barR: cardR,
    collapsedW: cardW,
    expandedW: width - 48,
  };
}

function Row({ slot, isCurrent, expanded, m, onAdd, onToggle, onMenu }) {
  const { task, state } = slot;
  const style = { height: `${m.cardH}px`, borderRadius: `${m.cardR}px` };
  const hold = useRef({});

  // Microanimation when a current task is checked, given up, or un-checked.
  const prev = useRef(state);
  const fx = useRef('');
  const [, bump] = useReducer((x) => x + 1, 0);
  if (prev.current !== state) {
    const from = prev.current;
    prev.current = state;
    fx.current = !isCurrent ? ''
      : from === 'open' && state === 'done' ? 'fx-done'
      : from === 'open' && state === 'abandoned' ? 'fx-gaveup'
      : from === 'done' && state === 'open' ? 'fx-undo' : '';
  }
  useEffect(() => {
    if (!fx.current || fx.current === 'fx-rest') return undefined;
    // Settle into a resting class: dropping the effect class would let the
    // entrance animation (cardIn) replay and make the card blink.
    const t = setTimeout(() => { fx.current = 'fx-rest'; bump(); }, 1150);
    return () => clearTimeout(t);
  }, [state]);

  // Rows past this sprint's slot count (after the count went down) stay empty.
  if (slot.hidden) return html`<div class="card hidden" style=${style} aria-hidden="true" />`;

  if (isCurrent && !task && !slot.blocked) {
    return html`<button class="card addable" style=${style} onClick=${stop(onAdd)}>
      <span class="card-icon" style=${{ width: `${m.cardW}px` }}><${Ico} n="plusBold" /></span>
      <span class="detail"><span class="title">Add a task</span></span>
    </button>`;
  }

  // Current-sprint tasks: long-press the card for actions (in both views).
  // A plain tap toggles done in sprintview; in wideview it falls through to the bar.
  const holdable = isCurrent && !!task && (state === 'open' || state === 'done');
  const tappable = holdable && expanded;
  const clear = () => clearTimeout(hold.current.timer);
  const press = holdable ? {
    onPointerDown: (e) => {
      clear();
      const el = e.currentTarget;
      hold.current = {
        x: e.clientX, y: e.clientY, fired: false,
        timer: setTimeout(() => { hold.current.fired = true; onMenu(task, el); }, 450),
      };
    },
    onPointerMove: (e) => { if (Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) clear(); },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e) => e.preventDefault(),
  } : {};
  const click = (e) => {
    if (hold.current.fired) { hold.current.fired = false; e.stopPropagation(); return; }
    if (tappable) { e.stopPropagation(); onToggle(task); }
  };

  return html`<div class=${`card ${task ? state : 'empty'} ${holdable ? 'hold' : ''} ${fx.current}`} style=${style}
      role=${tappable ? 'button' : undefined} tabindex=${tappable ? 0 : -1}
      aria-label=${task ? `${task.title}: ${state}` : 'Empty slot'}
      onClick=${click} ...${press}>
    ${state === 'done' && !isCurrent && html`<span class="card-mark"><${Ico} n="checkCircleFill" /></span>`}
    ${state === 'abandoned' && html`<span class="card-mark"><${Ico} n="skull" /></span>`}
    ${(fx.current === 'fx-done' || fx.current === 'fx-gaveup') && html`<span class="card-burst" aria-hidden="true">
      <${Ico} n=${fx.current === 'fx-done' ? 'checkCircleFill' : 'skull'} />
    </span>`}
    <span class="card-icon" style=${{ width: `${m.cardW}px` }}>
      ${state === 'missed'
        ? html`<${Ico} n="arrowBold" />`
        : task && html`<span class="emoji" key=${task.emoji}>${task.emoji}</span>`}
    </span>
    <span class="detail">
      <span class=${`title ${task ? state : 'empty'}`}>${task ? task.title : ''}</span>
      ${task && isCurrent && state === 'open'
        && html`<span class="acts">
          <button class="act" aria-label="Mark as done" onClick=${stop(() => onToggle(task))}><${Ico} n="checkLine" /></button>
          <button class="act" aria-label="Give up" onClick=${stop((e) => onMenu(task, e.currentTarget, true))}><${Ico} n="skullLine" /></button>
        </span>`}
      ${task && isCurrent && state === 'done'
        && html`<button class="act pop-in" aria-label="Undo done" onClick=${stop(() => onToggle(task))}><${Ico} n="undo" /></button>`}
    </span>
  </div>`;
}

function SprintBar({ index, s, isCurrent, expanded, focused, m, onTap, onAdd, onToggle, onMenu }) {
  const slots = S.slots(index, s);
  const width = expanded ? m.expandedW : m.collapsedW;
  const cy = (row) => row * (m.cardH + m.pad) + m.cardH / 2;

  return html`<div data-i=${index}
      class=${`bar ${isCurrent ? 'current' : ''} ${expanded ? 'expanded' : ''} ${focused ? 'focus' : 'dim'}`}
      style=${{ width: `${width}px` }} onClick=${onTap}>
    <div class="bar-body" style=${{ height: `${m.barH}px`, borderRadius: `${m.barR}px` }}>
      ${slots.filter((x) => x.fromPrevious).map((x) => html`<i key=${`in${x.row}`} class="link"
        style=${{ top: `${cy(x.row)}px`, width: '2px' }} />`)}
      ${slots.filter((x) => x.toNext).map((x) => html`<i key=${`out${x.row}`} class="link out"
        style=${{ top: `${cy(x.row)}px`, right: `${-m.gap - 8}px`, width: `${m.gap + 16}px` }} />`)}
      <div class="rows" style=${{ gap: `${m.pad}px` }}>
        ${slots.map((x) => html`<${Row} key=${x.row} slot=${x} isCurrent=${isCurrent} expanded=${expanded}
          m=${m} onAdd=${onAdd} onToggle=${onToggle} onMenu=${onMenu} />`)}
      </div>
    </div>
    <div class="bar-label">
      <span class=${`tag mono s10 ${focused ? 'on' : isCurrent ? 'now' : ''}`}>${S.shortLabel(index, s)}</span>
    </div>
  </div>`;
}

/** Countdown to the next sprint, sitting right after the current one. */
function NextSprint({ s, cur, m }) {
  const days = S.daysUntil(S.interval(cur, s).end, s);
  return html`<div class="next" style=${{ width: `${m.collapsedW}px` }} aria-label=${`Next sprint in ${days} days`}>
    <div class="next-body" style=${{ height: `${m.barH}px`, borderRadius: `${m.barR}px` }}>
      <span class="next-num">${days}</span>
      <span class="mono s9 ash">${days === 1 ? 'Day' : 'Days'}</span>
    </div>
    <div class="bar-label"><span class="tag mono s10">${S.shortLabel(cur + 1, s)}</span></div>
  </div>`;
}

function Timeline({ s }) {
  const cur = S.currentSprint(s);
  const count = cur + 1;
  const noun = S.eraAt(cur, s).cadence === 'weekly' ? 'week' : 'month';
  const [mode, setMode] = useState('wide');
  const [focus, setFocus] = useState(cur);
  const [sheet, setSheet] = useState(null);
  const [pop, setPop] = useState(null);
  const [dev, setDev] = useState(DEV_URL);
  const [box, setBox] = useState(null);
  const scroller = useRef();
  const focusRef = useRef(cur);
  const animating = useRef(false);
  const placed = useRef(false);
  const lastCur = useRef(cur);

  useLayoutEffect(() => {
    const el = scroller.current;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sprint = mode === 'sprint';
  const m = box && barMetrics(box.w, box.h, S.maxRows(s));
  // Enough room on both ends for the first and last bar to sit in the middle.
  const side = m ? (box.w - m.collapsedW) / 2 : 0;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settleTimer = useRef();

  /** scrollLeft that puts sprint `i` in the middle of the screen. */
  const centerOf = (i) => {
    const el = scroller.current;
    const bar = el?.querySelector(`[data-i="${i}"]`);
    return bar ? bar.offsetLeft + bar.offsetWidth / 2 - el.clientWidth / 2 : 0;
  };

  const setFocused = (i) => { focusRef.current = i; setFocus(i); };

  // Open on the current sprint, centered.
  useLayoutEffect(() => {
    if (m && !placed.current) {
      placed.current = true;
      scroller.current.scrollLeft = centerOf(cur);
    }
  });

  /** Index of the sprint closest to the middle of the screen. */
  function middleIndex() {
    const el = scroller.current;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = focusRef.current;
    let dist = Infinity;
    el.querySelectorAll('.bar').forEach((bar) => {
      const d = Math.abs(bar.offsetLeft + bar.offsetWidth / 2 - mid);
      if (d < dist) { dist = d; best = Number(bar.dataset.i); }
    });
    return best;
  }

  // Wideview: the emphasis follows the finger. Sprintview: once the strip
  // settles on another sprint, that one opens and the previous one closes.
  function onScroll() {
    if (animating.current) return;
    if (modeRef.current === 'wide') {
      const i = middleIndex();
      if (i !== focusRef.current) { haptic(); setFocused(i); }
      return;
    }
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (animating.current) return;
      const i = middleIndex();
      if (i !== focusRef.current) { haptic(); keepCentered(i, () => setFocused(i)); }
    }, 90);
  }

  const goTo = (i) => scroller.current?.scrollTo({ left: centerOf(i), behavior: 'smooth' });

  /** Apply a layout change (cards opening/closing) while sprint `i` stays centered. */
  function keepCentered(i, change) {
    const el = scroller.current;
    animating.current = true;
    el.classList.add('no-snap');
    change();
    const start = performance.now();
    const follow = () => {
      el.scrollLeft = centerOf(i);
      if (performance.now() - start < 620) requestAnimationFrame(follow);
      else { el.classList.remove('no-snap'); animating.current = false; }
    };
    requestAnimationFrame(follow);
  }

  const switchMode = (next, i) => keepCentered(i, () => { setFocused(i); setMode(next); });

  const openSprint = (i) => { haptic(); switchMode('sprint', i); };
  const closeSprint = () => { haptic(); switchMode('wide', focusRef.current); };
  // A sprint that isn't centered first glides to the middle (and gets the
  // emphasis); tapping the centered one opens it.
  const tapBar = (i) => {
    if (i !== focusRef.current) { haptic(); goTo(i); }
    else if (!sprint) openSprint(i);
  };
  const backToNow = () => { haptic(); goTo(cur); };

  // A new sprint began (or was simulated): glide to it.
  useEffect(() => {
    if (lastCur.current === cur) return;
    lastCur.current = cur;
    requestAnimationFrame(() => goTo(cur));
  }, [cur]);

  const open = (o) => setSheet({ ...o, key: Date.now() });
  const close = () => setSheet(null);
  const addTask = () => { haptic(); primeKeyboard(); open({ type: 'add' }); };
  const toggleDone = (task) => { haptic(); S.toggleDone(task.id); };
  const menu = (task, el, confirm = false) => { haptic(); setPop({ task, confirm, rect: el.getBoundingClientRect(), key: Date.now() }); };
  const closePop = () => {
    setPop((p) => (p && !p.closing ? { ...p, closing: true } : p));
    setTimeout(() => setPop((p) => (p?.closing ? null : p)), 160);
  };
  const longPress = useLongPress(() => { haptic(); setDev(true); open({ type: 'options' }); });

  const f = Math.min(focus, cur);
  const fRange = S.interval(f, s);
  // Same "back to now" control in both views: a crosshair, like recentering a map.
  const nowBtn = focus !== cur && html`<button class="now-round" aria-label=${`Go to this ${noun}`} onClick=${backToNow}>
    <${Ico} n="target" />
  </button>`;

  return html`
    <header class=${`tl-head ${sprint ? 'is-sprint' : ''}`}>
      <div class="head-wide">
        <div class="head-row">
          <h1 class="brand" ...${longPress}><span class="logo" role="img" aria-label="Sprinter" />${S.isDemo && html`<span class="demo-tag mono s9">Demo</span>`}</h1>
          <div class="head-right">
            ${!sprint && nowBtn}
            <button class="icon-btn" aria-label="Options" onClick=${() => { haptic(); open({ type: 'options' }); }}><${Ico} n="options" /></button>
          </div>
        </div>
      </div>
      <div class="head-sprint">
        <button class="back-btn" aria-label="Back to all sprints" tabindex=${sprint ? 0 : -1} onClick=${closeSprint}>
          <${Ico} n="left" />
        </button>
        <div class="head-center" key=${`${f}-${mode}`}>
          <span class="mono s10">${S.longLabel(f, s)}</span>
          <span class="head-title">${S.rangeTitle(fRange)}</span>
          <span class="head-status mono s10 ash">
            ${f !== cur && html`<${Ico} n="lock" />`}
            ${S.doneCount(f, s)}/${S.eraAt(f, s).slots} done · ${f === cur ? S.daysLeft(fRange.end, s) : 'Locked'}
          </span>
        </div>
        <div class="head-right">
          ${sprint && nowBtn}
        </div>
      </div>
    </header>
    <div class="scroller" ref=${scroller} onScroll=${onScroll}>
      ${m && html`<div class="track" style=${{ gap: `${m.gap}px`, paddingLeft: `${side}px`, paddingRight: `${side}px` }}>
        ${Array.from({ length: count }, (_, i) => html`<${SprintBar} key=${i} index=${i} s=${s}
          isCurrent=${i === cur} expanded=${sprint} focused=${i === focus} m=${m}
          onTap=${() => tapBar(i)} onAdd=${addTask} onToggle=${toggleDone} onMenu=${menu} />`)}
        <${NextSprint} s=${s} cur=${cur} m=${m} />
      </div>`}
    </div>
    <${Sheet} open=${!!sheet} onClose=${close}>
      ${sheet && (sheet.type === 'add'
        ? html`<${AddTaskSheet} key=${sheet.key} onCommit=${(e, t) => S.addTask(e, t)} onClose=${close} />`
        : html`<${OptionsSheet} key=${sheet.key} dev=${dev} onClose=${close} />`)}
    <//>
    ${pop && html`<${ActionPopup} key=${pop.key} pop=${pop} onClose=${closePop} />`}`;
}

/**
 * Vertical number picker: drag (or flick) up and down to change the value.
 * Bigger numbers sit above (so + is up); the neighbours peek in and fade out,
 * and it snaps to whole numbers.
 */
const WHEEL_ROW = 128;
function NumberWheel({ value, min, max, onChange }) {
  const el = useRef();
  const values = Array.from({ length: max - min + 1 }, (_, i) => max - i);
  const topFor = (v) => (max - v) * WHEEL_ROW;
  const at = () => Math.min(max, Math.max(min, max - Math.round(el.current.scrollTop / WHEEL_ROW)));

  useLayoutEffect(() => { el.current.scrollTop = topFor(value); }, []);
  // Buttons move the value: glide the strip to it (a drag already put it there).
  useEffect(() => {
    if (el.current && at() !== value) el.current.scrollTo({ top: topFor(value), behavior: 'smooth' });
  }, [value, min]);

  const onScroll = () => { const v = at(); if (v !== value) onChange(v); };

  return html`<div class="wheel" ref=${el} onScroll=${onScroll} role="spinbutton"
      aria-valuemin=${min} aria-valuemax=${max} aria-valuenow=${value}>
    ${values.map((v) => html`<span key=${v} class=${`wheel-num ${v === value ? 'on' : ''}`}
      onClick=${() => v !== value && onChange(v)}>${v}</span>`)}
  </div>`;
}

// ================= Onboarding =================

/**
 * A made-up history in wideview style (columns of task cards), for the welcome
 * screen. Each row is a run of tasks: carried sprints show an arrow, the last
 * sprint shows a check (done, green) or a skull (given up, black). Every row ends on
 * the last column, so the strip can repeat seamlessly.
 */
const REEL = (() => {
  const cols = 9, rows = 5;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grid = Array.from({ length: cols }, () => []);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols;) {
      const x = rnd();
      const len = Math.min(cols - c, x < 0.5 ? 1 : x < 0.82 ? 2 : 3);
      const end = rnd() < 0.72 ? 'done' : 'abandoned';
      for (let k = 0; k < len; k++) grid[c + k][r] = { state: k === len - 1 ? end : 'missed', linked: k > 0 };
      c += len;
    }
  }
  return grid;
})();

function WelcomeReel() {
  return html`<div class="reel reveal" style="--i:2" aria-hidden="true">
    <div class="reel-track">
      ${[...REEL, ...REEL].map((col, i) => html`<div class="reel-col" key=${i}>
        ${col.map((t, r) => html`<div class=${`card ${t.state}`} key=${r}>
          ${t.linked && html`<i class="reel-link" />`}
          <span class="card-icon">${t.state === 'missed'
            ? html`<${Ico} n="arrowBold" />`
            : html`<${Ico} n=${t.state === 'done' ? 'checkCircleFill' : 'skull'} />`}</span>
        </div>`)}
      </div>`)}
    </div>
  </div>`;
}

function Onboarding() {
  const [step, setStep] = useState(0);
  const [cadence, setCadence] = useState('weekly');
  const [count, setCount] = useState(5);
  const [drafts, setDrafts] = useState([]);
  const [adding, setAdding] = useState(null);

  const go = (n) => { haptic(); setStep(n); };
  const openAdd = () => {
    haptic();
    primeKeyboard();
    setAdding({ key: Date.now(), heading: `Task ${drafts.length + 1} of ${count}` });
  };

  const welcome = () => html`
    <h1 class="hero reveal" style="margin-top:16px"><span class="logo" role="img" aria-label="Sprinter" /></h1>
    <p class="lead reveal" style="--i:1; margin-top:24px">Commit to a few things each week or month. What you don't finish follows you. What you finish frees up room.</p>
    <${WelcomeReel} />
    <button class="pill block reveal" style="--i:3" onClick=${() => go(1)}>Get started</button>`;

  const option = (value, name, caption, i) => html`
    <button key=${value} class=${`option reveal ${cadence === value ? 'on' : ''}`} style=${`--i:${i}`}
      onClick=${() => { haptic(); setCadence(value); }}>
      <span><span class="name">${name}</span><span class="mono s10">${caption}</span></span>
      <span class="tick">${cadence === value && html`<${Ico} n="check" />`}</span>
    </button>`;

  const cadenceStep = () => html`
    <h2 class="step-title reveal">How long is<br />a sprint?</h2>
    <div class="options">
      ${option('weekly', 'Weekly', 'Monday → Sunday', 1)}
      ${option('monthly', 'Monthly', '1st → last day of the month', 2)}
    </div>
    <div class="spacer" />
    <button class="pill block reveal" style="--i:3" onClick=${() => go(2)}>Continue</button>`;

  const change = (delta) => { haptic(); setCount((c) => c + delta); };
  const countStep = () => {
    const lo = Math.max(2, drafts.length);
    return html`
    <div class="count">
      <div class="count-picker reveal">
        <button class="round" aria-label="More" disabled=${count >= 12} onClick=${() => change(1)}><${Ico} n="plus" /></button>
        <${NumberWheel} value=${count} min=${lo} max=${12} onChange=${(v) => { haptic(); setCount(v); }} />
        <button class="round" aria-label="Fewer" disabled=${count <= lo} onClick=${() => change(-1)}><${Ico} n="minus" /></button>
      </div>
      <div class="count-main">
        <h2 class="step-title reveal" style="--i:1">How\u00A0many tasks\u00A0per sprint?</h2>
        <p class="quiet reveal" style="--i:2; margin-top:12px">Pick what you<br />can really finish.</p>
      </div>
    </div>
    <button class="pill block reveal" style="--i:3" onClick=${() => go(3)}>Continue</button>`;
  };

  const firstTasks = () => {
    const range = S.firstInterval(cadence);
    return html`
      <h2 class="step-title reveal">Your first ${cadence === 'weekly' ? 'week' : 'month'}</h2>
      <div class="reveal" style="--i:1; display:flex; gap:8px; margin-top:12px">
        <span class="mono s10">${S.rangeLabel(range)}</span>
        <span class="mono s10 ash">· ${S.daysLeft(range.end)}</span>
      </div>
      <div class="drafts reveal" style="--i:2">
        ${Array.from({ length: count }, (_, i) => {
          const d = drafts[i];
          return d
            ? html`<div class="draft filled" key=${d.id}>
                <${TaskCircle} emoji=${d.emoji} state="open" size=${44} surface="var(--paper)" />
                <span class="t">${d.title}</span>
                <span class="mono s10 ash">${pad(i + 1)}</span>
              </div>`
            : html`<button class=${`draft empty ${i === drafts.length ? '' : 'dim'}`} key=${`slot${i}`} onClick=${openAdd}>
                <${TaskCircle} addable size=${44} surface="var(--paper)" />
                <span class="t">Add a task</span>
                <span class="mono s10 ash">${pad(i + 1)}</span>
              </button>`;
        })}
      </div>
      <div class="start reveal" style="--i:3">
        <button class="pill block" disabled=${!drafts.length}
          onClick=${() => { haptic(); S.completeOnboarding(cadence, count, drafts); }}>Start sprint</button>
      </div>`;
  };

  return html`
    <div class="onb-top">
      <div class="onb-nav">
        <button class=${`back ${step ? '' : 'gone'}`} onClick=${() => step && go(step - 1)}>
          <${Ico} n="left" /><span class="mono s10">Back</span>
        </button>
        <span class="mono s10 ash">${pad(step + 1)} / 04</span>
      </div>
      <div class="progress">${[0, 1, 2, 3].map((i) => html`<i key=${i} class=${i <= step ? 'on' : ''} />`)}</div>
    </div>
    <div class="step" key=${step}>${[welcome, cadenceStep, countStep, firstTasks][step]()}</div>
    <${Sheet} open=${!!adding} onClose=${() => setAdding(null)}>
      ${adding && html`<${AddTaskSheet} key=${adding.key} heading=${adding.heading}
        onCommit=${(emoji, title) => setDrafts((d) => [...d, { id: `${Date.now()}`, emoji, title }])}
        onClose=${() => setAdding(null)} />`}
    <//>`;
}

// ================= App =================

function App() {
  const s = useStore();

  useEffect(() => {
    // A new day (or week) may have started while the app sat in the background.
    const onVisible = () => { if (document.visibilityState === 'visible') S.refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const tick = setInterval(S.refresh, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(tick); };
  }, []);

  // Appearance: "auto" follows the phone; light/dark override it.
  const theme = S.getTheme();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    const page = getComputedStyle(root).getPropertyValue('--page').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
  });
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', S.refresh);
    return () => mq.removeEventListener('change', S.refresh);
  }, []);

  return html`<div class="screen" key=${s.config ? 'timeline' : 'onboarding'}>
    ${s.config ? html`<${Timeline} s=${s} />` : html`<${Onboarding} />`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
