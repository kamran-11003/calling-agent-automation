"use client";

import CallLogDashboard from "@/components/CallLogDashboard";
import { Button } from "@/components/ui/button";
import { PhoneCall, Bot, LayoutDashboard } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <PhoneCall className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="font-bold text-zinc-100">VoiceFlow</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-xs">
              <Bot className="h-3.5 w-3.5" />
              Agents
            </Button>
          </Link>
          <Link href="/campaigns">
            <Button variant="ghost" size="sm" className="text-xs">
              <PhoneCall className="h-3.5 w-3.5" />
              Campaigns
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="text-xs bg-zinc-800">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Button>
          </Link>
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        <CallLogDashboard />
      </div>
    </div>
  );
}
