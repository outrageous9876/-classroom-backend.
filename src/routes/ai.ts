import express from "express";
import Groq from "groq-sdk";

import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const GROQ_MODEL = "openai/gpt-oss-20b";

// Generates a short description for a class or subject using Groq.
// Fully optional on the frontend — this just pre-fills a form field.
router.post("/generate-description", requireAuth, async (req, res) => {
  try {
    const { type, name, context } = req.body;

    if (type !== "class" && type !== "subject") {
      return res
        .status(400)
        .json({ error: "type must be 'class' or 'subject'" });
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    if (!process.env.GROQ_API_KEY) {
      console.error(
        "POST /ai/generate-description error: GROQ_API_KEY is not configured"
      );
      return res
        .status(500)
        .json({ error: "AI description generation is not configured" });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const userPrompt =
      context && typeof context === "string" && context.trim()
        ? `Name: ${name}\nContext: ${context}`
        : `Name: ${name}`;

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `You are an assistant that writes concise, professional 1-2 sentence descriptions for university ${type}s. Given a name and optional context, write ONLY the description, no preamble.`,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    const description = completion.choices[0]?.message?.content?.trim();

    if (!description) {
      return res
        .status(502)
        .json({ error: "AI did not return a description" });
    }

    res.status(200).json({ data: { description } });
  } catch (error) {
    console.error("POST /ai/generate-description error:", error);
    res.status(500).json({ error: "Failed to generate description" });
  }
});

export default router;
