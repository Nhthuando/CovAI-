import { useId } from "react";

/**
 * "Covy", the CovAI mascot (landing page only).
 *
 * A small test bot: violet shell, dark visor with mint eyes, an antenna shaped
 * like a branching graph node, and the CovAI mark on its chest.
 *
 * pose:
 *  - "shield": holds a coverage shield and waves
 *  - "think":  hand on chin, question mark (FAQ)
 *  - "cheer":  both arms up, happy eyes (CTA)
 *
 * Purely decorative: hidden from assistive tech. Motion lives in landing.css
 * (.lp-covy*), and is switched off by prefers-reduced-motion there.
 */

const SHELL = "#6d5dfb";
const SHELL_DARK = "#2a2170";
const MINT = "#5eead4";
const SPARK = "#fbbf24";

function Sparks({ x, y, flip = false }) {
  const s = flip ? -1 : 1;
  return (
    <g
      className="lp-covy__spark"
      stroke={SPARK}
      strokeWidth="4"
      strokeLinecap="round"
      transform={`translate(${x} ${y}) scale(${s} 1)`}
    >
      <path d="M0 0 l8 -9" />
      <path d="M9 7 l12 -3" />
      <path d="M-6 -8 l1 -11" />
    </g>
  );
}

export default function Covy({ pose = "shield", className = "" }) {
  const uid = useId().replace(/:/g, "");
  const shell = `covy-shell-${uid}`;
  const shield = `covy-shield-${uid}`;
  const happy = pose === "cheer";
  const thinking = pose === "think";

  return (
    <svg
      className={`lp-covy lp-covy--${pose} ${className}`}
      viewBox="0 0 200 220"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={shell} x1="60" y1="55" x2="140" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b3a9ff" />
          <stop offset="0.55" stopColor={SHELL} />
          <stop offset="1" stopColor="#4a3fc9" />
        </linearGradient>
        <linearGradient id={shield} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7df5e1" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse className="lp-covy__shadow" cx="100" cy="208" rx="46" ry="7" fill="#000" opacity="0.28" />

      <g className="lp-covy__body">
        {/* legs */}
        <rect x="72" y="166" width="20" height="34" rx="10" fill={SHELL_DARK} />
        <rect x="108" y="166" width="20" height="34" rx="10" fill={SHELL_DARK} />
        <ellipse cx="80" cy="200" rx="15" ry="8" fill={SHELL_DARK} />
        <ellipse cx="120" cy="200" rx="15" ry="8" fill={SHELL_DARK} />

        {/* antenna: a branching graph node */}
        <path d="M100 60 V38" stroke={SHELL_DARK} strokeWidth="5" strokeLinecap="round" />
        <path d="M100 48 L117 40" stroke={SHELL_DARK} strokeWidth="4" strokeLinecap="round" />
        <circle cx="119" cy="39" r="5" fill="#a89cff" />
        <circle className="lp-covy__node" cx="100" cy="32" r="8" fill={MINT} />

        {/* back arm (drawn before the shell so it tucks behind) */}
        {pose === "shield" && (
          <path d="M52 122 Q34 128 40 146" stroke={SHELL} strokeWidth="13" strokeLinecap="round" />
        )}
        {thinking && (
          <path d="M50 124 Q36 142 46 160" stroke={SHELL} strokeWidth="13" strokeLinecap="round" />
        )}

        {/* shell */}
        <rect x="45" y="58" width="110" height="118" rx="44" fill={`url(#${shell})`} />
        <path
          d="M62 88 Q66 68 88 64"
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* visor */}
        <rect x="59" y="80" width="82" height="52" rx="24" fill="#120f2b" />
        <rect x="59" y="80" width="82" height="52" rx="24" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="2" />

        {/* eyes */}
        {happy ? (
          <g stroke={MINT} strokeWidth="5.5" strokeLinecap="round">
            <path d="M77 107 q7 -10 14 0" />
            <path d="M109 107 q7 -10 14 0" />
          </g>
        ) : (
          <g className="lp-covy__eyes" fill={MINT}>
            <rect x="79" y={thinking ? 97 : 94} width="11" height={thinking ? 13 : 18} rx="5.5" />
            <rect x="110" y="94" width="11" height="18" rx="5.5" />
          </g>
        )}
        {thinking && (
          <path d="M75 90 l17 4" stroke={MINT} strokeWidth="3.5" strokeLinecap="round" />
        )}

        {/* cheeks + mouth */}
        <ellipse cx="72" cy="118" rx="6" ry="3.5" fill="#fb7185" opacity="0.55" />
        <ellipse cx="128" cy="118" rx="6" ry="3.5" fill="#fb7185" opacity="0.55" />
        {happy && <path d="M92 114 q8 11 16 0 z" fill={MINT} />}
        {pose === "shield" && (
          <path d="M93 116 q7 6 14 0" stroke={MINT} strokeWidth="3.5" strokeLinecap="round" />
        )}
        {thinking && (
          <path d="M96 119 h9" stroke={MINT} strokeWidth="3.5" strokeLinecap="round" />
        )}

        {/* chest emblem: the CovAI mark */}
        <path
          d="M107.2 146.5 A9 9 0 1 0 107.2 159.5"
          stroke="#ffffff"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path
          d="M96.6 153.2 l3 3 l7.4 -7.8"
          stroke={MINT}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* front arms + props, per pose */}
        {pose === "shield" && (
          <>
            <g className="lp-covy__shield">
              <path
                d="M40 122 l22 -8 l22 8 v18 c0 15 -10 25 -22 30 c-12 -5 -22 -15 -22 -30 z"
                fill={`url(#${shield})`}
                stroke="#ffffff"
                strokeWidth="4"
                strokeLinejoin="round"
              />
              <path
                d="M52 141 l7 7 l14 -15"
                stroke="#ffffff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            <g className="lp-covy__wave">
              <path d="M150 122 Q168 112 172 90" stroke={SHELL} strokeWidth="13" strokeLinecap="round" />
              <circle cx="173" cy="86" r="10" fill={SHELL_DARK} />
            </g>
            <Sparks x={184} y={70} />
          </>
        )}

        {thinking && (
          <>
            <circle cx="46" cy="162" r="10" fill={SHELL_DARK} />
            <path d="M150 128 Q160 150 132 142" stroke={SHELL} strokeWidth="13" strokeLinecap="round" />
            <circle cx="128" cy="140" r="10" fill={SHELL_DARK} />
            <g className="lp-covy__question">
              <path
                d="M158 44 q0 -14 14 -14 q14 0 14 13 q0 9 -9 13 q-5 2 -5 9"
                stroke="#58a6ff"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="172" cy="80" r="5.5" fill="#58a6ff" />
            </g>
          </>
        )}

        {happy && (
          <>
            <path d="M52 120 Q30 110 28 86" stroke={SHELL} strokeWidth="13" strokeLinecap="round" />
            <circle cx="27" cy="82" r="10" fill={SHELL_DARK} />
            <path d="M148 120 Q170 110 172 86" stroke={SHELL} strokeWidth="13" strokeLinecap="round" />
            <circle cx="173" cy="82" r="10" fill={SHELL_DARK} />
            <Sparks x={184} y={66} />
            <Sparks x={16} y={66} flip />
          </>
        )}
      </g>
    </svg>
  );
}
