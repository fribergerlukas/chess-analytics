"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

const API_BASE = "http://localhost:3000";
const TOKEN_KEY = "chess-arena-token";

interface AuthContextType {
  authUser: string | null;
  authLoading: boolean;
  authError: string;
  clearAuthError: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, username: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setAuthLoading(false);
      return;
    }
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setAuthUser(data.username);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  async function login(email: string, password: string) {
    setAuthError("");
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(data.error || "Login failed");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    setAuthUser(data.username);
  }

  async function signup(email: string, password: string, username: string) {
    setAuthError("");
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(data.error || "Signup failed");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    setAuthUser(data.username);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setAuthUser(null);
  }

  function clearAuthError() {
    setAuthError("");
  }

  return (
    <AuthContext.Provider
      value={{ authUser, authLoading, authError, clearAuthError, login, signup, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
