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
// Per Enshrined AI docs: SSE endpoint uses txHash, not jobId.
// URL format: /v1/stream/${txHash}  — EIP-712 signed {txHash, timestamp}
const STREAMING_SERVICE_URL = "https://rpc.ritualfoundation.org";

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
  // Per Enshrined AI docs — 30-field ABI (fields 0-29)
  // piiEnabled (field 28) and stream (field 21) are mutually exclusive
  // convoHistory (field 29) is REQUIRED — empty StorageRef is valid
  return encodeAbiParameters(
    parseAbiParameters([
      "address, bytes[], uint256, bytes[], bytes,",
      "string, string, int256, string, bool, int256, string, string,",
      "uint256, bool, int256, string, bytes, int256, string, string, bool,",
      "int256, bytes, bytes, int256, int256, string, bool,",
      "(string,string,string)",
    ].join("")),
    [
      executor,               // (0)  executor — TEE node address
      [],                     // (1)  encryptedSecrets
      500n,                   // (2)  ttl — 500 blocks (maximum allowed)
      [],                     // (3)  secretSignatures
      "0x",                   // (4)  userPublicKey
      messagesJson,           // (5)  messagesJson — OpenAI-compatible JSON
      "zai-org/GLM-4.7-FP8", // (6)  model — zai-org/GLM-4.7-FP8 (64K context)
      0n,                     // (7)  frequencyPenalty
      "",                     // (8)  logitBiasJson
      false,                  // (9)  logprobs
      4096n,                  // (10) maxCompletionTokens — ≥4096 for GLM reasoning
      "",                     // (11) metadataJson
      "",                     // (12) modalitiesJson
      1n,                     // (13) n
      true,                   // (14) parallelToolCalls
      0n,                     // (15) presencePenalty
      "medium",               // (16) reasoningEffort
      "0x",                   // (17) responseFormatData
      -1n,                    // (18) seed (null = -1)
      "auto",                 // (19) serviceTier
      "",                     // (20) stopJson
      streaming,              // (21) stream — true enables SSE token push
      700n,                   // (22) temperature (0.7 × 1000)
      "0x",                   // (23) toolChoiceData
      "0x",                   // (24) toolsData
      -1n,                    // (25) topLogprobs (null = -1)
      1000n,                  // (26) topP (1.0 × 1000)
      "",                     // (27) user
      false,                  // (28) piiEnabled — mutually exclusive with streaming
      ["", "", ""],           // (29) convoHistory — required StorageRef (empty = no history)
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
  // ─────────────────────────────────────────────────────────────────────────
  //  SSE Streaming via fetch() + EIP-712 auth
  //  Per Enshrined AI docs: stream key = txHash (not jobId).
  //  EIP-712 signs { txHash: bytes32, timestamp: uint256 }.
  //  Endpoint: /v1/stream/${txHash}  — tokens arrive before tx finalizes.
  //  Cannot use browser EventSource (no custom header support) → use fetch().
  // ─────────────────────────────────────────────────────────────────────────
  const openSseStream = useCallback(
    async (txHash: string) => {
      if (!walletClient) return;

      // Sign EIP-712 stream request per Enshrined AI docs:
      //   domain: { name, version, chainId } — no verifyingContract
      //   types:  StreamRequest { txHash: bytes32, timestamp: uint256 }
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
              { name: "txHash",    type: "bytes32" },
              { name: "timestamp", type: "uint256" },
            ],
          },
          primaryType: "StreamRequest",
          message: { txHash: txHash as `0x${string}`, timestamp },
        });
      } catch (err) {
        console.warn("[SSE] EIP-712 sign failed, proceeding without auth:", err);
        signature = "0x" as `0x${string}`;
      }

      // Abort any previous stream
      if (abortRef.current) abortRef.current.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      // SSE URL uses txHash per Enshrined AI docs
      const streamUrl = `${STREAMING_SERVICE_URL}/v1/stream/${txHash}`;
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
          console.warn(`[SSE] HTTP ${response.status} — stream unavailable, falling back to contract poll.`);
          return;
        }

        if (!response.body) {
          console.warn("[SSE] No response body — stream unavailable.");
          return;
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";
        let   fullText = "";
        let   gotTokens = false;

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
              // OpenAI-style SSE: choices[0].delta.content OR token field
              const token: string =
                event.choices?.[0]?.delta?.content ??
                event.token ??
                "";
              if (token) {
                gotTokens = true;
                fullText += token;
                setState((prev) => ({
                  ...prev,
                  streamedText: prev.streamedText + token,
                  tokenCount:   prev.tokenCount + 1,
                }));
              }
              if (event.done || event.choices?.[0]?.finish_reason) {
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
        if (gotTokens && fullText) {
          setState((prev) => ({
            ...prev,
            phase:         "complete",
            severityScore: parseSeverityScore(fullText),
          }));
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        console.warn("[SSE] Stream error:", err.message);
        // Don't set error state — contract polling fallback will handle this
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

        // ── Step 1: Preflight — ensure sender RitualWallet ≥ 0.3 RITUAL ──────
        // Ritual Chain validator requires the SENDER's RitualWallet to have
        // sufficient staked balance (≥ ~0.3 RITUAL) to submit async LLM requests.
        // If below threshold, auto-deposit 0.5 RITUAL for the user (one-time setup).
        const MIN_RW_BALANCE = 300_000_000_000_000_000n; // 0.3 RITUAL
        const DEPOSIT_AMOUNT = 500_000_000_000_000_000n; // 0.5 RITUAL to stake
        const LOCK_DURATION  = 10_000_000n;              // ~40 months of blocks

        const ritualWalletAbi = [{
          name: "balanceOf", type: "function" as const,
          stateMutability: "view" as const,
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ type: "uint256" }],
        }, {
          name: "deposit", type: "function" as const,
          stateMutability: "payable" as const,
          inputs: [{ name: "lockDuration", type: "uint256" }],
          outputs: [],
        }];

        const senderRwBalance = await publicClient.readContract({
          address: RITUAL_CONTRACTS.RITUAL_WALLET,
          abi: ritualWalletAbi,
          functionName: "balanceOf",
          args: [userAddress],
        }) as bigint;

        console.log(`[Audit] Sender RitualWallet balance: ${senderRwBalance} (min: ${MIN_RW_BALANCE})`);

        if (senderRwBalance < MIN_RW_BALANCE) {
          console.log("[Audit] RitualWallet balance too low — auto-depositing 0.5 RITUAL...");
          setState((prev) => ({
            ...prev,
            phase: "submitting",
            streamedText: "⚡ First-time setup: Staking 0.5 RITUAL to your RitualWallet (one-time)...",
          }));

          const depositData = encodeFunctionData({
            abi: ritualWalletAbi,
            functionName: "deposit",
            args: [LOCK_DURATION],
          });

          const depositTx = await sendTransactionAsync({
            to:    RITUAL_CONTRACTS.RITUAL_WALLET,
            data:  depositData,
            value: DEPOSIT_AMOUNT,
            gas:   150_000n,
            chainId: ritualChain.id,
          });

          console.log("[Audit] Deposit TX:", depositTx);
          setState((prev) => ({
            ...prev,
            streamedText: `⏳ Confirming RitualWallet deposit... TX: ${depositTx.slice(0, 10)}...`,
          }));

          await publicClient.waitForTransactionReceipt({
            hash: depositTx,
            timeout: 60_000,
            pollingInterval: 3_000,
          });

          console.log("[Audit] RitualWallet deposit confirmed. Proceeding with audit...");
          setState((prev) => ({ ...prev, streamedText: "" }));
        }

        // ── Step 2: Call requestAudit on CodeAuditor Contract ──────────
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

        // ── Step 4: Start SSE stream using txHash (per Enshrined AI docs) ─
        // Tokens stream to frontend BEFORE the tx finalizes on-chain.
        // The SSE endpoint authenticates via EIP-712 signed {txHash, timestamp}.
        console.log("[SSE] Starting stream for txHash:", auditTx);
        openSseStream(auditTx);

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

        if (errorMsg.includes("User rejected") || errorMsg.includes("user rejected") || errorMsg.includes("4001")) {
          errorMsg = "Transaction rejected by user.";
        } else if (errorMsg.includes("insufficient funds") || errorMsg.includes("insufficient balance") || errorMsg.includes("InsufficientFunds")) {
          errorMsg = "Insufficient RITUAL for gas. Get RITUAL from https://faucet.ritualfoundation.org";
        } else if (errorMsg.includes("sender locked")) {
          errorMsg = "RitualWallet sender locked — wait a few blocks then retry.";
        } else if (errorMsg.includes("insufficient wallet balance") || errorMsg.includes("InsufficientWalletBalance")) {
          errorMsg = "⚠️ Contract escrow balance too low for LLM inference. The dApp owner needs to fund the contract RitualWallet. Please try again later.";
        } else if (errorMsg.includes("NoExecutor")) {
          errorMsg = "No TEE executor configured on the contract. Contact the dApp owner.";
        } else if (errorMsg.includes("timed out") || errorMsg.includes("timeout")) {
          errorMsg = "Transaction timed out — Ritual TEE may be busy. Check explorer for your TX status.";
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
