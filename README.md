# 📱 Карманный ассистент — Capacitor (iOS + Android + Web)

Личный органайзер с авторизацией. Одна кодовая база → сайт, iPhone, Android.

---

## 🗂 Структура

```
pocket-assistant/
├── capacitor.config.json   ← конфиг Capacitor (appId, appName)
├── package.json
├── public/
│   ├── index.html          ← meta-теги для safe area, PWA
│   └── manifest.json       ← PWA-манифест
└── src/
    ├── index.js            ← точка входа React
    ├── PocketAssistant.jsx ← ВСЁ приложение (органайзер + авторизация)
    ├── firebase.js         ← конфиг Firebase (для облачной авторизации)
    ├── AuthContext.js      ← Firebase Auth provider
    └── components/
        └── AuthScreens.js  ← экраны входа и профиля (Firebase-версия)
```

---

## 🚀 Шаг 1 — Запуск в браузере (самый быстрый старт)

```bash
# 1. Установи Node.js 18+ с nodejs.org

# 2. Перейди в папку проекта
cd pocket-assistant

# 3. Установи зависимости
npm install

# 4. Запусти
npm start
# Откроется http://localhost:3000
```

> **Авторизация в браузере работает в demo-режиме**: вводишь email, код появляется в
> консоли браузера (F12 → Console). Для настоящей отправки писем → подключи Firebase (Шаг 2).

---

## 🔥 Шаг 2 — Подключение Firebase (реальные письма)

### 2.1 Создай проект Firebase

1. Зайди на [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → введи название → создай (бесплатный план Spark)
3. **Authentication** → Get started → вкладка **Sign-in method**:
   - Включи **Email/Password**
   - Включи **Email link (passwordless sign-in)**
4. **Firestore Database** → Create database → Production mode → выбери регион `europe-west3`
5. **Project Settings** (⚙️) → **Your apps** → **Add app** → Web (`</>`) → скопируй `firebaseConfig`

### 2.2 Вставь конфиг

Открой `src/firebase.js` и замени значения:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "my-app.firebaseapp.com",
  projectId:         "my-app",
  storageBucket:     "my-app.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...:web:abc..."
};
```

### 2.3 Правила Firestore

Firebase Console → Firestore → **Rules** → вставь:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 2.4 Переключись на Firebase-авторизацию

В `src/index.js` замени:
```js
// Было:
import App from './PocketAssistant';
ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// Стало:
import { AuthProvider } from './AuthContext';
import RootApp from './App';
ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider><RootApp /></AuthProvider>
);
```

И создай `src/App.js`:
```js
import { useState } from 'react';
import { useAuth } from './AuthContext';
import AuthScreens, { ProfileSetupScreen, ProfileModal } from './components/AuthScreens';
import PocketAssistant from './PocketAssistant';

export default function RootApp() {
  const { authState, profile } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  if (authState === 'loading') return <Splash />;
  if (authState === 'guest')   return <AuthScreens />;
  if (!profile?.profileCompleted) return <ProfileSetupScreen onDone={() => {}} />;

  return (
    <>
      <PocketAssistant onOpenProfile={() => setShowProfile(true)} userProfile={profile} />
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </>
  );
}

function Splash() {
  return (
    <div style={{ minHeight:'100dvh', background:'#0f0f13', display:'flex',
      alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div style={{ fontSize:52 }}>🗂</div>
      <div style={{ color:'#8888aa', fontSize:14 }}>Загружаем...</div>
    </div>
  );
}
```

---

## 📦 Шаг 3 — Сборка для телефона (Capacitor)

### Предварительные требования

| Платформа | Что нужно |
|-----------|-----------|
| **Android** | [Android Studio](https://developer.android.com/studio) |
| **iOS** | Mac + [Xcode](https://developer.apple.com/xcode/) 14+ |

### 3.1 Инициализация Capacitor (один раз)

```bash
# Собери веб-версию
npm run build

# Добавь платформы
npx cap add android
npx cap add ios

# Синхронизируй
npx cap sync
```

### 3.2 Android → APK / AAB

```bash
# Открой Android Studio
npm run cap:android
# или: npx cap open android
```

В Android Studio:
1. **Build** → **Generate Signed Bundle / APK**
2. Выбери **APK** (для тестирования) или **Android App Bundle** (для Play Store)
3. Создай keystore → собери → получи `.apk`

**Установка на телефон напрямую:**
```bash
# Включи "Разработчик" в настройках Android, затем:
adb install app-release.apk
```

### 3.3 iOS → IPA (нужен Mac)

```bash
npm run cap:ios
# или: npx cap open ios
```

В Xcode:
1. Выбери устройство (реальный iPhone или симулятор)
2. **Product** → **Archive** (для App Store) или просто **Run** для тестирования
3. Для распространения вне App Store: **Signing & Capabilities** → выбери команду

---

## 🌐 Шаг 4 — Деплой сайта (чтобы работало и в браузере)

### Firebase Hosting (бесплатно, рекомендую)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# webDir: build
# SPA: yes
npm run build
firebase deploy
# Получишь: https://my-app.web.app
```

### Vercel (альтернатива)
```bash
npm install -g vercel
vercel
```

### Netlify
Перетащи папку `build/` на [netlify.com/drop](https://app.netlify.com/drop)

---

## ⚙️ Настройка appId и имени приложения

Открой `capacitor.config.json`:
```json
{
  "appId": "com.yourname.pocketassistant",  ← замени на свой
  "appName": "Карманный ассистент",
  ...
}
```

`appId` должен быть уникальным (формат: `com.имя.приложение`).

---

## 🎨 Иконки приложения

Положи в папку `public/`:
- `icon-192.png` — 192×192 px
- `icon-512.png` — 512×512 px

Для Capacitor дополнительно нужны иконки в `android/` и `ios/`.
Используй [capacitor-assets](https://github.com/ionic-team/capacitor-assets):
```bash
npm install -g @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#0f0f13'
```

---

## 🔐 Как работает авторизация (demo-режим)

1. Пользователь вводит **email**
2. Система генерирует **6-значный код** (в demo — виден в консоли; с Firebase — приходит на почту)
3. Пользователь вводит код → входит
4. При первом входе — экран **заполнения профиля** (имя, фамилия, возраст, пол, страна, город)
5. Можно нажать **«Пропустить»** и заполнить позже через кнопку профиля справа вверху

---

## ❓ Частые вопросы

**Q: Письмо не приходит от Firebase**
A: Проверь папку «Спам». В Firebase Console → Authentication → Authorized domains добавь свой домен.

**Q: Ошибка "auth/unauthorized-continue-uri"**
A: Firebase Console → Authentication → Settings → Authorized domains → добавь `localhost` и свой домен.

**Q: Capacitor sync ругается**
A: Убедись, что сначала выполнил `npm run build`, потом `npx cap sync`.

**Q: Как запустить на реальном Android без Android Studio?**
```bash
npm run build && npx cap sync
cd android && ./gradlew assembleDebug
# APK будет в android/app/build/outputs/apk/debug/app-debug.apk
```
