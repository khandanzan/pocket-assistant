import { initializeApp } from 'firebase/app';
import { getAuth }       from 'firebase/auth';
import { getFirestore }  from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            "AIzaSyAgZtD0zbPKrZ7n7t6XAB0n0zWBpYcVUDI",
  authDomain:        "pocket-assistant-9b55b.firebaseapp.com",
  projectId:         "pocket-assistant-9b55b",
  storageBucket:     "pocket-assistant-9b55b.firebasestorage.app",
  messagingSenderId: "358565674454",
  appId:             "1:358565674454:web:0cbc63157766c2e9fbb877"
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export default app;
