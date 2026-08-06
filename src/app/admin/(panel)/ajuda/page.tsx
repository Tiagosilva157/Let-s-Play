import { requireAdmin } from "@/lib/admin";
import { MANUAL } from "@/lib/manual";
import Manual from "./Manual";

export const metadata = { title: "Manual de uso — Let's Play" };

export default async function HelpPage() {
  await requireAdmin();
  return <Manual sections={MANUAL} />;
}
