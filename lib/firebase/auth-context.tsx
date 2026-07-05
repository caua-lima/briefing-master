"use client";

import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { createContext, useContext, useEffect, useState } from "react";
import { getFirebase, googleProvider, getGoogleProviderWithAccountSelection } from "./client";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithAccountSelection: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  async function signIn() {
    const { auth } = getFirebase();
    await signInWithPopup(auth, googleProvider);
  }

  async function signInWithAccountSelection() {
    const { auth } = getFirebase();
    const provider = getGoogleProviderWithAccountSelection();
    await signInWithPopup(auth, provider);
  }

  async function signInWithEmail(email: string, password: string) {
    const { auth } = getFirebase();
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }

  async function signOut() {
    const { auth } = getFirebase();
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithAccountSelection, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
