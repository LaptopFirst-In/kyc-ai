import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoint to check configuration status
  app.get("/api/config-status", (req, res) => {
    let githubRepo = process.env.GITHUB_REPO?.trim();
    if (githubRepo?.includes("github.com/")) {
      githubRepo = githubRepo.split("github.com/")[1].replace(/^\/+|\/+$/g, "").split("/").slice(0, 2).join("/");
    }
    
    res.json({
      hasToken: !!process.env.GITHUB_TOKEN?.trim(),
      repo: githubRepo || null,
      branch: (process.env.GITHUB_BRANCH || "main").trim(),
      folder: (process.env.GITHUB_FOLDER || "reports").trim(),
    });
  });

  // API endpoint to save report to GitHub
  app.post("/api/save-report", async (req, res) => {
    const { query, content } = req.body;
    let githubRepo = process.env.GITHUB_REPO?.trim();
    const githubToken = process.env.GITHUB_TOKEN?.trim();
    const githubBranch = (process.env.GITHUB_BRANCH || "main").trim();
    const githubFolder = (process.env.GITHUB_FOLDER || "reports").trim();

    // Robust sanitization of repo name
    if (githubRepo) {
      // Remove full URL if present
      if (githubRepo.includes("github.com/")) {
        githubRepo = githubRepo.split("github.com/")[1];
      }
      // Remove any leading/trailing slashes
      githubRepo = githubRepo.replace(/^\/+|\/+$/g, "");
      // Ensure it's only owner/repo (take first two parts)
      const parts = githubRepo.split("/");
      if (parts.length >= 2) {
        githubRepo = `${parts[0]}/${parts[1]}`;
      }
    }

    console.log(`Attempting to save report for "${query}" to GitHub...`);
    console.log(`Repo: ${githubRepo}, Branch: ${githubBranch}, Folder: ${githubFolder}`);
    console.log(`Token present: ${!!githubToken}`);

    if (!githubToken || !githubRepo) {
      const missing = [];
      if (!githubToken) missing.push("GITHUB_TOKEN");
      if (!githubRepo) missing.push("GITHUB_REPO");
      console.error(`Missing configuration: ${missing.join(", ")}`);
      return res.status(500).json({ 
        error: `GitHub configuration missing: ${missing.join(", ")}`,
        message: "Please ensure you have added GITHUB_TOKEN and GITHUB_REPO to the Secrets panel in AI Studio."
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedQuery = query.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const fileName = `${githubFolder.replace(/^\/+|\/+$/g, "")}/${sanitizedQuery}_${timestamp}.md`;
    const message = `Add report for ${query}`;
    const contentBase64 = Buffer.from(content).toString("base64");

    try {
      const url = `https://api.github.com/repos/${githubRepo}/contents/${fileName}`;
      
      await axios.put(
        url,
        {
          message,
          content: contentBase64,
          branch: githubBranch,
        },
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "VendorCheck-AI-App",
          },
        }
      );

      res.json({ success: true, fileName });
    } catch (error: any) {
      const errorData = error.response?.data;
      const status = error.response?.status;
      console.error(`GitHub API error (${status}):`, JSON.stringify(errorData, null, 2) || error.message);
      
      let errorMessage = "Failed to save to GitHub";
      if (status === 404) {
        errorMessage = `GitHub Error: Repository "${githubRepo}" not found. Please check if the repository name is correct (format: "username/repo") and your token has "repo" scope permissions.`;
      } else if (status === 401) {
        errorMessage = "GitHub Error: Unauthorized. Your GITHUB_TOKEN might be invalid or expired.";
      } else if (errorData?.message) {
        errorMessage = `GitHub Error: ${errorData.message}`;
      }

      res.status(status || 500).json({ 
        error: errorMessage, 
        details: errorData || error.message 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
