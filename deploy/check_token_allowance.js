const { ethers } = require("ethers");

async function main() {
  const user = "0xe1e8BD93279529831b789133BD76e7c30D54d200";
  const AUDITOR = "0x8a0237E3eDD7df869948E8e975801eB7d04ddBAa";
  const TOKEN = "0x26c11EB567BB83d2B031af41188ECA7872CaAF07";
  const RPC_URL = "https://rpc.ritualfoundation.org";
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const token = new ethers.Contract(TOKEN, [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ], provider);

  console.log(`👤 Checking user: ${user}`);
  try {
    const balance = await token.balanceOf(user);
    const allowance = await token.allowance(user, AUDITOR);
    console.log(`🪙 mRITUAL Balance:   ${ethers.formatEther(balance)} mRITUAL`);
    console.log(`📝 mRITUAL Allowance: ${ethers.formatEther(allowance)} mRITUAL`);
  } catch (err) {
    console.error("Error:", err);
  }
}

main().catch(console.error);
