import { generateInputSchema, runCodegen, type GenerateStreamEvent } from "@/server/routers/codegen";

function toSse(event: GenerateStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = generateInputSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.issues }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const send = async (event: GenerateStreamEvent) => {
          controller.enqueue(encoder.encode(toSse(event)));
        };

        void runCodegen(parsed.data, send)
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Unknown streaming error";
            const payload = { type: "error", message };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          })
          .finally(() => {
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
