import { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(null);
  const [profile,   setProfile]   = useState(null);
  const [authState, setAuthState] = useState('loading');

  useEffect(() => {
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

  async function register(email, password) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    return cred.user;
  }

  async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  }

  async function resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  }

  async function saveProfile(data) {
    if (!user) return;
    const updated = {
      ...profile, ...data,
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
    <AuthContext.Provider value={{ user, profile, authState, register, login, resetPassword, saveProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
