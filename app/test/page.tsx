import type { Metadata } from "next";
import { Rehearsal } from "@/components/rehearsal";

export const metadata: Metadata = { title: "Test TopBlast", robots: { index: false, follow: false } };

export default function TestPage() {
  return <main className="page shell">
    <div className="page-header"><div><div className="eyebrow">STONKFUN + PUMP.FUN TEST CENTER</div><h1>TEST THE LOOP.<br /><span>NO FUNDS NEEDED.</span></h1></div><p>Try TopBlast’s real position and reward calculations with fictional tokens. No wallet, payment, token creation, or database setup required.</p></div>
    <Rehearsal />
  </main>;
}
