// utils/compressAudio.js
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

async function compressToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    ffmpeg(inputPath)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .format("mp3")
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });
}

module.exports = { compressToMp3 };
