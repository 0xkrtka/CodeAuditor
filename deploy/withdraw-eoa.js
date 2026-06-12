/**
 * withdraw-eoa.js — Tarik RITUAL dari RitualWallet milik EOA
 *
 * Jalankan setelah block 32,670,827 (sekitar 11 hari dari sekarang).
 * Cek block saat ini: https://explorer.ritualfoundation.org
 *
 * Usage:
 *   $env:PRIVATE_KEY="your_key_here"; node deploy/withdraw-eoa.js
 */

const { ethers } = require("ethers");

const RPC_URL       = "https://rpc.ritualfoundation.org";
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
const LOCK_BLOCK    = 32_670_827n; // EOA's lockUntil block

const RW_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function lockUntil(address) view returns (uint256)",
  "function withdraw(uint256 amount) external",
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("❌  Set PRIVATE_KEY env var first");
    console.error("    $env:PRIVATE_KEY='your_key'; node deploy/withdraw-eoa.js");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY.replace("0x", ""), provider);
  const rw       = new ethers.Contract(RITUAL_WALLET, RW_ABI, wallet);

  const curBlock = BigInt(await provider.getBlockNumber());
  const balance  = await rw.balanceOf(wallet.address);
  const lock     = await rw.lockUntil(wallet.address);

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║    RitualWallet — EOA Withdraw Script     ║");
  console.log("╚═══════════════════════════════════════════╝\n");
  console.log(`👛  EOA:           ${wallet.address}`);
  console.log(`💰  RW Balance:    ${ethers.formatEther(balance)} RITUAL`);
  console.log(`🔒  Lock Until:    Block ${lock.toString()}`);
  console.log(`📦  Current Block: ${curBlock.toString()}`);

  if (balance === 0n) {
    console.log("\n✅  Balance is 0 — nothing to withdraw.");
    return;
  }

  if (curBlock < lock) {
    const remaining = lock - curBlock;
    const days      = (Number(remaining) / 86400).toFixed(1);
    console.log(`\n⏳  Lock NOT expired yet!`);
    console.log(`    Blocks remaining: ${remaining.toString()} (~${days} days)`);
    console.log(`    Come back at block ${lock.toString()}`);
    console.log(`\n    Check current block: https://explorer.ritualfoundation.org`);
    process.exit(0);
  }

  console.log(`\n🔓  Lock expired! Withdrawing ${ethers.formatEther(balance)} RITUAL...`);

  try {
    const tx = await rw.withdraw(balance, { gasLimit: 200_000n });
    console.log(`📤  Tx sent: ${tx.hash}`);
    console.log(`    https://explorer.ritualfoundation.org/tx/${tx.hash}`);
    await tx.wait();

    const newBal = await provider.getBalance(wallet.address);
    console.log(`\n✅  Withdraw berhasil!`);
    console.log(`    EOA Balance sekarang: ${ethers.formatEther(newBal)} RITUAL`);
  } catch (e) {
    console.error("❌  Withdraw failed:", e.message);
  }
}

main().catch(e => console.error(e));
