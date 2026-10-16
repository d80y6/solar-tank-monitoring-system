import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Contact | FTM",
  description:
    "FTM operational contact access has moved to the dashboard area.",
};

export default function ContactRedirectPage() {
  redirect("/dashboard/contact");
}
