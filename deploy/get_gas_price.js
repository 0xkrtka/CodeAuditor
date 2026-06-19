const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://rpc.ritualfoundation.org";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  try {
    const gasPrice = await provider.send("eth_gasPrice", []);
    console.log(`Current Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} gwei (${gasPrice} wei)`);
    
    const block = await provider.getBlock("latest");
    console.log(`Latest Block Gas Limit: ${block.gasLimit.toString()}`);
    console.log(`Latest Block Base Fee: ${block.baseFeePerGas ? ethers.formatUnits(block.baseFeePerGas, "gwei") : "None"} gwei`);
  } catch (err) {
    console.error("Error fetching gas price:", err);
  }
}

main().catch(console.error);
