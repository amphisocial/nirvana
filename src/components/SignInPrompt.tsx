"use client";
import { signIn } from "next-auth/react";
export function SignInPrompt({ label = "Sign in with Google", callbackUrl }: { label?: string; callbackUrl?: string }) {
  return (
    <button onClick={() => signIn("google", callbackUrl ? { callbackUrl } : undefined)} className="btn-brass">
      {label}
    </button>
  );
}
