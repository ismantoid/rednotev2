import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import sanitize from "sanitize-filename";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;
const UA = process.env.REQUEST_UA || "Mozilla/5.0";

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Helper
function isHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

// --- Rednote resolver ---
app.get("/api/resolve/rednote", async (req, res) => {
  try {
    const { url } = req.query;
    if (!isHttpUrl(url))
      return res.status(400).json({ ok: false, error: "URL tidak valid" });

    const pageResp = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "id,en;q=0.9" },
    });
    const finalUrl = pageResp.url;
    const html = await pageResp.text();

    // Ambil og:video / og:image
    const ogVideo =
      (html.match(
        /property=["']og:video(:url)?["'][^>]*content=["']([^"']+)["']/i
      ) || [, , ""])[2];
    const ogImage =
      (html.match(
        /property=["']og:image["'][^>]*content=["']([^"']+)["']/i
      ) || [,""])[1];
    const title =
      (html.match(/<title>([^<]+)<\\/title>/i) || [,""])[1]?.trim();

    // Cari semua link mp4/m3u8
    const urls = new Set();
    const rx = /(https?:\\/\\/[^"']+?\\.(?:mp4|m3u8))(?:\\?[^"'\\s]*)?/gi;
    let m;
    while ((m = rx.exec(html)) !== null) {
      let u = m[0].replace(/\\\\\\//g, "/");
      urls.add(u);
    }
    if (ogVideo) urls.add(ogVideo);

    const media = Array.from(urls).map((u) => ({
      url: u,
      type: u.includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
    }));

    if (!media.length && !ogImage) {
      return res.json({
        ok: false,
        error:
          "Tidak menemukan URL media langsung. Bisa jadi postingan dilindungi atau butuh login.",
      });
    }

    res.json({
      ok: true,
      page: finalUrl,
      title: title || "",
      cover: ogImage || "",
      media,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: "Gagal memproses halaman. Pastikan postingan publik.",
    });
  }
});

// --- Downloader ---
app.get("/api/download", async (req, res) => {
  try {
    const { url, filename, referer } = req.query;
    if (!isHttpUrl(url)) return res.status(400).send("URL tidak valid");
    const safeName = sanitize(filename || "download");
    const headers = { "User-Agent": UA };
    if (referer && isHttpUrl(referer)) headers["Referer"] = referer;

    const r = await fetch(url, { headers, redirect: "follow" });
    if (!r.ok) return res.status(400).send("Gagal mengunduh: " + r.status);

    const ct = r.headers.get("content-type") || "application/octet-stream";
    const ext = (ct.match(/\\/(\\w+)/)?.[1] || (url.includes(".m3u8") ? "m3u8" : "bin")).toLowerCase();
    res.setHeader("Content-Type", ct);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}.${ext}"`
    );

    r.body.pipe(res);
  } catch (e) {
    res.status(500).send("Server error saat mengunduh.");
  }
});

// --- Health check ---
app.get("/health", (req, res) => res.send("ok"));

// --- Start server ---
app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Rednote Downloader running at http://0.0.0.0:" + PORT);
});

// --- Self-ping supaya tetap aktif ---
const url = process.env.SELF_URL;
if (url) {
  setInterval(() => {
    fetch(url + "/health").catch(() => {});
  }, 4 * 60 * 1000); // ping tiap 4 menit
}
