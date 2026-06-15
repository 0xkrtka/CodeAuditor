/**
 * Test sending directly to LLM precompile 0x0802 on Ritual Chain
 * using a real private key — bypassing MetaMask completely.
 * Usage: $env:PRIVATE_KEY="your_key_here"; node deploy/test_precompile.js
 */
const { ethers, AbiCoder, toBeHex } = require("ethers");

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌ Set PRIVATE_KEY env var (without 0x prefix)");
    process.exit(1);
  }

  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  console.log("Wallet address:", wallet.address);
  console.log("Balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "RITUAL");

  // Build a minimal prompt
  const messagesJson = JSON.stringify([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user",   content: "Say hello in one word." },
  ]);

  const EXECUTOR     = "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B";
  const LLM_PRECOMPILE = "0x0000000000000000000000000000000000000802";

  // Encode the 30-field ABI tuple
  const abiCoder = AbiCoder.defaultAbiCoder();
  const payload = abiCoder.encode(
    [
      "address",    // (1)  executor
      "bytes[]",    // (2)  encryptedSecrets
      "uint256",    // (3)  ttl
      "bytes[]",    // (4)  secretSignatures
      "bytes",      // (5)  userPublicKey
      "string",     // (6)  messagesJson
      "string",     // (7)  model
      "int256",     // (8)  frequencyPenalty
      "string",     // (9)  logitBiasJson
      "bool",       // (10) logprobs
      "int256",     // (11) maxCompletionTokens
      "string",     // (12) metadataJson
      "string",     // (13) modalitiesJson
      "uint256",    // (14) n
      "bool",       // (15) parallelToolCalls
      "int256",     // (16) presencePenalty
      "string",     // (17) reasoningEffort
      "bytes",      // (18) responseFormatData
      "int256",     // (19) seed
      "string",     // (20) serviceTier
      "string",     // (21) stopJson
      "bool",       // (22) stream
      "uint256",    // (23) temperature
      "bytes",      // (24) toolChoiceData
      "bytes",      // (25) toolsData
      "int256",     // (26) topLogprobs
      "uint256",    // (27) topP
      "string",     // (28) user
      "bool",       // (29) piiEnabled
      "tuple(string,string,string)", // (30) convoHistory StorageRef
    ],
    [
      EXECUTOR,             // (1)
      [],                   // (2)
      300n,                 // (3)
      [],                   // (4)
      "0x",                 // (5)
      messagesJson,         // (6)
      "zai-org/GLM-4.7-FP8",// (7)
      0n,                   // (8)
      "",                   // (9)
      false,                // (10)
      4096n,                // (11)
      "",                   // (12)
      "",                   // (13)
      1n,                   // (14)
      true,                 // (15)
      0n,                   // (16)
      "medium",             // (17)
      "0x",                 // (18)
      -1n,                  // (19)
      "auto",               // (20)
      "",                   // (21)
      true,                 // (22) stream=true
      700n,                 // (23)
      "0x",                 // (24)
      "0x",                 // (25)
      -1n,                  // (26)
      1000n,                // (27)
      "",                   // (28)
      false,                // (29)
      ["", "", ""],         // (30)
    ]
  );

  console.log("\nPayload length:", payload.length, "bytes");
  console.log("First 64 chars:", payload.slice(0, 66));

  // Try eth_call first (dry-run without spending gas)
  console.log("\n--- eth_call dry run ---");
  try {
    const result = await provider.call({
      to:   LLM_PRECOMPILE,
      data: payload,
      from: wallet.address,
    });
    console.log("eth_call result:", result.slice(0, 66), "...");
  } catch (err) {
    console.log("eth_call error (expected for async precompile):", err.message.slice(0, 200));
  }

  // Try eth_estimateGas
  console.log("\n--- eth_estimateGas ---");
  try {
    const gas = await provider.estimateGas({
      to:   LLM_PRECOMPILE,
      data: payload,
      from: wallet.address,
    });
    console.log("Gas estimate:", gas.toString());
  } catch (err) {
    console.log("estimateGas error:", err.message.slice(0, 300));
  }

  // Now actually send the transaction
  console.log("\n--- sendTransaction ---");
  try {
    const tx = await wallet.sendTransaction({
      to:       LLM_PRECOMPILE,
      data:     payload,
      gasLimit: 3_000_000n,
    });
    console.log("✅ TX SENT! Hash:", tx.hash);
    console.log("Waiting for receipt...");
    const receipt = await tx.wait(1);
    console.log("Receipt status:", receipt.status);
    console.log("Block number:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());
    console.log("Logs count:", receipt.logs.length);
  } catch (err) {
    console.error("❌ sendTransaction failed:", err.message.slice(0, 500));
  }
}

main().catch(console.error);
