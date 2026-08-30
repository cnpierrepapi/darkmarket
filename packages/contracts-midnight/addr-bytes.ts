import { MidnightBech32m } from "@midnightntwrk/wallet-sdk-address-format";
const addrs = [
  ["unshielded p0", "mn_addr_preprod1rskenxg9smg5z3995a3kexmynwzq3a3kkwn5dpgzxvpur7elwtdqwgsp4f"],
  ["dust p0", "mn_dust_preprod1wdpr9q464mw98lxc3y7yzhn5dhzuzyw7w4qvxkzap6ghjfezvv94cey8r35"],
];
for (const [label, a] of addrs) {
  try {
    const p = MidnightBech32m.parse(a);
    console.log(`${label}: type=${p.type} network=${p.network} dataBytes=${p.data.length}`);
  } catch (e: any) { console.log(`${label}: parse failed ${String(e?.message).slice(0,80)}`); }
}
