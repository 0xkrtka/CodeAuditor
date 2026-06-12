/**
 * Deploy MockRITUAL token + CodeAuditor contract to Ritual Chain (Chain ID 1979)
 * Usage:
 *   node deploy/deploy.js
 *
 * Requires PRIVATE_KEY env var (without 0x prefix)
 */

const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

// ── ABI & Bytecode embedded (compiled from Solidity) ──────────────────────────

// MockRITUAL Token — ERC-20 that mints 1,000,000 tokens to deployer
const MOCK_TOKEN_ABI = [
  "constructor(string name, string symbol)",
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
];

// Compiled bytecode for a minimal ERC-20 (OpenZeppelin-compatible)
// This is a self-contained MockERC20 bytecode (solc 0.8.20 optimized)
const MOCK_TOKEN_BYTECODE = "0x60806040523480156200001157600080fd5b5060405162001a7338038062001a7383398101604081905262000034916200026a565b81516200004990600390602085019062000113565b5080516200005f90600490602084019062000113565b505050620002f2565b828054620000769062000297565b90600052602060002090601f0160209004810192826200009a5760008555620000e5565b82601f10620000b557805160ff1916838001178555620000e5565b82800160010185558215620000e5579182015b82811115620000e5578251825591602001919060010190620000c8565b50620000f3929150620000f7565b5090565b5b80821115620000f35760008155600101620000f8565b634e487b7160e01b600052604160045260246000fd5b600082601f8301126200013557600080fd5b81516001600160401b03808211156200015257620001526200010e565b604051601f8301601f19908116603f011681019082821181831017156200017d576200017d6200010e565b816040528381526020925086838588010111156200019a57600080fd5b600091505b83821015620001be5785820183015181830184015290820190620001a0565b83821115620001d05760008385830101525b9695505050505050565b80516001600160a01b0381168114620001f257600080fd5b919050565b600080604083850312156200020b57600080fd5b82516001600160401b03808211156200022357600080fd5b620002318683870162000123565b935060208501519150808211156200024857600080fd5b50620002578582860162000123565b9150509250929050565b600080604083850312156200027f57600080fd5b82516001600160401b03808211156200029757600080fd5b620002a58683870162000123565b93506020850151915080821115620002bc57600080fd5b50620002cb8582860162000123565b9150509250929050565b600181811c90821680620002ea57607f821691505b6020821081036200030b57634e487b7160e01b600052602260045260246000fd5b50919050565b61177180620003216000396000f3fe";

// CodeAuditor ABI (functions we need for deploy)
const CODEAUDITOR_ABI = [
  "constructor(address paymentToken, uint256 auditFee, address defaultExecutor)",
  "function auditFee() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function paymentToken() external view returns (address)",
  "function defaultExecutor() external view returns (address)",
  "function depositForFees() external payable",
  "function requestAudit(string calldata contractCode, address executor) external returns (uint256 auditId, bytes32 jobId)",
];

// ── Compiled CodeAuditor bytecode ─────────────────────────────────────────────
// We'll compile it on-the-fly using solc if available, otherwise use pre-compiled
async function compileSolidity() {
  try {
    const solc = require("solc");
    const source = fs.readFileSync(
      path.join(__dirname, "../contracts/src/CodeAuditor.sol"),
      "utf8"
    );

    const input = {
      language: "Solidity",
      sources: { "CodeAuditor.sol": { content: source } },
      settings: {
        outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
        optimizer: { enabled: true, runs: 200 },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    if (output.errors) {
      const errors = output.errors.filter((e) => e.severity === "error");
      if (errors.length > 0) {
        throw new Error(errors.map((e) => e.message).join("\n"));
      }
    }

    const contract = output.contracts["CodeAuditor.sol"]["CodeAuditor"];
    return {
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
    };
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      throw new Error("solc not found. Run: npm install -g solc");
    }
    throw err;
  }
}

async function main() {
  // ── Config ────────────────────────────────────────────────────────────────
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    console.error("❌  ERROR: Set PRIVATE_KEY environment variable (without 0x)");
    console.error("   Example: $env:PRIVATE_KEY='your_private_key_here'");
    process.exit(1);
  }

  const RPC_URL   = "https://rpc.ritualfoundation.org";
  const CHAIN_ID  = 1979n;
  const AUDIT_FEE = ethers.parseEther("1"); // 1 RITUAL token per audit

  // ── Provider & Signer ─────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY.replace("0x", ""), provider);

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║     CodeAuditor — Ritual Chain Deploy      ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  // Verify chain
  const network = await provider.getNetwork();
  console.log(`🔗  Chain ID:   ${network.chainId}`);
  if (network.chainId !== CHAIN_ID) {
    console.error(`❌  Wrong chain! Expected 1979, got ${network.chainId}`);
    process.exit(1);
  }

  const balance = await provider.getBalance(wallet.address);
  console.log(`👛  Deployer:   ${wallet.address}`);
  console.log(`💰  Balance:    ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.001")) {
    console.error("❌  Insufficient balance! Get testnet ETH from https://faucet.ritualfoundation.org");
    process.exit(1);
  }

  // ── Step 1: Deploy MockRITUAL Token ───────────────────────────────────────
  console.log("\n📦  Step 1/2 — Deploying MockRITUAL Token...");

  // Use a simple pre-compiled mock ERC20
  // Compile the MockToken inline using solc
  let tokenAddress;
  try {
    const mockTokenSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MockRITUAL {
    string public name = "Mock RITUAL";
    string public symbol = "mRITUAL";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor() {
        _mint(msg.sender, 1_000_000 ether);
    }
    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}`;

    const solc = require("solc");
    const input = {
      language: "Solidity",
      sources: { "MockRITUAL.sol": { content: mockTokenSource } },
      settings: {
        outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
        optimizer: { enabled: true, runs: 200 },
      },
    };
    const out = JSON.parse(solc.compile(JSON.stringify(input)));
    const compiled = out.contracts["MockRITUAL.sol"]["MockRITUAL"];

    const tokenFactory = new ethers.ContractFactory(
      compiled.abi,
      "0x" + compiled.evm.bytecode.object,
      wallet
    );
    const tokenContract = await tokenFactory.deploy();
    await tokenContract.waitForDeployment();
    tokenAddress = await tokenContract.getAddress();
    console.log(`✅  MockRITUAL Token: ${tokenAddress}`);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      console.error("❌  solc not found. Installing...");
      process.exit(1);
    }
    throw err;
  }

  // ── Step 2: Deploy CodeAuditor ─────────────────────────────────────────────
  console.log("\n📦  Step 2/2 — Deploying CodeAuditor...");

  const codeAuditorSource = fs.readFileSync(
    path.join(__dirname, "../contracts/src/CodeAuditor.sol"),
    "utf8"
  );

  const solc = require("solc");
  const input = {
    language: "Solidity",
    sources: { "CodeAuditor.sol": { content: codeAuditorSource } },
    settings: {
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));

  if (out.errors) {
    const errs = out.errors.filter((e) => e.severity === "error");
    if (errs.length) {
      console.error("❌  Solidity compile errors:");
      errs.forEach((e) => console.error("  ", e.formattedMessage));
      process.exit(1);
    }
  }

  const compiled = out.contracts["CodeAuditor.sol"]["CodeAuditor"];
  const auditorFactory = new ethers.ContractFactory(
    compiled.abi,
    "0x" + compiled.evm.bytecode.object,
    wallet
  );

  // ── Executor address (address(0) = no default, pass on each call) ──────────
  // Use a known TEE executor or leave as 0x0 and pass per-call from frontend
  const DEFAULT_EXECUTOR = "0x0000000000000000000000000000000000000000";

  const auditorContract = await auditorFactory.deploy(tokenAddress, AUDIT_FEE, DEFAULT_EXECUTOR);
  await auditorContract.waitForDeployment();
  const auditorAddress = await auditorContract.getAddress();
  console.log(`✅  CodeAuditor:      ${auditorAddress}`);

  // ── Step 3: Deposit native RITUAL to fund executor fees ───────────────────
  // This puts RITUAL into RitualWallet ON BEHALF of the CodeAuditor contract.
  // Without this, LLM precompile calls revert with "insufficient fees".
  const nativeBal = await provider.getBalance(wallet.address);
  const toDeposit = nativeBal > ethers.parseEther("0.1")
    ? ethers.parseEther("0.05")   // deposit 0.05 RITUAL to start
    : 0n;

  if (toDeposit > 0n) {
    console.log(`\n💰  Step 3/3 — Depositing ${ethers.formatEther(toDeposit)} RITUAL to fund executor fees...`);
    const auditorWithSigner = new ethers.Contract(auditorAddress, CODEAUDITOR_ABI, wallet);
    const depositTx = await auditorWithSigner.depositForFees({ value: toDeposit });
    await depositTx.wait();
    console.log(`✅  Executor fees funded!`);
  } else {
    console.log(`\n⚠️   Low balance — skipping depositForFees. Fund manually after deploy.`);
  }

  // ── Write .env.local ───────────────────────────────────────────────────────
  const envPath = path.join(__dirname, "../.env.local");
  const envContent = [
    `# Auto-generated by deploy.js on ${new Date().toISOString()}`,
    `NEXT_PUBLIC_AUDITOR_ADDRESS=${auditorAddress}`,
    `NEXT_PUBLIC_PAYMENT_TOKEN=${tokenAddress}`,
    `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`,
  ].join("\n");

  fs.writeFileSync(envPath, envContent + "\n");

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║           ✅  DEPLOYMENT COMPLETE           ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`  CodeAuditor:   ${auditorAddress}`);
  console.log(`  Payment Token: ${tokenAddress}`);
  console.log(`  Audit Fee:     ${ethers.formatEther(AUDIT_FEE)} mRITUAL`);
  console.log(`  Executor:      ${DEFAULT_EXECUTOR} (pass per-call from frontend)`);
  console.log(`  Explorer:      https://explorer.ritualfoundation.org/address/${auditorAddress}`);
  console.log(`\n  📝 .env.local has been written automatically!`);
  console.log(`\n  ▶️  Next step: npm run dev\n`);
  console.log(`\n  ℹ️  To fund executor fees later, call: node deploy/fund.js\n`);
}

main().catch((err) => {
  console.error("\n❌  Deploy failed:", err.message);
  process.exit(1);
});
