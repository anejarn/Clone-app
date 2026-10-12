import type { Metadata } from "next";
import { HomePage } from "@/components/home/HomePage";

export const metadata: Metadata = { title: "Logements" };

export default function Page() {
  return <HomePage category="homes" />;
}
