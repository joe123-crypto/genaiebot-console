import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genaie Console",
  description: "Operate the Genaie WhatsApp bot: groups, campaigns, schedule and lines.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
