// Unified LLM client. Routes to Anthropic, OpenAI, or Gemini based on
// config.ai.provider (resolved from AI_PROVIDER / available keys). Keeps the
// same ask/askJson surface the orchestrator and chat route already use.
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

export async function ask(
  system: string,
  user: string,
  maxTokens = 1400,
  opts: { json?: boolean } = {}
): Promise<string> {
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
    const res = await getOpenAI().chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    });
    return (res.choices[0]?.message?.content ?? "").trim();
  }

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.keys.gemini}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "").trim();
  }

  throw new Error("AI disabled");
}

// Ask for JSON only and parse it robustly across providers.
export async function askJson<T>(system: string, user: string, maxTokens = 2000): Promise<T> {
  const text = await ask(
    system + "\n\nRespond with ONLY valid minified JSON. No prose, no markdown, no code fences.",
    user,
    maxTokens,
    { json: true }
  );
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  const from = startArr >= 0 && (startArr < start || start < 0) ? startArr : start;
  return JSON.parse(from >= 0 ? cleaned.slice(from) : cleaned) as T;
}
