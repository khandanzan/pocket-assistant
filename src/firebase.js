// src/firebase.js
// ─────────────────────────────────────────────────────────────────────
// ЗАПОЛНИ ЭТИ ЗНАЧЕНИЯ из Firebase Console → Project Settings → Your apps
// Инструкция в README.md → раздел "Настройка Firebase"
// ─────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app';
import { getAuth }       from 'firebase/auth';
import { getFirestore }  from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export default app;
