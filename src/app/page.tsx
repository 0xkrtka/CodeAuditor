"use client";

import { AuditForm } from "@/components/AuditForm";

export default function Home() {
  return (
    <main>
      {/* ── Sticky Navigation ──────────────────────────────────────────── */}
      <nav style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 24px",
        background: "rgba(10,10,11,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #7C3AED, #3B82F6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 16px rgba(124,58,237,0.4)",
          }}>
            <i className="ti ti-shield-check" style={{ fontSize: 17, color: "#fff" }} aria-hidden="true" />
          </div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>
            CodeAuditor
          </span>
          <span className="badge badge-ritual" style={{ marginLeft: 2 }}>
            Ritual Chain
          </span>
        </div>

        {/* Nav links */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 13 }}>
          {[
            { href: "https://explorer.ritualfoundation.org", label: "Explorer" },
            { href: "https://docs.ritualfoundation.org",    label: "Docs" },
            { href: "https://faucet.ritualfoundation.org",  label: "Faucet" },
          ].map(({ href, label }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
              style={{
                color: "var(--text-tertiary)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "color 150ms",
              }}
            >
              {label}
              <i className="ti ti-external-link" style={{ fontSize: 11 }} aria-hidden="true" />
            </a>
          ))}
        </div>
      </nav>

      {/* ── Hero Section ──────────────────────────────────────────────────── */}
      <div style={{
        padding: "64px 24px 48px",
        textAlign: "center",
        maxWidth: 700,
        margin: "0 auto",
        position: "relative",
      }}>
        {/* Glow orb behind */}
        <div aria-hidden="true" style={{
          position: "absolute",
          top: 0, left: "50%",
          transform: "translateX(-50%)",
          width: 600, height: 300,
          background: "radial-gradient(ellipse at center, rgba(124,58,237,0.15) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Chain badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 14px",
          borderRadius: "var(--radius-full)",
          background: "rgba(124,58,237,0.1)",
          border: "1px solid rgba(124,58,237,0.3)",
          fontSize: 12,
          fontWeight: 500,
          color: "#A78BFA",
          marginBottom: 24,
          animation: "fade-in 0.6s ease both",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
          GLM-4.7-FP8 · TEE · Chain ID 1979 · ~350ms blocks
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: "clamp(30px, 6vw, 52px)",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
          marginBottom: 20,
          animation: "slide-up 0.6s ease both 0.1s",
        }}>
          <span className="gradient-text">AI Security Audit</span>
          <br />
          <span style={{ color: "var(--text-primary)" }}>Verified On-Chain</span>
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: 16,
          color: "var(--text-secondary)",
          lineHeight: 1.7,
          maxWidth: 540,
          margin: "0 auto 32px",
          animation: "slide-up 0.6s ease both 0.2s",
        }}>
          Paste your Solidity contract and the{" "}
          <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>Ritual LLM precompile</strong>{" "}
          audits it inside a Trusted Execution Environment — completely free.
          Results are stored on-chain forever.
        </p>

        {/* Feature chips */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 8,
          animation: "slide-up 0.6s ease both 0.3s",
        }}>
          {[
            { icon: "ti-broadcast",   label: "SSE Streaming",     color: "#7C3AED" },
            { icon: "ti-lock",        label: "TEE Encrypted",     color: "#3B82F6" },
            { icon: "ti-coin",        label: "X402 Micropayment", color: "#10B981" },
            { icon: "ti-database",    label: "Stored On-Chain",   color: "#F59E0B" },
            { icon: "ti-certificate", label: "EIP-712 Signed",    color: "#06B6D4" },
          ].map(({ icon, label, color }) => (
            <span key={label} style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              padding: "5px 12px",
              borderRadius: "var(--radius-full)",
              background: "var(--bg-surface)",
              border: "1px solid var(--bg-border)",
              color: "var(--text-secondary)",
            }}
            >
              <i className={`ti ${icon}`} style={{ fontSize: 13, color }} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Main Audit Form ──────────────────────────────────────────────── */}
      <div className="container" style={{ marginBottom: 64 }}>
        <div className="card" style={{
          padding: "2px",
          background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(59,130,246,0.15), rgba(16,185,129,0.1))",
          borderRadius: "var(--radius-xl)",
          boxShadow: "0 0 60px rgba(124,58,237,0.1), var(--shadow-lg)",
        }}>
          <div style={{
            background: "var(--bg-surface)",
            borderRadius: "calc(var(--radius-xl) - 2px)",
            padding: "var(--sp-6)",
          }}>
            <AuditForm />
          </div>
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div className="container" style={{ marginBottom: 64 }}>
        <h2 style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-tertiary)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          textAlign: "center",
          marginBottom: 32,
        }}>
          How it works
        </h2>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}>
          {[
            {
              step: "01",
              icon: "ti-code",
              title: "Paste your contract",
              desc:  "Drop any Solidity source code into the editor. Up to 32KB supported.",
              color: "#7C3AED",
            },
            {
              step: "02",
              icon: "ti-shield-check",
              title: "Free AI audit",
              desc:  "No payment needed. Submit your contract directly — the TEE handles it for free.",
              color: "#10B981",
            },
            {
              step: "03",
              icon: "ti-cpu",
              title: "TEE runs inference",
              desc:  "GLM-4.7-FP8 inside a Trusted Execution Environment analyzes your code.",
              color: "#3B82F6",
            },
            {
              step: "04",
              icon: "ti-database",
              title: "Stored on-chain",
              desc:  "Full audit report with severity score stored permanently on Ritual Chain.",
              color: "#F59E0B",
            },
          ].map(({ step, icon, title, desc, color }) => (
            <div key={step} className="card" style={{ padding: "var(--sp-5)", position: "relative", overflow: "hidden" }}>
              {/* Step number watermark */}
              <div aria-hidden="true" style={{
                position: "absolute",
                top: -10, right: 12,
                fontSize: 72,
                fontWeight: 800,
                color: color + "10",
                lineHeight: 1,
                letterSpacing: "-0.05em",
                pointerEvents: "none",
                fontFamily: "var(--font-mono)",
              }}>
                {step}
              </div>

              <div style={{
                width: 38, height: 38,
                borderRadius: "var(--radius-md)",
                background: color + "18",
                border: `1px solid ${color}33`,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 12,
              }}>
                <i className={`ti ${icon}`} style={{ fontSize: 18, color }} aria-hidden="true" />
              </div>

              <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                {title}
              </p>
              <p style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.6 }}>
                {desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tech specs ───────────────────────────────────────────────────── */}
      <div className="container" style={{ marginBottom: 64 }}>
        <div className="card" style={{ padding: "var(--sp-6)" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 24,
          }}>
            {[
              { label: "LLM Model",       value: "GLM-4.7-FP8",     sub: "zai-org / MIT License" },
              { label: "Execution",        value: "TEE Enclave",     sub: "Intel TDX / AMD SEV" },
              { label: "Streaming",        value: "SSE + EIP-712",   sub: "Per-token signature" },
              { label: "Payment",          value: "X402 Pattern",    sub: "ERC-20 micro-fee" },
              { label: "Block time",       value: "~350ms",          sub: "Ritual Chain ID 1979" },
              { label: "Precompile",       value: "0x0802",          sub: "LLM inference endpoint" },
            ].map(({ label, value, sub }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>
                  {value}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  {sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid var(--bg-border)",
        padding: "24px 24px",
        textAlign: "center",
        fontSize: 12,
        color: "var(--text-muted)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          <span>Built on</span>
          <a
            href="https://ritualfoundation.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--ritual-purple-mid)", fontWeight: 500 }}
          >
            Ritual Chain
          </a>
          <span>·</span>
          <span>Powered by GLM-4.7-FP8 in TEE</span>
          <span>·</span>
          <a
            href="https://explorer.ritualfoundation.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-tertiary)" }}
          >
            Chain ID 1979
          </a>
        </div>
      </footer>
    </main>
  );
}
