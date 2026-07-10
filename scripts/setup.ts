// One-time bootstrap for the local AI backend: install Ollama if needed, start it,
// and pull the model. After this, `npm run world` manages everything itself.
// Usage: npm run setup

import "dotenv/config";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Force the ollama backend for this script so ensureOllamaReady() provisions it,
// regardless of what TERRARIA_LLM is set to.
process.env.TERRARIA_LLM = "ollama";

async function has(cmd: string): Promise<boolean> {
  try {
    await run("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

function spawnInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "inherit" });
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    c.on("error", reject);
  });
}

async function main() {
  const model = process.env.TERRARIA_MODEL || "llama3.2";
  console.log(`🌱 Terraria setup — provisioning a local model (${model}) via Ollama…\n`);

  if (!(await has("ollama"))) {
    console.log("Ollama not found — installing…");
    if (process.platform === "darwin" && (await has("brew"))) {
      await spawnInherit("brew", ["install", "ollama"]);
    } else if (process.platform === "linux") {
      await spawnInherit("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"]);
    } else {
      console.error(
        "\nCouldn't auto-install. Please install Ollama from https://ollama.com/download, then re-run `npm run setup`.",
      );
      process.exit(1);
    }
  } else {
    console.log("✓ Ollama is installed.");
  }

  // Start the server (if needed) and pull the model.
  const { ensureOllamaReady } = await import("../src/lib/llm");
  const res = await ensureOllamaReady();
  if (!res.ok) {
    console.error(`\n✗ ${res.note}`);
    process.exit(1);
  }

  // Optional: provision mflux for photorealistic profile pictures. Faces are
  // optional, so this is entirely non-fatal — warn and continue on any problem.
  await maybeInstallMflux();

  console.log(`\n✅ Ready — backend: ollama, model: ${model}.`);
  console.log("Next:  npm run seed -- 15   then   npm run world");
}

async function maybeInstallMflux() {
  const image = process.env.TERRARIA_IMAGE?.toLowerCase();
  // Default backend is mflux, so provision it when TERRARIA_IMAGE is mflux or unset.
  if (image && image !== "mflux") return;

  if ((await has("mflux-generate")) || (await has("mflux"))) {
    console.log("\n✓ mflux is installed (photorealistic profile pictures available).");
    return;
  }

  console.log("\n📷 Installing mflux (optional — for photorealistic profile pictures)…");
  try {
    if (await has("uv")) {
      await spawnInherit("uv", ["tool", "install", "mflux"]);
    } else if (await has("pip3")) {
      await spawnInherit("pip3", ["install", "mflux"]);
    } else {
      console.warn(
        "  ⚠️  Neither `uv` nor `pip3` found — skipping mflux. Faces are optional; install\n" +
          "     later with `uv tool install mflux` (or `pip install mflux`) to enable `npm run faces`.",
      );
      return;
    }
    console.log("  ✓ mflux installed. Models download on first `npm run faces`.");
  } catch (e) {
    console.warn(
      `  ⚠️  Couldn't install mflux (${(e as Error).message}). Faces are optional — install it\n` +
        "     later with `uv tool install mflux`, or set TERRARIA_IMAGE=off / =a1111.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
