import "dotenv/config";
import { runCodegen } from "../server/routers/codegen";
import { AVAILABLE_MODELS } from "../lib/openrouter";

async function benchmark() {
  const prompt = "Generate a rack and pinion mechanism.";
  const results: Array<{ model: string; code: string; summary: string; iterations: number }> = [];

  for (const modelObj of AVAILABLE_MODELS) {
    console.log(`Benchmarking model: ${modelObj.name}`);
    try {
      const result = await runCodegen({
        prompt,
        model: modelObj.id,
        maxIterations: 3,
        projectContext: {},
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
      });

      results.push({
        model: modelObj.name,
        code: result.code,
        summary: result.assistantMessage ?? "",
        iterations: result.iterations,
      });

      console.log(`--- ${modelObj.name} ---\nSummary: ${result.assistantMessage ?? ""}\n`);
    } catch (err) {
      results.push({
        model: modelObj.name,
        code: "",
        summary: `Error: ${err}`,
        iterations: 0,
      });
      console.error(`Error benchmarking model ${modelObj.name}:`, err);
    }
  }

  console.log("\nBenchmark Results:");
  console.log("| Model | Summary | Iterations | Code Length |");
  console.log("|-------|---------|------------|------------|");
  for (const r of results) {
    const codeLen = r.code.length;
    const summaryPreview = r.summary.replace(/\n/g, " ").slice(0, 80);
    console.log(`| ${r.model} | ${summaryPreview} | ${r.iterations} | ${codeLen} |`);
  }
}

benchmark();
