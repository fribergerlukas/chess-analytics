"use client";

import { FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserContext } from "./UserContext";

const TIME_CATEGORIES = [
  { label: "Bullet", value: "bullet" },
  { label: "Blitz", value: "blitz" },
  { label: "Rapid", value: "rapid" },
];

const NAV_ITEMS = [
  {
    label: "Player Card",
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
    label: "Personalized Puzzles",
    href: "/puzzles",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.407 2.407 0 0 1-1.706.707 2.407 2.407 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.407 2.407 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.611-1.611a2.407 2.407 0 0 1 1.704-.706c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const {
    username,
    setUsername,
    queriedUser,
    timeCategory,
    setTimeCategory,
    ratedFilter,
    setRatedFilter,
    triggerSearch,
  } = useUserContext();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    triggerSearch();
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
          className="font-extrabold"
          style={{ color: "#fff", textDecoration: "none", fontSize: 18, letterSpacing: "-0.01em" }}
        >
          Chess Analytics
        </Link>
      </div>

      {/* Navigation */}
      <nav style={{ padding: "0 8px 12px" }}>
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

      {/* Divider */}
      <div style={{ borderTop: "1px solid #3d3a37", margin: "4px 16px 4px" }} />

      {/* Search section */}
      <form onSubmit={handleSubmit} style={{ padding: "14px 14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          placeholder="chess.com username..."
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 8,
            border: "none",
            backgroundColor: "#1c1b19",
            color: "#fff",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={timeCategory}
            onChange={(e) => setTimeCategory(e.target.value)}
            style={{
              flex: 1,
              padding: "9px 8px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              backgroundColor: "#1c1b19",
              color: "#fff",
              outline: "none",
            }}
          >
            {TIME_CATEGORIES.map((tc) => (
              <option key={tc.value} value={tc.value}>
                {tc.label}
              </option>
            ))}
          </select>
          <select
            value={ratedFilter}
            onChange={(e) => setRatedFilter(e.target.value)}
            style={{
              flex: 1,
              padding: "9px 8px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              backgroundColor: "#1c1b19",
              color: "#fff",
              outline: "none",
            }}
          >
            <option value="all">All</option>
            <option value="true">Rated</option>
            <option value="false">Casual</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={!username.trim()}
          style={{
            width: "100%",
            padding: "10px",
            fontSize: 14,
            fontWeight: 800,
            borderRadius: 8,
            border: "none",
            backgroundColor: "#81b64c",
            color: "#fff",
            cursor: username.trim() ? "pointer" : "not-allowed",
            opacity: username.trim() ? 1 : 0.5,
            letterSpacing: "0.01em",
          }}
        >
          Search
        </button>
      </form>

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

      {/* Spacer */}
      <div style={{ flex: 1 }} />
    </aside>
  );
}
