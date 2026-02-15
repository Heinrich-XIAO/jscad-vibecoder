const TITLE_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";
const MAX_TITLE_LENGTH = 60;

function sanitizeTitle(text: string) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^["'`\s]+|["'`\s]+$/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, MAX_TITLE_LENGTH).trim();
}

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as { prompt?: string; apiKey?: string };
    const prompt = typeof json.prompt === "string" ? json.prompt.trim() : "";
    const apiKey = typeof json.apiKey === "string" ? json.apiKey.trim() : "";

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!apiKey && !process.env.OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OpenRouter API key" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey || process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://jscad-vibe.app",
          "X-Title": "JSCAD Vibe",
        },
        body: JSON.stringify({
          model: TITLE_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You name projects from a user prompt. Return a short, concrete title (2-6 words), Title Case, no quotes, no markdown, max 60 characters.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 32,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const rawTitle = data.choices?.[0]?.message?.content || "";
    const title = sanitizeTitle(rawTitle);

    return new Response(JSON.stringify({ title }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
