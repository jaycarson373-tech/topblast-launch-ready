import { ExploreGrid } from "@/components/explore-grid";
import { parseFeaturedMints } from "@/lib/explore-order";
import { registeredFeaturedToken } from "@/lib/db/featured-token";
export const dynamic = "force-dynamic";
export default async function ExplorePage(){const registered = await registeredFeaturedToken(); const featured = parseFeaturedMints([process.env.EXPLORE_FEATURED_MINTS, registered].filter(Boolean).join(",")); return <main className="page shell"><div className="page-header"><div><div className="eyebrow">LIVE LAUNCHES</div><h1>EXPLORE<br /><span>TOPBLAST.</span></h1></div><p>Tokens registered with TopBlast. Market and reward figures use verified data. Featured placement is editorial, not a performance ranking.</p></div><ExploreGrid featuredMints={featured} /></main>}
