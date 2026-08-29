import { buildModule } from "@nomicfoundation/ignition-core";

export default buildModule("DarkPoolVaultModule", (m) => {
  // The executor is whoever relays a closed Midnight epoch. Defaults to the
  // deployer so a local run needs no configuration; on a real network it is
  // set to the backend's own address after deploy.
  const executor = m.getParameter("executor", m.getAccount(0));
  const contract = m.contract("DarkPoolVault", [executor]);
  return { contract };
});
