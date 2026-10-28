
import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Please upload a JPG, PNG or WEBP image."));
    }

    cb(null, true);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Vikku AI Studio backend is running."
  });
});

app.post(
  "/api/generate-video",
  upload.single("referenceImage"),
  async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({
          error: "GEMINI_API_KEY is missing from the hosting environment."
        });
      }

      const story = String(req.body.story || "").trim();

      if (!story) {
        return res.status(400).json({
          error: "Please write your story first."
        });
      }

      const style = String(
        req.body.style || "cinematic realistic"
      ).slice(0, 100);

      // Frontend uses "ratio"; also accept "aspectRatio".
      const requestedRatio = req.body.ratio || req.body.aspectRatio;

      const ratio = ["16:9", "9:16"].includes(requestedRatio)
        ? requestedRatio
        : "16:9";

      const camera = String(req.body.camera || "").slice(0, 2500);
      const extra = String(req.body.extra || "").slice(0, 2500);

      const audioPreference = String(
        req.body.audioPreference || "with audio"
      ).slice(0, 100);

      const prompt = [
        `Visual style: ${style}.`,
        `Story: ${story}`,
        `Camera movement: ${camera || "Smooth cinematic camera movement"}`,
        `Additional instructions: ${extra || "Polished lighting and coherent motion"}`,
        `Audio preference: ${audioPreference}.`,
        "Generate one short cinematic video clip, not a storyboard.",
        "Use natural movement and a clear visual composition."
      ].join("\n\n");

      const ai = new GoogleGenAI({ apiKey });

      let input = prompt;

      if (req.file) {
        input = [
          {
            type: "image",
            data: req.file.buffer.toString("base64"),
            mime_type: req.file.mimetype
          },
          {
            type: "text",
            text:
              prompt +
              "\nUse the uploaded image as a visual reference and animate the scene where supported."
          }
        ];
      }

      const result = await ai.interactions.create({
        model: "gemini-omni-1.1-flash",
        input,
        response_format: {
          type: "video",
          delivery: "inline",
          aspect_ratio: ratio
        }
      });

      // Find inline video data in the generated interaction steps.
      const steps = Array.isArray(result?.steps) ? result.steps : [];

      let videoBlock = null;

      for (const step of steps) {
        const content = Array.isArray(step?.content)
          ? step.content
          : [];

        videoBlock = content.find(
          item => item?.type === "video" && item?.data
        );

        if (videoBlock) break;
      }

      if (!videoBlock?.data) {
        console.error(
          "Video data was not found in the API response:",
          JSON.stringify(result).slice(0, 3000)
        );

        return res.status(502).json({
          error:
            "The AI did not return inline video data. Check model access, API quota and server logs."
        });
      }

      const videoBuffer = Buffer.from(videoBlock.data, "base64");

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="vikku-ai-scene.mp4"'
      );
      res.setHeader("Cache-Control", "no-store");

      return res.send(videoBuffer);
    } catch (error) {
      console.error("Video generation error:", error);

      const message = String(
        error?.message || "Unknown server error"
      );

      const status = /quota|rate.?limit|resource.?exhausted/i.test(message)
        ? 429
        : 500;

      return res.status(status).json({
        error: message.slice(0, 600)
      });
    }
  }
);

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: "Image upload failed. Maximum size is 8 MB."
    });
  }

  return res.status(400).json({
    error: error.message || "Request failed."
  });
});

app.listen(port, () => {
  console.log(`Vikku AI Studio listening on port ${port}`);
});
  
