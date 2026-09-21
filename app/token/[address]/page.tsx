import { TokenPage } from "@/components/token-page";
import { requirePublicLaunch } from "@/lib/db/public-launch";
export default async function Page({ params }: { params: Promise<{ address: string }> }) { const { address } = await params; await requirePublicLaunch(address); return <TokenPage address={address} />; }
