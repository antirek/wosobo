import fs from "fs";

/**
 * Minimal WAV PCM s16le loader.
 * @param {string} filePath
 * @returns {{ samples: Int16Array, sampleRate: number, channelCount: number }}
 */
export function loadWavPcm(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (id === "fmt ") {
      const format = buf.readUInt16LE(chunkStart);
      channelCount = buf.readUInt16LE(chunkStart + 2);
      sampleRate = buf.readUInt32LE(chunkStart + 4);
      bitsPerSample = buf.readUInt16LE(chunkStart + 14);
      if (format !== 1) throw new Error(`unsupported WAV format ${format} (need PCM)`);
      if (bitsPerSample !== 16) throw new Error(`unsupported bits ${bitsPerSample} (need 16)`);
    } else if (id === "data") {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    offset = chunkStart + size + (size % 2);
  }

  if (dataOffset < 0 || !sampleRate || !channelCount) {
    throw new Error("WAV missing fmt/data");
  }

  const frameCount = Math.floor(dataSize / (2 * channelCount));
  const samples = new Int16Array(frameCount * channelCount);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2);
  }

  return { samples, sampleRate, channelCount };
}
