#!/usr/bin/env tsx
/**
 * Convert Audio Script
 *
 * Converts audio files (MP3, WAV, etc.) to raw PCM format suitable for
 * streaming through the radio's RTCAudioSource.
 *
 * Output format:
 * - Sample rate: 48000 Hz
 * - Bit depth: 16-bit signed little-endian
 * - Channels: Mono (1 channel)
 *
 * Usage:
 *   pnpm convert-audio <input-file> [output-file]
 *
 * Examples:
 *   pnpm convert-audio ~/music/song.mp3 assets/radio-music.pcm
 *   pnpm convert-audio song.mp3  # outputs to assets/song.pcm
 */

import { spawn } from "child_process";
import { basename, extname, join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "../assets");

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BIT_DEPTH = 16;

const printUsage = () => {
  console.log(`
Convert Audio - Convert audio files to PCM for radio streaming

Usage:
  pnpm convert-audio <input-file> [output-file]

Arguments:
  input-file   Path to input audio file (MP3, WAV, FLAC, etc.)
  output-file  Optional output path (defaults to assets/<input-name>.pcm)

Output Format:
  - Sample Rate: ${SAMPLE_RATE} Hz
  - Bit Depth: ${BIT_DEPTH}-bit signed little-endian
  - Channels: ${CHANNELS} (mono)

Examples:
  pnpm convert-audio ~/music/song.mp3 assets/radio-music.pcm
  pnpm convert-audio song.mp3

Prerequisites:
  FFmpeg must be installed and available in PATH
  `);
};

const checkFfmpeg = (): Promise<boolean> => {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "pipe" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
};

const convertAudio = (inputPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    console.log(`Converting: ${inputPath}`);
    console.log(`Output: ${outputPath}`);
    console.log(`Format: ${SAMPLE_RATE}Hz, ${BIT_DEPTH}-bit, mono PCM\n`);

    const args = [
      "-i",
      inputPath,
      "-f",
      "s16le", // 16-bit signed little-endian PCM
      "-acodec",
      "pcm_s16le",
      "-ar",
      SAMPLE_RATE.toString(),
      "-ac",
      CHANNELS.toString(),
      "-y", // Overwrite output
      outputPath,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run FFmpeg: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}\n${stderr}`));
      }
    });
  });
};

const getFileInfo = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-i",
      filePath,
      "-show_entries",
      "format=duration",
      "-v",
      "quiet",
      "-of",
      "csv=p=0",
    ]);

    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", () => {
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration)) {
        const minutes = Math.floor(duration / 60);
        const seconds = Math.floor(duration % 60);
        resolve(`${minutes}:${seconds.toString().padStart(2, "0")}`);
      } else {
        resolve("unknown");
      }
    });

    proc.on("error", () => {
      resolve("unknown");
    });
  });
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.error("Error: FFmpeg is not installed or not in PATH");
    console.error("Please install FFmpeg: https://ffmpeg.org/download.html");
    process.exit(1);
  }

  const inputPath = args[0];

  if (!existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let outputPath: string;
  if (args[1]) {
    outputPath = args[1];
  } else {
    const inputName = basename(inputPath, extname(inputPath));
    outputPath = join(ASSETS_DIR, `${inputName}.pcm`);
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const duration = await getFileInfo(inputPath);
    console.log(`Input duration: ${duration}\n`);

    await convertAudio(inputPath, outputPath);

    const { statSync } = await import("fs");
    const stats = statSync(outputPath);
    const sizeKb = Math.round(stats.size / 1024);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    console.log("Conversion complete!");
    console.log(`Output size: ${sizeMb} MB (${sizeKb} KB)`);
    console.log(`\nTo use this file, start a radio with:`);
    console.log(`  startRadio(eid, "${outputPath}")`);
  } catch (err) {
    console.error("Conversion failed:", err);
    process.exit(1);
  }
};

main();
