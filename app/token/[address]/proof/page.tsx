import { ProofPage } from "@/components/proof-page";
export default async function Page({ params }: { params: Promise<{ address: string }> }) { const { address } = await params; return <ProofPage address={address} />; }
