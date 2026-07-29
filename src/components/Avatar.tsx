import type { AgentId } from "@/lib/types";

// Flat-illustration analyst portraits — a distinct face per employee.
// Kept as inline SVG so the app has no external image dependencies.
const SKIN = {
  researcher: "#E8C4A0",
  risk: "#C98D63",
  debater: "#E4B593",
  tester: "#D9A97E",
  optimizer: "#C68E63",
} as const;

function Face({ id, accent }: { id: AgentId; accent: string }) {
  const skin = SKIN[id];
  const hair: Record<AgentId, string> = {
    researcher: "#2C2A28",
    risk: "#3A342C",
    debater: "#241C18",
    tester: "#4A3B2A",
    optimizer: "#211814",
  };
  const h = hair[id];
  return (
    <g>
      {/* shoulders / collar */}
      <path d="M12 100 C12 78 30 70 50 70 C70 70 88 78 88 100 Z" fill={accent} />
      <path d="M40 74 L50 88 L60 74 Z" fill="#F6F3EA" opacity="0.9" />
      {/* neck */}
      <rect x="43" y="58" width="14" height="16" rx="6" fill={skin} />
      {/* head */}
      <ellipse cx="50" cy="44" rx="19" ry="21" fill={skin} />

      {id === "researcher" && (
        <>
          <path d="M31 40 C31 22 69 22 69 40 C69 30 60 24 50 24 C40 24 31 30 31 40 Z" fill={h} />
          <path d="M28 42 C28 30 40 26 50 26 L50 34 C42 34 34 37 34 46 Z" fill={h} />
          <circle cx="42" cy="44" r="6" fill="none" stroke="#2C2A28" strokeWidth="1.6" />
          <circle cx="58" cy="44" r="6" fill="none" stroke="#2C2A28" strokeWidth="1.6" />
          <path d="M48 44 h4" stroke="#2C2A28" strokeWidth="1.6" />
        </>
      )}
      {id === "risk" && (
        <>
          <path d="M30 42 C30 22 70 22 70 40 C70 32 62 25 50 25 C39 25 30 31 30 42 Z" fill={h} />
          <path d="M35 54 C40 62 60 62 65 54 C64 60 58 64 50 64 C42 64 36 60 35 54 Z" fill={h} />
        </>
      )}
      {id === "debater" && (
        <>
          <path d="M29 46 C25 24 75 24 71 46 L71 66 C71 60 66 58 66 52 C66 34 34 34 34 52 C34 58 29 60 29 66 Z" fill={h} />
        </>
      )}
      {id === "tester" && (
        <>
          <path d="M31 40 C31 24 69 24 69 40 C69 32 61 27 50 27 C39 27 31 32 31 40 Z" fill={h} />
          <path d="M30 46 a20 20 0 0 1 40 0" fill="none" stroke="#2C2A28" strokeWidth="2.4" />
          <rect x="27" y="44" width="6" height="9" rx="2" fill="#2C2A28" />
          <rect x="67" y="44" width="6" height="9" rx="2" fill="#2C2A28" />
        </>
      )}
      {id === "optimizer" && (
        <>
          <path d="M30 44 C30 22 70 22 70 44 L70 60 C70 52 64 50 64 44 L36 44 C36 50 30 52 30 60 Z" fill={h} />
          <path d="M50 24 L50 44" stroke={skin} strokeWidth="0" />
        </>
      )}

      {/* eyes + smile (shared) */}
      {id !== "researcher" && (
        <>
          <circle cx="43" cy="45" r="1.8" fill="#2C2A28" />
          <circle cx="57" cy="45" r="1.8" fill="#2C2A28" />
        </>
      )}
      {id === "researcher" && (
        <>
          <circle cx="42" cy="44" r="1.6" fill="#2C2A28" />
          <circle cx="58" cy="44" r="1.6" fill="#2C2A28" />
        </>
      )}
      <path d="M45 53 q5 4 10 0" fill="none" stroke="#9A6B4E" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  );
}

export function Avatar({
  id,
  accent,
  size = 96,
  ring = true,
}: {
  id: AgentId;
  accent: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 108" role="img" aria-label="agent avatar">
      <defs>
        <clipPath id={`clip-${id}`}>
          <circle cx="50" cy="50" r="48" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="49" fill="#EFEBDE" />
      <g clipPath={`url(#clip-${id})`}>
        <rect x="0" y="0" width="100" height="100" fill="#EFEBDE" />
        <Face id={id} accent={accent} />
      </g>
      {ring && (
        <circle cx="50" cy="50" r="48" fill="none" stroke={accent} strokeWidth="1.5" />
      )}
    </svg>
  );
}
