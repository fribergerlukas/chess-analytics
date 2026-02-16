"use client";

import { useAuth } from "../AuthContext";

const COACHES = [
  {
    name: "Chesswithakeem",
    title: "NM",
    rating: 2721,
    stars: 5,
    avatar: "https://images.chesscomfiles.com/uploads/v1/user/89523040.0341f1a9.200x200o.0996111c0eec.jpeg",
    website: "https://www.chesswithakeem.com/",
    specialties: ["Tactics", "Attacking Play", "Opening Preparation"],
    description:
      "National Master and chess content creator helping players of all levels sharpen their game. Known for his engaging teaching style and deep tactical understanding.",
  },
];

function StarRating({ count }: { count: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={i < count ? "#f0d9b5" : "none"}
          stroke={i < count ? "#f0d9b5" : "#4a4745"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

export default function CoachPage() {
  const { authUser, authLoading } = useAuth();

  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div
          className="h-8 w-8 animate-spin rounded-full border-4"
          style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
        />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: "#9b9895" }}>
          Log in to browse coaches.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingTop: 40 }}>
      <p
        className="font-extrabold"
        style={{
          fontSize: 12,
          color: "#81b64c",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 8,
        }}
      >
        Connect to Our Trusted Coaches
      </p>
      <h1
        className="font-extrabold"
        style={{ fontSize: 28, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}
      >
        Find a coach.
      </h1>
      <p style={{ fontSize: 14, fontWeight: 600, color: "#9b9895", lineHeight: 1.75, marginBottom: 32 }}>
        Work with a coach who can access your puzzle database and target your weaknesses directly.
      </p>

      {COACHES.map((coach) => (
        <div
          key={coach.name}
          style={{
            backgroundColor: "#262421",
            borderRadius: 16,
            border: "1px solid #3d3a37",
            padding: 28,
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", gap: 24, alignItems: "start" }}>
            {/* Avatar */}
            <img
              src={coach.avatar}
              alt={coach.name}
              style={{
                width: 80,
                height: 80,
                borderRadius: 12,
                objectFit: "cover",
                flexShrink: 0,
              }}
            />

            {/* Info */}
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                {coach.title && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: "#f0d9b5",
                      backgroundColor: "#3d3a37",
                      padding: "2px 7px",
                      borderRadius: 4,
                    }}
                  >
                    {coach.title}
                  </span>
                )}
                <span style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
                  {coach.name}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#9b9895" }}>
                  ({coach.rating})
                </span>
              </div>

              <div style={{ marginBottom: 10 }}>
                <StarRating count={coach.stars} />
              </div>

              <p style={{ fontSize: 13, fontWeight: 600, color: "#9b9895", lineHeight: 1.7, marginBottom: 14 }}>
                {coach.description}
              </p>

              {/* Specialties */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                {coach.specialties.map((s) => (
                  <span
                    key={s}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#81b64c",
                      backgroundColor: "rgba(129,182,76,0.12)",
                      padding: "4px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>

              {/* CTA */}
              <a
                href={coach.website}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  padding: "10px 28px",
                  fontSize: 14,
                  fontWeight: 800,
                  borderRadius: 8,
                  backgroundColor: "#81b64c",
                  color: "#fff",
                  textDecoration: "none",
                  transition: "background-color 0.2s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#6fa33e"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#81b64c"; }}
              >
                Visit Website
              </a>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
