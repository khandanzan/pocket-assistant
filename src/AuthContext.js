// src/AuthContext.js
import { createContext, useContext, useState, useEffect } from 'react';
import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const AuthContext = createContext(null);

// ── Helpers ───────────────────────────────────────────────────────────────────
function getActionCodeSettings() {
  // When running in Capacitor (native), use a universal link / deep link.
  // For web, use the current origin.
  const isNative = window.Capacitor?.isNativePlatform?.();
  const url = isNative
    ? 'https://YOUR_PROJECT.firebaseapp.com/__/auth/action' // ← замени на свой домен
    : `${window.location.origin}`;
  return { url, handleCodeInApp: true };
}

const STORAGE_KEY = 'emailForSignIn';

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(null);
  const [profile,   setProfile]   = useState(null);   // Firestore doc
  const [authState, setAuthState] = useState('loading'); // loading | guest | logged-in

  useEffect(() => {
    // Handle magic-link sign-in on app open
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const email = localStorage.getItem(STORAGE_KEY);
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(() => {
            localStorage.removeItem(STORAGE_KEY);
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
          })
          .catch(console.error);
      }
    }

    // Listen to auth state
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        const snap = await getDoc(doc(db, 'users', fbUser.uid));
        const data = snap.exists() ? snap.data() : {};
        setProfile({ ...data, email: fbUser.email });
        setAuthState('logged-in');
      } else {
        setUser(null);
        setProfile(null);
        setAuthState('guest');
      }
    });

    return unsub;
  }, []);

  // Send passwordless sign-in link
  async function sendLoginLink(email) {
    await sendSignInLinkToEmail(auth, email, getActionCodeSettings());
    localStorage.setItem(STORAGE_KEY, email);
  }

  // Save / update profile in Firestore
  async function saveProfile(data) {
    if (!user) return;
    const updated = {
      ...profile,
      ...data,
      uid: user.uid,
      email: user.email,
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', user.uid), updated, { merge: true });
    setProfile(updated);
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, profile, authState, sendLoginLink, saveProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
