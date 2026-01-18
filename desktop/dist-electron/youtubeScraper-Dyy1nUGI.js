"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const child_process = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
const LOCAL_BIN_DIR = path.join(os.homedir(), ".redconvert", "bin");
const LOCAL_YTDLP_PATH = path.join(LOCAL_BIN_DIR, "yt-dlp");
async function checkYtdlp() {
  return new Promise((resolve) => {
    if (fs.existsSync(LOCAL_YTDLP_PATH)) {
      try {
        const process = child_process.spawn(LOCAL_YTDLP_PATH, ["--version"]);
        let version = "";
        process.stdout.on("data", (data) => version += data.toString().trim());
        process.on("close", (code) => {
          if (code === 0) resolve({ installed: true, version, path: LOCAL_YTDLP_PATH });
          else checkSystemYtdlp(resolve);
        });
        process.on("error", () => {
          checkSystemYtdlp(resolve);
        });
      } catch (e) {
        checkSystemYtdlp(resolve);
      }
    } else {
      checkSystemYtdlp(resolve);
    }
  });
}
function checkSystemYtdlp(resolve) {
  try {
    const process = child_process.spawn("yt-dlp", ["--version"]);
    let version = "";
    process.stdout.on("data", (data) => version += data.toString().trim());
    process.on("close", (code) => resolve({ installed: code === 0, version, path: code === 0 ? "yt-dlp (system)" : void 0 }));
    process.on("error", () => resolve({ installed: false }));
  } catch (e) {
    resolve({ installed: false });
  }
}
async function installYtdlp(onProgress) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(LOCAL_BIN_DIR)) {
      fs.mkdirSync(LOCAL_BIN_DIR, { recursive: true });
    }
    if (fs.existsSync(LOCAL_YTDLP_PATH)) {
      try {
        fs.unlinkSync(LOCAL_YTDLP_PATH);
      } catch (e) {
      }
    }
    const args = ["-L", YTDLP_URL, "-o", LOCAL_YTDLP_PATH];
    const curl = child_process.spawn("curl", args);
    if (onProgress) onProgress(10);
    curl.on("close", (code) => {
      if (code === 0) {
        if (fs.existsSync(LOCAL_YTDLP_PATH)) {
          fs.chmodSync(LOCAL_YTDLP_PATH, "755");
          if (onProgress) onProgress(100);
          resolve(true);
        } else {
          reject(new Error("Download finished but file missing"));
        }
      } else {
        reject(new Error(`Curl failed with exit code ${code}`));
      }
    });
    curl.on("error", (err) => {
      reject(err);
    });
  });
}
async function updateYtdlp() {
  const { path: ytPath } = await checkYtdlp();
  if (!ytPath) return false;
  const cmd = ytPath === LOCAL_YTDLP_PATH ? LOCAL_YTDLP_PATH : "yt-dlp";
  return new Promise((resolve) => {
    const process = child_process.spawn(cmd, ["-U"]);
    process.on("close", (code) => resolve(code === 0));
    process.on("error", () => resolve(false));
  });
}
async function fetchChannelInfo(channelUrl, onProgress) {
  const { path: ytPath } = await checkYtdlp();
  const cmd = ytPath || "yt-dlp";
  console.log(`[fetchChannelInfo] using binary: ${cmd}`);
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--flat-playlist",
      "--playlist-end",
      "5",
      channelUrl
    ];
    console.log(`[fetchChannelInfo] spawning: ${cmd} ${args.join(" ")}`);
    if (onProgress) onProgress(`Starting info fetch for ${channelUrl}...`);
    const process = child_process.spawn(cmd, args);
    let output = "";
    let errorOutput = "";
    process.stdout.on("data", (data) => {
      output += data.toString();
      if (onProgress) onProgress("Receiving data...");
    });
    process.stderr.on("data", (data) => {
      const msg = data.toString();
      errorOutput += msg;
      console.log(`[fetchChannelInfo] stderr: ${msg}`);
      if (onProgress) onProgress(`yt-dlp (stderr): ${msg.slice(0, 50)}...`);
    });
    process.on("close", (code) => {
      if (code !== 0) {
        console.error("yt-dlp error:", errorOutput);
        reject(new Error(`Failed to fetch channel info: ${errorOutput}`));
        return;
      }
      try {
        resolve(fetchChannelInfoWithSingleJson(channelUrl));
      } catch (e) {
        reject(e);
      }
    });
  });
}
async function fetchChannelInfoWithSingleJson(channelUrl) {
  const { path: ytPath } = await checkYtdlp();
  const cmd = ytPath || "yt-dlp";
  return new Promise((resolve, reject) => {
    const args = [
      "-J",
      // dump single json
      "--flat-playlist",
      "--playlist-end",
      "5",
      channelUrl
    ];
    const process = child_process.spawn(cmd, args);
    let output = "";
    let errorOutput = "";
    process.stdout.on("data", (data) => {
      output += data.toString();
    });
    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });
    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to fetch channel info: ${errorOutput}`));
        return;
      }
      try {
        const data = JSON.parse(output);
        const channelName = data.uploader || data.channel || data.title || "Unknown Channel";
        const channelId = data.channel_id || data.uploader_id || data.id;
        const channelDescription = data.description || "";
        let avatarUrl = "";
        if (data.thumbnails && data.thumbnails.length > 0) {
          avatarUrl = data.thumbnails[data.thumbnails.length - 1].url;
        }
        const recentVideos = (data.entries || []).map((entry) => ({
          id: entry.id,
          title: entry.title
        }));
        resolve({
          channelId,
          channelName,
          channelDescription,
          avatarUrl,
          recentVideos
        });
      } catch (e) {
        reject(new Error(`Failed to parse yt-dlp output: ${e}`));
      }
    });
  });
}
async function downloadSubtitles(channelUrl, videoCount, outputDir, onProgress) {
  const { path: ytPath } = await checkYtdlp();
  const cmd = ytPath || "yt-dlp";
  return new Promise((resolve) => {
    const args = [
      "--skip-download",
      // Don't download video
      "--write-auto-sub",
      // Write automatic subtitles
      "--write-sub",
      // Write manual subtitles if available
      "--sub-lang",
      "zh-Hans,zh-Hant,zh,en",
      // Prefer Chinese then English
      "--sub-format",
      "vtt",
      // VTT format
      "--convert-subs",
      "srt",
      // Convert to SRT for easier reading
      "--playlist-end",
      String(videoCount),
      "--output",
      path.join(outputDir, "%(title)s.%(ext)s"),
      "--no-overwrites",
      // Skip if exists
      channelUrl
    ];
    console.log(`[downloadSubtitles] spawning: ${cmd} ${args.join(" ")}`);
    const process = child_process.spawn(cmd, args);
    let errorOutput = "";
    process.stdout.on("data", (data) => {
      const line = data.toString();
      if (onProgress) {
        onProgress(line);
      }
    });
    process.stderr.on("data", (data) => {
      const line = data.toString();
      if (onProgress) {
        onProgress(line);
      }
      errorOutput += line;
    });
    process.on("close", (code) => {
      if (code !== 0) {
        console.warn("[downloadSubtitles] yt-dlp finished with code", code);
        console.warn("[downloadSubtitles] stderr accumulated:", errorOutput);
      } else {
        console.log("[downloadSubtitles] finished successfully");
      }
      resolve([]);
    });
  });
}
exports.checkYtdlp = checkYtdlp;
exports.downloadSubtitles = downloadSubtitles;
exports.fetchChannelInfo = fetchChannelInfo;
exports.installYtdlp = installYtdlp;
exports.updateYtdlp = updateYtdlp;
