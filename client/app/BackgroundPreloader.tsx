"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";

const API_BASE = "http://localhost:3000";

export default function BackgroundPreloader() {
  const { authUser, authLoading } = useAuth();
  const firedRef = useRef(false);

  useEffect(() => {
    if (authLoading || !authUser || firedRef.current) return;
    firedRef.current = true;

    // Fire-and-forget: import games then generate puzzles
    (async () => {
      try {
        await fetch(`${API_BASE}/import/chesscom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: authUser, rated: true, maxGames: 200 }),
        });
        await fetch(
          `${API_BASE}/users/${encodeURIComponent(authUser)}/puzzles/generate`,
          { method: "POST" }
        );
      } catch {
        // Background preloading is non-critical
      }
    })();
  }, [authUser, authLoading]);

  return null;
}
