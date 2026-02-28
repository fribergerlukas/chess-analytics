"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./AuthContext";
import { UserProvider } from "./UserContext";
import Sidebar from "./Sidebar";
import BackgroundPreloader from "./BackgroundPreloader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <title>Chess Arena</title>
        <meta name="description" content="Chess game statistics dashboard" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <UserProvider>
            <Sidebar />
            <BackgroundPreloader />
            <div style={{ marginLeft: 230 }}>{children}</div>
          </UserProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
