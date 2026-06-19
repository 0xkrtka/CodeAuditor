"use client";

import { useState, useRef, useCallback } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAudit } from "@/hooks/useAudit";
import { AuditResult } from "./AuditResult";
import { wagmiConfig } from "@/app/providers";

// ── Contract addresses from environment ──────────────────────────────────────
let AUDITOR_ADDRESS = (
  process.env.NEXT_PUBLIC_AUDITOR_ADDRESS ??
  "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa"
) as `0x${string}`;

// Force override if the env variable points to the old deprecated contract address
if (AUDITOR_ADDRESS.toLowerCase() === "0x8cadb7a5303450e10ca5bae2a1442b906ec21b7c".toLowerCase()) {
  AUDITOR_ADDRESS = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
}

const PAYMENT_TOKEN = (
  process.env.NEXT_PUBLIC_PAYMENT_TOKEN ??
  "0x26c11EB567BB83d2B031af41188ECA7872CaAF07"
) as `0x${string}`;

// ── Sample vulnerable contract for demo ──────────────────────────────────────
const SAMPLE_CODE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Vault — Classic reentrancy vulnerability example
contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // ⚠️  Reentrancy vulnerability: state updated AFTER external call
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");
        // External call before state update — attacker can re-enter!
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        balances[msg.sender] = 0; // BUG: should be BEFORE the call
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shortenAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const PHASES = [
  { key: "submitting", label: "Sending Tx",      icon: "ti-send"           },
  { key: "waiting",    label: "Confirming",       icon: "ti-loader-2"       },
  { key: "streaming",  label: "AI Streaming",     icon: "ti-broadcast"      },
  { key: "complete",   label: "Complete",         icon: "ti-circle-check"   },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export function AuditForm() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();

  const [code, setCode] = useState(SAMPLE_CODE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    phase,
    streamedText,
    severityScore,
    txHash,
    error,
    tokenCount,
    submitAudit,
    reset,
  } = useAudit(AUDITOR_ADDRESS, PAYMENT_TOKEN);

  const isActive  = phase !== "idle" && phase !== "error";
  const charCount = code.length;
  const lineCount = code.split("\n").length;
  const isOverLimit = charCount > 32_768;

  // File drop handler
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".sol")) {
      const reader = new FileReader();
      reader.onload = (ev) => setCode(ev.target?.result as string ?? "");
      reader.readAsText(file);
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setCode(ev.target?.result as string ?? "");
      reader.readAsText(file);
    }
  }, []);

  async function handleSubmit() {
    if (!code.trim() || isOverLimit) return;
    await submitAudit(code);
  }

  const notDeployed =
    AUDITOR_ADDRESS === "0x0000000000000000000000000000000000000000";

  const btnDisabled =
    !isConnected ||
    !code.trim() ||
    isOverLimit ||
    notDeployed;

  const btnLabel = !isConnected
    ? "Connect wallet to audit"
    : notDeployed
    ? "Contract not deployed"
    : isOverLimit
    ? "Code too long (max 32KB)"
    : "Request On-Chain Audit";

  return (
    <div>
      {/* ── Wallet Bar ──────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: "var(--sp-4)",
        marginBottom: "var(--sp-4)",
        borderBottom: "1px solid var(--bg-border)",
        flexWrap: "wrap",
        gap: 8,
      }}>
        {/* Wallet info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: "var(--radius-full)",
            background: isConnected ? "rgba(16,185,129,0.08)" : "var(--bg-elevated)",
            border: `1px solid ${isConnected ? "rgba(16,185,129,0.25)" : "var(--bg-border)"}`,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: isConnected ? "var(--color-success)" : "var(--text-muted)",
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: isConnected ? "var(--color-success)" : "var(--text-muted)" }}>
              {isConnected ? shortenAddr(address!) : "Not connected"}
            </span>
          </div>

          {/* Free audit badge */}
          {isConnected && (
            <span style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.25)",
              color: "var(--color-success)",
              fontFamily: "var(--font-mono)",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}>
              <i className="ti ti-gift" style={{ fontSize: 12 }} aria-hidden="true" />
              Free audit
            </span>
          )}


        </div>

        {/* Connect / Disconnect */}
        <button
          id="wallet-connect-btn"
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: "6px 14px" }}
          onClick={isConnected
            ? () => disconnect()
            : () => connect({ connector: wagmiConfig.connectors[0] })
          }
        >
          <i className={`ti ${isConnected ? "ti-logout" : "ti-wallet"}`} aria-hidden="true" />
          {isConnected ? "Disconnect" : "Connect Wallet"}
        </button>
      </div>

      {/* ── Code Editor ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "var(--sp-4)" }}>
        {/* Label row */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          flexWrap: "wrap",
          gap: 8,
        }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            Solidity Source Code
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-muted)" }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {lineCount} lines
            </span>
            <span style={{
              fontFamily: "var(--font-mono)",
              color: isOverLimit ? "var(--color-danger)" : charCount > 28_000 ? "var(--color-warning)" : "var(--text-muted)",
            }}>
              {charCount.toLocaleString()} / 32,768
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "2px 8px", gap: 4 }}
              onClick={() => fileInputRef.current?.click()}
              title="Upload .sol file"
            >
              <i className="ti ti-upload" aria-hidden="true" />
              Upload .sol
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div
          className="code-editor"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          style={{
            opacity: isActive ? 0.6 : 1,
            pointerEvents: isActive ? "none" : undefined,
          }}
        >
          {/* Editor chrome */}
          <div className="code-editor-header">
            <span className="code-editor-dot" style={{ background: "#FF5F57" }} />
            <span className="code-editor-dot" style={{ background: "#FEBC2E" }} />
            <span className="code-editor-dot" style={{ background: "#28C840" }} />
            <span style={{
              marginLeft: 8,
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}>
              contract.sol
            </span>
            {/* Drag & drop hint */}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
              drag &amp; drop .sol file
            </span>
          </div>

          {/* Textarea */}
          <textarea
            id="solidity-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isActive}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="// Paste your Solidity contract here…"
            style={{
              minHeight: 320,
              maxHeight: 600,
            }}
            aria-label="Solidity source code editor"
          />
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".sol,.txt"
          style={{ display: "none" }}
          onChange={handleFileInput}
        />
      </div>

      {/* ── Error Alert ─────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 16px",
          borderRadius: "var(--radius-md)",
          background: "var(--color-danger-bg)",
          border: "1px solid rgba(239,68,68,0.25)",
          marginBottom: "var(--sp-4)",
          animation: "fade-in 200ms ease both",
        }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 16, color: "var(--color-danger)", flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span style={{ fontSize: 13, color: "var(--color-danger)", lineHeight: 1.5 }}>
            {error}
          </span>
        </div>
      )}



      {/* ── Submit Button or Progress ────────────────────────────────────── */}
      {(phase === "idle" || phase === "error") ? (
        notDeployed ? (
          /* ── Not Deployed Banner ────────────────────────────────────── */
          <div style={{
            padding: "16px 20px",
            borderRadius: "var(--radius-lg)",
            background: "rgba(139,92,246,0.06)",
            border: "1px dashed rgba(139,92,246,0.35)",
            textAlign: "center",
            animation: "fade-in 300ms ease both",
          }}>
            <i className="ti ti-settings-2" style={{ fontSize: 28, color: "var(--ritual-purple-mid)", marginBottom: 8, display: "block" }} aria-hidden="true" />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
              Contract Belum Di-Deploy
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Jalankan perintah berikut di terminal untuk deploy ke Ritual Chain:
            </div>
            <code style={{
              display: "block",
              padding: "10px 14px",
              background: "var(--bg-code)",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--color-success)",
              textAlign: "left",
              marginBottom: 10,
              wordBreak: "break-all",
            }}>
              {`$env:PRIVATE_KEY="YOUR_KEY"; node deploy/deploy.js`}
            </code>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Setelah deploy selesai, restart server dengan <strong>npm run dev</strong>
            </div>
          </div>
        ) : (
        <button
          id="submit-audit-btn"
          className="btn btn-primary"
          style={{ width: "100%", padding: "13px", fontSize: 15, gap: 10 }}
          onClick={handleSubmit}
          disabled={btnDisabled}
        >
          <i className="ti ti-shield-search" aria-hidden="true" style={{ fontSize: 18 }} />
          {btnLabel}
          {!btnDisabled && (
            <span style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              background: "rgba(255,255,255,0.15)",
              fontWeight: 500,
            }}>
              via Ritual TEE
            </span>
          )}
        </button>
        )
      ) : (
        <AuditProgressStepper phase={phase} tokenCount={tokenCount ?? 0} />
      )}

      {/* ── Streaming Result ─────────────────────────────────────────────── */}
      <AuditResult
        phase={phase}
        streamedText={streamedText}
        severityScore={severityScore}
        txHash={txHash}
        onReset={reset}
      />
    </div>
  );
}

// ─── Phase progress stepper ───────────────────────────────────────────────────
function AuditProgressStepper({
  phase,
  tokenCount,
}: {
  phase: string;
  tokenCount: number;
}) {
  const currentIdx = PHASES.findIndex((p) => p.key === phase);

  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: "1px solid var(--bg-border)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--sp-5)",
      animation: "slide-up 300ms ease both",
    }}>
      {/* Steps */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        marginBottom: 16,
      }}>
        {PHASES.map((step, i) => {
          const done   = i < currentIdx;
          const active = i === currentIdx;
          const stepColor = done ? "var(--color-success)" : active ? "var(--ritual-purple-mid)" : "var(--text-muted)";

          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{
                  width: 32, height: 32,
                  borderRadius: "50%",
                  border: `2px solid ${stepColor}`,
                  background: done ? "var(--color-success)" : active ? "rgba(155,92,246,0.15)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13,
                  color: done ? "#fff" : stepColor,
                  transition: "all 300ms var(--ease-out)",
                  flexShrink: 0,
                }}>
                  {done ? (
                    <i className="ti ti-check" aria-hidden="true" />
                  ) : active ? (
                    <i
                      className={`ti ${step.icon}`}
                      aria-hidden="true"
                      style={{ animation: step.key === "waiting" ? "spin 1.5s linear infinite" : undefined }}
                    />
                  ) : (
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{i + 1}</span>
                  )}
                </div>
                <span style={{
                  fontSize: 10,
                  marginTop: 6,
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 400,
                  whiteSpace: "nowrap",
                }}>
                  {step.label}
                </span>
              </div>

              {i < PHASES.length - 1 && (
                <div style={{
                  height: 2,
                  flex: 1,
                  background: done ? "var(--color-success)" : "var(--bg-border)",
                  transition: "background 300ms",
                  marginBottom: 22,
                  minWidth: 12,
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Live status */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: "var(--text-tertiary)",
      }}>
        <span>
          {phase === "approving"  && "Waiting for token approval in wallet…"}
          {phase === "submitting" && "Waiting for transaction confirmation…"}
          {phase === "waiting"    && "Transaction submitted — waiting for receipt…"}
          {phase === "streaming"  && `Streaming AI audit… ${tokenCount} tokens received`}
          {phase === "complete"   && "Audit complete"}
        </span>
        {phase === "streaming" && tokenCount > 0 && (
          <span style={{
            fontFamily: "var(--font-mono)",
            color: "var(--ritual-purple-mid)",
          }}>
            {tokenCount} tokens
          </span>
        )}
      </div>
    </div>
  );
}
