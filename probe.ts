import {
  createConstructorContext, createCircuitContext, emptyZswapLocalState, DUMMY_ADDRESS,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits } from "./contract/index.js";

const COIN_PK = "0".repeat(64);
const bytes = (n: number, s: number) => new Uint8Array(Array.from({length:n},(_,i)=>(s*31+i)%251));

const contract = new Contract({});
const init = await contract.initialState(createConstructorContext({}, COIN_PK));
const ctx: any = createCircuitContext("commit_intent", DUMMY_ADDRESS, emptyZswapLocalState(COIN_PK), init.currentContractState, init.currentPrivateState);

const c = pureCircuits.intent_commitment(true, 500n, bytes(32,1));
contract.impureCircuits.commit_intent(ctx, bytes(64,7), c);

const dump = (label: string, o: any) => {
  console.log(label, "keys:", Object.keys(o ?? {}));
  for (const k of Object.keys(o ?? {})) {
    const v = o[k];
    console.log("   ", k, "->", v?.constructor?.name, v && typeof v === "object" ? Object.keys(v).slice(0,10) : v);
  }
};
dump("contractStates", ctx.contractStates);
dump("queryContexts", ctx.queryContexts);

for (const k of Object.keys(ctx.contractStates ?? {})) {
  try { console.log("ledger(contractStates."+k+"):", ledger(ctx.contractStates[k])); }
  catch (e:any) { console.log("  fail:", e.message.slice(0,90)); }
}
for (const k of Object.keys(ctx.queryContexts ?? {})) {
  const v = ctx.queryContexts[k];
  for (const sub of ["state","currentState"]) {
    try { console.log(`ledger(queryContexts.${k}.${sub}):`, ledger(v[sub])); } catch(e:any){}
  }
}
