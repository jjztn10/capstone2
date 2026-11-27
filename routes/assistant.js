const express = require("express");
const router = express.Router();

const MODEL = "gemini-2.5-flash"; // check AI Studio if this name stops working

router.post("/", async (req, res) => {
  const { messages = [], tasks = [], mood = "unknown" } = req.body;

  const system = `You are SmartWork Assistant, a friendly productivity helper.
Today's mood: ${mood}
The user's tasks (JSON): ${JSON.stringify(tasks)}
Recommend what to work on based on priority, deadlines, and mood.
On low-energy days, suggest a lighter plan. Keep answers short and practical.`;

  // Gemini uses "model" instead of "assistant"
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
        }),
      }
    );
    const data = await r.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error(JSON.stringify(data));
    res.json({ reply });
  } catch (err) {
    console.error("Assistant error:", err.message);
    res.status(500).json({ reply: "Sorry, something went wrong." });
  }
});

module.exports = router;