// Photorealistic portrait generation for personas. Pluggable image backend,
// selected via TERRARIA_IMAGE (mirrors the LLM backend selector in llm.ts):
//
//   1. "mflux"  — DEFAULT. mflux (MIT, MLX-native for Apple Silicon), driven by
//      its CLI (`mflux-generate`). Fully open-source and permissive: no App Store,
//      no closed binary, no HTTP server to babysit. `pip install mflux` /
//      `uv tool install mflux` (and `npm run setup` provisions it). Models are
//      pulled on first generate.
//   2. "a1111" — a local image server speaking the Automatic1111 HTTP API
//      (Draw Things, A1111, ComfyUI-with-shim, Forge) at TERRARIA_IMAGE_HOST.
//   3. "sdcpp" — stable-diffusion.cpp (MIT, tiny C++/Metal engine), driven by its
//      `sd` CLI. Lightweight and RAM-friendly (runs a ~2 GB SD1.5 checkpoint in a
//      few GB), so it's the best fit for machines with ≤16–24 GB RAM where the
//      larger mflux/FLUX models swap-thrash. Build the binary from
//      github.com/leejet/stable-diffusion.cpp and point TERRARIA_SDCPP_BIN /
//      TERRARIA_SDCPP_MODEL (and optionally TERRARIA_SDCPP_VAE) at it.
//   4. "off"   — no image generation; callers keep the procedural SVG avatar.
//
// generateFace() returns a base64 PNG (no data-URI prefix), or null on any
// failure (callers then fall back to the procedural SVG).

type ImageBackend = "mflux" | "a1111" | "sdcpp" | "off";

const HOST = process.env.TERRARIA_IMAGE_HOST || "http://localhost:7860";
const SIZE = parseInt(process.env.TERRARIA_IMAGE_SIZE || "512", 10);
const CFG = parseFloat(process.env.TERRARIA_IMAGE_CFG || "6");

// stable-diffusion.cpp config. Point these at your built binary + downloaded
// checkpoint; the VAE is optional (needed for "noVAE" checkpoints like
// Realistic Vision, unnecessary for checkpoints with a baked VAE like SD1.5 base).
const SDCPP_BIN = process.env.TERRARIA_SDCPP_BIN || "sd";
const SDCPP_MODEL = process.env.TERRARIA_SDCPP_MODEL || "";
const SDCPP_VAE = process.env.TERRARIA_SDCPP_VAE || "";

// mflux config. Default model: FLUX.1 schnell — small, Apache-2.0, distilled for
// a handful of steps, great for headshots. schnell/dev use the base
// `mflux-generate`; newer models (e.g. z-image-turbo, qwen-image) ship dedicated
// `mflux-generate-<model>` commands, which this maps to automatically.
const MODEL = process.env.TERRARIA_IMAGE_MODEL || "schnell";
const QUANTIZE = parseInt(process.env.TERRARIA_IMAGE_QUANTIZE || "8", 10);

// Steps: shared TERRARIA_IMAGE_STEPS, but the sensible default differs per
// backend — schnell is distilled for ~2–4 steps, classic SD samplers want ~20+.
function steps(backendDefault: number): number {
  return parseInt(process.env.TERRARIA_IMAGE_STEPS || String(backendDefault), 10);
}

export function imageBackend(): ImageBackend {
  const mode = process.env.TERRARIA_IMAGE?.toLowerCase();
  if (mode === "off") return "off";
  if (mode === "a1111") return "a1111";
  if (mode === "sdcpp") return "sdcpp";
  if (mode === "mflux") return "mflux";
  // Default: mflux — open-source, permissive (MIT), no App Store, no server.
  return "mflux";
}

// Apparent-appearance phrasing per country, so faces read as plausibly from the
// persona's home. Kept descriptive and neutral; falls back to the country name.
const ETHNICITY: Record<string, string> = {
  "United States": "American",
  India: "Indian, South Asian",
  China: "Chinese, East Asian",
  Nigeria: "Nigerian, West African",
  Brazil: "Brazilian",
  Japan: "Japanese, East Asian",
  Germany: "German, Northern European",
  "United Kingdom": "British",
  Mexico: "Mexican, Latino",
  Egypt: "Egyptian, North African",
  Sweden: "Swedish, Scandinavian",
  Kenya: "Kenyan, East African",
  France: "French, European",
  Indonesia: "Indonesian, Southeast Asian",
};

export interface FaceDemographics {
  age: number;
  gender: string;
  country: string;
  occupation: string;
}

export function buildFacePrompt(d: FaceDemographics): string {
  const eth = ETHNICITY[d.country] ?? d.country;
  const g = d.gender === "male" ? "man" : d.gender === "female" ? "woman" : "androgynous person";
  const subject =
    d.age < 13 ? `${d.age}-year-old ${eth} child` : `${d.age}-year-old ${eth} ${g}`;
  const occ = ["toddler", "student", "retired", "in school"].includes(d.occupation)
    ? ""
    : `, works as a ${d.occupation}`;
  return `headshot portrait photo of a ${subject}${occ}, natural candid expression, plain neutral studio background, soft natural lighting, shot on 50mm lens, shallow depth of field, sharp focus, photorealistic, highly detailed`;
}

// A1111 negative prompt. (mflux/FLUX don't use negative prompts or CFG.)
const NEGATIVE =
  "cartoon, illustration, painting, drawing, 3d render, cgi, anime, doll, deformed, disfigured, extra limbs, extra fingers, mutated hands, bad anatomy, blurry, low quality, lowres, grainy, watermark, signature, text, logo, nsfw, nude";

// Deterministic 32-bit seed from a string (FNV-1a) so a persona keeps a stable face.
function seedInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// schnell/dev use the base `mflux-generate`; other models have dedicated commands.
function mfluxCommand(model: string): string {
  return model === "schnell" || model === "dev" ? "mflux-generate" : `mflux-generate-${model}`;
}

// ── mflux CLI backend ───────────────────────────────────────────────────────

let mfluxMissing = false; // set once if the mflux binary isn't found

async function viaMflux(seed: string, prompt: string): Promise<string | null> {
  if (mfluxMissing) return null;
  const cmd = mfluxCommand(MODEL);
  const os = await import("node:os");
  const path = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { readFile, unlink } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const out = path.join(os.tmpdir(), `terraria-img-${randomUUID()}.png`);
  try {
    await run(
      cmd,
      [
        "--model", MODEL,
        "--prompt", prompt,
        "--seed", String(seedInt(seed)),
        "--steps", String(steps(4)),
        "--width", String(SIZE),
        "--height", String(SIZE),
        "--quantize", String(QUANTIZE),
        "--output", out,
      ],
      // Generous timeout: generation is 30–120s, and the first run also downloads
      // the model weights (several GB). Output goes to a file; stdout is progress.
      { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const buf = await readFile(out);
    return buf.toString("base64");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      mfluxMissing = true;
      console.warn(
        `[terraria] mflux CLI (\`${cmd}\`) not found. Install it: \`uv tool install mflux\` ` +
          `or \`pip install mflux\` (or run \`npm run setup\`). Set TERRARIA_IMAGE=a1111 for the ` +
          `Automatic1111 path, or =off to skip photos. Keeping procedural avatars for now.`,
      );
    } else {
      console.warn("[terraria] mflux generation failed, keeping procedural avatar:", (err as Error).message);
    }
    return null;
  } finally {
    await unlink(out).catch(() => {});
  }
}

// ── stable-diffusion.cpp CLI backend ────────────────────────────────────────

let sdcppMissing = false; // set once if the sd binary isn't found

async function viaSdcpp(seed: string, prompt: string, negative: string): Promise<string | null> {
  if (sdcppMissing) return null;
  const os = await import("node:os");
  const path = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const { readFile, unlink } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  const out = path.join(os.tmpdir(), `terraria-img-${randomUUID()}.png`);
  const args = [
    "-M", "img_gen",
    "-m", SDCPP_MODEL,
    "-p", prompt,
    "-n", negative,
    "--steps", String(steps(22)),
    "--cfg-scale", String(CFG),
    "-W", String(SIZE),
    "-H", String(SIZE),
    "-s", String(seedInt(seed)),
    "--sampling-method", "dpm++2m",
    "--scheduler", "karras",
    "-o", out,
  ];
  if (SDCPP_VAE) args.push("--vae", SDCPP_VAE);
  try {
    await run(SDCPP_BIN, args, { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    const buf = await readFile(out);
    return buf.toString("base64");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      sdcppMissing = true;
      console.warn(
        `[terraria] stable-diffusion.cpp binary not found at \`${SDCPP_BIN}\`. Build it ` +
          `(github.com/leejet/stable-diffusion.cpp) and set TERRARIA_SDCPP_BIN to the \`sd\` ` +
          `binary and TERRARIA_SDCPP_MODEL to a checkpoint. Set TERRARIA_IMAGE=off to skip ` +
          `photos. Keeping procedural avatars for now.`,
      );
    } else {
      console.warn("[terraria] sdcpp generation failed, keeping procedural avatar:", (err as Error).message);
    }
    return null;
  } finally {
    await unlink(out).catch(() => {});
  }
}

// ── Automatic1111 HTTP backend ──────────────────────────────────────────────

async function viaA1111(seed: string, prompt: string, negative: string): Promise<string | null> {
  try {
    const res = await fetch(`${HOST}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: negative,
        steps: steps(22),
        width: SIZE,
        height: SIZE,
        cfg_scale: CFG,
        seed: seedInt(seed),
        sampler_name: "DPM++ 2M Karras",
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { images?: string[] };
    return data.images?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Dispatch a prompt to the active image backend. Returns base64 PNG or null. */
function runImage(seed: string, prompt: string, negative: string): Promise<string | null> {
  const b = imageBackend();
  if (b === "off") return Promise.resolve(null);
  if (b === "a1111") return viaA1111(seed, prompt, negative);
  if (b === "sdcpp") return viaSdcpp(seed, prompt, negative);
  return viaMflux(seed, prompt);
}

/** Generate a persona portrait from demographics. */
export function generateFace(seed: string, d: FaceDemographics): Promise<string | null> {
  return runImage(seed, buildFacePrompt(d), NEGATIVE);
}

/** Turn a persona's photo description into a realistic-photo prompt. */
export function buildContentPrompt(desc: string): string {
  const cleaned = desc.trim().replace(/^(a\s+)?(photo|picture|pic|image|shot)\s+of\s+/i, "");
  return `a realistic candid photograph of ${cleaned}, natural lighting, sharp focus, high detail`;
}

/** Generate an arbitrary image from a free-text description (e.g. a photo a
 *  persona is "posting"). */
export function generateImage(seed: string, desc: string): Promise<string | null> {
  return runImage(seed, buildContentPrompt(desc), NEGATIVE);
}

/** Is the active image backend ready to generate? Returns not-ready with a human
 *  note when it isn't (off, unreachable server, or missing CLI). */
export async function imageReady(): Promise<{ ok: boolean; note?: string }> {
  const b = imageBackend();
  if (b === "off") {
    return { ok: false, note: "Image generation is off (TERRARIA_IMAGE=off). Set TERRARIA_IMAGE=mflux to enable photos." };
  }
  if (b === "a1111") {
    try {
      const res = await fetch(`${HOST}/`, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return { ok: true };
      return { ok: false, note: `Image server at ${HOST} responded ${res.status}.` };
    } catch {
      return {
        ok: false,
        note:
          `No Automatic1111 image server reachable at ${HOST}. Start Draw Things (enable its HTTP ` +
          `server on port 7860) or another A1111-compatible server, then re-run.`,
      };
    }
  }
  if (b === "sdcpp") {
    const { access } = await import("node:fs/promises");
    try {
      await access(SDCPP_BIN);
    } catch {
      return {
        ok: false,
        note:
          `stable-diffusion.cpp binary not found at \`${SDCPP_BIN}\` (TERRARIA_SDCPP_BIN). Build it ` +
          `from github.com/leejet/stable-diffusion.cpp (\`cmake -B build -DSD_METAL=ON && cmake ` +
          `--build build\`) and point TERRARIA_SDCPP_BIN at the resulting \`sd\` binary.`,
      };
    }
    if (!SDCPP_MODEL) {
      return { ok: false, note: "TERRARIA_SDCPP_MODEL is unset. Point it at a .safetensors SD checkpoint." };
    }
    try {
      await access(SDCPP_MODEL);
    } catch {
      return {
        ok: false,
        note: `sdcpp checkpoint not found at \`${SDCPP_MODEL}\` (TERRARIA_SDCPP_MODEL). Download an ungated SD1.5 .safetensors checkpoint.`,
      };
    }
    if (SDCPP_VAE) {
      try {
        await access(SDCPP_VAE);
      } catch {
        return {
          ok: false,
          note: `sdcpp VAE not found at \`${SDCPP_VAE}\` (TERRARIA_SDCPP_VAE). Unset it for baked-VAE checkpoints, or fix the path.`,
        };
      }
    }
    return { ok: true };
  }

  // mflux: check the CLI is on PATH.
  const cmd = mfluxCommand(MODEL);
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    await run("which", [cmd]);
    return { ok: true };
  } catch {
    return {
      ok: false,
      note:
        `mflux CLI (\`${cmd}\`) not found on PATH. Install it: \`uv tool install mflux\` or ` +
        `\`pip install mflux\` (or run \`npm run setup\`).`,
    };
  }
}

export { HOST as IMAGE_HOST };
