"use client";

import { useState, type Ref } from "react";

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
    endgame: CategoryStat;
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
  phaseAccuracy: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseAccuracyVsExpected?: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseBestMoveRate?: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseAccuracyByResult?: {
    opening: { wins: number | null; draws: number | null; losses: number | null };
    middlegame: { wins: number | null; draws: number | null; losses: number | null };
    endgame: { wins: number | null; draws: number | null; losses: number | null };
  };
  phaseBlunderRate?: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  gamesAnalyzed: number;
  record?: { wins: number; draws: number; losses: number };
}

interface PlayerCardProps {
  username: string;
  timeControl: "bullet" | "blitz" | "rapid";
  chessRating: number;
  peakRating?: number;
  title?: string;
  countryCode?: string;
  avatarUrl?: string;
  arenaStats: ArenaStatsData;
  frontFaceRef?: Ref<HTMLDivElement>;
  statDiffs?: Partial<Record<keyof ArenaStatsData["categories"], number>> & { overall?: number };
  editableRating?: boolean;
  onRatingChange?: (rating: number) => void;
  ratingPlaceholder?: string;
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
    background: "linear-gradient(160deg, #9A7209 0%, #FFD700 45%, #FFF1A0 70%, #FFD700 100%)",
    accent: "#FFF8DC",
    accentDark: "rgba(184,134,11,0.6)",
    boxShadow: "0 0 18px rgba(255,215,0,0.2)",
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
    background: "#6B4C38",
    accent: "#A89070",
    accentDark: "rgba(107,76,56,0.5)",
  },
  silver: {
    background: "#5C636B",
    accent: "#9BA0A6",
    accentDark: "rgba(92,99,107,0.5)",
  },
  gold: {
    background: "#C4A24C",
    accent: "#FFF3D0",
    accentDark: "rgba(196,162,76,0.5)",
  },
  platinum: {
    background: "#252235",
    accent: "#9A8A5C",
    accentDark: "rgba(37,34,53,0.5)",
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
  { key: "positional", label: "STR" },
  { key: "opening", label: "OPN" },
  { key: "endgame", label: "END" },
];

// ── Component ──────────────────────────────────────────────────────────

export default function PlayerCard({
  username,
  timeControl,
  chessRating,
  peakRating,
  title,
  countryCode,
  avatarUrl,
  arenaStats,
  frontFaceRef,
  statDiffs,
  editableRating,
  onRatingChange,
  ratingPlaceholder,
}: PlayerCardProps) {
  const [flipped, setFlipped] = useState(false);
  const { tier, shiny, arenaRating, categories, form, backStats, gamesAnalyzed, record } = arenaStats;
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
          ref={frontFaceRef}
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
                data-shimmer
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

          {/* Target label — only on editable (target) cards */}
          {editableRating && (
            <div style={{
              textAlign: "center",
              paddingTop: 4,
              paddingBottom: 0,
              fontSize: 9,
              fontWeight: 800,
              color: "#fff",
              opacity: 0.5,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}>
              Target
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
              <div style={{ position: "relative", display: "inline-flex", alignItems: "flex-start" }}>
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
              </div>

              {/* Chess rating */}
              {editableRating ? (
                <input
                  className="rating-spinner"
                  type="number"
                  min={500}
                  max={3500}
                  step={50}
                  value={chessRating || ""}
                  placeholder={ratingPlaceholder || "2000"}
                  onChange={(e) => {
                    const v = e.target.value;
                    onRatingChange?.(v === "" ? 0 : Number(v));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 64,
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#fff",
                    opacity: 0.9,
                    marginTop: 3,
                    background: "transparent",
                    border: "1.5px solid #000",
                    borderRadius: 4,
                    outline: "none",
                    textAlign: "center",
                    padding: "2px 4px",
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#fff",
                    opacity: 0.9,
                    marginTop: 3,
                  }}
                >
                  {chessRating}
                </span>
              )}

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

            {/* Player avatar / chess piece fallback */}
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={username}
                  style={{
                    width: 110,
                    height: 110,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: `2px solid ${style.accent}50`,
                    opacity: 0.85,
                  }}
                />
              ) : (
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
              )}
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderBottom: `1px solid ${style.accent}40`,
                paddingBottom: 6,
              }}
            >
              {flagUrl && (
                <img
                  src={flagUrl}
                  alt={countryCode}
                  style={{ width: 18, height: 13, borderRadius: 2, flexShrink: 0 }}
                />
              )}
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
                    {(() => {
                      const diff = statDiffs?.[s.key as keyof typeof statDiffs] as number | undefined;
                      const hasDiff = diff != null;
                      const reached = hasDiff && diff <= 0;
                      const brightBg = shiny && (tier === "gold" || tier === "silver");
                      const statColor = hasDiff ? (reached ? "#00ff55" : "#ff5050") : "#fff";
                      return (
                        <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 2,
                          filter: hasDiff ? (brightBg ? "saturate(3) brightness(1.3)" : "saturate(2.5) brightness(1.15)") : undefined,
                        }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 900,
                              color: statColor,
                              minWidth: 22,
                              backgroundColor: hasDiff ? (brightBg ? "#000000b0" : "#00000070") : undefined,
                              borderRadius: 4,
                              padding: hasDiff ? "1px 5px" : undefined,
                            }}
                          >
                            {displayStat(s.key)}
                          </span>
                          {hasDiff && !reached && diff > 0 && (
                            <span style={{
                              fontSize: 10,
                              fontWeight: 900,
                              color: "#ff5050",
                              backgroundColor: brightBg ? "#000000b0" : undefined,
                              borderRadius: brightBg ? 3 : undefined,
                              padding: brightBg ? "0 3px" : undefined,
                            }}>
                              +{diff}
                            </span>
                          )}
                        </span>
                      );
                    })()}
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
                    {(() => {
                      const diff = statDiffs?.[s.key as keyof typeof statDiffs] as number | undefined;
                      const hasDiff = diff != null;
                      const reached = hasDiff && diff <= 0;
                      const brightBg = shiny && (tier === "gold" || tier === "silver");
                      const statColor = hasDiff ? (reached ? "#00ff55" : "#ff5050") : "#fff";
                      return (
                        <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 2,
                          filter: hasDiff ? (brightBg ? "saturate(3) brightness(1.3)" : "saturate(2.5) brightness(1.15)") : undefined,
                        }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 900,
                              color: statColor,
                              minWidth: 22,
                              backgroundColor: hasDiff ? (brightBg ? "#000000b0" : "#00000070") : undefined,
                              borderRadius: 4,
                              padding: hasDiff ? "1px 5px" : undefined,
                            }}
                          >
                            {displayStat(s.key)}
                          </span>
                          {hasDiff && !reached && diff > 0 && (
                            <span style={{
                              fontSize: 10,
                              fontWeight: 900,
                              color: "#ff5050",
                              backgroundColor: brightBg ? "#000000b0" : undefined,
                              borderRadius: brightBg ? 3 : undefined,
                              padding: brightBg ? "0 3px" : undefined,
                            }}>
                              +{diff}
                            </span>
                          )}
                        </span>
                      );
                    })()}
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
              {TC_ICONS[timeControl]} {timeControl} &middot; {record ? `${record.wins + record.draws + record.losses} games` : `${gamesAnalyzed} analyzed`}
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

            {record && (
              <>
                <div
                  style={{
                    width: "100%",
                    height: 1,
                    backgroundColor: style.accent,
                    opacity: 0.2,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: style.accent, opacity: 0.85 }}>
                    Record
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>
                    <span style={{ color: "#81b64c" }}>{record.wins}</span>
                    {" / "}
                    <span style={{ color: "#9b9895" }}>{record.draws}</span>
                    {" / "}
                    <span style={{ color: "#e05252" }}>{record.losses}</span>
                  </span>
                </div>
              </>
            )}
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
