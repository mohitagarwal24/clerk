// Spike: forced function calling (mode ANY) with the pinned model, plus a model listing.
import { GoogleGenAI, FunctionCallingConfigMode, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!apiKey || !model) throw new Error("Set GEMINI_API_KEY and GEMINI_MODEL in .env");

const ai = new GoogleGenAI({ apiKey });

console.log("--- models with generateContent ---");
for await (const m of await ai.models.list()) {
  if (m.supportedActions?.includes("generateContent") && m.name?.includes("gemini")) console.log(m.name);
}

const res = await ai.models.generateContent({
  model,
  contents: `Goal: enter invoice INV-1042 into the ERP.
Latest observation:
- textbox "Amount" [ref=e5]
- button "Create bill" [ref=e6]
Facts: amount=48250.00. Choose exactly one next action.`,
  config: {
    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
    tools: [{
      functionDeclarations: [
        {
          name: "type",
          description: "Type text into the element with this ref from the latest snapshot",
          parameters: { type: Type.OBJECT, properties: { ref: { type: Type.STRING }, text: { type: Type.STRING } }, required: ["ref", "text"] },
        },
        {
          name: "click",
          description: "Click the element with this ref from the latest snapshot",
          parameters: { type: Type.OBJECT, properties: { ref: { type: Type.STRING } }, required: ["ref"] },
        },
      ],
    }],
  },
});

console.log(`--- ${model} returned ---`);
console.log(JSON.stringify(res.functionCalls, null, 2));
console.log("usage:", JSON.stringify(res.usageMetadata));
