/* eslint-disable */
import { useState, useEffect } from "react";
import { auth as fbAuth } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const COLORS = {
  bg:          "#000000",          // true iOS black
  surface:     "#1c1c1e",          // iOS grouped bg
  card:        "#2c2c2e",          // iOS card
  cardElev:    "#3a3a3c",          // elevated card
  border:      "#38383a",          // iOS separator
  accent:      "#0a84ff",          // iOS blue
  accentGlow:  "#0a84ff30",
  green:       "#30d158",          // iOS green
  red:         "#ff453a",          // iOS red
  orange:      "#ff9f0a",          // iOS orange
  yellow:      "#ffd60a",          // iOS yellow
  blue:        "#0a84ff",
  teal:        "#5ac8f5",          // iOS teal
  pink:        "#ff375f",          // iOS pink
  purple:      "#bf5af2",          // iOS purple
  text:        "#ffffff",
  textSec:     "#ebebf599",        // iOS secondary label
  muted:       "#ebebf54d",        // iOS tertiary label
  dimmed:      "#ffffff1a",
  fill:        "#787880",          // iOS fill
};

const STORAGE_KEY = "pocket_assistant_data_v2";

const defaultData = {
  events: [],
  diary: [],
  topLists: [
    { id: 1, title: "📚 Топ книг", category: "books", items: [] },
    { id: 2, title: "🎬 Топ фильмов", category: "movies", items: [] },
    { id: 3, title: "✈️ Топ мест", category: "travel", items: [] },
  ],
  habits: [],
  birthdays: [],
};

// ─── NOTIFICATION ENGINE ─────────────────────────────────────────────────────

async function requestNotifPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  return result;
}

function sendNotification(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag: tag || title,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });
  } catch {}
}

function scheduleNotification(triggerDate, title, body, tag) {
  const ms = triggerDate.getTime() - Date.now();
  if (ms < 0 || ms > 14 * 24 * 60 * 60 * 1000) return null;
  return setTimeout(() => sendNotification(title, body, tag), ms);
}

function scheduleEventNotification(ev) {
  if (!ev.time || ev.reminderOffset == null) return null;
  const eventDate = new Date(ev.date + "T" + ev.time + ":00");
  const triggerDate = new Date(eventDate.getTime() - ev.reminderOffset * 60 * 1000);
  const label = ev.reminderOffset === 0 ? "начинается сейчас" :
    ev.reminderOffset === 30 ? "через 30 минут" :
    ev.reminderOffset === 60 ? "через 1 час" : "через 2 часа";
  return scheduleNotification(triggerDate, `📅 ${ev.title}`, label, `event-${ev.id}`);
}

function scheduleBirthdayNotifications(b) {
  const now = new Date();
  const year = now.getFullYear();
  const [, mm, dd] = b.date.split("-");
  const bdayThisYear = new Date(`${year}-${mm}-${dd}T09:00:00`);
  const tids = [];
  if (b.notifWeekBefore) {
    const t = new Date(bdayThisYear.getTime() - 7 * 24 * 60 * 60 * 1000);
    const tid = scheduleNotification(t, `🎂 Через неделю день рождения`, b.name, `bday-week-${b.id}`);
    if (tid) tids.push(tid);
  }
  if (b.notifDayBefore) {
    const t = new Date(bdayThisYear.getTime() - 24 * 60 * 60 * 1000);
    const tid = scheduleNotification(t, `🎂 Завтра день рождения!`, b.name, `bday-day-${b.id}`);
    if (tid) tids.push(tid);
  }
  if (b.notifHourBefore) {
    const t = new Date(bdayThisYear.getTime() - 60 * 60 * 1000);
    const tid = scheduleNotification(t, `🎂 Через час день рождения!`, b.name, `bday-hour-${b.id}`);
    if (tid) tids.push(tid);
  }
  return tids;
}

function checkTodayBirthdays(birthdays) {
  const _now = new Date();
  const todayMMDD = String(_now.getMonth() + 1).padStart(2, "0") + "-" + String(_now.getDate()).padStart(2, "0");
  birthdays.forEach(b => {
    if (b.date.slice(5) === todayMMDD) {
      sendNotification(`🎉 Сегодня день рождения!`, `${b.name} — не забудь поздравить!`, `bday-today-${b.id}`);
    }
  });
}

// Schedule daily habit reminder at given hour (default 21:00)
function scheduleHabitReminder(habits, hour = 21) {
  if (!habits || habits.length === 0) return null;
  const now = new Date();
  const trigger = new Date();
  trigger.setHours(hour, 0, 0, 0);
  if (trigger <= now) trigger.setDate(trigger.getDate() + 1);
  const unfinished = habits.filter(h => {
    const todayKey = today();
    return !h.checkins?.[todayKey];
  });
  if (unfinished.length === 0) return null;
  const names = unfinished.slice(0, 3).map(h => h.emoji + " " + h.name).join(", ");
  const body = unfinished.length === 1
    ? `Не забудь: ${names}`
    : `${unfinished.length} привычек ждут тебя: ${names}`;
  return scheduleNotification(trigger, "🔥 Ежедневные привычки", body, "habits-daily");
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultData, ...JSON.parse(raw) } : defaultData;
  } catch {
    return defaultData;
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatDate(d) {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
}

// ─── Reusable UI ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: COLORS.surface,
        borderRadius: "20px 20px 0 0",
        width: "100%", maxWidth: "480px",
        maxHeight: "92vh", overflowY: "auto",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {/* iOS drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
          <div style={{ width: "36px", height: "4px", background: COLORS.fill, borderRadius: "2px", opacity: 0.5 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 20px 16px" }}>
          <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "17px", letterSpacing: "-0.3px" }}>{title}</span>
          <button onClick={onClose} style={{
            background: COLORS.cardElev, border: "none", color: COLORS.textSec,
            width: "28px", height: "28px", borderRadius: "50%",
            fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>
        <div style={{ padding: "0 16px 20px" }}>
        {children}
        </div>
      </div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      {label && <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "6px", letterSpacing: "0.5px", textTransform: "uppercase" }}>{label}</label>}
      <input
        {...props}
        style={{
          width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px",
          outline: "none", boxSizing: "border-box",
          ...(props.style || {})
        }}
      />
    </div>
  );
}

function Textarea({ label, ...props }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      {label && <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "6px", letterSpacing: "0.5px", textTransform: "uppercase" }}>{label}</label>}
      <textarea
        {...props}
        style={{
          width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px",
          outline: "none", resize: "vertical", minHeight: "80px", boxSizing: "border-box",
          ...(props.style || {})
        }}
      />
    </div>
  );
}

function Btn({ children, onClick, color = COLORS.accent, variant = "solid", small = false, style = {}, disabled = false }) {
  const base = {
    border: "none", borderRadius: small ? "8px" : "12px", cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600, fontFamily: "inherit",
    fontSize: small ? "13px" : "15px",
    padding: small ? "6px 12px" : "12px 20px",
    opacity: disabled ? 0.5 : 1,
    letterSpacing: "-0.2px",
    ...style
  };
  if (variant === "solid") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: color, color: "#fff" }}>{children}</button>;
  if (variant === "ghost") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "transparent", color: color, border: `1px solid ${color}44` }}>{children}</button>;
  if (variant === "tint") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: `${color}22`, color: color }}>{children}</button>;
  return <button onClick={onClick} disabled={disabled} style={{ ...base, background: color, color: "#fff" }}>{children}</button>;
}


function ProgressBar({ value, max, color = COLORS.accent }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
        <span style={{ color: COLORS.muted, fontSize: "11px" }}>{value} / {max}</span>
        <span style={{ color, fontSize: "11px", fontWeight: 700 }}>{pct}%</span>
      </div>
      <div style={{ height: "6px", background: COLORS.surface, borderRadius: "99px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "99px", transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ─── CONFIRM DELETE MODAL ────────────────────────────────────────────────────

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "16px" }}>
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "20px", padding: "28px 24px", width: "100%", maxWidth: "340px", textAlign: "center" }}>
        <div style={{ fontSize: "36px", marginBottom: "12px" }}>🗑</div>
        <div style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px", marginBottom: "8px" }}>Удалить?</div>
        <div style={{ color: COLORS.muted, fontSize: "13px", marginBottom: "24px", lineHeight: "1.5" }}>{message}</div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={onCancel} style={{ flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "12px", padding: "10px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>Отмена</button>
          <button onClick={onConfirm} style={{ flex: 1, background: COLORS.red, border: "none", color: "#fff", borderRadius: "12px", padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>Удалить</button>
        </div>
      </div>
    </div>
  );
}

// ─── CALENDAR ────────────────────────────────────────────────────────────────

const EVENT_COLORS = ["#7c6af7", "#60a5fa", "#4ade80", "#fb923c", "#f472b6", "#facc15", "#34d399"];

function timeToMinutes(t) {
  if (!t) return -1;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}


const REMINDER_OPTIONS = [
  { value: null, label: "Нет" },
  { value: 0, label: "В момент" },
  { value: 30, label: "За 30 мин" },
  { value: 60, label: "За 1 час" },
  { value: 120, label: "За 2 часа" },
];

function EventFormFields({ form, setForm }) {
  return (
    <>
      <Input label="Название" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Встреча, тренировка..." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <Input label="Время" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
        <Input label="Длительность (мин)" type="number" value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} placeholder="60" />
      </div>
      <Textarea label="Описание" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      <div style={{ marginBottom: "14px" }}>
        <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Цвет</label>
        <div style={{ display: "flex", gap: "8px" }}>
          {EVENT_COLORS.map(c => (
            <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))} style={{ width: "24px", height: "24px", borderRadius: "50%", background: c, border: `3px solid ${form.color === c ? "#fff" : "transparent"}`, cursor: "pointer" }} />
          ))}
        </div>
      </div>
      <div style={{ marginBottom: "16px" }}>
        <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>🔔 Напоминание</label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {REMINDER_OPTIONS.map(opt => (
            <button key={String(opt.value)} onClick={() => setForm(f => ({ ...f, reminderOffset: opt.value }))} style={{
              background: form.reminderOffset === opt.value ? `${COLORS.accent}33` : COLORS.surface,
              border: `1px solid ${form.reminderOffset === opt.value ? COLORS.accent : COLORS.border}`,
              color: form.reminderOffset === opt.value ? COLORS.accent : COLORS.muted,
              borderRadius: "8px", padding: "5px 10px", fontSize: "12px", cursor: "pointer", fontWeight: 600
            }}>{opt.label}</button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Collision layout: assign column index and total columns to each event ───
function computeColumns(eventsWithTime) {
  // Sort by start time
  const sorted = [...eventsWithTime].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  // Each event gets { col, totalCols }
  const layout = sorted.map(ev => ({
    ev,
    start: timeToMinutes(ev.time),
    end: timeToMinutes(ev.time) + (parseInt(ev.duration) || 60),
    col: 0,
    totalCols: 1,
  }));

  // Group overlapping events into clusters
  const clusters = [];
  let cluster = [];
  let clusterEnd = -1;

  for (const item of layout) {
    if (item.start < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      if (cluster.length) clusters.push(cluster);
      cluster = [item];
      clusterEnd = item.end;
    }
  }
  if (cluster.length) clusters.push(cluster);

  // Within each cluster assign columns greedily
  for (const cl of clusters) {
    const colEnds = []; // end time of last event in each column
    for (const item of cl) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (item.start >= colEnds[c]) {
          item.col = c;
          colEnds[c] = item.end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = colEnds.length;
        colEnds.push(item.end);
      }
    }
    const totalCols = colEnds.length;
    cl.forEach(item => { item.totalCols = totalCols; });
  }

  // Return map: ev.id -> { col, totalCols }
  const map = {};
  layout.forEach(item => { map[item.ev.id] = { col: item.col, totalCols: item.totalCols }; });
  return map;
}

// Day timeline view
function DayView({ date, events, birthdays, onAdd, onEdit, onDelete, onBack }) {
  const sorted = [...events].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const minMinutes = sorted.length > 0 && sorted[0].time ? Math.min(timeToMinutes(sorted[0].time), 6 * 60) : 6 * 60;
  const startHour = Math.floor(minMinutes / 60);
  const endHour = 24;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const HOUR_H = 60;
  const [confirmId, setConfirmId] = useState(null);

  const eventsWithTime = sorted.filter(e => e.time);
  const eventsNoTime = sorted.filter(e => !e.time);
  const colMap = computeColumns(eventsWithTime);
  const allEventsMap = Object.fromEntries(events.map(e => [e.id, e]));

  return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <button onClick={onBack} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "14px" }}>← Назад</button>
        <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px", flex: 1 }}>
          {new Date(date + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" })}
        </span>
        <Btn small onClick={onAdd}>+ Добавить</Btn>
      </div>

      {/* All-day / no-time events */}
      {eventsNoTime.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Весь день</div>
          {eventsNoTime.map(ev => (
            <div key={ev.id} onClick={() => onEdit(ev)} style={{ background: `${ev.color || COLORS.accent}22`, border: `1px solid ${ev.color || COLORS.accent}55`, borderLeft: `3px solid ${ev.color || COLORS.accent}`, borderRadius: "8px", padding: "8px 12px", marginBottom: "6px", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: COLORS.text, fontSize: "13px", fontWeight: 600 }}>{ev.title}</span>
              <button onClick={e => { e.stopPropagation(); setConfirmId(ev.id); }} style={{ background: "none", border: "none", color: COLORS.dimmed, cursor: "pointer", fontSize: "12px" }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Birthday banners */}
      {birthdays && birthdays.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          {birthdays.map(b => {
            const age = new Date().getFullYear() - new Date(b.date + "T12:00:00").getFullYear();
            return (
              <div key={b.id} style={{ background: `${COLORS.pink}18`, border: `1px solid ${COLORS.pink}44`, borderLeft: `3px solid ${COLORS.pink}`, borderRadius: "8px", padding: "8px 12px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>🎂</span>
                <div>
                  <span style={{ color: COLORS.pink, fontWeight: 700, fontSize: "13px" }}>{b.name}</span>
                  <span style={{ color: COLORS.muted, fontSize: "12px" }}> · {age} лет · {b.relation}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Timeline */}
      <div style={{ position: "relative", marginLeft: "44px" }}>
        {/* Hour lines */}
        {hours.map(h => (
          <div key={h} style={{ position: "relative", height: `${HOUR_H}px` }}>
            <div style={{ position: "absolute", left: "-44px", top: "-8px", color: COLORS.dimmed, fontSize: "11px", width: "36px", textAlign: "right" }}>
              {String(h).padStart(2, "0")}:00
            </div>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: COLORS.border }} />
          </div>
        ))}

        {/* Events overlay */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          {eventsWithTime.map(ev => {
            const startMin = timeToMinutes(ev.time);
            const dur = parseInt(ev.duration) || 60;
            const top = ((startMin - startHour * 60) / 60) * HOUR_H;
            const height = Math.max((dur / 60) * HOUR_H, 28);
            const color = ev.color || COLORS.accent;
            const { col, totalCols } = colMap[ev.id] || { col: 0, totalCols: 1 };
            const GAP = 3;
            const colW = `calc(${100 / totalCols}% - ${GAP}px)`;
            const colL = `calc(${(col / totalCols) * 100}% + ${GAP / 2}px)`;

            return (
              <div key={ev.id} onClick={() => onEdit(ev)} style={{
                position: "absolute", left: colL, width: colW, top: `${top}px`, height: `${height}px`,
                background: `${color}22`, border: `1px solid ${color}66`, borderLeft: `3px solid ${color}`,
                borderRadius: "8px", padding: "4px 8px", cursor: "pointer", overflow: "hidden",
                boxSizing: "border-box", zIndex: col + 1,
              }}>
                <div style={{ color, fontWeight: 700, fontSize: "12px" }}>{ev.time}{ev.duration ? ` · ${ev.duration}м` : ""}</div>
                <div style={{ color: COLORS.text, fontSize: "12px", fontWeight: 600, lineHeight: "1.3" }}>{ev.title}</div>
                {ev.description && height > 50 && <div style={{ color: COLORS.muted, fontSize: "11px", marginTop: "2px" }}>{ev.description}</div>}
                {ev.reminder && <span style={{ fontSize: "10px" }}>🔔</span>}
              </div>
            );
          })}
        </div>
      </div>

      {confirmId && (
        <ConfirmModal
          message={`Удалить событие «${allEventsMap[confirmId]?.title}»?`}
          onConfirm={() => { onDelete(confirmId); setConfirmId(null); }}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </div>
  );
}

// Week view
function WeekView({ weekStart, events, onDayClick, onBack }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const todayStr = today();
  const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  const weekEvents = events.filter(e => days.includes(e.date) && e.time);
  const minMin = weekEvents.length > 0 ? Math.min(...weekEvents.map(e => timeToMinutes(e.time)), 6 * 60) : 6 * 60;
  const startHour = Math.floor(minMin / 60);
  const endHour = Math.max(22, ...weekEvents.map(e => {
    const end = timeToMinutes(e.time) + (parseInt(e.duration) || 60);
    return Math.ceil(end / 60);
  }));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const HOUR_H = 52;

  // Build per-day column maps
  const dayColMaps = {};
  days.forEach(ds => {
    const dayEvs = events.filter(e => e.date === ds && e.time);
    dayColMaps[ds] = computeColumns(dayEvs);
  });

  return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <button onClick={onBack} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "14px" }}>← Назад</button>
        <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "14px", flex: 1 }}>
          {new Date(days[0] + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} – {new Date(days[6] + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
        </span>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "32px repeat(7,1fr)", marginBottom: "0" }}>
        <div />
        {days.map((ds, i) => {
          const d = new Date(ds + "T12:00:00");
          const isToday = ds === todayStr;
          return (
            <div key={ds} onClick={() => onDayClick(ds)} style={{ textAlign: "center", cursor: "pointer", padding: "6px 2px", borderBottom: `2px solid ${isToday ? COLORS.accent : COLORS.border}` }}>
              <div style={{ color: COLORS.muted, fontSize: "10px" }}>{dayNames[i]}</div>
              <div style={{ color: isToday ? COLORS.accent : COLORS.text, fontWeight: isToday ? 700 : 400, fontSize: "13px" }}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Timeline grid */}
      <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 260px)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "32px repeat(7,1fr)", position: "relative" }}>
          {/* Hour labels */}
          <div>
            {hours.map(h => (
              <div key={h} style={{ height: `${HOUR_H}px`, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: "4px", paddingTop: "2px" }}>
                <span style={{ color: COLORS.dimmed, fontSize: "9px" }}>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(ds => {
            const dayEvs = events.filter(e => e.date === ds && e.time);
            const colMap = dayColMaps[ds];
            return (
              <div key={ds} style={{ position: "relative", borderLeft: `1px solid ${COLORS.border}` }}>
                {hours.map(h => (
                  <div key={h} style={{ height: `${HOUR_H}px`, borderTop: `1px solid ${COLORS.border}` }} />
                ))}
                {dayEvs.map(ev => {
                  const startMin = timeToMinutes(ev.time);
                  const dur = parseInt(ev.duration) || 60;
                  const top = ((startMin - startHour * 60) / 60) * HOUR_H;
                  const height = Math.max((dur / 60) * HOUR_H, 18);
                  const color = ev.color || COLORS.accent;
                  const { col, totalCols } = colMap[ev.id] || { col: 0, totalCols: 1 };
                  const GAP = 1;
                  const pctW = 100 / totalCols;
                  const pctL = (col / totalCols) * 100;
                  return (
                    <div key={ev.id} onClick={() => onDayClick(ds)} title={`${ev.time} ${ev.title}`} style={{
                      position: "absolute",
                      left: `calc(${pctL}% + ${GAP}px)`,
                      width: `calc(${pctW}% - ${GAP * 2}px)`,
                      top: `${top}px`,
                      height: `${height}px`,
                      background: `${color}33`,
                      borderLeft: `2px solid ${color}`,
                      borderRadius: "4px",
                      padding: "2px 3px",
                      overflow: "hidden",
                      cursor: "pointer",
                      boxSizing: "border-box",
                      zIndex: col + 1,
                    }}>
                      <div style={{ color, fontSize: "9px", fontWeight: 700, lineHeight: "1.2" }}>{ev.time}</div>
                      <div style={{ color: COLORS.text, fontSize: "9px", lineHeight: "1.2", overflow: "hidden" }}>{ev.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── RUSSIAN HOLIDAYS & WEEKENDS ─────────────────────────────────────────────

// Fixed holidays MM-DD
const RU_FIXED_HOLIDAYS = {
  "01-01": "Новый год",
  "01-02": "Новогодние каникулы",
  "01-03": "Новогодние каникулы",
  "01-04": "Новогодние каникулы",
  "01-05": "Новогодние каникулы",
  "01-06": "Новогодние каникулы",
  "01-07": "Рождество Христово",
  "01-08": "Новогодние каникулы",
  "02-23": "День защитника Отечества",
  "03-08": "Международный женский день",
  "05-01": "Праздник Весны и Труда",
  "05-09": "День Победы",
  "06-12": "День России",
  "11-04": "День народного единства",
  "12-31": "Канун Нового года",
};

function getRuHoliday(dateStr) {
  const mmdd = dateStr.slice(5);
  return RU_FIXED_HOLIDAYS[mmdd] || null;
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay(); // 0=Sun, 6=Sat
  return dow === 0 || dow === 6;
}

function getBirthdaysOnDay(birthdays, year, month, day) {
  const mmdd = `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (birthdays || []).filter(b => b.date.slice(5) === mmdd);
}

function CalendarSection({ data, setData }) {
  const [now, setNow] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }));
  const [selected, setSelected] = useState(null); // null = month view
  const [calView, setCalView] = useState("month"); // "month" | "day" | "week"
  const [weekStart, setWeekStart] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState(null);
  const [showHolidays, setShowHolidays] = useState(true);
  const emptyForm = { title: "", time: "", duration: "", description: "", reminderOffset: null, color: EVENT_COLORS[0] };
  const [form, setForm] = useState(emptyForm);

  const days = getDaysInMonth(now.year, now.month);
  const firstDay = getFirstDayOfMonth(now.year, now.month);
  const todayStr = today();

  const eventsOnDay = (d) => {
    const ds = `${now.year}-${String(now.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return data.events.filter(e => e.date === ds);
  };

  function addEvent() {
    if (!form.title.trim()) return;
    const newEvent = { id: Date.now(), date: selected || todayStr, ...form };
    setData(d => ({ ...d, events: [...d.events, newEvent] }));
    if (newEvent.reminderOffset != null) scheduleEventNotification(newEvent);
    setForm(emptyForm);
    setShowModal(false);
  }

  function saveEdit() {
    if (!editEvent || !form.title.trim()) return;
    const updated = { ...editEvent, ...form };
    setData(d => ({ ...d, events: d.events.map(e => e.id === editEvent.id ? updated : e) }));
    if (updated.reminderOffset != null) scheduleEventNotification(updated);
    setEditEvent(null);
    setForm(emptyForm);
  }

  function deleteEvent(id) {
    setData(d => ({ ...d, events: d.events.filter(e => e.id !== id) }));
  }

  function openEdit(ev) {
    setEditEvent(ev);
    setForm({ title: ev.title, time: ev.time, duration: ev.duration, description: ev.description, reminderOffset: ev.reminderOffset ?? null, color: ev.color || EVENT_COLORS[0] });
  }

  function openDayView(ds) {
    setSelected(ds);
    setCalView("day");
  }

  function openWeekView(ds) {
    // find Monday of the week containing ds
    const d = new Date(ds + "T12:00:00");
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    setWeekStart(d.toISOString().slice(0, 10));
    setCalView("week");
  }

  const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  if (calView === "day" && selected) {
    const dayEvents = data.events.filter(e => e.date === selected);
    const [, sy, sm, sd] = selected.match(/(\d+)-(\d+)-(\d+)/);
    const dayBirthdays = getBirthdaysOnDay(data.birthdays, parseInt(sy), parseInt(sm) - 1, parseInt(sd));
    return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
        <DayView
          date={selected}
          events={dayEvents}
          birthdays={dayBirthdays}
          onAdd={() => { setForm(emptyForm); setShowModal(true); }}
          onEdit={openEdit}
          onDelete={deleteEvent}
          onBack={() => setCalView("month")}
        />
        {showModal && (
          <Modal title="Новое событие" onClose={() => setShowModal(false)}>
            <EventFormFields form={form} setForm={setForm} />
            <Btn onClick={addEvent} style={{ width: "100%" }}>Добавить</Btn>
          </Modal>
        )}
        {editEvent && !confirmDeleteEvent && (
          <Modal title="Редактировать событие" onClose={() => { setEditEvent(null); setForm(emptyForm); }}>
            <EventFormFields form={form} setForm={setForm} />
            <div style={{ display: "flex", gap: "10px" }}>
              <Btn onClick={saveEdit} style={{ flex: 1 }}>Сохранить</Btn>
              <Btn onClick={() => setConfirmDeleteEvent(editEvent.id)} color={COLORS.red} style={{ flex: 1 }}>Удалить</Btn>
            </div>
          </Modal>
        )}
        {confirmDeleteEvent && (
          <ConfirmModal
            message={`Удалить событие «${data.events.find(e => e.id === confirmDeleteEvent)?.title}»?`}
            onConfirm={() => { deleteEvent(confirmDeleteEvent); setConfirmDeleteEvent(null); setEditEvent(null); setForm(emptyForm); }}
            onCancel={() => setConfirmDeleteEvent(null)}
          />
        )}
      </div>
    );
  }

  if (calView === "week" && weekStart) {
    return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
        <WeekView
          weekStart={weekStart}
          events={data.events}
          onDayClick={openDayView}
          onBack={() => setCalView("month")}
        />
      </div>
    );
  }

  // Month view
  return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <button onClick={() => setNow(n => n.month === 0 ? { year: n.year - 1, month: 11 } : { ...n, month: n.month - 1 })}
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "8px", padding: "6px 12px", cursor: "pointer" }}>‹</button>
        <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px" }}>{monthNames[now.month]} {now.year}</span>
        <button onClick={() => setNow(n => n.month === 11 ? { year: n.year + 1, month: 0 } : { ...n, month: n.month + 1 })}
          style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "8px", padding: "6px 12px", cursor: "pointer" }}>›</button>
      </div>

      {/* Controls row: Holidays toggle + Week button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <label onClick={() => setShowHolidays(v => !v)} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
          <div style={{
            width: "36px", height: "20px", borderRadius: "10px",
            background: showHolidays ? COLORS.accent : COLORS.dimmed,
            position: "relative", transition: "background 0.2s", flexShrink: 0
          }}>
            <div style={{
              position: "absolute", top: "3px",
              left: showHolidays ? "18px" : "3px",
              width: "14px", height: "14px", borderRadius: "50%",
              background: "#fff", transition: "left 0.2s"
            }} />
          </div>
          <span style={{ color: showHolidays ? COLORS.text : COLORS.muted, fontSize: "12px", fontWeight: 600 }}>🇷🇺 Праздники РФ</span>
        </label>
        <button onClick={() => openWeekView(todayStr)} style={{ background: `${COLORS.accent}22`, border: `1px solid ${COLORS.accent}55`, color: COLORS.accent, borderRadius: "8px", padding: "5px 12px", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>
          📅 Неделя
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "4px", marginBottom: "4px" }}>
        {dayNames.map((d, i) => (
          <div key={d} style={{ textAlign: "center", color: (i >= 5 && showHolidays) ? COLORS.red : COLORS.muted, fontSize: "11px", padding: "4px 0", fontWeight: i >= 5 ? 600 : 400 }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "4px", marginBottom: "16px" }}>
        {Array(firstDay).fill(null).map((_, i) => <div key={`empty-${i}`} />)}
        {Array(days).fill(null).map((_, i) => {
          const d = i + 1;
          const ds = `${now.year}-${String(now.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isToday = ds === todayStr;
          const evs = eventsOnDay(d);
          const dotColor = evs[0]?.color || COLORS.accent;
          const holiday = showHolidays ? getRuHoliday(ds) : null;
          const weekend = showHolidays ? isWeekend(ds) : false;
          const bdayPeople = getBirthdaysOnDay(data.birthdays, now.year, now.month, d);
          const isSpecial = holiday || weekend;
          const dayColor = isToday ? COLORS.accent : isSpecial ? COLORS.red : COLORS.text;

          return (
            <div key={d} onClick={() => openDayView(ds)} title={holiday || ""} style={{
              textAlign: "center", borderRadius: "10px", cursor: "pointer",
              background: isToday ? `${COLORS.accent}22` : holiday ? `${COLORS.red}15` : "transparent",
              border: holiday ? `1px solid ${COLORS.red}30` : "1px solid transparent",
              padding: "5px 2px 3px",
              minHeight: "46px",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
            }}>
              <span style={{ color: dayColor, fontWeight: isToday || isSpecial ? 700 : 400, fontSize: "13px" }}>{d}</span>

              {/* Bottom indicators row */}
              <div style={{ display: "flex", gap: "2px", alignItems: "center", marginTop: "3px", flexWrap: "wrap", justifyContent: "center" }}>
                {evs.length > 0 && <div style={{ width: "4px", height: "4px", background: dotColor, borderRadius: "50%", flexShrink: 0 }} />}
                {bdayPeople.map(b => (
                  <span key={b.id} title={`🎂 ${b.name}`} style={{ fontSize: "9px", lineHeight: 1 }}>🎂</span>
                ))}
              </div>

              {/* Holiday short label */}
              {holiday && (
                <div style={{ color: COLORS.red, fontSize: "7px", lineHeight: "1.1", textAlign: "center", marginTop: "1px", overflow: "hidden", maxWidth: "100%", opacity: 0.85 }}>
                  {holiday.length > 10 ? holiday.slice(0, 9) + "…" : holiday}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {showHolidays && (
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "10px", height: "10px", background: `${COLORS.red}33`, border: `1px solid ${COLORS.red}55`, borderRadius: "3px" }} />
            <span style={{ color: COLORS.muted, fontSize: "11px" }}>Праздник / выходной</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px" }}>🎂</span>
            <span style={{ color: COLORS.muted, fontSize: "11px" }}>День рождения</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ width: "6px", height: "6px", background: COLORS.accent, borderRadius: "50%" }} />
            <span style={{ color: COLORS.muted, fontSize: "11px" }}>Событие</span>
          </div>
        </div>
      )}

      <div style={{ color: COLORS.dimmed, textAlign: "center", fontSize: "12px" }}>
        Нажми на дату, чтобы увидеть события
      </div>
    </div>
  );
}

// ─── DIARY ───────────────────────────────────────────────────────────────────

function DiarySection({ data, setData }) {
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ date: today(), mood: "😊", text: "" });
  const moods = ["😊", "😐", "😔", "😤", "🥳", "😴", "💪"];

  function addEntry() {
    if (!form.text.trim()) return;
    const entry = { id: Date.now(), ...form };
    setData(d => ({ ...d, diary: [entry, ...d.diary] }));
    setForm({ date: today(), mood: "😊", text: "" });
    setShowModal(false);
  }

  function deleteEntry(id) {
    setData(d => ({ ...d, diary: d.diary.filter(e => e.id !== id) }));
    setConfirmDelete(null);
  }

  return (
    <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px" }}>Записи</span>
        <Btn small onClick={() => setShowModal(true)}>+ Запись</Btn>
      </div>

      {data.diary.length === 0 ? (
        <div style={{ color: COLORS.dimmed, textAlign: "center", padding: "40px 0", fontSize: "14px" }}>Нет записей. Начни свой дневник!</div>
      ) : data.diary.map(e => (
        <div key={e.id} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "14px", padding: "16px", marginBottom: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "20px" }}>{e.mood}</span>
              <span style={{ color: COLORS.muted, fontSize: "12px" }}>{formatDate(e.date)}</span>
            </div>
            <button onClick={() => setConfirmDelete(e.id)} style={{ background: "none", border: "none", color: COLORS.dimmed, cursor: "pointer" }}>🗑</button>
          </div>
          <p style={{ color: COLORS.text, fontSize: "14px", lineHeight: "1.6", margin: 0 }}>{e.text}</p>
        </div>
      ))}

      {confirmDelete && (
        <ConfirmModal
          message="Удалить эту запись из дневника?"
          onConfirm={() => deleteEntry(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showModal && (
        <Modal title="Новая запись" onClose={() => setShowModal(false)}>
          <Input label="Дата" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <div style={{ marginBottom: "14px" }}>
            <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Настроение</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {moods.map(m => (
                <button key={m} onClick={() => setForm(f => ({ ...f, mood: m }))} style={{
                  fontSize: "22px", background: form.mood === m ? `${COLORS.accent}33` : "transparent",
                  border: `2px solid ${form.mood === m ? COLORS.accent : "transparent"}`,
                  borderRadius: "10px", padding: "6px", cursor: "pointer"
                }}>{m}</button>
              ))}
            </div>
          </div>
          <Textarea label="Запись" value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} placeholder="Сегодня я..." />
          <Btn onClick={addEntry} style={{ width: "100%" }}>Сохранить</Btn>
        </Modal>
      )}
    </div>
  );
}

// ─── TOP LISTS ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  todo: { label: "В списке", color: COLORS.muted },
  inprogress: { label: "В процессе", color: COLORS.orange },
  done: { label: "Завершено", color: COLORS.green },
};

function TopListsSection({ data, setData }) {
  const [activeList, setActiveList] = useState(data.topLists[0]?.id);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddList, setShowAddList] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // {listId, itemId, title}
  const [itemForm, setItemForm] = useState({ title: "", status: "todo", totalPages: "", readPages: "", season: "", episode: "", isSeries: false, country: "", city: "", placeType: "", notes: "" });
  const [newListTitle, setNewListTitle] = useState("");

  const list = data.topLists.find(l => l.id === activeList);

  function addItem() {
    if (!itemForm.title.trim()) return;
    const item = { id: Date.now(), ...itemForm };
    setData(d => ({ ...d, topLists: d.topLists.map(l => l.id === activeList ? { ...l, items: [...l.items, item] } : l) }));
    setItemForm({ title: "", status: "todo", totalPages: "", readPages: "", season: "", episode: "", isSeries: false, country: "", city: "", placeType: "", notes: "" });
    setShowAddItem(false);
  }

  function toggleStatus(listId, itemId) {
    setData(d => ({
      ...d, topLists: d.topLists.map(l => l.id === listId ? {
        ...l, items: l.items.map(it => it.id === itemId ? {
          ...it, status: it.status === "todo" ? "inprogress" : it.status === "inprogress" ? "done" : "todo"
        } : it)
      } : l)
    }));
  }

  function deleteItem(listId, itemId) {
    setData(d => ({ ...d, topLists: d.topLists.map(l => l.id === listId ? { ...l, items: l.items.filter(i => i.id !== itemId) } : l) }));
  }

  function addList() {
    if (!newListTitle.trim()) return;
    const icons = ["📝", "🎯", "⭐", "🔖", "🎵", "🍕"];
    const icon = icons[Math.floor(Math.random() * icons.length)];
    setData(d => ({ ...d, topLists: [...d.topLists, { id: Date.now(), title: `${icon} ${newListTitle}`, items: [] }] }));
    setNewListTitle("");
    setShowAddList(false);
  }

  const isBooks = list?.category === "books";
  const isMovies = list?.category === "movies";
  const isTravel = list?.category === "travel";

  const PLACE_TYPES = [
    { value: "restaurant", label: "Ресторан", emoji: "🍽" },
    { value: "hotel", label: "Гостиница", emoji: "🏨" },
    { value: "attraction", label: "Достопримечательность", emoji: "🗺" },
    { value: "museum", label: "Музей", emoji: "🏛" },
    { value: "park", label: "Парк", emoji: "🌳" },
    { value: "zoo", label: "Зоопарк", emoji: "🦁" },
    { value: "club", label: "Клуб / Развлечения", emoji: "🎭" },
    { value: "other", label: "Другое", emoji: "📍" },
  ];

  return (
    <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      {/* List tabs */}
      <div style={{ display: "flex", gap: "8px", overflowX: "auto", marginBottom: "16px", paddingBottom: "4px", WebkitOverflowScrolling: "touch" }}>
        {data.topLists.map(l => (
          <button key={l.id} onClick={() => setActiveList(l.id)} style={{
            whiteSpace: "nowrap", background: activeList === l.id ? COLORS.accent : COLORS.surface,
            border: `1px solid ${activeList === l.id ? COLORS.accent : COLORS.border}`,
            color: activeList === l.id ? "#fff" : COLORS.muted,
            borderRadius: "10px", padding: "6px 14px", fontSize: "13px", cursor: "pointer", fontWeight: 600
          }}>{l.title}</button>
        ))}
        <button onClick={() => setShowAddList(true)} style={{ whiteSpace: "nowrap", background: "transparent", border: `1px dashed ${COLORS.dimmed}`, color: COLORS.dimmed, borderRadius: "10px", padding: "6px 14px", fontSize: "13px", cursor: "pointer" }}>+ Список</button>
      </div>

      {list && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <span style={{ color: COLORS.muted, fontSize: "13px" }}>{list.items.length} позиций · {list.items.filter(i => i.status === "done").length} завершено</span>
            <Btn small onClick={() => setShowAddItem(true)}>+ Добавить</Btn>
          </div>
          {list.items.length === 0 ? (
            <div style={{ color: COLORS.dimmed, textAlign: "center", padding: "40px 0", fontSize: "14px" }}>Список пуст</div>
          ) : list.items.map((item, idx) => {
            const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.todo;
            return (
              <div key={item.id} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "14px", padding: "14px", marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: COLORS.dimmed, fontSize: "12px", fontWeight: 700 }}>#{idx + 1}</span>
                      <span style={{ color: item.status === "done" ? COLORS.muted : COLORS.text, fontWeight: 600, fontSize: "14px", textDecoration: item.status === "done" ? "line-through" : "none" }}>{item.title}</span>
                    </div>
                    <button onClick={() => toggleStatus(list.id, item.id)} style={{ background: `${sc.color}22`, border: "none", color: sc.color, borderRadius: "6px", padding: "3px 8px", fontSize: "11px", cursor: "pointer", marginTop: "6px", fontWeight: 600 }}>{sc.label}</button>
                  </div>
                  <button onClick={() => setConfirmDelete({ listId: list.id, itemId: item.id, title: item.title })} style={{ background: "none", border: "none", color: COLORS.dimmed, cursor: "pointer" }}>🗑</button>
                </div>
                {(item.totalPages || item.readPages) && (
                  <div style={{ marginTop: "10px" }}>
                    <ProgressBar value={parseInt(item.readPages) || 0} max={parseInt(item.totalPages) || 1} color={COLORS.accent} />
                  </div>
                )}
                {(item.season || item.episode) && (
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    {item.isSeries && <span style={{ background: `${COLORS.blue}22`, color: COLORS.blue, borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>📺 Сериал</span>}
                    {item.season && <span style={{ background: `${COLORS.accent}22`, color: COLORS.accent, borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>Сезон {item.season}</span>}
                    {item.episode && <span style={{ background: `${COLORS.orange}22`, color: COLORS.orange, borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>Серия {item.episode}</span>}
                  </div>
                )}
                {(item.country || item.city || item.placeType) && (() => {
                  const pt = PLACE_TYPES.find(p => p.value === item.placeType);
                  return (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                      {pt && <span style={{ background: `${COLORS.pink}22`, color: COLORS.pink, borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>{pt.emoji} {pt.label}</span>}
                      {item.city && <span style={{ background: `${COLORS.blue}22`, color: COLORS.blue, borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>🏙 {item.city}</span>}
                      {item.country && <span style={{ background: `${COLORS.green}22`, color: COLORS.green, borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>🌍 {item.country}</span>}
                    </div>
                  );
                })()}
                {item.notes && <div style={{ color: COLORS.muted, fontSize: "12px", marginTop: "8px", fontStyle: "italic" }}>"{item.notes}"</div>}
              </div>
            );
          })}
        </>
      )}

      {showAddItem && (
        <Modal title={`Добавить в ${list?.title}`} onClose={() => setShowAddItem(false)}>
          <Input label="Название" value={itemForm.title} onChange={e => setItemForm(f => ({ ...f, title: e.target.value }))} placeholder="Название..." />
          <div style={{ marginBottom: "14px" }}>
            <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Статус</label>
            <div style={{ display: "flex", gap: "8px" }}>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <button key={k} onClick={() => setItemForm(f => ({ ...f, status: k }))} style={{ flex: 1, background: itemForm.status === k ? `${v.color}33` : COLORS.surface, border: `1px solid ${itemForm.status === k ? v.color : COLORS.border}`, color: v.color, borderRadius: "8px", padding: "6px 4px", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>{v.label}</button>
              ))}
            </div>
          </div>

          {isBooks && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Input label="Всего страниц" type="number" value={itemForm.totalPages} onChange={e => setItemForm(f => ({ ...f, totalPages: e.target.value }))} placeholder="300" />
              <Input label="Прочитано" type="number" value={itemForm.readPages} onChange={e => setItemForm(f => ({ ...f, readPages: e.target.value }))} placeholder="120" />
            </div>
          )}

          {isMovies && (
            <>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Тип</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setItemForm(f => ({ ...f, isSeries: false, season: "", episode: "" }))} style={{ flex: 1, background: !itemForm.isSeries ? `${COLORS.accent}33` : COLORS.surface, border: `1px solid ${!itemForm.isSeries ? COLORS.accent : COLORS.border}`, color: !itemForm.isSeries ? COLORS.accent : COLORS.muted, borderRadius: "8px", padding: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px" }}>🎬 Фильм</button>
                  <button onClick={() => setItemForm(f => ({ ...f, isSeries: true }))} style={{ flex: 1, background: itemForm.isSeries ? `${COLORS.blue}33` : COLORS.surface, border: `1px solid ${itemForm.isSeries ? COLORS.blue : COLORS.border}`, color: itemForm.isSeries ? COLORS.blue : COLORS.muted, borderRadius: "8px", padding: "8px", cursor: "pointer", fontWeight: 600, fontSize: "13px" }}>📺 Сериал</button>
                </div>
              </div>
              {itemForm.isSeries && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <Input label="Сезон" type="number" value={itemForm.season} onChange={e => setItemForm(f => ({ ...f, season: e.target.value }))} placeholder="1" />
                  <Input label="Серия" type="number" value={itemForm.episode} onChange={e => setItemForm(f => ({ ...f, episode: e.target.value }))} placeholder="5" />
                </div>
              )}
            </>
          )}

          {isTravel && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <Input label="Страна" value={itemForm.country} onChange={e => setItemForm(f => ({ ...f, country: e.target.value }))} placeholder="Франция, Япония..." />
                <Input label="Город" value={itemForm.city} onChange={e => setItemForm(f => ({ ...f, city: e.target.value }))} placeholder="Париж, Токио..." />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Тип места</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {PLACE_TYPES.map(pt => (
                    <button key={pt.value} onClick={() => setItemForm(f => ({ ...f, placeType: pt.value }))} style={{
                      background: itemForm.placeType === pt.value ? `${COLORS.pink}33` : COLORS.surface,
                      border: `1px solid ${itemForm.placeType === pt.value ? COLORS.pink : COLORS.border}`,
                      color: itemForm.placeType === pt.value ? COLORS.pink : COLORS.muted,
                      borderRadius: "8px", padding: "7px 8px", cursor: "pointer", fontWeight: 600,
                      fontSize: "12px", textAlign: "left", display: "flex", alignItems: "center", gap: "6px"
                    }}>
                      <span>{pt.emoji}</span><span>{pt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Textarea label="Краткий вывод" value={itemForm.notes} onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))} placeholder={isMovies ? "Впечатления, рекомендую ли..." : isBooks ? "Главная мысль, понравилось ли..." : isTravel ? "Что запомнилось, стоит ли посетить..." : "Комментарий..."} />
          <Btn onClick={addItem} style={{ width: "100%" }}>Добавить</Btn>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          message={`Удалить «${confirmDelete.title}» из списка?`}
          onConfirm={() => { deleteItem(confirmDelete.listId, confirmDelete.itemId); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showAddList && (
        <Modal title="Новый список" onClose={() => setShowAddList(false)}>
          <Input label="Название" value={newListTitle} onChange={e => setNewListTitle(e.target.value)} placeholder="Топ сериалов, Топ ресторанов..." />
          <Btn onClick={addList} style={{ width: "100%" }}>Создать</Btn>
        </Modal>
      )}
    </div>
  );
}

// ─── CONFIRM DELETE ──────────────────────────────────────────────────────────

// ─── HABIT DETAIL VIEW ────────────────────────────────────────────────────────

function HabitDetail({ habit, onBack, onToggle, onDelete }) {
  const todayStr = today();
  const isGood = habit.type === "good";
  const color = isGood ? COLORS.green : COLORS.red;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startDate = new Date(habit.startDate + "T12:00:00");
  const nowDate = new Date();
  const totalDaysSinceStart = Math.floor((nowDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
  const currentDay = Math.min(totalDaysSinceStart, habit.goal);

  const allDays = Array.from({ length: habit.goal }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const isPast = d < nowDate;
    const isToday = ds === todayStr;
    const isFuture = !isPast && !isToday;
    const done = !!habit.checkins[ds];
    return { ds, day: i + 1, done, isPast, isToday, isFuture };
  });

  const doneDays = allDays.filter(d => d.done).length;
  const missedDays = allDays.filter(d => (d.isPast || d.isToday) && !d.done).length;
  const pct = habit.goal > 0 ? Math.round((doneDays / habit.goal) * 100) : 0;
  let streak = 0;
  for (let i = currentDay - 1; i >= 0; i--) {
    if (allDays[i] && allDays[i].done) streak++;
    else break;
  }

  const checkedToday = !!habit.checkins[todayStr];
  const startFmt = startDate.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const todayFmt = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
        <button onClick={onBack} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "14px" }}>← Назад</button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "22px" }}>{habit.emoji}</span>
          <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px" }}>{habit.name}</span>
        </div>
        <button onClick={() => setConfirmDelete(true)} style={{ background: `${COLORS.red}22`, border: "none", color: COLORS.red, borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "14px" }}>🗑</button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "20px" }}>
        {[
          { label: "День", value: `${currentDay}/${habit.goal}`, c: COLORS.accent },
          { label: "Выполнено", value: doneDays, c: color },
          { label: "Пропущено", value: missedDays, c: missedDays > habit.allowedMiss ? COLORS.red : COLORS.muted },
          { label: "Серия 🔥", value: streak, c: COLORS.orange },
        ].map(s => (
          <div key={s.label} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "12px", padding: "10px 4px", textAlign: "center" }}>
            <div style={{ color: s.c, fontWeight: 800, fontSize: "17px" }}>{s.value}</div>
            <div style={{ color: COLORS.muted, fontSize: "9px", marginTop: "2px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: "16px" }}>
        <ProgressBar value={doneDays} max={habit.goal} color={color} />
        <div style={{ color: COLORS.muted, fontSize: "11px", marginTop: "5px", textAlign: "center" }}>{pct}% цели достигнуто</div>
      </div>

      {/* Dates */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <div style={{ flex: 1, background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: "10px", padding: "8px 12px" }}>
          <div style={{ color: COLORS.muted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Начало</div>
          <div style={{ color: COLORS.text, fontSize: "12px", fontWeight: 600, marginTop: "2px" }}>{startFmt}</div>
        </div>
        <div style={{ flex: 1, background: COLORS.card, border: `1px solid ${COLORS.accent}44`, borderRadius: "10px", padding: "8px 12px", textAlign: "right" }}>
          <div style={{ color: COLORS.muted, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Сегодня</div>
          <div style={{ color: COLORS.accent, fontSize: "12px", fontWeight: 600, marginTop: "2px" }}>{todayFmt}</div>
        </div>
      </div>

      {/* Full progress grid — left to right, day 1 → goal */}
      <div style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
        Прогресс по дням (день 1 → {habit.goal})
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "16px" }}>
        {allDays.map(({ ds, day, done, isPast, isToday, isFuture }) => {
          const bg = done ? color : isToday ? `${color}22` : isFuture ? COLORS.surface : `${COLORS.red}18`;
          const borderCol = isToday ? color : done ? color + "88" : isFuture ? COLORS.border : COLORS.red + "44";
          const textCol = done ? "#fff" : isToday ? color : isFuture ? COLORS.dimmed : COLORS.red;
          return (
            <div key={ds} title={ds} style={{ borderRadius: "7px", padding: "5px 2px", textAlign: "center", background: bg, border: `1.5px solid ${borderCol}`, opacity: isFuture ? 0.35 : 1 }}>
              <div style={{ color: textCol, fontSize: "10px", fontWeight: isToday ? 800 : 600 }}>{day}</div>
              <div style={{ fontSize: "8px", color: done ? "#fff" : isToday ? color : isFuture ? COLORS.dimmed : COLORS.red + "99", marginTop: "1px" }}>
                {done ? "✓" : isToday ? "●" : isFuture ? "" : "✕"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
        {[
          { bg: color, label: "Выполнено" },
          { bg: `${COLORS.red}18`, label: "Пропуск", border: COLORS.red + "44", text: COLORS.red },
          { bg: `${color}22`, label: "Сегодня", border: color },
          { bg: COLORS.surface, label: "Будущее", border: COLORS.border, text: COLORS.dimmed },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: l.bg, border: `1px solid ${l.border || l.bg}`, flexShrink: 0 }} />
            <span style={{ color: COLORS.muted, fontSize: "11px" }}>{l.label}</span>
          </div>
        ))}
      </div>

      <button onClick={() => onToggle(habit.id)} style={{
        width: "100%", background: checkedToday ? color : "transparent",
        border: `2px solid ${color}`, color: checkedToday ? "#fff" : color,
        borderRadius: "14px", padding: "14px", cursor: "pointer", fontWeight: 700, fontSize: "15px", transition: "all 0.2s"
      }}>{checkedToday ? `✓ День ${currentDay} выполнен!` : `Отметить день ${currentDay}`}</button>

      {confirmDelete && (
        <ConfirmModal
          message={`Удалить привычку «${habit.name}»? Весь прогресс будет потерян.`}
          onConfirm={() => { onDelete(habit.id); setConfirmDelete(false); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ─── HABITS ───────────────────────────────────────────────────────────────────

function HabitsSection({ data, setData }) {
  const [showModal, setShowModal] = useState(false);
  const [detailHabit, setDetailHabit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const todayStr = today();
  const [form, setForm] = useState({ name: "", type: "good", goal: 30, allowedMiss: 0, emoji: "✅" });
  const goodEmojis = ["✅", "💪", "🏃", "📖", "🧘", "💧", "🥗", "😴", "🎯", "🌟"];
  const badEmojis = ["🚫", "🍭", "🚬", "📱", "🍺", "🎰", "😤", "🛋"];

  function addHabit() {
    if (!form.name.trim()) return;
    const habit = { id: Date.now(), ...form, startDate: todayStr, checkins: {} };
    setData(d => ({ ...d, habits: [...d.habits, habit] }));
    setForm({ name: "", type: "good", goal: 30, allowedMiss: 0, emoji: "✅" });
    setShowModal(false);
  }

  function toggleCheckin(id) {
    setData(d => ({
      ...d, habits: d.habits.map(h => h.id === id ? {
        ...h, checkins: { ...h.checkins, [todayStr]: !h.checkins[todayStr] }
      } : h)
    }));
  }

  function deleteHabit(id) {
    setData(d => ({ ...d, habits: d.habits.filter(h => h.id !== id) }));
    if (detailHabit?.id === id) setDetailHabit(null);
    setConfirmDelete(null);
  }

  // Show first 7 days from habit start: day 1 (left) → day 7 (right)
  function getLast7(habit) {
    const startDate = new Date(habit.startDate + "T12:00:00");
    return Array(7).fill(null).map((_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const isFuture = d > new Date();
      return { ds, done: !!habit.checkins[ds], isToday: ds === todayStr, isFuture };
    });
  }

  if (detailHabit) {
    const liveHabit = data.habits.find(h => h.id === detailHabit.id) || detailHabit;
    return (
      <HabitDetail
        habit={liveHabit}
        onBack={() => setDetailHabit(null)}
        onToggle={toggleCheckin}
        onDelete={(id) => { deleteHabit(id); setDetailHabit(null); }}
      />
    );
  }

  return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px" }}>Трекер привычек</span>
        <Btn small onClick={() => setShowModal(true)}>+ Привычка</Btn>
      </div>

      {data.habits.length === 0 ? (
        <div style={{ color: COLORS.dimmed, textAlign: "center", padding: "40px 0", fontSize: "14px" }}>Добавь первую привычку!</div>
      ) : data.habits.map(habit => {
        const done = Object.values(habit.checkins).filter(Boolean).length;
        const pct = habit.goal > 0 ? Math.min(100, Math.round((done / habit.goal) * 100)) : 0;
        const last7 = getLast7(habit);
        const isGood = habit.type === "good";
        const color = isGood ? COLORS.green : COLORS.red;
        const checkedToday = !!habit.checkins[todayStr];
        const startDate = new Date(habit.startDate + "T12:00:00");
        const dayNum = Math.min(Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24)) + 1, habit.goal);

        return (
          <div key={habit.id} onClick={() => setDetailHabit(habit)} style={{
            background: COLORS.card, border: `1px solid ${checkedToday ? color + "55" : COLORS.border}`,
            borderRadius: "16px", padding: "16px", marginBottom: "14px",
            cursor: "pointer", transition: "border-color 0.3s"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "22px" }}>{habit.emoji}</span>
                <div>
                  <div style={{ color: COLORS.text, fontWeight: 600, fontSize: "15px" }}>{habit.name}</div>
                  <div style={{ color: COLORS.muted, fontSize: "11px", marginTop: "2px" }}>
                    <span style={{ color, fontWeight: 700 }}>{isGood ? "✓ Полезная" : "✗ Вредная"}</span>
                    {" · "} день {dayNum}/{habit.goal}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color, fontSize: "12px", fontWeight: 700 }}>{pct}%</span>
                <button onClick={e => { e.stopPropagation(); setConfirmDelete(habit.id); }}
                  style={{ background: "none", border: "none", color: COLORS.dimmed, cursor: "pointer", fontSize: "14px", padding: "2px 4px" }}>🗑</button>
              </div>
            </div>

            {/* Days 1–7 from start: left=day1, right=day7 */}
            <div style={{ display: "flex", gap: "3px", marginBottom: "10px" }}>
              {last7.map(({ ds, done: d, isToday, isFuture }, i) => (
                <div key={ds} title={ds} style={{
                  flex: 1, height: "28px", borderRadius: "5px",
                  background: d ? color : isToday ? `${color}22` : isFuture ? COLORS.surface : `${COLORS.red}18`,
                  border: `1.5px solid ${isToday ? color : d ? color + "88" : isFuture ? COLORS.border : COLORS.red + "44"}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  opacity: isFuture ? 0.35 : 1,
                }}>
                  <span style={{ fontSize: "8px", color: d ? "#fff" : isToday ? color : isFuture ? COLORS.dimmed : COLORS.red, fontWeight: 700, lineHeight: 1 }}>
                    {d ? "✓" : isToday ? "●" : isFuture ? "" : "✕"}
                  </span>
                  <span style={{ fontSize: "7px", color: d ? "#ffffff88" : COLORS.dimmed, lineHeight: 1, marginTop: "1px" }}>{i + 1}</span>
                </div>
              ))}
            </div>

            <ProgressBar value={done} max={habit.goal} color={color} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
              <span style={{ color: COLORS.dimmed, fontSize: "11px" }}>Нажми для деталей →</span>
              <button onClick={e => { e.stopPropagation(); toggleCheckin(habit.id); }} style={{
                background: checkedToday ? color : "transparent",
                border: `2px solid ${color}`, color: checkedToday ? "#fff" : color,
                borderRadius: "10px", padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: "12px", transition: "all 0.2s"
              }}>{checkedToday ? "✓ Выполнено" : "Отметить"}</button>
            </div>
          </div>
        );
      })}

      {confirmDelete && (
        <ConfirmModal
          message={`Удалить привычку «${data.habits.find(h => h.id === confirmDelete)?.name}»? Весь прогресс будет потерян.`}
          onConfirm={() => deleteHabit(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showModal && (
        <Modal title="Новая привычка" onClose={() => setShowModal(false)}>
          <Input label="Название" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Читать 30 мин, Не есть сахар..." />
          <div style={{ marginBottom: "14px" }}>
            <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Тип</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setForm(f => ({ ...f, type: "good", emoji: "✅" }))} style={{ flex: 1, background: form.type === "good" ? `${COLORS.green}22` : COLORS.surface, border: `1px solid ${form.type === "good" ? COLORS.green : COLORS.border}`, color: form.type === "good" ? COLORS.green : COLORS.muted, borderRadius: "10px", padding: "8px", cursor: "pointer", fontWeight: 600 }}>✓ Полезная</button>
              <button onClick={() => setForm(f => ({ ...f, type: "bad", emoji: "🚫" }))} style={{ flex: 1, background: form.type === "bad" ? `${COLORS.red}22` : COLORS.surface, border: `1px solid ${form.type === "bad" ? COLORS.red : COLORS.border}`, color: form.type === "bad" ? COLORS.red : COLORS.muted, borderRadius: "10px", padding: "8px", cursor: "pointer", fontWeight: 600 }}>✗ Вредная</button>
            </div>
          </div>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Иконка</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {(form.type === "good" ? goodEmojis : badEmojis).map(em => (
                <button key={em} onClick={() => setForm(f => ({ ...f, emoji: em }))} style={{ fontSize: "20px", background: form.emoji === em ? `${COLORS.accent}33` : "transparent", border: `2px solid ${form.emoji === em ? COLORS.accent : "transparent"}`, borderRadius: "8px", padding: "4px", cursor: "pointer" }}>{em}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Input label="Цель (дней)" type="number" value={form.goal} onChange={e => setForm(f => ({ ...f, goal: parseInt(e.target.value) || 30 }))} />
            <Input label="Допустимо пропусков" type="number" value={form.allowedMiss} onChange={e => setForm(f => ({ ...f, allowedMiss: parseInt(e.target.value) || 0 }))} />
          </div>
          <Btn onClick={addHabit} style={{ width: "100%" }}>Добавить привычку</Btn>
        </Modal>
      )}
    </div>
  );
}

// ─── BIRTHDAYS ────────────────────────────────────────────────────────────────

const RELATION_OPTIONS = ["👨‍👩‍👧 Семья", "👫 Друг", "💼 Коллега", "❤️ Партнёр", "👥 Другое"];
const ZODIAC_SIGNS = [
  { name: "Козерог", start: [12, 22], end: [1, 19], emoji: "♑" },
  { name: "Водолей", start: [1, 20], end: [2, 18], emoji: "♒" },
  { name: "Рыбы", start: [2, 19], end: [3, 20], emoji: "♓" },
  { name: "Овен", start: [3, 21], end: [4, 19], emoji: "♈" },
  { name: "Телец", start: [4, 20], end: [5, 20], emoji: "♉" },
  { name: "Близнецы", start: [5, 21], end: [6, 20], emoji: "♊" },
  { name: "Рак", start: [6, 21], end: [7, 22], emoji: "♋" },
  { name: "Лев", start: [7, 23], end: [8, 22], emoji: "♌" },
  { name: "Дева", start: [8, 23], end: [9, 22], emoji: "♍" },
  { name: "Весы", start: [9, 23], end: [10, 22], emoji: "♎" },
  { name: "Скорпион", start: [10, 23], end: [11, 21], emoji: "♏" },
  { name: "Стрелец", start: [11, 22], end: [12, 21], emoji: "♐" },
];

function getZodiac(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const m = d.getMonth() + 1, day = d.getDate();
  for (const z of ZODIAC_SIGNS) {
    const [sm, sd] = z.start, [em, ed] = z.end;
    if ((m === sm && day >= sd) || (m === em && day <= ed)) return z;
  }
  return null;
}

function getDaysUntilBirthday(dateStr) {
  const now = new Date();
  const year = now.getFullYear();
  const [, mm, dd] = dateStr.split("-");
  let bday = new Date(`${year}-${mm}-${dd}T00:00:00`);
  if (bday < now) bday = new Date(`${year + 1}-${mm}-${dd}T00:00:00`);
  return Math.ceil((bday - now) / (1000 * 60 * 60 * 24));
}

function getAge(dateStr) {
  const now = new Date();
  const birth = new Date(dateStr + "T12:00:00");
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function BirthdaysSection({ data, setData }) {
  const [showModal, setShowModal] = useState(false);
  const [notifModal, setNotifModal] = useState(null);
  const [notifPerm, setNotifPerm] = useState(() => "Notification" in window ? Notification.permission : "unsupported");
  const [confirmDelete, setConfirmDelete] = useState(null); // birthday id
  const [form, setForm] = useState({ name: "", date: "", relation: "👫 Друг", note: "" });

  const emptyNotif = { notifWeekBefore: true, notifDayBefore: true, notifHourBefore: false };

  async function ensurePermission() {
    const result = await requestNotifPermission();
    setNotifPerm(result);
    return result === "granted";
  }

  function addBirthday() {
    if (!form.name.trim() || !form.date) return;
    const b = { id: Date.now(), ...form, ...emptyNotif };
    setData(d => ({ ...d, birthdays: [...(d.birthdays || []), b] }));
    setForm({ name: "", date: "", relation: "👫 Друг", note: "" });
    setShowModal(false);
    // Open notification config right away
    setNotifModal(b);
  }

  function saveNotifSettings(bid, settings) {
    setData(d => ({
      ...d,
      birthdays: (d.birthdays || []).map(b => b.id === bid ? { ...b, ...settings } : b)
    }));
    const updated = (data.birthdays || []).find(b => b.id === bid);
    if (updated) scheduleBirthdayNotifications({ ...updated, ...settings });
    setNotifModal(null);
  }

  function deleteBirthday(id) {
    setData(d => ({ ...d, birthdays: (d.birthdays || []).filter(b => b.id !== id) }));
  }

  const sorted = [...(data.birthdays || [])].sort((a, b) => getDaysUntilBirthday(a.date) - getDaysUntilBirthday(b.date));
  const _now = new Date();
  const todayMMDD = String(_now.getMonth() + 1).padStart(2, "0") + "-" + String(_now.getDate()).padStart(2, "0");

  return (
    <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", overflowX: "hidden" }}>
      {/* Notification permission banner */}
      {notifPerm !== "granted" && notifPerm !== "unsupported" && (
        <div style={{ background: `${COLORS.orange}22`, border: `1px solid ${COLORS.orange}55`, borderRadius: "12px", padding: "12px 16px", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: COLORS.orange, fontSize: "13px" }}>
            {notifPerm === "denied" ? "🚫 Уведомления заблокированы в браузере" : "🔔 Разреши уведомления для напоминаний"}
          </span>
          {notifPerm !== "denied" && (
            <button onClick={ensurePermission} style={{ background: COLORS.orange, border: "none", color: "#fff", borderRadius: "8px", padding: "5px 12px", fontSize: "12px", cursor: "pointer", fontWeight: 700 }}>Разрешить</button>
          )}
        </div>
      )}
      {notifPerm === "granted" && (
        <div style={{ background: `${COLORS.green}18`, border: `1px solid ${COLORS.green}44`, borderRadius: "12px", padding: "10px 16px", marginBottom: "16px" }}>
          <span style={{ color: COLORS.green, fontSize: "12px" }}>✓ Уведомления включены · работают пока приложение открыто</span>
        </div>
      )}
      {notifPerm === "unsupported" && (
        <div style={{ background: `${COLORS.yellow}18`, border: `1px solid ${COLORS.yellow}44`, borderRadius: "12px", padding: "10px 16px", marginBottom: "16px" }}>
          <span style={{ color: COLORS.yellow, fontSize: "12px" }}>⚠️ На iPhone уведомления работают только пока приложение открыто. Для фоновых уведомлений нужен iOS 16.4+ и разрешение в настройках Safari.</span>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "16px" }}>Дни рождения</span>
        <Btn small onClick={async () => { await ensurePermission(); setShowModal(true); }}>+ Добавить</Btn>
      </div>

      {sorted.length === 0 ? (
        <div style={{ color: COLORS.dimmed, textAlign: "center", padding: "40px 0", fontSize: "14px" }}>Добавь первый день рождения!</div>
      ) : sorted.map(b => {
        const daysLeft = getDaysUntilBirthday(b.date);
        const isToday = b.date.slice(5) === todayMMDD;
        const age = getAge(b.date);
        const zodiac = getZodiac(b.date);
        const urgentColor = isToday ? COLORS.pink : daysLeft <= 7 ? COLORS.orange : daysLeft <= 30 ? COLORS.yellow : COLORS.muted;

        return (
          <div key={b.id} style={{ background: COLORS.card, border: `1px solid ${isToday ? COLORS.pink + "88" : COLORS.border}`, borderRadius: "16px", padding: "16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "18px" }}>{isToday ? "🎉" : "🎂"}</span>
                  <span style={{ color: COLORS.text, fontWeight: 700, fontSize: "15px" }}>{b.name}</span>
                  {zodiac && <span style={{ fontSize: "14px" }} title={zodiac.name}>{zodiac.emoji}</span>}
                </div>
                <div style={{ color: COLORS.muted, fontSize: "12px", marginBottom: "6px" }}>
                  {b.relation} · {new Date(b.date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} · {age} лет
                </div>
                <div style={{ display: "inline-block", background: `${urgentColor}22`, border: `1px solid ${urgentColor}44`, borderRadius: "8px", padding: "3px 10px" }}>
                  <span style={{ color: urgentColor, fontSize: "12px", fontWeight: 700 }}>
                    {isToday ? "🎊 Сегодня!" : `через ${daysLeft} дн.`}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={() => setNotifModal(b)} style={{ background: `${COLORS.accent}22`, border: "none", color: COLORS.accent, borderRadius: "8px", padding: "5px 8px", cursor: "pointer", fontSize: "14px" }} title="Настройки уведомлений">🔔</button>
                <button onClick={() => setConfirmDelete(b.id)} style={{ background: "none", border: "none", color: COLORS.dimmed, cursor: "pointer", fontSize: "14px" }}>🗑</button>
              </div>
            </div>

            {/* Notification badges */}
            <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
              {b.notifWeekBefore && <span style={{ background: `${COLORS.blue}22`, color: COLORS.blue, borderRadius: "6px", padding: "2px 8px", fontSize: "10px", fontWeight: 600 }}>за неделю</span>}
              {b.notifDayBefore && <span style={{ background: `${COLORS.accent}22`, color: COLORS.accent, borderRadius: "6px", padding: "2px 8px", fontSize: "10px", fontWeight: 600 }}>за день</span>}
              {b.notifHourBefore && <span style={{ background: `${COLORS.green}22`, color: COLORS.green, borderRadius: "6px", padding: "2px 8px", fontSize: "10px", fontWeight: 600 }}>за час</span>}
              {!b.notifWeekBefore && !b.notifDayBefore && !b.notifHourBefore && <span style={{ color: COLORS.dimmed, fontSize: "10px" }}>уведомления отключены</span>}
            </div>
            {b.note && <div style={{ color: COLORS.muted, fontSize: "12px", marginTop: "8px" }}>{b.note}</div>}
          </div>
        );
      })}

      {confirmDelete && (
        <ConfirmModal
          message={`Удалить день рождения «${(data.birthdays || []).find(b => b.id === confirmDelete)?.name}»?`}
          onConfirm={() => { deleteBirthday(confirmDelete); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Add modal */}
      {showModal && (
        <Modal title="Новый день рождения" onClose={() => setShowModal(false)}>
          <Input label="Имя" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Имя или прозвище" />
          <Input label="Дата рождения" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <div style={{ marginBottom: "14px" }}>
            <label style={{ color: COLORS.muted, fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Кем приходится</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {RELATION_OPTIONS.map(r => (
                <button key={r} onClick={() => setForm(f => ({ ...f, relation: r }))} style={{ background: form.relation === r ? `${COLORS.accent}33` : COLORS.surface, border: `1px solid ${form.relation === r ? COLORS.accent : COLORS.border}`, color: form.relation === r ? COLORS.accent : COLORS.muted, borderRadius: "8px", padding: "5px 10px", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>{r}</button>
              ))}
            </div>
          </div>
          <Textarea label="Заметка (необязательно)" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Что подарить, любимый цвет..." />
          <Btn onClick={addBirthday} style={{ width: "100%" }}>Добавить →</Btn>
        </Modal>
      )}

      {/* Notification settings modal */}
      {notifModal && (
        <NotifSettingsModal
          birthday={notifModal}
          onSave={settings => saveNotifSettings(notifModal.id, settings)}
          onClose={() => setNotifModal(null)}
        />
      )}
    </div>
  );
}

function NotifSettingsModal({ birthday, onSave, onClose }) {
  const [settings, setSettings] = useState({
    notifWeekBefore: birthday.notifWeekBefore ?? true,
    notifDayBefore: birthday.notifDayBefore ?? true,
    notifHourBefore: birthday.notifHourBefore ?? false,
  });

  const options = [
    { key: "notifWeekBefore", label: "За неделю", desc: "В 9:00 утра, за 7 дней", color: COLORS.blue },
    { key: "notifDayBefore", label: "За день", desc: "В 9:00 утра, накануне", color: COLORS.accent },
    { key: "notifHourBefore", label: "За час", desc: "В 8:00 утра, в день рождения", color: COLORS.green },
  ];

  return (
    <Modal title={`🔔 Уведомления — ${birthday.name}`} onClose={onClose}>
      <div style={{ color: COLORS.muted, fontSize: "13px", marginBottom: "20px" }}>
        Выбери, когда напоминать о дне рождения ежегодно
      </div>
      {options.map(opt => (
        <div key={opt.key} onClick={() => setSettings(s => ({ ...s, [opt.key]: !s[opt.key] }))} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: settings[opt.key] ? `${opt.color}18` : COLORS.surface,
          border: `1px solid ${settings[opt.key] ? opt.color + "55" : COLORS.border}`,
          borderRadius: "12px", padding: "14px 16px", marginBottom: "10px", cursor: "pointer"
        }}>
          <div>
            <div style={{ color: settings[opt.key] ? opt.color : COLORS.text, fontWeight: 600, fontSize: "14px" }}>{opt.label}</div>
            <div style={{ color: COLORS.muted, fontSize: "12px", marginTop: "2px" }}>{opt.desc}</div>
          </div>
          <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: settings[opt.key] ? opt.color : "transparent", border: `2px solid ${settings[opt.key] ? opt.color : COLORS.dimmed}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "#fff" }}>
            {settings[opt.key] ? "✓" : ""}
          </div>
        </div>
      ))}
      <Btn onClick={() => onSave(settings)} style={{ width: "100%", marginTop: "8px" }}>Сохранить настройки</Btn>
    </Modal>
  );
}

// ─── AUTH STORAGE ─────────────────────────────────────────────────────────────
const AUTH_KEY = "pocket_auth_v1";
const PROFILE_KEY = "pocket_profile_v1";

function loadAuth() { // eslint-disable-line no-unused-vars
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
function clearAuth() { localStorage.removeItem(AUTH_KEY); }
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch { return null; }
}
function saveProfileLS(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

// ─── FIREBASE AUTH SCREEN ────────────────────────────────────────────────────

async function fbRegister(email, password) {
  return createUserWithEmailAndPassword(fbAuth, email, password);
}
async function fbLogin(email, password) {
  return signInWithEmailAndPassword(fbAuth, email, password);
}
async function fbReset(email) {
  return sendPasswordResetEmail(fbAuth, email);
}

function AuthScreen({ onAuth }) {
  const [tab, setTab] = useState("login"); // "login" | "register" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const iBase = {
    width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`,
    borderRadius: "12px", padding: "12px 14px", color: COLORS.text, fontSize: "16px",
    outline: "none", boxSizing: "border-box", fontFamily: "inherit", marginBottom: "12px",
  };

  function getErrorText(code) {
    const map = {
      "auth/user-not-found": "Пользователь не найден",
      "auth/wrong-password": "Неверный пароль",
      "auth/email-already-in-use": "Email уже используется",
      "auth/weak-password": "Пароль слишком короткий (минимум 6 символов)",
      "auth/invalid-email": "Некорректный email",
      "auth/invalid-credential": "Неверный email или пароль",
      "auth/too-many-requests": "Слишком много попыток. Попробуй позже",
      "auth/network-request-failed": "Нет соединения с интернетом",
    };
    return map[code] || "Ошибка. Попробуй ещё раз.";
  }

  async function handleSubmit() {
    setError(""); setLoading(true);
    try {
      if (tab === "login") {
        await fbLogin(email.trim(), password);
        onAuth({ email: email.trim() });
      } else if (tab === "register") {
        if (password !== confirm) { setError("Пароли не совпадают"); setLoading(false); return; }
        if (password.length < 6) { setError("Пароль минимум 6 символов"); setLoading(false); return; }
        await fbRegister(email.trim(), password);
        onAuth({ email: email.trim() });
      } else {
        await fbReset(email.trim());
        setResetSent(true);
      }
    } catch (e) {
      setError(getErrorText(e.code));
    }
    setLoading(false);
  }

  const tabStyle = (active) => ({
    flex: 1, background: "none", border: "none",
    borderBottom: `1.5px solid ${active ? COLORS.accent : "transparent"}`,
    color: active ? COLORS.accent : COLORS.fill,
    padding: "11px 4px", fontSize: "14px", fontWeight: active ? 600 : 400,
    cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.2px",
  });

  return (
    <div style={{
      height: "100dvh", background: COLORS.bg, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px)",
      fontFamily: "-apple-system, 'SF Pro Display', system-ui, sans-serif", overflowY: "auto",
    }}>
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "56px", marginBottom: "10px" }}>🗂</div>
        <div style={{ fontWeight: 800, fontSize: "24px", background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.pink})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Карманный ассистент
        </div>
        <div style={{ color: COLORS.muted, fontSize: "13px", marginTop: "6px" }}>Твой личный органайзер</div>
      </div>

      <div style={{ width: "100%", maxWidth: "380px", background: COLORS.surface, border: `0.5px solid ${COLORS.border}`, borderRadius: "20px", overflow: "hidden" }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${COLORS.border}` }}>
          <button style={tabStyle(tab === "login")} onClick={() => { setTab("login"); setError(""); setResetSent(false); }}>Войти</button>
          <button style={tabStyle(tab === "register")} onClick={() => { setTab("register"); setError(""); }}>Регистрация</button>
          <button style={tabStyle(tab === "reset")} onClick={() => { setTab("reset"); setError(""); setResetSent(false); }}>Забыл пароль</button>
        </div>

        <div style={{ padding: "24px" }}>
          {tab === "reset" && resetSent ? (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>📬</div>
              <div style={{ color: COLORS.green, fontWeight: 700, fontSize: "15px", marginBottom: "8px" }}>Письмо отправлено!</div>
              <div style={{ color: COLORS.muted, fontSize: "13px", lineHeight: "1.6" }}>Проверь почту <span style={{ color: COLORS.accent }}>{email}</span> и перейди по ссылке для сброса пароля.</div>
              <button onClick={() => { setTab("login"); setResetSent(false); }} style={{ marginTop: "20px", background: "none", border: "none", color: COLORS.accent, cursor: "pointer", fontSize: "14px", fontFamily: "inherit" }}>← Вернуться к входу</button>
            </div>
          ) : (
            <>
              <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Email</label>
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); }} placeholder="your@email.com" style={iBase} autoComplete="email" />

              {tab !== "reset" && (
                <>
                  <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Пароль</label>
                  <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="Минимум 6 символов" style={iBase} autoComplete={tab === "register" ? "new-password" : "current-password"} onKeyDown={e => e.key === "Enter" && !confirm && handleSubmit()} />
                </>
              )}

              {tab === "register" && (
                <>
                  <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Повтори пароль</label>
                  <input type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setError(""); }} placeholder="Ещё раз пароль" style={iBase} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
                </>
              )}

              {error && <div style={{ color: COLORS.red, fontSize: "13px", marginBottom: "12px", lineHeight: "1.4" }}>⚠️ {error}</div>}

              <button onClick={handleSubmit} disabled={loading} style={{
                width: "100%", background: loading ? COLORS.dimmed : COLORS.accent,
                border: "none", color: "#fff", borderRadius: "12px", padding: "14px",
                fontWeight: 700, fontSize: "15px", cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}>
                {loading ? "Подождите..." : tab === "login" ? "Войти →" : tab === "register" ? "Создать аккаунт →" : "Отправить письмо →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────

const GENDER_OPTIONS = ["Мужской", "Женской", "Предпочитаю не указывать"];

function ProfileScreen({ auth, profile, onSave, onSkip, onLogout, isSetup = false }) {
  const [form, setForm] = useState({
    firstName: profile?.firstName || "",
    lastName: profile?.lastName || "",
    age: profile?.age || "",
    gender: profile?.gender || "",
    country: profile?.country || "",
    city: profile?.city || "",
  });

  function handleSave() {
    saveProfileLS({ ...form, email: auth?.email || "", updatedAt: Date.now() });
    onSave({ ...form, email: auth?.email || "" });
  }

  const avatarLetter = (form.firstName || auth?.email || "?")[0].toUpperCase();

  return (
    <div style={{
      height: "100dvh", background: COLORS.bg, fontFamily: "-apple-system, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
      display: "flex", flexDirection: "column", maxWidth: "480px", margin: "0 auto",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        paddingTop: `calc(env(safe-area-inset-top) + 16px)`,
        paddingBottom: "16px", paddingLeft: "20px", paddingRight: "20px",
        borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: "12px"
      }}>
        {!isSetup && (
          <button onClick={onSkip} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "14px" }}>← Назад</button>
        )}
        <div style={{ flex: 1, fontWeight: 800, fontSize: "18px", color: COLORS.text }}>
          {isSetup ? "👤 Расскажи о себе" : "👤 Профиль"}
        </div>
        {!isSetup && (
          <button onClick={onLogout} style={{ background: `${COLORS.red}22`, border: "none", color: COLORS.red, borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Выйти</button>
        )}
      </div>

      <div style={{ flex: 1, padding: "24px 20px", overflowY: "auto", WebkitOverflowScrolling: "touch", paddingBottom: `calc(env(safe-area-inset-bottom) + 24px)` }}>
        {/* Avatar */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "28px" }}>
          <div style={{
            width: "72px", height: "72px", borderRadius: "50%",
            background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.pink})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "28px", fontWeight: 800, color: "#fff", marginBottom: "8px"
          }}>{avatarLetter}</div>
          <div style={{ color: COLORS.muted, fontSize: "13px" }}>{auth?.email}</div>
          {isSetup && <div style={{ color: COLORS.muted, fontSize: "12px", marginTop: "6px", textAlign: "center", maxWidth: "260px", lineHeight: "1.5" }}>Заполни профиль или пропусти — можно сделать это позже</div>}
        </div>

        {/* Name row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
          <div>
            <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Имя</label>
            <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="Иван" style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Фамилия</label>
            <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Иванов" style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        {/* Age */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Возраст</label>
          <input type="number" value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))} placeholder="25" style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Gender */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "8px" }}>Пол</label>
          <div style={{ display: "flex", gap: "8px" }}>
            {GENDER_OPTIONS.map(g => (
              <button key={g} onClick={() => setForm(f => ({ ...f, gender: g }))} style={{
                flex: 1, background: form.gender === g ? `${COLORS.accent}33` : COLORS.surface,
                border: `1px solid ${form.gender === g ? COLORS.accent : COLORS.border}`,
                color: form.gender === g ? COLORS.accent : COLORS.muted,
                borderRadius: "10px", padding: "8px 4px", fontSize: "11px", cursor: "pointer", fontWeight: 600
              }}>{g}</button>
            ))}
          </div>
        </div>

        {/* Country / City */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "28px" }}>
          <div>
            <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Страна</label>
            <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Россия" style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ color: COLORS.muted, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "6px" }}>Город</label>
            <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Москва" style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: "10px", padding: "10px 12px", color: COLORS.text, fontSize: "14px", outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        <button onClick={handleSave} style={{
          width: "100%", background: COLORS.accent, border: "none", color: "#fff",
          borderRadius: "12px", padding: "13px", fontWeight: 700, fontSize: "15px", cursor: "pointer", marginBottom: "12px"
        }}>Сохранить профиль ✓</button>

        {isSetup && (
          <button onClick={onSkip} style={{
            width: "100%", background: "transparent", border: `1px solid ${COLORS.border}`,
            color: COLORS.muted, borderRadius: "12px", padding: "12px",
            fontWeight: 600, fontSize: "14px", cursor: "pointer"
          }}>Пропустить — заполню позже</button>
        )}
      </div>
    </div>
  );
}



const TABS = [
  { id: "calendar", label: "Календарь", icon: "📅" },
  { id: "diary", label: "Дневник", icon: "📔" },
  { id: "top", label: "Топ-списки", icon: "⭐" },
  { id: "habits", label: "Привычки", icon: "🔥" },
  { id: "birthdays", label: "ДР", icon: "🎂" },
];

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(loadProfile);
  const [screen, setScreen] = useState("loading");
  const [tab, setTab] = useState("calendar");
  const [data, setDataRaw] = useState(loadData);

  // Listen to Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth, async (fbUser) => {
      if (fbUser) {
        setAuthUser(fbUser);
        // Load profile from Firestore
        try {
          const snap = await getDoc(doc(db, "users", fbUser.uid));
          if (snap.exists()) {
            const p = snap.data();
            setProfile(p);
            saveProfileLS(p);
            setScreen("app");
          } else {
            setScreen("profile-setup");
          }
        } catch {
          // Firestore offline — use localStorage profile
          const p = loadProfile();
          setProfile(p);
          setScreen(p ? "app" : "profile-setup");
        }
      } else {
        setAuthUser(null);
        setScreen("auth");
      }
    });
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setData(updater) {
    setDataRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveData(next);
      return next;
    });
  }

  function handleAuth() {
    // onAuthStateChanged will handle screen transition
  }

  async function handleProfileSave(profileData) {
    setProfile(profileData);
    saveProfileLS(profileData);
    if (authUser) {
      try {
        await setDoc(doc(db, "users", authUser.uid), {
          ...profileData, uid: authUser.uid, email: authUser.email, updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch { /* offline, saved locally */ }
    }
    setScreen("app");
  }

  async function handleLogout() {
    try { await signOut(fbAuth); } catch {}
    clearAuth();
    setAuthUser(null);
    setProfile(null);
    setScreen("auth");
  }

  useEffect(() => {
    if (data.birthdays?.length) checkTodayBirthdays(data.birthdays);
    if (data.birthdays?.length) data.birthdays.forEach(b => scheduleBirthdayNotifications(b));
    if (data.events?.length) data.events.forEach(ev => { if (ev.reminderOffset != null) scheduleEventNotification(ev); });
    if (data.habits?.length) scheduleHabitReminder(data.habits);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading splash
  if (screen === "loading") return (
    <div style={{
      height: "100dvh", background: COLORS.bg,
      display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "20px",
      fontFamily: "-apple-system, 'SF Pro Display', system-ui, sans-serif",
    }}>
      <div style={{ fontSize: "72px", lineHeight: 1 }}>🗂</div>
      <div style={{ color: COLORS.fill, fontSize: "15px", letterSpacing: "-0.2px" }}>Загрузка...</div>
    </div>
  );

  if (screen === "auth") return <AuthScreen onAuth={handleAuth} />;

  if (screen === "profile-setup") return (
    <ProfileScreen
      auth={authUser || { email: "" }}
      profile={profile}
      onSave={handleProfileSave}
      onSkip={() => setScreen("app")}
      onLogout={handleLogout}
      isSetup={true}
    />
  );

  if (screen === "profile") return (
    <ProfileScreen
      auth={authUser || { email: "" }}
      profile={profile}
      onSave={d => { handleProfileSave(d); setScreen("app"); }}
      onSkip={() => setScreen("app")}
      onLogout={handleLogout}
      isSetup={false}
    />
  );

  const avatarLetter = (profile?.firstName || authUser?.email || "?")[0].toUpperCase();

  // Safe area values for iPhone notch / Dynamic Island / home indicator
  const safeTop = "env(safe-area-inset-top)";

  return (
    <div style={{
      background: COLORS.bg,
      color: COLORS.text,
      fontFamily: "-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif",
      WebkitFontSmoothing: "antialiased",
      display: "flex",
      flexDirection: "column",
      height: "100dvh",
      width: "100%",
      maxWidth: "480px",
      margin: "0 auto",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Header — iOS large title style */}
      <div style={{
        flexShrink: 0,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderBottom: `0.5px solid ${COLORS.border}`,
        paddingTop: `calc(${safeTop} + 10px)`,
        paddingBottom: "10px",
        paddingLeft: "16px",
        paddingRight: "16px",
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "17px", color: COLORS.text, letterSpacing: "-0.4px" }}>
              Карманный ассистент
            </div>
            <div style={{ color: COLORS.fill, fontSize: "11px", marginTop: "1px", letterSpacing: "-0.1px" }}>
              {new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
          <button onClick={() => setScreen("profile")} style={{
            width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.purple})`,
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "14px", fontWeight: 700, color: "#fff",
          }}>{avatarLetter}</button>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        padding: "12px 16px 16px",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        minWidth: 0,
        background: COLORS.bg,
      }}>
        {tab === "calendar" && <CalendarSection data={data} setData={setData} />}
        {tab === "diary" && <DiarySection data={data} setData={setData} />}
        {tab === "top" && <TopListsSection data={data} setData={setData} />}
        {tab === "habits" && <HabitsSection data={data} setData={setData} />}
        {tab === "birthdays" && <BirthdaysSection data={data} setData={setData} />}
      </div>

      {/* Bottom Nav — iOS tab bar */}
      <div style={{
        flexShrink: 0,
        background: "rgba(28,28,30,0.92)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderTop: `0.5px solid ${COLORS.border}`,
        display: "flex",
        paddingBottom: "env(safe-area-inset-bottom)",
        zIndex: 100,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, background: "none", border: "none",
            padding: "8px 4px 4px", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
            fontFamily: "inherit", minWidth: 0,
            transition: "opacity 0.1s",
          }}>
            <div style={{
              fontSize: "22px", lineHeight: 1,
              filter: tab === t.id ? "none" : "grayscale(0.3)",
              opacity: tab === t.id ? 1 : 0.45,
              transition: "all 0.15s",
            }}>{t.icon}</div>
            <span style={{
              fontSize: "10px", fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? COLORS.accent : COLORS.fill,
              letterSpacing: "-0.1px",
              transition: "color 0.15s",
            }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
