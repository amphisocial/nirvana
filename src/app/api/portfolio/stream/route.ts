import { NextRequest } from "next/server";
import { runFirmStream } from "@/lib/agents/orchestrator";
import type { Answers, PortfolioRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streams the firm's work as newline-delimited JSON. Each line is one stage
// event; the final line carries the full portfolio record.
export async function POST(req: NextRequest) {
  const { answers } = (await req.json()) as { answers: Answers };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: unknown) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        if (!answers?.amount) throw new Error("Missing amount");
        const result = await runFirmStream(answers, emit);
        const id = Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
        const record: PortfolioRecord = {
          id,
          createdAt: new Date().toISOString(),
          answers,
          allocation: result.allocation,
          backtest: result.backtest,
          research: result.research,
          risk: result.risk,
          debate: result.debate,
          updates: [],
          engine: result.engine,
        };
        emit({ stage: "done", record });
      } catch (e: any) {
        emit({ stage: "error", error: e?.message ?? "Failed to build portfolio" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // tell nginx not to buffer the stream
      Connection: "keep-alive",
    },
  });
}
