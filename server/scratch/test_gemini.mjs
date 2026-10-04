import { generateText } from "../src/services/gemini.service.js";

async function test() {
  try {
    const res = await generateText("Return a simple JSON: {\"test\": true}");
    console.log("Gemini response:", res);
  } catch (err) {
    console.error("Gemini error:", err);
  }
}
test();
