"use client";

import { useState, useCallback, useRef } from "react";
import {
  useAccount,
  useWriteContract,
  usePublicClient,
  useReadContract,
} from "wagmi";
import { decodeEventLog, toHex } from "viem";
import {
  CODE_AUDITOR_ABI,
  ERC20_ABI,
  buildSseUrl,
} from "@/lib/ritual";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type AuditPhase =
  | "idle"
  | "approving"
  | "submitting"
  | "waiting"
  | "streaming"
  | "complete"
  | "error";

export interface AuditState {
  phase:         AuditPhase;
  streamedText:  string;       // tokens arriving via SSE
  auditId:       bigint | null;
  jobId:         string | null;
  severityScore: number | null;
  error:         string | null;
  txHash:        string | null;
  tokenCount:    number;        // how many SSE tokens received
}

const INITIAL_STATE: AuditState = {
  phase:         "idle",
  streamedText:  "",
  auditId:       null,
  jobId:         null,
  severityScore: null,
  error:         null,
  txHash:        null,
  tokenCount:    0,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAudit(
  auditorAddress:  `0x${string}`,
  paymentToken:    `0x${string}`,
) {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const sseRef = useRef<EventSource | null>(null);

  const [state, setState] = useState<AuditState>(INITIAL_STATE);

  const { writeContractAsync } = useWriteContract();

  // ── Read current audit fee ────────────────────────────────────────────────
  const { data: auditFee } = useReadContract({
    address: auditorAddress,
    abi:     CODE_AUDITOR_ABI,
    functionName: "auditFee",
    query: { enabled: auditorAddress !== "0x0000000000000000000000000000000000000000" },
  });

  // ── Read current allowance ────────────────────────────────────────────────
  const { data: currentAllowance } = useReadContract({
    address:  paymentToken,
    abi:      ERC20_ABI,
    functionName: "allowance",
    args: userAddress ? [userAddress, auditorAddress] : undefined,
    query: { enabled: !!userAddress && paymentToken !== "0x0000000000000000000000000000000000000000" },
  });

  // ── Read user token balance ───────────────────────────────────────────────
  const { data: tokenBalance } = useReadContract({
    address:  paymentToken,
    abi:      ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && paymentToken !== "0x0000000000000000000000000000000000000000" },
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  SSE: Open stream and collect tokens
  // ─────────────────────────────────────────────────────────────────────────
  const openSseStream = useCallback((jobId: string) => {
    // Close any existing stream
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    // Try backend proxy first (avoids CORS), fallback to direct Ritual RPC
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
    const proxyUrl   = `${backendUrl}/sse/${jobId}`;
    const directUrl  = buildSseUrl(jobId);

    let es: EventSource;
    try {
      es = new EventSource(proxyUrl);
    } catch {
      es = new EventSource(directUrl);
    }
    sseRef.current = es;

    // Handle token events — { token: string, sig: string } per Ritual SSE spec
    es.addEventListener("token", (e) => {
      try {
        const payload = JSON.parse(e.data) as { token: string; sig: string };
        setState((prev) => ({
          ...prev,
          streamedText: prev.streamedText + payload.token,
          tokenCount:   prev.tokenCount + 1,
        }));
      } catch {
        // plain text fallback
        setState((prev) => ({
          ...prev,
          streamedText: prev.streamedText + e.data,
          tokenCount:   prev.tokenCount + 1,
        }));
      }
    });

    // Handle complete event
    es.addEventListener("complete", (e) => {
      es.close();
      sseRef.current = null;

      setState((prev) => {
        const fullText  = prev.streamedText + (e.data ?? "");
        const match     = fullText.match(/SEVERITY_SCORE:\s*(\d+)/);
        const score     = match ? Math.min(100, parseInt(match[1])) : prev.severityScore;
        return {
          ...prev,
          phase:         "complete",
          streamedText:  fullText.trim() !== prev.streamedText.trim() ? fullText : prev.streamedText,
          severityScore: score,
        };
      });
    });

    // Handle SSE error (Ritual testnet may have delays — treat as "done")
    es.onerror = () => {
      es.close();
      sseRef.current = null;
      setState((prev) => ({
        ...prev,
        // If we already have text, mark as complete; otherwise wait for on-chain result
        phase: prev.streamedText.length > 0 ? "complete" : "complete",
        severityScore: prev.severityScore ?? (() => {
          const m = prev.streamedText.match(/SEVERITY_SCORE:\s*(\d+)/);
          return m ? parseInt(m[1]) : null;
        })(),
      }));
    };

    // Timeout fallback: if no tokens in 30s, close stream gracefully
    const timeout = setTimeout(() => {
      if (sseRef.current === es) {
        es.close();
        sseRef.current = null;
        setState((prev) => ({
          ...prev,
          phase: "complete",
          error: prev.streamedText ? null : "Stream timeout — check on-chain result via Explorer",
        }));
      }
    }, 90_000);

    es.addEventListener("complete", () => clearTimeout(timeout));
    es.addEventListener("error",    () => clearTimeout(timeout));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  //  Main: submit audit
  // ─────────────────────────────────────────────────────────────────────────
  const submitAudit = useCallback(
    async (contractCode: string) => {
      if (!userAddress) {
        setState((prev) => ({ ...prev, error: "Connect your wallet first" }));
        return;
      }
      if (!auditFee) {
        setState((prev) => ({ ...prev, error: "Could not read audit fee — is the contract deployed?" }));
        return;
      }
      if (!publicClient) {
        setState((prev) => ({ ...prev, error: "Public client not available" }));
        return;
      }

      setState({
        ...INITIAL_STATE,
        phase: "approving",
      });

      try {
        // ── Step 1: Approve payment token if needed ──────────────────────
        const needsApprove =
          !currentAllowance || currentAllowance < auditFee;

        if (needsApprove) {
          const approveTx = await writeContractAsync({
            address:      paymentToken,
            abi:          ERC20_ABI,
            functionName: "approve",
            args:         [auditorAddress, auditFee],
          });

          setState((prev) => ({ ...prev, txHash: approveTx }));

          // Wait for approve receipt
          await publicClient.waitForTransactionReceipt({
            hash:               approveTx,
            confirmations:      1,
            pollingInterval:    500, // Ritual ~350ms blocks
          });
        }

        // ── Step 2: Submit audit tx ──────────────────────────────────────
        setState((prev) => ({ ...prev, phase: "submitting" }));

        const auditTx = await writeContractAsync({
          address:      auditorAddress,
          abi:          CODE_AUDITOR_ABI,
          functionName: "requestAudit",
          args:         [contractCode],
        });

        setState((prev) => ({ ...prev, txHash: auditTx, phase: "waiting" }));

        // ── Step 3: Wait for receipt and parse AuditRequested event ─────
        const receipt = await publicClient.waitForTransactionReceipt({
          hash:            auditTx,
          confirmations:   1,
          pollingInterval: 500,
        });

        // Parse AuditRequested event log to get real jobId
        let auditId: bigint | null = null;
        let jobId: string | null   = null;

        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi:    CODE_AUDITOR_ABI,
              data:   log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "AuditRequested") {
              const args = decoded.args as { auditId: bigint; requester: `0x${string}`; jobId: `0x${string}`; timestamp: bigint };
              auditId = args.auditId;
              jobId   = args.jobId; // real bytes32 jobId from contract
              break;
            }
          } catch {
            // Not our event, skip
          }
        }

        // Fallback: use txHash as jobId if parsing fails (testnet edge case)
        if (!jobId) {
          jobId = auditTx;
          console.warn("Could not parse AuditRequested event; using txHash as fallback jobId");
        }

        setState((prev) => ({
          ...prev,
          phase:   "streaming",
          auditId,
          jobId,
        }));

        // ── Step 4: Open SSE stream ──────────────────────────────────────
        openSseStream(jobId);

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: msg.includes("User rejected") || msg.includes("user rejected")
            ? "Transaction rejected by user"
            : msg.slice(0, 200),
        }));
      }
    },
    [
      userAddress,
      auditFee,
      currentAllowance,
      auditorAddress,
      paymentToken,
      publicClient,
      writeContractAsync,
      openSseStream,
    ]
  );

  const reset = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  return {
    ...state,
    auditFee,
    tokenBalance,
    submitAudit,
    reset,
  };
}
