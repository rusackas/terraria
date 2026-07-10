// Photorealistic portrait generation via a local image server that speaks the
// Automatic1111 API (Draw Things, A1111, ComfyUI-with-shim, Forge). Builds a
// prompt from a persona's demographics and returns a PNG. Falls back to nothing
// (callers keep the procedural SVG) when no server is reachable.

const HOST = process.env.TERRARIA_IMAGE_HOST || "http://localhost:7860";
const STEPS = parseInt(process.env.TERRARIA_IMAGE_STEPS || "22", 10);
const SIZE = parseInt(process.env.TERRARIA_IMAGE_SIZE || "512", 10);
const CFG = parseFloat(process.env.TERRARIA_IMAGE_CFG || "6");

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

/** Generate a portrait. Returns base64 PNG (no data-URI prefix), or null if the
 *  image server is unreachable or errors. */
export async function generateFace(seed: string, d: FaceDemographics): Promise<string | null> {
  try {
    const res = await fetch(`${HOST}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: buildFacePrompt(d),
        negative_prompt: NEGATIVE,
        steps: STEPS,
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

/** Is a local image server reachable? */
export async function imageServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${HOST}/`, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export { HOST as IMAGE_HOST };
