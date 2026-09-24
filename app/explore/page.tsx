import { ExploreGrid } from "@/components/explore-grid";
import { parseFeaturedMints } from "@/lib/explore-order";
export const dynamic = "force-dynamic";
export default function ExplorePage(){return <main className="page shell"><div className="page-header"><div><div className="eyebrow">LIVE LAUNCHES</div><h1>EXPLORE<br /><span>TOPBLAST.</span></h1></div><p>Tokens registered with TopBlast. Market and reward figures use verified data. Featured placement is editorial, not a performance ranking.</p></div><ExploreGrid featuredMints={parseFeaturedMints(process.env.EXPLORE_FEATURED_MINTS)} /></main>}
