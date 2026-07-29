import { NextRequest, NextResponse } from "next/server";
import { ask } from "@/lib/anthropic";
import { CHAT_SYSTEM } from "@/lib/agents/prompts";
import { config } from "@/lib/config";
import { PERSONAS } from "@/lib/agents/personas";
import type { AgentId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { agentId, messages, symbol } = await req.json() as {
      agentId: AgentId; messages: { role: "user" | "assistant"; content: string }[]; symbol?: string;
    };
    const persona = PERSONAS[agentId];
    if (!persona) return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    const last = messages?.[messages.length - 1]?.content ?? "";

    if (!config.ai.enabled) {
      // Simulated reply keeps the desk usable without a key.
      const reply = `I'm ${persona.name}, ${persona.title}. ${simReply(agentId, last, symbol)}\n\n(Running in simulation mode — add an ANTHROPIC_API_KEY to hear the full analysis.)`;
      return NextResponse.json({ reply });
    }
    const convo = messages.map((m) => `${m.role === "user" ? "Client" : persona.name}: ${m.content}`).join("\n");
    const reply = await ask(
      CHAT_SYSTEM(agentId),
      `${symbol ? `The client is asking about ${symbol}. ` : ""}Continue this conversation as ${persona.name}.\n\n${convo}\n\n${persona.name}:`,
      900
    );
    return NextResponse.json({ reply });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed" }, { status: 500 });
  }
}

function simReply(agentId: string, q: string, symbol?: string): string {
  const s = symbol ? ` on ${symbol}` : "";
  const map: Record<string, string> = {
    researcher: `Here's how I'd frame the research${s}: I start from the business quality and the sector's secular direction, write a one-paragraph thesis, then name the catalysts that would prove it and the risks that would break it. Give me a ticker and I'll run a full note.`,
    risk: `On risk${s}: I care about volatility, beta, and the worst realistic drawdown before I care about upside. Tell me the name and I'll size it — conviction never overrides position size.`,
    debater: `Let's debate${s}. I'll make the strongest bull case, then the strongest bear case, and find the single crux the whole thesis rests on. Which name should we put on trial?`,
    tester: `For testing${s}: I backtest the plan against a simple buy-and-hold benchmark and report return, drawdown, and Sharpe with equal weight. Past results aren't future results — I'll always say so.`,
    optimizer: `For construction${s}: I turn conviction and risk into weights and share counts, capped so no single name or sector can sink the plan. Tell me your amount and risk budget and I'll build the book.`,
  };
  return map[agentId] ?? "How can I help?";
}
