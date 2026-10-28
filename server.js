
import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
    fields: 10,
    fieldSize: 100 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      return callback(
        new Error("Please upload a JPG, PNG or WEBP image.")
      );
    }

    callback(null, true);
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
          error:
            "GEMINI_API_KEY is missing. Add it in your hosting environment variables."
        });
      }

      const story = String(req.body.story || "").trim();

      if (!story) {
        return res.status(400).json({
          error: "Please write your story first."
        });
      }

      if (story.length > 10000) {
        return res.status(400).json({
          error: "Please keep your story under 10,000 characters."
        });
      }

      const username = String(req.body.username || "")
        .trim()
        .slice(0, 80);

      const project = String(req.body.project || "")
        .trim()
        .slice(0, 120);

      const style = String(
        req.body.style || "cinematic realistic"
      ).slice(0, 100);

      // Support both field names used by the frontend.
      const requestedRatio =
        req.body.ratio || req.body.aspectRatio || "16:9";

      const ratio = ["16:9", "9:16"].includes(requestedRatio)
        ? requestedRatio
        : "16:9";

      const camera = String(req.body.camera || "").slice(0, 2500);
      const extra = String(req.body.extra || "").slice(0, 2500);

      const audioPreference = String(
        req.body.audioPreference || "with audio"
      ).slice(0, 100);

      const prompt = [
        project ? `Project: ${project}.` : "",
        username ? `Creator: ${username}.` : "",
        `Visual style: ${style}.`,
        `Story and scene: ${story}`,
        `Camera movement: ${
          camera || "Smooth cinematic camera movement"
        }.`,
        `Additional instructions: ${
          extra || "Use polished lighting and coherent motion"
        }.`,
        `Audio preference: ${audioPreference}.`,
        audioPreference.toLowerCase().includes("silent")
          ? "Prefer a silent video without audio if supported."
          : "Include suitable audio where supported.",
        "Generate one short video clip, not a storyboard or a text description.",
        "Keep the scene visually coherent with natural motion and clear composition."
      ]
        .filter(Boolean)
        .join("\n\n");

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
              "\nUse the uploaded image as a visual reference. " +
              "Generate an animated scene based on it."
          }
        ];
      }

      const interactionOptions = {
        model: "gemini-omni-1.1-flash",
        input,
        response_format: {
          type: "video",
          aspect_ratio: ratio
        }
      };

      // Explicitly request image-to-video when an image is supplied.
      if (req.file) {
        interactionOptions.generationConfig = {
          videoConfig: {
            task: "image_to_video"
          }
        };
      }

      const result = await ai.interactions.create(
        interactionOptions
      );

      if (
        result?.status &&
        result.status !== "completed"
      ) {
        console.error("Interaction status:", result.status);

        return res.status(502).json({
          error:
            "Video generation did not complete. Please check model access and server logs."
        });
      }

      // The SDK may expose output_video directly.
      // Also support video data inside the raw steps response.
      let videoData = result?.output_video?.data;
      let videoMimeType = "video/mp4";

      if (!videoData && Array.isArray(result?.steps)) {
        for (const step of result.steps) {
          const content = Array.isArray(step?.content)
            ? step.content
            : [];

          const videoItem = content.find(
            item => item?.type === "video" && item?.data
          );

          if (videoItem) {
            videoData = videoItem.data;
            videoMimeType =
              videoItem.mime_type || "video/mp4";
            break;
          }
        }
      }

      if (!videoData) {
        console.error(
          "No inline video data found. Response:",
          JSON.stringify(result).slice(0, 3000)
        );

        return res.status(502).json({
          error:
            "The AI did not return inline video data. Check model access, quota and server logs."
        });
      }

      const videoBuffer = Buffer.from(videoData, "base64");

      if (!videoBuffer.length) {
        return res.status(502).json({
          error: "The AI returned an empty video file."
        });
      }

      res.setHeader("Content-Type", videoMimeType);
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

      const status = /quota|rate.?limit|resource.?exhausted/i.test(
        message
      )
        ? 429
        : 500;

      return res.status(status).json({
        error: message.slice(0, 600)
      });
    }
  }
);

// Handle upload errors and other request errors.
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image is too large. Maximum size is 8 MB."
        : "Image upload failed. Please check the file and try again.";

    return res.status(400).json({ error: message });
  }

  console.error("Request error:", error);

  return res.status(400).json({
    error: error.message || "Request failed."
  });
});

app.listen(port, () => {
  console.log(`Vikku AI Studio listening on port ${port}`);
});
  
