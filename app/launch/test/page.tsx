import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = { title: "Controlled test launch | TopBlast", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function TestLaunchPage() {
  if (process.env.LAUNCHES_ENABLED === "true") notFound();
  redirect("/launch");
}
