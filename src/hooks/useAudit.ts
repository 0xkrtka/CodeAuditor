"use client";

import { useState, useCallback, useRef } from "react";
import {
  useAccount,
  useSendTransaction,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
  useBlockNumber,
} from "wagmi";
import {
  encodeAbiParameters,
  parseAbiParameters,
  decodeAbiParameters,
  keccak256,
  toHex,
  parseEther,
  encodeFunctionData,
} from "viem";
import {
  CODE_AUDITOR_ABI,
  ritualChain,
  RITUAL_CONTRACTS,
} from "@/lib/ritual";

// ─── Ritual Streaming Service ─────────────────────────────────────────────────
const STREAMING_SERVICE_URL = "https://streaming.ritualfoundation.org";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type AuditPhase =
  | "idle"
  | "submitting"
  | "waiting"
  | "streaming"
  | "complete"
  | "error";

export interface AuditState {
  phase:         AuditPhase;
  streamedText:  string;
  severityScore: number | null;
  error:         string | null;
  txHash:        string | null;
  jobId:         string | null;   // jobId from AuditRequested event — used for SSE
  tokenCount:    number;
}

const INITIAL_STATE: AuditState = {
  phase:         "idle",
  streamedText:  "",
  severityScore: null,
  error:         null,
  txHash:        null,
  jobId:         null,
  tokenCount:    0,
};

// ─── 30-Field LLM Payload Encoder ────────────────────────────────────────────
// Per Ritual docs (ritual-dapp-llm SKILL.md Section 1):
// "Always call precompile 0x0802 with the full 30-field ABI tuple."
function encodeLLMPayload(
  executor: `0x${string}`,
  messagesJson: string,
  streaming: boolean,
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters([
      "address, bytes[], uint256, bytes[], bytes,",
      "string, string, int256, string, bool, int256, string, string,",
      "uint256, bool, int256, string, bytes, int256, string, string, bool,",
      "int256, bytes, bytes, int256, int256, string, bool,",
      "(string,string,string)",
    ].join("")),
    [
      executor,               // (1)  executor — TEE node address
      [],                     // (2)  encryptedSecrets
      300n,                   // (3)  ttl — 300 blocks (~105s, safe for GLM reasoning)
      [],                     // (4)  secretSignatures
      "0x",                   // (5)  userPublicKey
      messagesJson,           // (6)  messagesJson
      "zai-org/GLM-4.7-FP8", // (7)  model — only confirmed live model on Ritual
      0n,                     // (8)  frequencyPenalty
      "",                     // (9)  logitBiasJson
      false,                  // (10) logprobs
      4096n,                  // (11) maxCompletionTokens — ≥4096 required for GLM reasoning model
      "",                     // (12) metadataJson
      "",                     // (13) modalitiesJson
      1n,                     // (14) n
      true,                   // (15) parallelToolCalls
      0n,                     // (16) presencePenalty
      "medium",               // (17) reasoningEffort
      "0x",                   // (18) responseFormatData
      -1n,                    // (19) seed (null)
      "auto",                 // (20) serviceTier
      "",                     // (21) stopJson
      streaming,              // (22) stream — true enables SSE
      700n,                   // (23) temperature (0.7 × 1000)
      "0x",                   // (24) toolChoiceData
      "0x",                   // (25) toolsData
      -1n,                    // (26) topLogprobs (null)
      1000n,                  // (27) topP (1.0 × 1000)
      "",                     // (28) user
      false,                  // (29) piiEnabled
      ["", "", ""],           // (30) convoHistory — empty StorageRef
    ],
  ) as `0x${string}`;
}

// ─── Extract jobId from AuditRequested event in receipt ─────────────────────
// Per Ritual CodeAuditor contract:
//   event AuditRequested(uint256 indexed auditId, address indexed requester,
//                        bytes32 codeHash, bytes32 jobId, uint256 timestamp)
// auditId (indexed) → topics[1], requester (indexed) → topics[2]
// non-indexed → data: abi.encode(bytes32 codeHash, bytes32 jobId, uint256 timestamp)
const AUDIT_REQUESTED_TOPIC = keccak256(
  toHex("AuditRequested(uint256,address,bytes32,bytes32,uint256)"),
);

function extractJobIdFromReceipt(receipt: any, requester: string): string | null {
  for (const log of receipt.logs) {
    if (!log.topics || log.topics[0] !== AUDIT_REQUESTED_TOPIC) continue;
    try {
      // topics[2] is the indexed requester address (padded to 32 bytes)
      const logRequester = "0x" + log.topics[2]?.slice(-40);
      if (logRequester.toLowerCase() !== requester.toLowerCase()) continue;

      // data = abi.encode(bytes32 codeHash, bytes32 jobId, uint256 timestamp)
      const [, jobIdBytes] = decodeAbiParameters(
        parseAbiParameters("bytes32, bytes32, uint256"),
        log.data,
      );
      return jobIdBytes as string;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Parse severity score from audit text ─────────────────────────────────────
function parseSeverityScore(text: string): number | null {
  const match = text.match(/SEVERITY_SCORE:\s*(\d+)/i);
  if (match) {
    const score = parseInt(match[1], 10);
    return Math.min(100, Math.max(0, score));
  }
  return null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAudit(
  _auditorAddress: `0x${string}`,  // CodeAuditor contract address (used for requestAudit calls)
  _paymentToken:   `0x${string}`,  // mRITUAL token address (kept for future use)
) {
  const { address: userAddress, chain } = useAccount();
  const { switchChainAsync }            = useSwitchChain();
  const { data: walletClient }          = useWalletClient();
  const publicClient                    = usePublicClient();
  const abortRef                        = useRef<AbortController | null>(null);

  const [state, setState] = useState<AuditState>(INITIAL_STATE);

  // useSendTransaction — used for requestAudit on CodeAuditor.
  // We pass a manual gas limit to bypass MetaMask simulation of async precompile calls.
  const { sendTransactionAsync } = useSendTransaction();

  // ─── Query user's EOA balance in RitualWallet ──────────────────────────────
  const { data: userWalletBalance, refetch: refetchUserWalletBalance } = useReadContract({
    address:      RITUAL_CONTRACTS.RITUAL_WALLET,
    abi: [{
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "balance", type: "uint256" }],
    }] as const,
    functionName: "balanceOf",
    chainId:      ritualChain.id,
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // ─── Query user's EOA lock block in RitualWallet ───────────────────────────
  const { data: userWalletLock, refetch: refetchUserWalletLock } = useReadContract({
    address:      RITUAL_CONTRACTS.RITUAL_WALLET,
    abi: [{
      name: "lockUntil",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "blockNumber", type: "uint256" }],
    }] as const,
    functionName: "lockUntil",
    chainId:      ritualChain.id,
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // ─── Query current block number ────────────────────────────────────────────
  const { data: currentBlock, refetch: refetchBlockNumber } = useBlockNumber({
    chainId: ritualChain.id,
    watch: true,
  });

  const refetchAllWalletData = useCallback(async () => {
    await Promise.all([
      refetchUserWalletBalance(),
      refetchUserWalletLock(),
      refetchBlockNumber(),
    ]);
  }, [refetchUserWalletBalance, refetchUserWalletLock, refetchBlockNumber]);

  // ─── Deposit/Extend lock for user EOA in RitualWallet ──────────────────────
  // NOTE: This deposits RITUAL into RitualWallet for the USER's EOA.
  // The CONTRACT's RitualWallet is funded separately by the owner via depositForFees().
  // Users only need this if they want to call precompiles directly from their EOA.
  const depositFees = useCallback(async (amount: string = "0.05") => {
    if (!userAddress || !walletClient) {
      throw new Error("Wallet not connected");
    }

    if (chain?.id !== ritualChain.id) {
      if (!switchChainAsync) {
        throw new Error("Switch network support not available");
      }
      await switchChainAsync({ chainId: ritualChain.id });
    }

    // Call deposit(10000000) on RitualWallet to lock for ~41 days (10M blocks)
    const depositData = encodeFunctionData({
      abi: [{
        name: "deposit",
        type: "function",
        stateMutability: "payable",
        inputs: [{ name: "lockDuration", type: "uint256" }],
        outputs: [],
      }] as const,
      functionName: "deposit",
      args: [10000000n],
    });

    const tx = await sendTransactionAsync({
      to:      RITUAL_CONTRACTS.RITUAL_WALLET,
      data:    depositData,
      value:   parseEther(amount),
      chainId: ritualChain.id,
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refetchAllWalletData();
    }
  }, [userAddress, walletClient, chain, switchChainAsync, sendTransactionAsync, publicClient, refetchAllWalletData]);

  // ─── Withdraw all funds from RitualWallet ───────────────────────────────────
  const withdrawFees = useCallback(async () => {
    if (!userAddress || !walletClient || !userWalletBalance || userWalletBalance === 0n) {
      throw new Error("Wallet not connected or balance is zero");
    }

    if (chain?.id !== ritualChain.id) {
      if (!switchChainAsync) {
        throw new Error("Switch network support not available");
      }
      await switchChainAsync({ chainId: ritualChain.id });
    }

    const data = encodeFunctionData({
      abi: [{
        name: 'withdraw',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
      }] as const,
      functionName: 'withdraw',
      args: [userWalletBalance],
    });

    const tx = await sendTransactionAsync({
      to:      RITUAL_CONTRACTS.RITUAL_WALLET,
      data,
      chainId: ritualChain.id,
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refetchAllWalletData();
    }
  }, [userAddress, walletClient, chain, switchChainAsync, sendTransactionAsync, publicClient, refetchAllWalletData, userWalletBalance]);

  // ─────────────────────────────────────────────────────────────────────────
  //  SSE Streaming via fetch() + EIP-712 auth
  //  Per Ritual docs: use jobId (from AuditRequested event) as the stream key.
  //  Cannot use browser EventSource (no custom header support).
  //  Use fetch() with ReadableStream + Authorization + X-Timestamp headers.
  // ─────────────────────────────────────────────────────────────────────────
  const openSseStream = useCallback(
    async (jobId: string) => {
      if (!walletClient) return;

      // Sign EIP-712 stream request
      // Domain: { name, version, chainId } — NO verifyingContract per docs
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      let signature: `0x${string}`;
      try {
        signature = await walletClient.signTypedData({
          domain: {
            name:    "Ritual Streaming Service",
            version: "1",
            chainId: ritualChain.id,
          },
          types: {
            StreamRequest: [
              { name: "jobId",     type: "bytes32" },
              { name: "timestamp", type: "uint256" },
            ],
          },
          primaryType: "StreamRequest",
          message: { jobId: jobId as `0x${string}`, timestamp },
        });
      } catch (err) {
        console.warn("[SSE] EIP-712 sign failed, will try without auth:", err);
        signature = "0x" as `0x${string}`;
      }

      // Abort any previous stream
      if (abortRef.current) abortRef.current.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Use jobId-based SSE URL (correct format per Ritual docs)
      const streamUrl = `${STREAMING_SERVICE_URL}/v1/stream/${jobId}`;
      console.log("[SSE] Connecting to:", streamUrl);

      try {
        const response = await fetch(streamUrl, {
          headers: {
            Accept:          "text/event-stream",
            Authorization:   `Bearer ${signature}`,
            "X-Timestamp":   timestamp.toString(),
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          console.warn(`[SSE] HTTP ${response.status} — stream unavailable, result from contract.`);
          return;
        }

        const reader  = response.body!.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";
        let   fullText = "";

        const timeout = setTimeout(() => {
          abortController.abort();
          console.warn("[SSE] Stream timeout after 120s");
        }, 120_000);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);

            if (data === "[DONE]") {
              clearTimeout(timeout);
              setState((prev) => ({
                ...prev,
                phase:         "complete",
                severityScore: parseSeverityScore(prev.streamedText),
              }));
              return;
            }

            try {
              const event = JSON.parse(data);
              if (event.token) {
                fullText += event.token;
                setState((prev) => ({
                  ...prev,
                  streamedText: prev.streamedText + event.token,
                  tokenCount:   prev.tokenCount + 1,
                }));
              }
              if (event.done) {
                clearTimeout(timeout);
                setState((prev) => ({
                  ...prev,
                  phase:         "complete",
                  severityScore: parseSeverityScore(prev.streamedText),
                }));
                return;
              }
            } catch {
              /* skip non-JSON lines */
            }
          }
        }

        clearTimeout(timeout);
        if (fullText) {
          setState((prev) => ({
            ...prev,
            phase:         "complete",
            severityScore: parseSeverityScore(fullText),
          }));
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        console.warn("[SSE] Stream error:", err.message);
        // Don't set error — contract polling fallback handles this
      }
    },
    [walletClient],
  );

  // ─────────────────────────────────────────────────────────────────────────
  //  Main: submit audit — calls requestAudit on CodeAuditor contract
  //  which internally calls LLM precompile 0x0802 in TEE
  // ─────────────────────────────────────────────────────────────────────────
  const submitAudit = useCallback(
    async (contractCode: string) => {
      if (!userAddress) {
        setState((prev) => ({ ...prev, error: "Connect your wallet first" }));
        return;
      }
      if (!publicClient) {
        setState((prev) => ({ ...prev, error: "Public client not available" }));
        return;
      }
      if (!contractCode.trim()) {
        setState((prev) => ({ ...prev, error: "Paste your Solidity code first" }));
        return;
      }

      setState({ ...INITIAL_STATE, phase: "submitting" });

      try {
        // ── Step 0: Ensure Ritual Chain ──────────────────────────────────
        if (chain?.id !== ritualChain.id) {
          if (!switchChainAsync) {
            throw new Error(
              "Wrong network. Please switch to Ritual Chain (Chain ID: 1979) in MetaMask.",
            );
          }
          await switchChainAsync({ chainId: ritualChain.id });
        }

        // Get initial audit count before transaction to detect new records
        const initialAuditIds = await publicClient.readContract({
          address: _auditorAddress,
          abi: CODE_AUDITOR_ABI,
          functionName: "getMyAudits",
          args: [userAddress],
        }) as readonly bigint[];
        const initialCount = initialAuditIds ? initialAuditIds.length : 0;
        console.log(`[Audit] Initial audit count for ${userAddress}: ${initialCount}`);

        // ── Step 1: Call requestAudit on CodeAuditor Contract ──────────
        // No approval needed — auditFee = 0 (free audit mode)
        const data = encodeFunctionData({
          abi: CODE_AUDITOR_ABI,
          functionName: "requestAudit",
          args: [contractCode, "0x0000000000000000000000000000000000000000"],
        });

        console.log("[Audit] Sending requestAudit tx to contract...");
        const auditTx = await sendTransactionAsync({
          to:      _auditorAddress,
          data,
          gas:     1_000_000n,        // 1M gas — enough for commitment tx
          chainId: ritualChain.id,
        });

        console.log("[Audit] Tx submitted:", auditTx);
        setState((prev) => ({
          ...prev,
          txHash: auditTx,
          phase:  "waiting",
        }));

        // ── Step 2: Wait for TX to be mined ─────────────────────────────
        // Ritual LLM precompile is ASYNC:
        // 1) Builder simulates tx and creates commitment
        // 2) Executor runs inference off-chain in TEE (2-10+ minutes for GLM-4.7)
        // 3) Builder re-executes tx with settled output injected
        console.log("[Audit] Waiting for transaction receipt (async LLM, up to 10min)...");
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({
            hash: auditTx,
            timeout: 600_000,       // 600s (10 min) — GLM reasoning model can take this long
            pollingInterval: 4_000, // Poll every 4s
          });
        } catch (receiptErr: any) {
          console.error("[Audit] waitForTransactionReceipt failed:", receiptErr);
          throw new Error(
            "Transaction timed out after 10 minutes. The Ritual Chain LLM executor may be busy. " +
            `Check your TX on the explorer: https://explorer.ritualfoundation.org/tx/${auditTx}`
          );
        }

        console.log("[Audit] Receipt received. Status:", receipt.status, "Gas used:", receipt.gasUsed.toString());

        if (receipt.status === "reverted") {
          throw new Error(
            "Transaction reverted on-chain. Possible causes: " +
            "(1) Contract RitualWallet balance too low for LLM escrow — contact dApp owner. " +
            "(2) No executor configured on the contract."
          );
        }

        // ── Step 3: Extract jobId from AuditRequested event ─────────────
        const jobId = extractJobIdFromReceipt(receipt, userAddress);
        console.log("[Audit] jobId from AuditRequested event:", jobId);

        setState((prev) => ({
          ...prev,
          phase: "streaming",
          jobId,
        }));

        // ── Step 4: Start SSE stream using jobId (correct URL) ──────────
        if (jobId) {
          openSseStream(jobId);
        } else {
          console.warn("[Audit] No jobId found in receipt logs, skipping SSE stream");
        }

        // ── Step 5: Poll contract for completed audit result ─────────────
        // The TX is already confirmed, so audit data should appear very soon.
        const pollInterval = 3000;  // 3 seconds
        const maxPollTime  = 60000; // 60 seconds
        const startTime    = Date.now();

        const pollResult = async () => {
          try {
            const auditIds = await publicClient.readContract({
              address: _auditorAddress,
              abi: CODE_AUDITOR_ABI,
              functionName: "getMyAudits",
              args: [userAddress],
            }) as readonly bigint[];

            if (auditIds && auditIds.length > initialCount) {
              const latestId = auditIds[auditIds.length - 1];

              const audit = await publicClient.readContract({
                address: _auditorAddress,
                abi: CODE_AUDITOR_ABI,
                functionName: "getAudit",
                args: [latestId],
              }) as any;

              if (audit && audit.completed) {
                console.log("[Audit] On-chain audit ID:", latestId.toString(), "completed!");
                setState((prev) => {
                  const newText = audit.auditResult || "";
                  // Only update if stream has not already fetched more text
                  if (prev.streamedText.length > newText.length + 50) return prev;
                  return {
                    ...prev,
                    phase:         "complete",
                    streamedText:  newText,
                    severityScore: Number(audit.severityScore),
                  };
                });
                return true; // Stop polling
              }
            }
          } catch (pollErr) {
            console.warn("[Audit] Polling error (non-fatal):", pollErr);
          }
          return false;
        };

        // Run first poll immediately
        let completed = await pollResult();

        if (!completed) {
          const intervalId = setInterval(async () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > maxPollTime) {
              clearInterval(intervalId);
              console.warn("[Audit] Polling timed out after TX confirmed.");
              setState((prev) => {
                if (prev.phase === "complete" || prev.streamedText.length > 10) return prev;
                return {
                  ...prev,
                  phase: "error",
                  error: "Transaction confirmed but audit data not found. Check the block explorer.",
                };
              });
              return;
            }

            const isDone = await pollResult();
            if (isDone) {
              clearInterval(intervalId);
            }
          }, pollInterval);
        }
      } catch (err: any) {
        console.error("[Audit] Error:", err);

        let errorMsg: string = err?.message ?? "Unknown error";

        if (errorMsg.includes("User rejected") || errorMsg.includes("user rejected")) {
          errorMsg = "Transaction rejected by user.";
        } else if (errorMsg.includes("insufficient funds") || errorMsg.includes("insufficient balance")) {
          errorMsg = "Insufficient RITUAL for gas fees.";
        } else if (errorMsg.includes("sender locked")) {
          errorMsg = "RitualWallet sender is temporarily locked. Wait a few blocks and try again.";
        } else if (errorMsg.includes("insufficient wallet balance")) {
          errorMsg = "Contract RitualWallet balance too low. Please contact the dApp owner to top up.";
        } else if (errorMsg.includes("NoExecutor")) {
          errorMsg = "No TEE executor configured on the contract. Contact the dApp owner.";
        }

        setState((prev) => ({
          ...prev,
          phase: "error",
          error: errorMsg,
        }));
      }
    },
    [
      userAddress,
      chain,
      publicClient,
      sendTransactionAsync,
      switchChainAsync,
      openSseStream,
      _auditorAddress,
    ],
  );

  // ─── Reset ────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  return {
    phase:         state.phase,
    streamedText:  state.streamedText,
    severityScore: state.severityScore,
    error:         state.error,
    txHash:        state.txHash,
    jobId:         state.jobId,
    tokenCount:    state.tokenCount,
    submitAudit,
    reset,
    userAddress,
    userWalletBalance,
    userWalletLock,
    currentBlock,
    depositFees,
    withdrawFees,
  };
}
