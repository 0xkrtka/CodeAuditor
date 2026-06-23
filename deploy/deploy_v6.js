/**
 * Deploy CodeAuditor V6 to Ritual Chain
 * 
 * V6 changes:
 *   - transferFrom guarded by auditFee > 0 check (free audit mode)
 *   - Executor passed as param or uses defaultExecutor
 *   - Sets defaultExecutor to known active TEE node
 *   - Funds RitualWallet for the contract
 *   - auditFee set to 0 (free)
 * 
 * Usage:
 *   $env:PRIVATE_KEY="your_key_here"; node deploy/deploy_v6.js
 */

const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const RPC_URL  = "https://rpc.ritualfoundation.org";
const CHAIN_ID = 1979n;

// Known active TEE executor (500k+ txs, 20M+ RITUAL balance)
const DEFAULT_EXECUTOR = "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B";

// Existing mRITUAL token (reuse — no need to redeploy)
const EXISTING_TOKEN = "0x26c11EB567BB83d2B031af41188ECA7872CaAF07";

async function compileSolidity() {
  let solc;
  try {
    solc = require("solc");
  } catch (e) {
    throw new Error("solc not found. Run: npm install solc");
  }

  const source = fs.readFileSync(
    path.join(__dirname, "../contracts/src/CodeAuditor.sol"),
    "utf8"
  );

  console.log("📝  Compiling CodeAuditor v6...");
  const input = {
    language: "Solidity",
    sources:  { "CodeAuditor.sol": { content: source } },
    settings: {
      outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } },
      optimizer:       { enabled: true, runs: 200 },
      evmVersion:      "london",
      viaIR:           true,
    },
  };


  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const errs  = output.errors.filter((e) => e.severity === "error");
    const warns = output.errors.filter((e) => e.severity === "warning");
    if (warns.length) {
      warns.forEach((w) => console.warn("  ⚠️ ", w.formattedMessage?.split("\n")[0]));
    }
    if (errs.length) {
      console.error("❌  Compile errors:");
      errs.forEach((e) => console.error("  ", e.formattedMessage));
      process.exit(1);
    }
  }

  const contract = output.contracts["CodeAuditor.sol"]["CodeAuditor"];
  if (!contract) {
    throw new Error("CodeAuditor contract not found in compiler output");
  }

  const byteLen = contract.evm.bytecode.object.length / 2;
  console.log(`✅  Compiled! Bytecode size: ${byteLen} bytes`);
  return {
    abi:      contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };
}

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var");
    console.error('   Example: $env:PRIVATE_KEY="your_private_key_here"');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   CodeAuditor V6 — Ritual Chain Deployment   ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Verify chain
  const network = await provider.getNetwork();
  console.log(`🔗  Chain ID:   ${network.chainId}`);
  if (network.chainId !== CHAIN_ID) {
    console.error(`❌  Wrong chain! Expected 1979, got ${network.chainId}`);
    process.exit(1);
  }

  const balance = await provider.getBalance(wallet.address);
  console.log(`👛  Deployer:   ${wallet.address}`);
  console.log(`💰  Balance:    ${ethers.formatEther(balance)} RITUAL`);

  if (balance < ethers.parseEther("0.1")) {
    console.error("❌  Need at least 0.1 RITUAL (for deploy + funding)");
    console.error("   Get from: https://faucet.ritualfoundation.org");
    process.exit(1);
  }

  // Compile
  const { abi, bytecode } = await compileSolidity();

  // Deploy CodeAuditor V6
  console.log("\n📦  Deploying CodeAuditor V6...");
  console.log(`   Payment token:    ${EXISTING_TOKEN}`);
  console.log(`   Audit fee:        0 (FREE)`);
  console.log(`   Default executor: ${DEFAULT_EXECUTOR}`);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(
    EXISTING_TOKEN,    // paymentToken (reuse existing mRITUAL)
    0n,                // auditFee = 0 (free audit)
    DEFAULT_EXECUTOR,  // defaultExecutor = known active TEE node
    {
      gasLimit: 3_000_000n,
      gasPrice: 1_500_000_000n,
    }
  );

  console.log(`   Deploy tx hash: ${contract.deploymentTransaction()?.hash}`);
  console.log("   Waiting for confirmation...");

  await contract.waitForDeployment();
  const auditorAddress = await contract.getAddress();

  console.log(`✅  CodeAuditor V6 deployed: ${auditorAddress}`);
  console.log(`   Explorer: https://explorer.ritualfoundation.org/address/${auditorAddress}`);

  // Fund the contract's RitualWallet escrow
  console.log("\n💰  Funding contract RitualWallet for executor escrow...");
  const ritualWalletABI = [
    "function balanceOf(address) view returns (uint256)",
    "function lockUntil(address) view returns (uint256)",
  ];
  const ritualWallet = new ethers.Contract(
    "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
    ritualWalletABI,
    provider
  );

  const depositAmount = ethers.parseEther("0.3"); // 0.3 RITUAL for escrow
  console.log(`   Depositing ${ethers.formatEther(depositAmount)} RITUAL via depositForFees()...`);

  const auditorContract = new ethers.Contract(auditorAddress, abi, wallet);
  const depositTx = await auditorContract.depositForFees({
    value:    depositAmount,
    gasLimit: 300_000n,
    gasPrice: 1_500_000_000n,
  });
  console.log(`   Deposit tx: ${depositTx.hash}`);
  const depositReceipt = await depositTx.wait();
  console.log(`   ✅  Funded! Status: ${depositReceipt.status === 1 ? "SUCCESS" : "FAILED"}`);

  // Verify RitualWallet balance for the contract
  const contractWalletBal = await ritualWallet.balanceOf(auditorAddress);
  console.log(`   Contract RitualWallet balance: ${ethers.formatEther(contractWalletBal)} RITUAL`);

  // Verify executor is set
  const executor = await auditorContract.defaultExecutor();
  console.log(`   Default executor: ${executor}`);

  const fee = await auditorContract.auditFee();
  console.log(`   Audit fee: ${ethers.formatEther(fee)} (${fee === 0n ? "FREE ✅" : "PAID"})`);

  // Update .env.local
  const envPath = path.join(__dirname, "../.env.local");
  const envContent = [
    `# Auto-generated by deploy_v6.js on ${new Date().toISOString()}`,
    `NEXT_PUBLIC_AUDITOR_ADDRESS=${auditorAddress}`,
    `NEXT_PUBLIC_PAYMENT_TOKEN=${EXISTING_TOKEN}`,
    `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`,
  ].join("\n");

  fs.writeFileSync(envPath, envContent + "\n");
  console.log(`\n📝  .env.local updated!`);

  // Final summary
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║          ✅  DEPLOYMENT COMPLETE!             ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  CodeAuditor V6:  ${auditorAddress}`);
  console.log(`  Payment Token:   ${EXISTING_TOKEN}`);
  console.log(`  Audit Fee:       FREE (0)`);
  console.log(`  Executor:        ${executor}`);
  console.log(`  Wallet Balance:  ${ethers.formatEther(contractWalletBal)} RITUAL`);
  console.log(`\n  ▶️  Next step: npm run dev`);
  console.log(`  🔗  Explorer: https://explorer.ritualfoundation.org/address/${auditorAddress}\n`);
}

main().catch((err) => {
  console.error("\n❌  Deploy failed:", err.message || err);
  if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
});
