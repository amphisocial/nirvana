// Unified LLM client. Routes to Anthropic, OpenAI, or Gemini based on
// config.ai.provider. Keeps the same ask/askJson surface used everywhere.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "@/lib/config";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: config.ai.keys.anthropic });
  return anthropicClient;
}
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: config.ai.keys.openai });
  return openaiClient;
}

// Newer OpenAI models (gpt-5*, o1/o3/o4*) use max_completion_tokens and count
// reasoning against it, so they need headroom — and they reject max_tokens.
function isNewGenOpenAI(model: string): boolean {
  return /^(gpt-5|o1|o3|o4|gpt-4\.1)/i.test(model);
}

async function openaiCreate(model: string, system: string, user: string, maxTokens: number, json: boolean): Promise<string> {
  const client = getOpenAI();
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const newGen = isNewGenOpenAI(model);
  const base: any = { model, messages };
  if (json) base.response_format = { type: "json_object" };

  // Give reasoning-capable models real output headroom.
  const primary = newGen
    ? { ...base, max_completion_tokens: Math.max(maxTokens, 6000) }
    : { ...base, max_tokens: maxTokens };

  try {
    const res = await client.chat.completions.create(primary);
    return (res.choices?.[0]?.message?.content ?? "").trim();
  } catch (err: any) {
    // If the token param (or temperature) was the problem, retry the other way.
    const msg = String(err?.message || err?.error?.message || "");
    if (/max_tokens|max_completion_tokens|unsupported|temperature|not supported/i.test(msg)) {
      const alt: any = { ...base };
      if (newGen) alt.max_tokens = maxTokens;
      else alt.max_completion_tokens = Math.max(maxTokens, 6000);
      const res = await client.chat.completions.create(alt);
      return (res.choices?.[0]?.message?.content ?? "").trim();
    }
    throw err;
  }
}

export async function ask(system: string, user: string, maxTokens = 1400, opts: { json?: boolean } = {}): Promise<string> {
  const { provider, model } = config.ai;
  if (!config.ai.enabled) throw new Error("AI disabled");

  if (provider === "anthropic") {
    const res = await getAnthropic().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  }

  if (provider === "openai") {
    return openaiCreate(model, system, user, maxTokens, Boolean(opts.json));
  }

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.keys.gemini}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: Math.max(maxTokens, 4000), ...(opts.json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "").trim();
  }

  throw new Error("AI disabled");
}

export async function askJson<T>(system: string, user: string, maxTokens = 2000): Promise<T> {
  const text = await ask(
    system + "\n\nRespond with ONLY valid minified JSON. No prose, no markdown, no code fences.",
    user,
    maxTokens,
    { json: true }
  );
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!cleaned) throw new Error("Empty LLM response");
  const start = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  const from = startArr >= 0 && (startArr < start || start < 0) ? startArr : start;
  return JSON.parse(from >= 0 ? cleaned.slice(from) : cleaned) as T;
}
