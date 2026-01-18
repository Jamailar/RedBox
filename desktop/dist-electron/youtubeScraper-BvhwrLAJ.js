"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const child_process = require("child_process");
const path = require("path");
const fs = require("fs");
require("https");
const os = require("os");
const LOCAL_BIN_DIR = path.join(os.homedir(), ".redconvert", "bin");
const LOCAL_YTDLP_PATH = path.join(LOCAL_BIN_DIR, "yt-dlp");
async function checkYtdlp() {
  return new Promise((resolve) => {
    if (fs.existsSync(LOCAL_YTDLP_PATH)) {
      const process = child_process.spawn(LOCAL_YTDLP_PATH, ["--version"]);
      let version = "";
      process.stdout.on("data", (data) => version += data.toString().trim());
      process.on("close", (code) => {
        if (code === 0) resolve({ installed: true, version, path: LOCAL_YTDLP_PATH });
        else checkSystemYtdlp(resolve);
      });
      process.on("error", () => checkSystemYtdlp(resolve));
    } else {
      checkSystemYtdlp(resolve);
    }
  });
}
function checkSystemYtdlp(resolve) {
  const process = child_process.spawn("yt-dlp", ["--version"]);
  let version = "";
  process.stdout.on("data", (data) => version += data.toString().trim());
  process.on("close", (code) => resolve({ installed: code === 0, version, path: code === 0 ? "yt-dlp (system)" : void 0 }));
  process.on("error", () => resolve({ installed: false }));
}
async function fetchChannelInfo(channelUrl) {
  const { path: ytPath } = await checkYtdlp();
  const cmd = ytPath || "yt-dlp";
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
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
    const process = child_process.spawn(cmd, args);
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
    });
    process.on("close", (code) => {
      if (code !== 0) {
        console.warn("yt-dlp finished with code", code);
      }
      resolve([]);
    });
  });
}
exports.checkYtdlp = checkYtdlp;
exports.downloadSubtitles = downloadSubtitles;
exports.fetchChannelInfo = fetchChannelInfo;
