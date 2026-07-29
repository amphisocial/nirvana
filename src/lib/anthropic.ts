import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.ai.enabled) return null;
  if (!client) client = new Anthropic({ apiKey: config.ai.key });
  return client;
}

// Ask Claude with a system prompt; return raw text.
export async function ask(
  system: string,
  user: string,
  maxTokens = 1400
): Promise<string> {
  const c = getClient();
  if (!c) throw new Error("AI disabled");
  const res = await c.messages.create({
    model: config.ai.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

// Ask Claude for JSON only and parse it robustly.
export async function askJson<T>(
  system: string,
  user: string,
  maxTokens = 2000
): Promise<T> {
  const text = await ask(
    system +
      "\n\nRespond with ONLY valid minified JSON. No prose, no markdown, no code fences.",
    user,
    maxTokens
  );
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  const from =
    startArr >= 0 && (startArr < start || start < 0) ? startArr : start;
  const body = from >= 0 ? cleaned.slice(from) : cleaned;
  return JSON.parse(body) as T;
}
