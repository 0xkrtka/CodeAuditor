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
  tokenCount:    number;
}

const INITIAL_STATE: AuditState = {
  phase:         "idle",
  streamedText:  "",
  severityScore: null,
  error:         null,
  txHash:        null,
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

// ─── Audit Prompt Builder ──────────────────────────────────────────────────────
function buildAuditMessages(contractCode: string): string {
  return JSON.stringify([
    {
      role: "system",
      content:
        "You are a senior Solidity security auditor. Respond with:\nSEVERITY_SCORE: [0-100]\nSUMMARY: [2 sentences]\nFINDINGS:\n[numbered list with severity]\nRECOMMENDATIONS:\n[fixes]",
    },
    {
      role: "user",
      content: `Audit this contract:\n\`\`\`solidity\n${contractCode}\n\`\`\``,
    },
  ]);
}

// ─── LLM Result Extractor from PrecompileCalled event ───────────────────────
// Per docs Section 2: result lives in PrecompileCalled(address,bytes,bytes) event
const PRECOMPILE_CALLED_TOPIC = keccak256(
  toHex("PrecompileCalled(address,bytes,bytes)"),
);

function extractLLMResultFromReceipt(receipt: any): `0x${string}` | null {
  for (const log of receipt.logs) {
    if (log.topics[0] !== PRECOMPILE_CALLED_TOPIC) continue;
    try {
      const [addr, , output] = decodeAbiParameters(
        parseAbiParameters("address, bytes, bytes"),
        log.data,
      );
      if (
        (addr as string).toLowerCase() !==
        RITUAL_CONTRACTS.LLM_PRECOMPILE.toLowerCase()
      )
        continue;
      // Unwrap async envelope: (bytes simmedInput, bytes actualOutput)
      try {
        const [, actual] = decodeAbiParameters(
          parseAbiParameters("bytes, bytes"),
          output as `0x${string}`,
        );
        return actual as `0x${string}`;
      } catch {
        return output as `0x${string}`;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Decode LLM text content from ABI-encoded completionData ─────────────────
function decodeLLMContent(actualOutput: `0x${string}`): {
  text: string;
  hasError: boolean;
  errorMessage: string;
} {
  try {
    const decoded = decodeAbiParameters(
      parseAbiParameters(
        "bool, bytes, bytes, string, (string,string,string)",
      ),
      actualOutput,
    );
    const hasError    = decoded[0] as boolean;
    const completionData = decoded[1] as `0x${string}`;
    const errorMsg    = decoded[3] as string;

    if (hasError) return { text: "", hasError: true, errorMessage: errorMsg };
    if (!completionData || completionData === "0x")
      return { text: "", hasError: false, errorMessage: "" };

    const completionDecoded = decodeAbiParameters(
      parseAbiParameters(
        "string, string, uint256, string, string, string, uint256, bytes[], bytes",
      ),
      completionData,
    );
    const choicesData = completionDecoded[7] as `0x${string}`[];
    if (!choicesData.length) return { text: "", hasError: false, errorMessage: "" };

    const [, , messageData] = decodeAbiParameters(
      parseAbiParameters("uint256, string, bytes"),
      choicesData[0],
    );
    const [content] = decodeAbiParameters(
      parseAbiParameters("string, string, string, uint256, bytes[]"),
      messageData as `0x${string}`,
    );
    return { text: content as string, hasError: false, errorMessage: "" };
  } catch {
    return { text: "", hasError: false, errorMessage: "" };
  }
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
  _paymentToken:   `0x${string}`,  // mRITUAL token address (used for approval + payment)
) {
  const { address: userAddress, chain } = useAccount();
  const { switchChainAsync }            = useSwitchChain();
  const { data: walletClient }          = useWalletClient();
  const publicClient                    = usePublicClient();
  const abortRef                        = useRef<AbortController | null>(null);

  const [state, setState] = useState<AuditState>(INITIAL_STATE);

  // useSendTransaction — used for approval + requestAudit on CodeAuditor.
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
  // Calls deposit(lockDuration) directly on RitualWallet for the user's EOA
  // with a 100,000 block lock duration (~10 hours) to ensure async LLM calls work.
  // We send a tiny amount (0.01 RITUAL) to extend the lock duration.
  const depositFees = useCallback(async () => {
    if (!userAddress || !walletClient) {
      throw new Error("Wallet not connected");
    }

    if (chain?.id !== ritualChain.id) {
      if (!switchChainAsync) {
        throw new Error("Switch network support not available");
      }
      await switchChainAsync({ chainId: ritualChain.id });
    }

    // Call deposit(100000) on RitualWallet
    const depositData = encodeFunctionData({
      abi: [{
        name: "deposit",
        type: "function",
        stateMutability: "payable",
        inputs: [{ name: "lockDuration", type: "uint256" }],
        outputs: [],
      }] as const,
      functionName: "deposit",
      args: [100000n],
    });

    const tx = await sendTransactionAsync({
      to:      RITUAL_CONTRACTS.RITUAL_WALLET,
      data:    depositData,
      value:   parseEther("0.01"),
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

    // Encode withdraw(uint256) function call
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

  // auditFee dihapus — fee = 0, user tidak perlu bayar mRITUAL

  // ─────────────────────────────────────────────────────────────────────────
  //  SSE Streaming via fetch() + EIP-712 auth
  //  Per Ritual docs: cannot use browser EventSource (no custom header support).
  //  Use fetch() with ReadableStream + Authorization + X-Timestamp headers.
  // ─────────────────────────────────────────────────────────────────────────
  const openSseStream = useCallback(
    async (txHash: `0x${string}`) => {
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
              { name: "txHash",    type: "bytes32" },
              { name: "timestamp", type: "uint256" },
            ],
          },
          primaryType: "StreamRequest",
          message: { txHash, timestamp },
        });
      } catch (err) {
        console.warn("[SSE] EIP-712 sign failed, will try without auth:", err);
        // Fallback: try unauthenticated (some executors don't require auth)
        signature = "0x" as `0x${string}`;
      }

      // Abort any previous stream
      if (abortRef.current) abortRef.current.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

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
          console.warn(`[SSE] HTTP ${response.status} — stream unavailable, result from receipt.`);
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
        // Don't set error — receipt fallback below handles this
      }
    },
    [walletClient],
  );

  // ─────────────────────────────────────────────────────────────────────────
  //  Main: submit audit — sends directly to LLM precompile 0x0802
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

        // ── Step 1: DIHAPUS — auditFee = 0, tidak perlu approve mRITUAL ─

        // Escape newlines and double quotes for JSON compatibility
        const escapedCode = JSON.stringify(contractCode).slice(1, -1);

        // ── Step 2: Call requestAudit on CodeAuditor Contract ──────────
        // Per Ritual docs: 0x0802 simulation fails on MetaMask (eth_call reverts).
        // To bypass this, call contract with a high manual gas limit (5,000,000).
        const data = encodeFunctionData({
          abi: CODE_AUDITOR_ABI,
          functionName: "requestAudit",
          args: [escapedCode, "0x0000000000000000000000000000000000000000"], // Use default executor on-chain
        });

        console.log("[Audit] Sending requestAudit tx to contract...");
        const auditTx = await sendTransactionAsync({
          to:      _auditorAddress,
          data,
          gas:     500_000n, // Lower manual gas limit to accommodate low user balance (estimate is ~250k)
          gasPrice: 1_500_000_000n, // Enforce 1.5 gwei gas price (Legacy tx type) to ensure inclusion
          chainId: ritualChain.id,
        });

        console.log("[Audit] Tx submitted:", auditTx);
        setState((prev) => ({
          ...prev,
          txHash: auditTx,
          phase:  "waiting",
        }));

        // ── Step 3: Wait for receipt and extract result as fallback ──────
        console.log("[Audit] Waiting for receipt...");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash:            auditTx,
          confirmations:   1,
          pollingInterval: 500,
          timeout:         120_000,
        });

        console.log("[Audit] Receipt received, status:", receipt.status);

        if (receipt.status === "reverted") {
          setState((prev) => ({
            ...prev,
            phase: "error",
            error: "Transaction reverted on-chain. Check contract RitualWallet balance and try again.",
          }));
          return;
        }

        // ── Step 4: Confirm transaction and initiate SSE streaming ──────
        setState((prev) => ({
          ...prev,
          phase: "streaming",
        }));
        openSseStream(auditTx); // stream concurrently

        // Extract result from PrecompileCalled event (settlement receipt)
        const llmResult = extractLLMResultFromReceipt(receipt);

        if (llmResult) {
          console.log("[Audit] LLM result found in receipt, decoding...");
          const { text, hasError, errorMessage } = decodeLLMContent(llmResult);

          if (hasError) {
            console.warn("[Audit] LLM error:", errorMessage);
            // Don't override stream — stream may already have text
            setState((prev) => {
              if (prev.phase === "complete" || prev.streamedText.length > 100) return prev;
              return {
                ...prev,
                phase: "error",
                error: `LLM inference error: ${errorMessage}`,
              };
            });
          } else if (text) {
            // Use receipt text only if stream didn't deliver content
            setState((prev) => {
              if (prev.streamedText.length > 50) return prev; // stream won
              return {
                ...prev,
                phase:         "complete",
                streamedText:  text,
                severityScore: parseSeverityScore(text),
              };
            });
          } else {
            // No content yet — commitment phase, stream should deliver
            console.log("[Audit] No content in receipt yet — stream delivering tokens...");
          }
        } else {
          // No PrecompileCalled event — tx is in commitment phase
          // Stream will deliver tokens as executor settles
          console.log("[Audit] No PrecompileCalled event — waiting for stream...");
          setState((prev) => {
            if (prev.phase === "streaming" || prev.phase === "complete") return prev;
            return { ...prev, phase: "streaming" };
          });
        }
      } catch (err: any) {
        console.error("[Audit] Error:", err);

        let errorMsg: string = err?.message ?? "Unknown error";

        // Parse common MetaMask / RPC errors
        if (errorMsg.includes("User rejected") || errorMsg.includes("user rejected")) {
          errorMsg = "Transaction rejected by user.";
        } else if (errorMsg.includes("insufficient funds") || errorMsg.includes("insufficient balance")) {
          errorMsg = "Insufficient RITUAL for gas fees.";
        } else if (errorMsg.includes("sender locked")) {
          errorMsg = "Previous audit still in progress. Please wait a few seconds and try again.";
        } else if (errorMsg.includes("insufficient wallet balance")) {
          errorMsg = "Contract RitualWallet balance too low. Please contact the dApp owner to top up.";
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
