import "dotenv/config";
import express from "express";
import cors from "cors";
import { askTutor } from "./tutorEngine.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "DoStudy Buddy", version: "0.1.0" });
});

app.post("/api/tutor/ask", async (req, res) => {
  try {
    const { message, history = [], mode = "guide" } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const result = await askTutor({ message, history, mode });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Tutor request failed" });
  }
});

app.post("/api/tutor/hint", async (req, res) => {
  const { message, history = [], level = 1 } = req.body || {};
  const mode = `hint-level-${Math.min(5, Math.max(1, Number(level) || 1))}`;
  try {
    const result = await askTutor({ message, history, mode });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Hint request failed" });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`DoStudy Buddy API running on http://localhost:${port}`);
});
