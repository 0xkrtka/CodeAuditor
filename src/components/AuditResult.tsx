"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AuditPhase } from "@/hooks/useAudit";
import { SeverityBadge } from "./SeverityBadge";

interface Props {
  phase:         AuditPhase;
  streamedText:  string;
  severityScore: number | null;
  txHash:        string | null;
  jobId?:        string | null;
  onReset:       () => void;
}

// ─── Section colors ───────────────────────────────────────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  "[CRITICAL]": "var(--sev-critical)",
  "[HIGH]":     "var(--sev-high)",
  "[MEDIUM]":   "var(--sev-medium)",
  "[LOW]":      "var(--sev-low)",
  "[INFO]":     "var(--color-info)",
  "CRITICAL:":  "var(--sev-critical)",
  "HIGH:":      "var(--sev-high)",
  "MEDIUM:":    "var(--sev-medium)",
  "LOW:":       "var(--sev-low)",
};

const SECTION_ICONS: Record<string, string> = {
  "SEVERITY_SCORE": "ti-chart-bar",
  "SUMMARY":        "ti-file-description",
  "FINDINGS":       "ti-bug",
  "RECOMMENDATIONS":"ti-bulb",
};

// ─── Component ────────────────────────────────────────────────────────────────
export function AuditResult({
  phase,
  streamedText,
  severityScore,
  txHash,
  jobId,
  onReset,
}: Props) {
  const scrollRef  = useRef<HTMLDivElement>(null);
  const [copied,   setCopied]   = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["SUMMARY", "FINDINGS", "RECOMMENDATIONS", "SEVERITY_SCORE"]));

  // Auto-scroll as tokens stream in
  useEffect(() => {
    if (scrollRef.current && phase === "streaming") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamedText, phase]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(streamedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = streamedText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [streamedText]);

  const handleDownload = useCallback(() => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const filename  = `audit-report-${timestamp}.md`;
    const content   = [
      `# CodeAuditor — AI Security Audit Report`,
      `**Date:** ${new Date().toLocaleString()}`,
      `**Chain:** Ritual Chain (ID 1979)`,
      txHash ? `**Tx:** ${txHash}` : "",
      jobId  ? `**Job ID:** ${jobId}` : "",
      `\n---\n`,
      streamedText,
    ].filter(Boolean).join("\n");

    const blob = new Blob([content], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [streamedText, txHash, jobId]);

  const toggleSection = useCallback((section: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  }, []);

  if (phase === "idle") return null;

  const isStreaming = phase === "streaming";
  const isDone      = phase === "complete";
  const isError     = phase === "error";
  const isWaiting   = phase === "submitting" || phase === "waiting";

  const statusColor = isStreaming
    ? "var(--color-warning)"
    : isDone
    ? "var(--color-success)"
    : isError
    ? "var(--color-danger)"
    : "var(--text-muted)";

  return (
    <div
      className="animate-slide-up"
      style={{
        marginTop: "var(--sp-5)",
        border: "1px solid var(--bg-border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        background: "var(--bg-surface)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        background: "var(--bg-muted)",
        borderBottom: "1px solid var(--bg-border)",
        flexWrap: "wrap",
        gap: 8,
      }}>
        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className={isStreaming ? "status-dot live" : "status-dot"}
            style={{ background: statusColor, color: statusColor }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {phase === "submitting" && "Submitting to Ritual Chain…"}
            {phase === "waiting"    && "Waiting for confirmation…"}
            {phase === "streaming"  && "AI audit streaming via TEE…"}
            {phase === "complete"   && "Audit complete · Stored on-chain"}
            {phase === "error"      && "Error"}
          </span>
        </div>

        {/* Right actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isDone && severityScore !== null && (
            <SeverityBadge score={severityScore} size="sm" />
          )}

          {streamedText && isDone && (
            <>
              <button
                id="copy-report-btn"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 10px", gap: 5 }}
                onClick={handleCopy}
                title="Copy report to clipboard"
              >
                <i className={`ti ${copied ? "ti-check" : "ti-clipboard"}`} aria-hidden="true" />
                {copied ? "Copied!" : "Copy"}
              </button>

              <button
                id="download-report-btn"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "4px 10px", gap: 5 }}
                onClick={handleDownload}
                title="Download as Markdown"
              >
                <i className="ti ti-download" aria-hidden="true" />
                .md
              </button>
            </>
          )}

          {txHash && (
            <a
              href={`https://explorer.ritualfoundation.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "4px 10px", gap: 5 }}
              title="View transaction on explorer"
            >
              <i className="ti ti-external-link" aria-hidden="true" />
              Tx
            </a>
          )}

          {(isDone || isError) && (
            <button
              id="new-audit-btn"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "4px 10px", gap: 5 }}
              onClick={onReset}
            >
              <i className="ti ti-plus" aria-hidden="true" />
              New audit
            </button>
          )}
        </div>
      </div>

      {/* ── Loading placeholder ──────────────────────────────────────────── */}
      {isWaiting && !streamedText && (
        <div style={{
          padding: "var(--sp-8)",
          textAlign: "center",
          color: "var(--text-tertiary)",
          fontSize: 13,
        }}>
          <LoadingDots />
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
            {phase === "submitting" && "Transaction submitted — awaiting block…"}
            {phase === "waiting"    && "Tx confirmed — LLM inference starting…"}
          </p>
        </div>
      )}

      {/* ── Streaming text ───────────────────────────────────────────────── */}
      {streamedText && (
        <div
          ref={scrollRef}
          style={{
            padding: "var(--sp-4) var(--sp-5)",
            maxHeight: 560,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "12.5px",
            lineHeight: "1.75",
            color: "var(--text-secondary)",
          }}
        >
          <FormattedAuditText
            text={streamedText}
            isStreaming={isStreaming}
            expanded={expanded}
            onToggleSection={toggleSection}
          />
        </div>
      )}

      {/* ── Footer metadata ──────────────────────────────────────────────── */}
      {isDone && (
        <div style={{
          padding: "8px 16px",
          borderTop: "1px solid var(--bg-border)",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 11,
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          background: "var(--bg-muted)",
        }}>
          {jobId && (
            <span data-tooltip="SSE job reference for this audit">
              Job: {jobId.slice(0, 20)}…
            </span>
          )}
          <span>Model: GLM-4.7-FP8</span>
          <span>Chain: 1979</span>
          <span>Precompile: 0x0802</span>
          {txHash && (
            <a
              href={`https://explorer.ritualfoundation.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--ritual-purple-mid)", marginLeft: "auto" }}
            >
              View on explorer ↗
            </a>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 currentColor; }
          70%  { box-shadow: 0 0 0 6px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </div>
  );
}

// ─── Formatted audit text with sections ──────────────────────────────────────
function FormattedAuditText({
  text,
  isStreaming,
  expanded,
  onToggleSection,
}: {
  text: string;
  isStreaming: boolean;
  expanded: Set<string>;
  onToggleSection: (s: string) => void;
}) {
  const lines = text.split("\n");
  let currentSection = "";

  const elements: React.ReactNode[] = [];
  let sectionLines: React.ReactNode[] = [];
  let sectionKey   = "";

  function flushSection() {
    if (!sectionKey) return;
    const isExp = expanded.has(sectionKey);
    elements.push(
      <div key={`sec-${sectionKey}`} style={{ marginBottom: 8 }}>
        <button
          onClick={() => onToggleSection(sectionKey)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 0",
            color: "var(--text-primary)",
            fontWeight: 700,
            fontSize: "13px",
            fontFamily: "var(--font-mono)",
            width: "100%",
            textAlign: "left",
          }}
        >
          <i
            className={`ti ${SECTION_ICONS[sectionKey] ?? "ti-chevron-right"}`}
            style={{ fontSize: 14, color: "var(--ritual-purple-mid)" }}
            aria-hidden="true"
          />
          {sectionKey}
          <i
            className={`ti ${isExp ? "ti-chevron-up" : "ti-chevron-down"}`}
            style={{ fontSize: 11, marginLeft: "auto", color: "var(--text-muted)" }}
            aria-hidden="true"
          />
        </button>
        {isExp && (
          <div style={{ paddingLeft: 20 }}>
            {sectionLines}
          </div>
        )}
      </div>
    );
    sectionLines = [];
    sectionKey   = "";
  }

  lines.forEach((line, i) => {
    // Detect section header: SEVERITY_SCORE:, SUMMARY:, FINDINGS:, RECOMMENDATIONS:
    const headerMatch = line.match(/^(SEVERITY_SCORE|SUMMARY|FINDINGS|RECOMMENDATIONS):/);
    if (headerMatch) {
      flushSection();
      sectionKey = headerMatch[1];
      currentSection = sectionKey;

      // Add the value on same line as SEVERITY_SCORE
      if (sectionKey === "SEVERITY_SCORE") {
        const val = line.replace("SEVERITY_SCORE:", "").trim();
        if (val) {
          sectionLines.push(
            <div key={`sev-val`} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "4px 12px",
              borderRadius: "var(--radius-full)",
              background: "rgba(124,58,237,0.1)",
              border: "1px solid rgba(124,58,237,0.25)",
              color: "var(--ritual-purple-mid)",
              fontWeight: 700, fontSize: 14,
              margin: "4px 0",
            }}>
              {val} / 100
            </div>
          );
        }
      }
      return;
    }

    // Colored severity tags
    let lineColor: string | undefined;
    for (const tag of Object.keys(SEVERITY_COLORS)) {
      if (line.includes(tag)) {
        lineColor = SEVERITY_COLORS[tag];
        break;
      }
    }

    const isCode = line.startsWith("```") || line.startsWith("    ") || line.startsWith("\t");

    const lineEl = (
      <div
        key={i}
        style={{
          color: lineColor ?? (isCode ? "var(--text-tertiary)" : "var(--text-secondary)"),
          background: isCode ? "var(--bg-muted)" : undefined,
          padding: isCode ? "0 8px" : undefined,
          borderRadius: isCode ? "var(--radius-sm)" : undefined,
          fontWeight: lineColor ? 600 : undefined,
          marginTop: line === "" ? 4 : undefined,
        }}
      >
        {line || "\u00A0"}
      </div>
    );

    if (currentSection) {
      sectionLines.push(lineEl);
    } else {
      elements.push(lineEl);
    }
  });

  flushSection();

  return (
    <>
      {elements}
      {isStreaming && (
        <span
          style={{
            display: "inline-block",
            width: 7, height: 13,
            background: "var(--ritual-purple-mid)",
            marginLeft: 2,
            verticalAlign: "text-bottom",
            animation: "blink 1s step-end infinite",
            borderRadius: 2,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}

// ─── Loading dots ─────────────────────────────────────────────────────────────
function LoadingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 6, height: 6,
            borderRadius: "50%",
            background: "var(--ritual-purple-mid)",
            animation: `bounce-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounce-dot {
          0%,80%,100% { transform:translateY(0); opacity:0.4; }
          40%          { transform:translateY(-8px); opacity:1; }
        }
      `}</style>
    </span>
  );
}
