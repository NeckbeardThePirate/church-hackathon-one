"use client";

import { useEffect, useRef, useState } from "react";

/** Ids present in the previous comma-separated key that are absent now. */
export function useIdsLeft(key: string): Set<string> {
  const previous = useRef<string | null>(null);
  const [left, setLeft] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const prior = previous.current;
    previous.current = key;
    if (prior === null) return;
    const now = new Set(key ? key.split(",") : []);
    const flipped = prior.split(",").filter((id) => id && !now.has(id));
    if (!flipped.length) return;
    setLeft(new Set(flipped));
    const timer = window.setTimeout(() => setLeft(new Set()), 1100);
    return () => window.clearTimeout(timer);
  }, [key]);

  return left;
}
