"use client";

import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

interface CategoryStat {
  stat: number;
  percentage: number;
  successRate: number;
}

export interface ArenaStatsData {
  arenaRating: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
  shiny: boolean;
  categories: {
    attacking: CategoryStat;
    defending: CategoryStat;
    tactics: CategoryStat;
    positional: CategoryStat;
    opening: CategoryStat;
    calculation: CategoryStat;
  };
  form: number;
  backStats: {
    accuracyOverall: number | null;
    accuracyWhite: number | null;
    accuracyBlack: number | null;
    blunderRate: number;
    missedWinRate: number;
    missedSaveRate: number;
  };
  gamesAnalyzed: number;
}

interface PlayerCardProps {
  username: string;
  timeControl: "bullet" | "blitz" | "rapid";
  chessRating: number;
  peakRating?: number;
  title?: string;
  countryCode?: string;
  arenaStats: ArenaStatsData;
}

// ── Constants ──────────────────────────────────────────────────────────

type Tier = "bronze" | "silver" | "gold" | "platinum";

type TierStyle = { background: string; accent: string; accentDark: string; boxShadow?: string };

const TIER_STYLES_SHINY: Record<Tier, TierStyle> = {
  bronze: {
    background: "linear-gradient(160deg, #8B5E3C 0%, #CD853F 100%)",
    accent: "#FFE0B2",
    accentDark: "rgba(139,94,60,0.6)",
  },
  silver: {
    background: "linear-gradient(160deg, #708090 0%, #C0C0C0 100%)",
    accent: "#E8E8E8",
    accentDark: "rgba(112,128,144,0.6)",
  },
  gold: {
    background: "linear-gradient(160deg, #B8860B 0%, #FFD700 100%)",
    accent: "#FFF8DC",
    accentDark: "rgba(184,134,11,0.6)",
  },
  platinum: {
    background: "linear-gradient(160deg, #1a1a2e 0%, #4a0080 100%)",
    accent: "#FFD700",
    accentDark: "rgba(74,0,128,0.6)",
    boxShadow: "0 0 24px rgba(255,215,0,0.3)",
  },
};

const TIER_STYLES_MATTE: Record<Tier, TierStyle> = {
  bronze: {
    background: "linear-gradient(160deg, #5C3D2E 0%, #7A5A3E 100%)",
    accent: "#C4A882",
    accentDark: "rgba(92,61,46,0.6)",
  },
  silver: {
    background: "linear-gradient(160deg, #4E5660 0%, #7A828C 100%)",
    accent: "#B0B8C0",
    accentDark: "rgba(78,86,96,0.6)",
  },
  gold: {
    background: "linear-gradient(160deg, #7A5C10 0%, #A68B2E 100%)",
    accent: "#D4C48A",
    accentDark: "rgba(122,92,16,0.6)",
  },
  platinum: {
    background: "linear-gradient(160deg, #141420 0%, #302050 100%)",
    accent: "#B8A060",
    accentDark: "rgba(48,32,80,0.6)",
  },
};

const TC_ICONS: Record<string, string> = {
  bullet: "\u26A1",
  blitz: "\uD83D\uDD25",
  rapid: "\u23F1",
};

const STAT_LABELS: { key: keyof ArenaStatsData["categories"]; label: string }[] = [
  { key: "attacking", label: "ATK" },
  { key: "defending", label: "DEF" },
  { key: "tactics", label: "TAC" },
  { key: "positional", label: "POS" },
  { key: "opening", label: "OPN" },
  { key: "calculation", label: "CAL" },
];

// ── Component ──────────────────────────────────────────────────────────

export default function PlayerCard({
  username,
  timeControl,
  chessRating,
  peakRating,
  title,
  countryCode,
  arenaStats,
}: PlayerCardProps) {
  const [flipped, setFlipped] = useState(false);
  const { tier, shiny, arenaRating, categories, form, backStats, gamesAnalyzed } = arenaStats;
  const style = shiny ? TIER_STYLES_SHINY[tier] : TIER_STYLES_MATTE[tier];

  const flagUrl = countryCode
    ? `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`
    : null;

  const leftStats = STAT_LABELS.slice(0, 3);
  const rightStats = STAT_LABELS.slice(3);

  // Apply form modifier to displayed stats
  const displayStat = (key: keyof typeof categories) => {
    return categories[key].stat + form;
  };

  const formLabel = form > 0 ? `+${form}` : form < 0 ? `${form}` : "0";
  const formColor = form > 0 ? "#81b64c" : form < 0 ? "#e05252" : "#9b9895";
  const formArrow = form > 0 ? "\u25B2" : form < 0 ? "\u25BC" : "\u25CF";

  // Shiny border glow color per tier
  const shinyGlow = shiny
    ? tier === "platinum"
      ? "0 0 20px rgba(255,215,0,0.5), inset 0 0 20px rgba(255,215,0,0.1)"
      : tier === "gold"
        ? "0 0 16px rgba(255,215,0,0.4), inset 0 0 16px rgba(255,215,0,0.08)"
        : tier === "silver"
          ? "0 0 16px rgba(200,220,255,0.4), inset 0 0 16px rgba(200,220,255,0.08)"
          : "0 0 14px rgba(255,180,100,0.35), inset 0 0 14px rgba(255,180,100,0.07)"
    : undefined;

  return (
    <div
      onClick={() => setFlipped(!flipped)}
      style={{
        width: 240,
        height: 360,
        perspective: 800,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transformStyle: "preserve-3d",
          transition: "transform 0.5s ease",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Shimmer keyframes for platinum shiny cards only */}
        {shiny && tier === "platinum" && (
          <style>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%) rotate(25deg); }
              100% { transform: translateX(200%) rotate(25deg); }
            }
          `}</style>
        )}

        {/* ── FRONT ── */}
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            backfaceVisibility: "hidden",
            background: style.background,
            borderRadius: 16,
            border: shiny ? `2px solid ${style.accent}60` : undefined,
            boxShadow: shinyGlow || style.boxShadow || "0 4px 20px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {/* Shimmer overlay — platinum only */}
          {shiny && tier === "platinum" && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 16,
                overflow: "hidden",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "-50%",
                  left: "-50%",
                  width: "60%",
                  height: "200%",
                  background: `linear-gradient(90deg, transparent 0%, ${style.accent}18 40%, ${style.accent}30 50%, ${style.accent}18 60%, transparent 100%)`,
                  animation: "shimmer 3s ease-in-out infinite",
                }}
              />
            </div>
          )}

          {/* Top section */}
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Left strip — arena rating, chess rating, peak, time control, flag, title */}
            <div
              style={{
                width: 76,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                paddingTop: 12,
                gap: 1,
                flexShrink: 0,
              }}
            >
              {/* Arena Rating — huge */}
              <span
                style={{
                  fontSize: 52,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: style.accent,
                }}
              >
                {arenaRating}
              </span>

              {/* Chess rating — small */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: style.accent,
                  opacity: 0.7,
                  marginTop: 2,
                }}
              >
                {chessRating}
              </span>

              {/* Peak rating */}
              {peakRating != null && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: style.accent,
                    opacity: 0.5,
                  }}
                >
                  PK {peakRating}
                </span>
              )}

              {/* Time control */}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  color: style.accent,
                  letterSpacing: 1,
                  opacity: 0.85,
                  marginTop: 4,
                }}
              >
                {TC_ICONS[timeControl]} {timeControl}
              </span>

              <div
                style={{
                  width: 24,
                  height: 1,
                  backgroundColor: style.accent,
                  opacity: 0.4,
                  margin: "4px 0",
                }}
              />

              {flagUrl && (
                <img
                  src={flagUrl}
                  alt={countryCode}
                  style={{ width: 22, height: 15, borderRadius: 2 }}
                />
              )}
              {title && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: tier === "platinum" ? "#FFD700" : style.accent,
                    marginTop: 2,
                  }}
                >
                  {title}
                </span>
              )}
            </div>

            {/* Chess piece watermark */}
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  fontSize: 90,
                  lineHeight: 1,
                  color: style.accent,
                  opacity: 0.35,
                }}
              >
                ♚
              </span>
            </div>
          </div>

          {/* Bottom section: name + 6 stats */}
          <div
            style={{
              backgroundColor: "rgba(0,0,0,0.25)",
              padding: "8px 14px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {/* Name bar */}
            <div
              style={{
                textAlign: "center",
                borderBottom: `1px solid ${style.accent}40`,
                paddingBottom: 6,
              }}
            >
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#fff",
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  textShadow: "0 1px 4px rgba(0,0,0,0.5)",
                  margin: 0,
                }}
              >
                {username}
              </p>
            </div>

            {/* 6 stats in 2 columns of 3 */}
            <div style={{ display: "flex", gap: 8 }}>
              {/* Left column */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  borderRight: `1px solid ${style.accent}30`,
                  paddingRight: 8,
                }}
              >
                {leftStats.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#fff",
                      }}
                    >
                      {displayStat(s.key)}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: style.accent,
                        opacity: 0.85,
                        letterSpacing: 0.5,
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Right column */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  paddingLeft: 8,
                }}
              >
                {rightStats.map((s) => (
                  <div
                    key={s.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#fff",
                      }}
                    >
                      {displayStat(s.key)}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: style.accent,
                        opacity: 0.85,
                        letterSpacing: 0.5,
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── BACK ── */}
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: style.background,
            borderRadius: 16,
            border: shiny ? `2px solid ${style.accent}60` : undefined,
            boxShadow: shinyGlow || style.boxShadow || "0 4px 20px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {/* Shimmer overlay (back) — platinum only */}
          {shiny && tier === "platinum" && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 16,
                overflow: "hidden",
                pointerEvents: "none",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "-50%",
                  left: "-50%",
                  width: "60%",
                  height: "200%",
                  background: `linear-gradient(90deg, transparent 0%, ${style.accent}18 40%, ${style.accent}30 50%, ${style.accent}18 60%, transparent 100%)`,
                  animation: "shimmer 3s ease-in-out infinite",
                }}
              />
            </div>
          )}

          {/* Header */}
          <div
            style={{
              padding: "16px 20px 12px",
              borderBottom: `1px solid ${style.accent}30`,
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "#fff",
                textTransform: "uppercase",
                letterSpacing: 1.5,
                margin: 0,
              }}
            >
              {username}
            </p>
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: style.accent,
                opacity: 0.7,
                margin: "4px 0 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {TC_ICONS[timeControl]} {timeControl} &middot; {gamesAnalyzed} games
            </p>
          </div>

          {/* Stats list */}
          <div
            style={{
              flex: 1,
              padding: "12px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <BackStatRow
              label="Accuracy"
              value={backStats.accuracyOverall != null ? `${backStats.accuracyOverall}%` : "N/A"}
              accent={style.accent}
            />
            <BackStatRow
              label="White Acc"
              value={backStats.accuracyWhite != null ? `${backStats.accuracyWhite}%` : "N/A"}
              accent={style.accent}
            />
            <BackStatRow
              label="Black Acc"
              value={backStats.accuracyBlack != null ? `${backStats.accuracyBlack}%` : "N/A"}
              accent={style.accent}
            />

            <div
              style={{
                width: "100%",
                height: 1,
                backgroundColor: style.accent,
                opacity: 0.2,
              }}
            />

            <BackStatRow
              label="Blunder %"
              value={`${backStats.blunderRate}%`}
              accent={style.accent}
            />
            <BackStatRow
              label="Missed Wins"
              value={`${backStats.missedWinRate}%`}
              accent={style.accent}
            />
            <BackStatRow
              label="Missed Saves"
              value={`${backStats.missedSaveRate}%`}
              accent={style.accent}
            />
          </div>

          {/* Form indicator */}
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${style.accent}30`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: style.accent, opacity: 0.7 }}>
                FORM
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: formColor }}>
                {formArrow} {formLabel}
              </span>
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: style.accent,
                opacity: 0.4,
              }}
            >
              tap to flip
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function BackStatRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: accent,
          opacity: 0.85,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 800,
          color: "#fff",
        }}
      >
        {value}
      </span>
    </div>
  );
}
