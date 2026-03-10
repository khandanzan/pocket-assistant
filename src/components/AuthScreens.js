// src/components/AuthScreens.js
import { useState } from 'react';
import { useAuth } from '../AuthContext';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#0f0f13', surface: '#17171f', card: '#1e1e28', border: '#2a2a38',
  accent: '#7c6af7', green: '#4ade80', red: '#f87171', orange: '#fb923c',
  blue: '#60a5fa', pink: '#f472b6',
  text: '#f0f0f8', muted: '#8888aa', dimmed: '#44445a',
};

// ── Shared micro-styles ───────────────────────────────────────────────────────
const sc = {
  wrap: {
    minHeight: '100dvh', background: C.bg, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', padding: '24px 20px',
  },
  card: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: '24px',
    padding: '32px 24px', width: '100%', maxWidth: '400px',
  },
  title: { color: C.text, fontWeight: 800, fontSize: '22px', marginBottom: '6px', textAlign: 'center' },
  sub:   { color: C.muted, fontSize: '13px', textAlign: 'center', marginBottom: '28px', lineHeight: 1.6 },
  label: { color: C.muted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' },
  input: {
    width: '100%', background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: '12px', padding: '13px 14px', color: C.text, fontSize: '16px',
    outline: 'none', marginBottom: '16px', fontFamily: 'inherit',
  },
  btn: {
    width: '100%', background: C.accent, border: 'none', color: '#fff',
    borderRadius: '12px', padding: '14px', cursor: 'pointer', fontWeight: 700,
    fontSize: '15px', marginBottom: '10px', fontFamily: 'inherit',
  },
  btnOutline: {
    width: '100%', background: 'transparent', border: `1px solid ${C.border}`,
    color: C.muted, borderRadius: '12px', padding: '12px', cursor: 'pointer',
    fontWeight: 600, fontSize: '14px', fontFamily: 'inherit',
  },
  err:     { color: C.red,   fontSize: '13px', textAlign: 'center', marginBottom: '12px' },
  success: { color: C.green, fontSize: '13px', textAlign: 'center', marginBottom: '12px' },
};

// ── Step 1: Enter email ───────────────────────────────────────────────────────
function EmailStep({ onSent }) {
  const { sendLoginLink } = useAuth();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@')) { setError('Введи корректный email'); return; }
    setLoading(true); setError('');
    try {
      await sendLoginLink(e);
      onSent(e);
    } catch (err) {
      console.error(err);
      setError('Не удалось отправить письмо. Проверь email и попробуй снова.');
    }
    setLoading(false);
  }

  return (
    <div style={sc.wrap}>
      <div style={{ fontSize: '56px', marginBottom: '20px' }}>📱</div>
      <div style={sc.card}>
        <div style={sc.title}>Карманный ассистент</div>
        <div style={sc.sub}>Введи свой email — мы пришлём ссылку для входа. Пароль не нужен.</div>
        {error && <div style={sc.err}>{error}</div>}
        <label style={sc.label}>Email</label>
        <input
          style={sc.input} type="email" placeholder="example@mail.com" autoFocus
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <button style={{ ...sc.btn, opacity: loading ? 0.65 : 1 }} onClick={submit} disabled={loading}>
          {loading ? '⏳ Отправляем...' : '📨 Получить ссылку для входа'}
        </button>
        <div style={{ color: C.dimmed, fontSize: '11px', textAlign: 'center', lineHeight: 1.5 }}>
          Нажимая кнопку, ты соглашаешься с условиями использования
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Check email ───────────────────────────────────────────────────────
function CheckEmailStep({ email, onBack }) {
  const { sendLoginLink } = useAuth();
  const [resent,  setResent]  = useState(false);
  const [loading, setLoading] = useState(false);

  async function resend() {
    setLoading(true);
    await sendLoginLink(email);
    setResent(true); setLoading(false);
    setTimeout(() => setResent(false), 4000);
  }

  return (
    <div style={sc.wrap}>
      <div style={{ fontSize: '56px', marginBottom: '20px' }}>📬</div>
      <div style={sc.card}>
        <div style={sc.title}>Проверь почту</div>
        <div style={sc.sub}>
          Письмо со ссылкой отправлено на{' '}
          <span style={{ color: C.accent, fontWeight: 700 }}>{email}</span>
          <br /><br />
          Открой его и нажми на ссылку — тебя автоматически перенесёт в приложение.
        </div>
        {resent && <div style={sc.success}>✓ Письмо отправлено повторно!</div>}
        <button style={{ ...sc.btn, opacity: loading ? 0.65 : 1 }} onClick={resend} disabled={loading}>
          {loading ? '⏳ Отправляем...' : '🔄 Отправить письмо снова'}
        </button>
        <button style={sc.btnOutline} onClick={onBack}>← Указать другой email</button>
        <div style={{ color: C.dimmed, fontSize: '11px', textAlign: 'center', marginTop: '16px', lineHeight: 1.5 }}>
          Не видишь? Проверь папку «Спам» или подожди пару минут.
        </div>
      </div>
    </div>
  );
}

// ── Profile Setup (first login) ───────────────────────────────────────────────
export function ProfileSetupScreen({ onDone }) {
  const { saveProfile } = useAuth();
  const [form,    setForm]    = useState({ firstName: '', lastName: '', age: '', gender: '', country: '', city: '' });
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setLoading(true);
    await saveProfile({ ...form, profileCompleted: true });
    setLoading(false);
    onDone();
  }
  async function skip() {
    await saveProfile({ profileCompleted: false });
    onDone();
  }

  return (
    <div style={{ ...sc.wrap, justifyContent: 'flex-start', paddingTop: '48px', overflowY: 'auto' }}>
      <div style={{ fontSize: '44px', marginBottom: '12px' }}>👤</div>
      <div style={{ ...sc.card, maxWidth: '440px' }}>
        <div style={sc.title}>Расскажи о себе</div>
        <div style={sc.sub}>Персонализирует опыт. Можно заполнить позже через профиль.</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <LabelInput label="Имя"      placeholder="Иван"   value={form.firstName} onChange={v => set('firstName', v)} />
          <LabelInput label="Фамилия"  placeholder="Иванов" value={form.lastName}  onChange={v => set('lastName', v)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <LabelInput label="Возраст" placeholder="25" type="number" value={form.age} onChange={v => set('age', v)} />
          <div>
            <label style={sc.label}>Пол</label>
            <GenderPicker value={form.gender} onChange={v => set('gender', v)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <LabelInput label="Страна" placeholder="Россия" value={form.country} onChange={v => set('country', v)} />
          <LabelInput label="Город"  placeholder="Москва" value={form.city}    onChange={v => set('city', v)} />
        </div>

        <button style={{ ...sc.btn, opacity: loading ? 0.65 : 1 }} onClick={save} disabled={loading}>
          {loading ? 'Сохраняем...' : '✓ Сохранить и начать'}
        </button>
        <button style={sc.btnOutline} onClick={skip}>Пропустить →</button>
      </div>
    </div>
  );
}

// ── Profile Modal (opened from top-right button) ───────────────────────────────
export function ProfileModal({ onClose }) {
  const { user, profile, saveProfile, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState({
    firstName: profile?.firstName || '', lastName: profile?.lastName || '',
    age: profile?.age || '', gender: profile?.gender || '',
    country: profile?.country || '', city: profile?.city || '',
  });
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setLoading(true);
    await saveProfile({ ...form, profileCompleted: true });
    setLoading(false);
    setEditing(false);
  }

  const genderLabel = { male: '♂ Мужской', female: '♀ Женский', other: 'Другой' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000000bb', zIndex: 3000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '16px', paddingTop: '56px', overflowY: 'auto',
    }}>
      <div style={{ ...sc.card, maxWidth: '440px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ color: C.text, fontWeight: 800, fontSize: '17px' }}>👤 Профиль</div>
          <button onClick={onClose} style={{ background: C.surface, border: 'none', color: C.muted, borderRadius: '8px', padding: '6px 12px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Email badge */}
        <div style={{ background: C.surface, borderRadius: '12px', padding: '12px 16px', marginBottom: '20px' }}>
          <div style={{ color: C.dimmed, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Аккаунт</div>
          <div style={{ color: C.accent, fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>{user?.email}</div>
        </div>

        {editing ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <LabelInput label="Имя"     placeholder="Иван"   value={form.firstName} onChange={v => set('firstName', v)} />
              <LabelInput label="Фамилия" placeholder="Иванов" value={form.lastName}  onChange={v => set('lastName', v)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <LabelInput label="Возраст" placeholder="25" type="number" value={form.age} onChange={v => set('age', v)} />
              <div>
                <label style={sc.label}>Пол</label>
                <GenderPicker value={form.gender} onChange={v => set('gender', v)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <LabelInput label="Страна" placeholder="Россия" value={form.country} onChange={v => set('country', v)} />
              <LabelInput label="Город"  placeholder="Москва" value={form.city}    onChange={v => set('city', v)} />
            </div>
            <button style={{ ...sc.btn, opacity: loading ? 0.65 : 1 }} onClick={save} disabled={loading}>
              {loading ? 'Сохраняем...' : '✓ Сохранить'}
            </button>
            <button style={sc.btnOutline} onClick={() => setEditing(false)}>Отмена</button>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              {[
                ['Имя',           [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || '—'],
                ['Возраст',       profile?.age   || '—'],
                ['Пол',           genderLabel[profile?.gender] || '—'],
                ['Местоположение',[profile?.city, profile?.country].filter(Boolean).join(', ') || '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: C.surface, borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ color: C.dimmed, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{l}</div>
                  <div style={{ color: C.text, fontSize: '13px', fontWeight: 600, marginTop: '4px' }}>{v}</div>
                </div>
              ))}
            </div>
            <button style={sc.btn} onClick={() => setEditing(true)}>✏️ Редактировать профиль</button>
            <button
              onClick={logout}
              style={{ ...sc.btnOutline, color: C.red, borderColor: C.red + '55', marginTop: '4px' }}
            >Выйти из аккаунта</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────
function LabelInput({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label style={sc.label}>{label}</label>
      <input
        style={{ ...sc.input, marginBottom: 0 }}
        type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function GenderPicker({ value, onChange }) {
  const opts = [{ v: 'male', l: '♂' }, { v: 'female', l: '♀' }, { v: 'other', l: '—' }];
  return (
    <div style={{ display: 'flex', gap: '5px' }}>
      {opts.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          flex: 1, background: value === o.v ? `${C.accent}33` : C.surface,
          border: `1px solid ${value === o.v ? C.accent : C.border}`,
          color: value === o.v ? C.accent : C.muted,
          borderRadius: '8px', padding: '8px 2px', cursor: 'pointer',
          fontWeight: 700, fontSize: '14px', fontFamily: 'inherit',
        }}>{o.l}</button>
      ))}
    </div>
  );
}

// ── Main export: auth flow ────────────────────────────────────────────────────
export default function AuthScreens() {
  const [step,  setStep]  = useState('email');
  const [email, setEmail] = useState('');

  return step === 'email'
    ? <EmailStep onSent={e => { setEmail(e); setStep('check'); }} />
    : <CheckEmailStep email={email} onBack={() => setStep('email')} />;
}
