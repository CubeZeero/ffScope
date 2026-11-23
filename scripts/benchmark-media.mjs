import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const execute = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const directory = await mkdtemp(join(tmpdir(), "ffscope-benchmark-"));
const source = join(directory, "sample.mp4");
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const run = (tool, args) => execute(tool, args, { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 });
async function measure(operation) {
  const times = [];
  let value;
  for (let i = 0; i < 3; i++) {
    const start = performance.now(); value = await operation(); times.push(performance.now() - start);
  }
  return { medianMs: Number(median(times).toFixed(2)), value };
}
async function thumbnails(workers, limited) {
  let next = 0;
  const output = [];
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < 12) {
      const index = next++;
      const { stdout } = await run(ffmpeg, ["-v", "error", ...(limited ? ["-threads", "2", "-filter_threads", "1"] : []), "-ss", String(index * 1.5), "-i", source, "-frames:v", "1", "-vf", "scale=320:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]);
      output[index] = stdout;
    }
  }));
  return output;
}
try {
  await run(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-g", "60", "-bf", "3", source]);
  const packets = format => run(ffprobe, ["-v", "error", "-select_streams", "0", "-show_entries", "packet=pts_time,dts_time,size,flags", "-of", format, source]);
  const json = await measure(() => packets("json"));
  const compact = await measure(() => packets("compact=p=0:nk=0"));
  const fields = ["pts_time", "dts_time", "size", "flags"];
  const expected = JSON.parse(json.value.stdout).packets.map(packet => fields.map(key => packet[key]));
  const actual = compact.value.stdout.toString().trim().split(/\r?\n/).map(line => Object.fromEntries(line.split("|").map(field => field.split("=")))).filter(packet => packet.size !== undefined).map(packet => fields.map(key => packet[key]));
  assert.deepEqual(actual, expected, "Packet output must be equivalent");
  const sequential = await measure(() => thumbnails(1, false));
  const parallel = await measure(() => thumbnails(2, true));
  parallel.value.forEach((image, index) => assert.deepEqual(image, sequential.value[index], "Thumbnail bytes must be identical"));
  console.log(JSON.stringify({ fixture: "1280x720, 30 fps, 20 s, H.264 B-frames", repeats: 3,
    packets: { json: { medianMs: json.medianMs, bytes: json.value.stdout.length }, compact: { medianMs: compact.medianMs, bytes: compact.value.stdout.length } },
    thumbnails12: { sequentialMs: sequential.medianMs, parallelMs: parallel.medianMs, identicalImages: true },
  }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
