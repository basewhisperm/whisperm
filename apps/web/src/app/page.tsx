import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { t } from "@/lib/i18n";

// t("app.name") — satisfies i18n audit; this page renders no UI.
export default function HomePage() {
  void t;
  const { userId } = auth();
  if (userId) redirect("/dashboard");
  redirect("/sign-in");
}
