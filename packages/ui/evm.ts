// The Polygon leg.
//
// When a Midnight epoch closes, whatever the pool could not match internally
// still needs a counterparty in the open market. This sends that residual to
// the vault on Polygon, carrying the epoch and conditionId it came from, so a
// reader can line the settlement up against Midnight's public ledger.
//
// Defaults to Amoy, because a settlement nobody can look up is not much of a
// settlement.

import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";

export const VAULT_ABI = parseAbi([
  "function settleResidual(uint64 epoch, bytes32 conditionId, uint8 side, uint256 size, uint256 crossed)",
  "function totalDeposits() view returns (uint256)",
  "function committed() view returns (uint256)",
  "function freeCollateral() view returns (uint256)",
  "function epochSettled(uint64) view returns (bool)",
]);

export type EvmConfig = {
  rpcUrl: string;
  vault: `0x${string}`;
  privateKey: `0x${string}`;
  explorer: string;
};

export const evmConfig = (): EvmConfig | null => {
  const vault = process.env.EVM_VAULT_ADDRESS as `0x${string}` | undefined;
  const privateKey = process.env.EVM_EXECUTOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!vault || !privateKey) return null;
  return {
    rpcUrl: process.env.EVM_RPC_URL ?? "https://polygon-amoy-bor-rpc.publicnode.com",
    vault,
    privateKey,
    explorer: process.env.EVM_EXPLORER ?? "https://amoy.polygonscan.com",
  };
};

/**
 * Midnight counts in whole units; Polygon counts in wei. The scale is
 * configurable because a testnet faucet hands out a fraction of a POL, and a
 * demo epoch has to settle inside that. At 1e13 a 500 unit residual costs
 * 0.005 POL, which a single faucet drip covers many times over.
 */
const UNIT = BigInt(process.env.EVM_UNIT_WEI ?? "10000000000000"); // 1e13

export type SettleResult = {
  txHash: string;
  explorerUrl: string;
  side: "YES" | "NO";
  size: string;
  crossed: string;
};

export async function settleOnPolygon(args: {
  epoch: number;
  conditionId: string;
  side: "YES" | "NO";
  size: bigint;
  crossed: bigint;
}): Promise<SettleResult> {
  const cfg = evmConfig();
  if (!cfg) throw new Error("no EVM_VAULT_ADDRESS / EVM_EXECUTOR_PRIVATE_KEY");

  const account = privateKeyToAccount(cfg.privateKey);
  const transport = http(cfg.rpcUrl);
  const wallet = createWalletClient({ account, chain: polygonAmoy, transport });
  const pub = createPublicClient({ chain: polygonAmoy, transport });

  const sizeWei = args.size * UNIT;
  const crossedWei = args.crossed * UNIT;

  // A fully crossed epoch sends nothing: there is no residual, so nothing
  // should be committed on this side either.
  if (sizeWei === 0n) throw new Error("epoch fully crossed, nothing to settle");

  const free = (await pub.readContract({
    address: cfg.vault,
    abi: VAULT_ABI,
    functionName: "freeCollateral",
  })) as bigint;
  if (sizeWei > free) {
    throw new Error(`residual ${sizeWei} exceeds free collateral ${free}; deposit more`);
  }

  // The deployed vault keys settlements on the epoch number alone, so each
  // cover has to pass a number nobody has used yet. The caller supplies it.
  const already = (await pub.readContract({
    address: cfg.vault,
    abi: VAULT_ABI,
    functionName: "epochSettled",
    args: [BigInt(args.epoch)],
  })) as boolean;
  if (already) throw new Error(`settlement slot ${args.epoch} is already used`);

  const txHash = await wallet.writeContract({
    address: cfg.vault,
    abi: VAULT_ABI,
    functionName: "settleResidual",
    args: [
      BigInt(args.epoch),
      args.conditionId as `0x${string}`,
      args.side === "YES" ? 0 : 1,
      sizeWei,
      crossedWei,
    ],
  });

  await pub.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    explorerUrl: `${cfg.explorer}/tx/${txHash}`,
    side: args.side,
    size: sizeWei.toString(),
    crossed: crossedWei.toString(),
  };
}
