import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "WhispeRM",
  description: "CRM frontend foundation for WhispeRM.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${inter.variable} font-sans`}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
