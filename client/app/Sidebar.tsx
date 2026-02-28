"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserContext } from "./UserContext";
import { useAuth } from "./AuthContext";

const NAV_ITEMS = [
  {
    label: "Arena Player Card",
    href: "/",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <circle cx="8" cy="11" r="2.5" />
        <path d="M4 18c0-2 2-3.5 4-3.5s4 1.5 4 3.5" />
        <line x1="15" y1="9" x2="20" y2="9" />
        <line x1="15" y1="13" x2="18" y2="13" />
      </svg>
    ),
  },
  {
    label: "Training Ground",
    href: "/puzzles",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.407 2.407 0 0 1-1.706.707 2.407 2.407 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.407 2.407 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.611-1.611a2.407 2.407 0 0 1 1.704-.706c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
      </svg>
    ),
  },
  {
    label: "Arena Game",
    href: "/beat-your-friends",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2l6 6-2 2-6-6zM18 2l-6 6 2 2 6-6z" />
        <path d="M12 8v4" />
        <path d="M8 14l4-2 4 2" />
        <path d="M6 18h12" />
        <path d="M8 22h8" />
        <path d="M10 18v4" />
        <path d="M14 18v4" />
      </svg>
    ),
  },
  {
    label: "Chess Coach",
    href: "/coach",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: "Puzzle Test",
    href: "/puzzle-test",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6v3H9z" />
        <path d="M7 6h10v2H7z" />
        <path d="M5 8h14l-1 13H6L5 8z" />
        <circle cx="12" cy="15" r="2" />
      </svg>
    ),
  },
  {
    label: "Motif Test",
    href: "/motif-test",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { queriedUser } = useUserContext();
  const { authUser, authLoading, authError, clearAuthError, login, signup, logout } = useAuth();

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthSubmitting(true);
    try {
      if (authMode === "login") {
        await login(authEmail, authPassword);
      } else {
        await signup(authEmail, authPassword, signupUsername);
      }
    } finally {
      setAuthSubmitting(false);
    }
  }

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: 230,
        backgroundColor: "#262421",
        borderRight: "1px solid #3d3a37",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        overflowY: "auto",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "20px 20px 16px" }}>
        <Link
          href="/"
          className="font-extrabold flex items-center gap-3"
          style={{ color: "#fff", textDecoration: "none", fontSize: 18, letterSpacing: "-0.01em" }}
        >
          <svg width="28" height="28" viewBox="0 0 45 45" fill="none">
            {/* Classic chess king — cburnett style */}
            {/* Cross */}
            <rect x="20.5" y="2" width="4" height="8" rx="1" fill="#81b64c" />
            <rect x="17" y="4" width="11" height="4" rx="1" fill="#81b64c" />
            {/* Crown points */}
            <path d="M10 16 C10 16 12 13 14 14 C16 15 16 12 16 12 L17 10 C17 10 19 12.5 22.5 12.5 C26 12.5 28 10 28 10 L29 12 C29 12 29 15 31 14 C33 13 35 16 35 16 L35 20 C35 20 30 18 22.5 18 C15 18 10 20 10 20 Z" fill="#81b64c" />
            {/* Body */}
            <path d="M10 20 C10 20 8 28 8 32 C8 34 10 36 10 36 L35 36 C35 36 37 34 37 32 C37 28 35 20 35 20 C35 20 30 22 22.5 22 C15 22 10 20 10 20 Z" fill="#81b64c" />
            {/* Base */}
            <rect x="7" y="36" width="31" height="4" rx="1.5" fill="#81b64c" />
            <rect x="9" y="40" width="27" height="3" rx="1" fill="#81b64c" />
          </svg>
          Chess Arena
        </Link>
      </div>

      {/* Auth form — at the top when logged out */}
      {!authUser && !authLoading && (
        <div style={{ padding: "0 14px 14px" }}>
          <form onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => { setAuthEmail(e.target.value); clearAuthError(); }}
              style={{
                width: "100%",
                padding: "9px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: "none",
                backgroundColor: "#1c1b19",
                color: "#fff",
                outline: "none",
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => { setAuthPassword(e.target.value); clearAuthError(); }}
              style={{
                width: "100%",
                padding: "9px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: "none",
                backgroundColor: "#1c1b19",
                color: "#fff",
                outline: "none",
              }}
            />
            {authMode === "signup" && (
              <input
                type="text"
                placeholder="chess.com username"
                value={signupUsername}
                onChange={(e) => { setSignupUsername(e.target.value); clearAuthError(); }}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: "#1c1b19",
                  color: "#fff",
                  outline: "none",
                }}
              />
            )}
            {authError && (
              <p style={{ fontSize: 11, fontWeight: 700, color: "#e05252", margin: 0 }}>{authError}</p>
            )}
            <button
              type="submit"
              disabled={authSubmitting}
              style={{
                width: "100%",
                padding: "9px",
                fontSize: 13,
                fontWeight: 800,
                borderRadius: 6,
                border: "none",
                backgroundColor: "#81b64c",
                color: "#fff",
                cursor: authSubmitting ? "not-allowed" : "pointer",
                opacity: authSubmitting ? 0.6 : 1,
              }}
            >
              {authSubmitting ? "..." : authMode === "login" ? "Log In" : "Sign Up"}
            </button>
            <p
              onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); clearAuthError(); }}
              style={{ fontSize: 11, fontWeight: 600, color: "#9b9895", textAlign: "center", cursor: "pointer", margin: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#9b9895"; }}
            >
              {authMode === "login" ? "Create an account" : "Already have an account? Log in"}
            </p>
          </form>
        </div>
      )}

      {/* Loading spinner while checking auth */}
      {authLoading && (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 mx-auto"
            style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
          />
        </div>
      )}

      {/* Nav + active player — only when logged in */}
      {authUser && (
        <>
          {/* Navigation */}
          <nav style={{ padding: "8px 8px 0" }}>
            {NAV_ITEMS.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 transition-all"
                  style={{
                    padding: "12px 14px",
                    fontSize: 14,
                    fontWeight: 700,
                    color: active ? "#fff" : "#9b9895",
                    textDecoration: "none",
                    borderRadius: 8,
                    backgroundColor: active ? "#3a3733" : "transparent",
                    marginBottom: 2,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = "#3a3733";
                      e.currentTarget.style.color = "#fff";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "#9b9895";
                    }
                  }}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Active user display */}
          {queriedUser && (
            <>
              <div style={{ borderTop: "1px solid #3d3a37", margin: "0 16px" }} />
              <div style={{ padding: "14px 20px" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Active Player
                </p>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>
                  {queriedUser}
                </p>
              </div>
            </>
          )}
        </>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Logged-in user info — at the bottom */}
      {authUser && (
        <div style={{ borderTop: "1px solid #3d3a37", padding: "14px 14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>
                Logged in as
              </p>
              <p style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{authUser}</p>
            </div>
            <button
              onClick={logout}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 6,
                border: "none",
                backgroundColor: "#3d3a37",
                color: "#9b9895",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#4a4745"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#3d3a37"; e.currentTarget.style.color = "#9b9895"; }}
            >
              Log Out
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
