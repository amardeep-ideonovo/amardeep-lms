"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

// Entry point: route to dashboard if authed, otherwise login.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? "/dashboard" : "/login");
  }, [router]);
  return (
    <div className="dark-page">
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    </div>
  );
}
