import { TokenPage } from "@/components/token-page";
export default async function Page({ params }: { params: Promise<{ address: string }> }) { const { address } = await params; return <TokenPage address={address} />; }
