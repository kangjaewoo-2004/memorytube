import type { Metadata } from "next";

import { Header } from "@/components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemoryTube",
  description: "Save, summarize, and ask questions about YouTube videos."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
