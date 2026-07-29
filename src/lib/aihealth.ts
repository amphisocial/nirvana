import { config } from "@/lib/config";
import { ask } from "@/lib/anthropic";

export interface AiHealth {
  ok: boolean;
  provider: string;
  model: string;
  detail: string;
}

// Does a minimal real completion so admin can see whether the model actually
// answers (vs. silently falling back to the simulation/curated list).
export async function aiHealth(): Promise<AiHealth> {
  const provider = config.ai.provider;
  const model = config.ai.model;
  if (!config.ai.enabled) return { ok: false, provider, model, detail: "no provider/key configured" };
  try {
    const r = await ask("You are a connectivity check.", 'Reply with exactly: OK', 16);
    if (!r) return { ok: false, provider, model, detail: "empty response (model returned no content — raise token budget or wrong model name)" };
    return { ok: /ok/i.test(r), provider, model, detail: `responded: "${r.slice(0, 40)}"` };
  } catch (e: any) {
    const msg = e?.error?.message || e?.message || "unknown error";
    return { ok: false, provider, model, detail: String(msg).slice(0, 160) };
  }
}
