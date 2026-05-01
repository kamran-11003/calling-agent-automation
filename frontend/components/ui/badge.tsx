"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "hot" | "warm" | "cold" | "outline";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        {
          "bg-zinc-700 text-zinc-100": variant === "default",
          "bg-red-500/20 text-red-400 border border-red-500/30": variant === "hot",
          "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30": variant === "warm",
          "bg-zinc-700/50 text-zinc-400 border border-zinc-600": variant === "cold",
          "border border-zinc-700 text-zinc-300 bg-transparent": variant === "outline",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
