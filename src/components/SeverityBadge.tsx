"use client";

interface Props {
  score: number | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

interface ScoreInfo {
  label:      string;
  color:      string;
  bgColor:    string;
  borderColor:string;
  icon:       string;
  desc:       string;
}

function getScoreInfo(score: number): ScoreInfo {
  if (score <= 20) return {
    label:       "CRITICAL",
    color:       "var(--sev-critical)",
    bgColor:     "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.35)",
    icon:        "ti-alert-octagon",
    desc:        "Critical vulnerabilities found",
  };
  if (score <= 40) return {
    label:       "HIGH",
    color:       "var(--sev-high)",
    bgColor:     "rgba(249,115,22,0.12)",
    borderColor: "rgba(249,115,22,0.35)",
    icon:        "ti-alert-triangle",
    desc:        "High severity issues found",
  };
  if (score <= 60) return {
    label:       "MEDIUM",
    color:       "var(--sev-medium)",
    bgColor:     "rgba(245,158,11,0.12)",
    borderColor: "rgba(245,158,11,0.35)",
    icon:        "ti-alert-circle",
    desc:        "Medium severity issues",
  };
  if (score <= 80) return {
    label:       "LOW",
    color:       "var(--sev-low)",
    bgColor:     "rgba(16,185,129,0.12)",
    borderColor: "rgba(16,185,129,0.35)",
    icon:        "ti-info-circle",
    desc:        "Low severity issues",
  };
  return {
    label:       "CLEAN",
    color:       "var(--sev-clean)",
    bgColor:     "rgba(6,182,212,0.12)",
    borderColor: "rgba(6,182,212,0.35)",
    icon:        "ti-shield-check",
    desc:        "No critical issues found",
  };
}

const CIRCLE_R = 20;
const CIRCLE_C = 2 * Math.PI * CIRCLE_R; // ~125.66

export function SeverityBadge({ score, size = "md", showLabel = true }: Props) {
  if (score === null) return null;

  const info = getScoreInfo(score);
  const safeSc = Math.max(0, Math.min(100, score));

  const svgSize    = size === "lg" ? 72 : size === "sm" ? 44 : 56;
  const fontSize   = size === "lg" ? 14  : size === "sm" ? 10 : 12;
  const labelSize  = size === "lg" ? 13  : size === "sm" ? 11 : 12;
  const padV       = size === "sm" ? 3   : 5;
  const padH       = size === "sm" ? 8   : 12;

  const strokeDash = (safeSc / 100) * CIRCLE_C;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size === "sm" ? 6 : 10,
      }}
      title={`${info.desc} (Score: ${score}/100)`}
    >
      {/* Circular score gauge */}
      <svg
        width={svgSize}
        height={svgSize}
        viewBox="0 0 48 48"
        aria-label={`Severity score: ${score} out of 100`}
        role="img"
      >
        {/* Glow filter */}
        <defs>
          <filter id={`glow-${score}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <circle
          cx="24" cy="24" r={CIRCLE_R}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="4"
        />

        {/* Progress arc */}
        <circle
          cx="24" cy="24" r={CIRCLE_R}
          fill="none"
          stroke={info.color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${CIRCLE_C}`}
          transform="rotate(-90 24 24)"
          filter={`url(#glow-${score})`}
          style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.87,0,0.13,1)" }}
        />

        {/* Center score text */}
        <text
          x="24" y="24"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight="700"
          fill={info.color}
          fontFamily="var(--font-mono, monospace)"
        >
          {score}
        </text>
      </svg>

      {/* Label pill */}
      {showLabel && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: labelSize,
            fontWeight: 700,
            padding: `${padV}px ${padH}px`,
            borderRadius: "var(--radius-full)",
            background: info.bgColor,
            color: info.color,
            border: `1px solid ${info.borderColor}`,
            fontFamily: "var(--font-mono, monospace)",
            letterSpacing: "0.06em",
          }}>
            <i className={`ti ${info.icon}`} aria-hidden="true" style={{ fontSize: labelSize - 1 }} />
            {info.label}
          </span>
          {size !== "sm" && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", paddingLeft: padH }}>
              {info.desc}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
