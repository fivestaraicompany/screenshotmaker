import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localeRoot = resolve(projectRoot, "i18n");
const model = process.env.SCREENSHOT_MAKER_TRANSLATION_MODEL ?? "translategemma:12b";
const ollamaURL =
  process.env.SCREENSHOT_MAKER_OLLAMA_URL ?? "http://127.0.0.1:11434";

const localeProfiles = {
  af: ["Afrikaans", "Natural South African Afrikaans; clear and friendly."],
  am: ["Amharic", "Modern, respectful Ethiopian Amharic."],
  ar: ["Modern Standard Arabic", "Region-neutral MSA; avoid dialect and gendered address where practical."],
  az: ["Azerbaijani", "Contemporary Latin-script Azerbaijani."],
  be: ["Belarusian", "Natural contemporary Belarusian."],
  bg: ["Bulgarian", "Natural contemporary Bulgarian."],
  bn: ["Bengali", "Respectful, region-neutral standard Bengali."],
  ca: ["Catalan", "Natural Catalan suitable across Catalan-speaking markets."],
  cs: ["Czech", "Natural, concise Czech for a consumer productivity app."],
  da: ["Danish", "Natural Danish with a concise Scandinavian tone."],
  de: ["German", "Natural German for a modern consumer app; concise and approachable."],
  el: ["Greek", "Natural contemporary Greek."],
  es: ["Spanish", "International Spanish with wording that works in Spain and Latin America."],
  "es-MX": ["Mexican Spanish", "Natural Mexican Spanish; avoid Spain-only vocabulary."],
  fi: ["Finnish", "Natural, concise Finnish."],
  fr: ["French", "International French with a polished but approachable register."],
  "fr-CA": ["Canadian French", "Natural Canadian French; avoid France-only idioms."],
  he: ["Hebrew", "Natural modern Hebrew; use inclusive or impersonal wording where practical."],
  hi: ["Hindi", "Respectful, natural standard Hindi."],
  hr: ["Croatian", "Natural contemporary Croatian."],
  hu: ["Hungarian", "Natural, concise Hungarian."],
  id: ["Indonesian", "Natural Indonesian; friendly and professional, not overly formal."],
  it: ["Italian", "Natural Italian for a modern creative app."],
  ja: ["Japanese", "Natural, concise Japanese UI and marketing copy; polite where a full sentence is needed."],
  ko: ["Korean", "Natural Korean UI copy; concise headlines and polite 해요/합니다 style for guidance."],
  ms: ["Malay", "Natural Malaysian Malay; clear and professional."],
  nb: ["Norwegian Bokmål", "Natural, concise Norwegian Bokmål."],
  nl: ["Dutch", "Natural Dutch with a direct, friendly tone."],
  pl: ["Polish", "Natural contemporary Polish; avoid unnecessarily gendered address."],
  "pt-BR": ["Brazilian Portuguese", "Natural Brazilian Portuguese; friendly modern app language."],
  "pt-PT": ["European Portuguese", "Natural European Portuguese; avoid Brazilian-only vocabulary."],
  ro: ["Romanian", "Natural contemporary Romanian."],
  ru: ["Russian", "Natural contemporary Russian with neutral, professional wording."],
  sk: ["Slovak", "Natural contemporary Slovak."],
  sv: ["Swedish", "Natural, concise Swedish."],
  th: ["Thai", "Natural polite Thai without gender-specific sentence particles."],
  tr: ["Turkish", "Natural contemporary Turkish."],
  uk: ["Ukrainian", "Natural contemporary Ukrainian."],
  vi: ["Vietnamese", "Natural, respectful Vietnamese without region-specific slang."],
  "zh-Hans": ["Simplified Chinese", "Concise Simplified Chinese for Mainland and other Simplified Chinese readers."],
  "zh-Hant": ["Traditional Chinese", "Natural Traditional Chinese that is understandable in Taiwan, Hong Kong, and Macao; avoid region-only slang."],
};

const forcedPaths = new Set(["language.hint", "home.final.action"]);

function flatten(value, prefix = "", output = {}) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      flatten(entry, prefix ? `${prefix}.${index}` : String(index), output),
    );
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      flatten(entry, prefix ? `${prefix}.${key}` : key, output),
    );
  } else {
    output[prefix] = value;
  }
  return output;
}

function valueAtPath(object, path) {
  return path
    .split(".")
    .reduce((value, key) => value?.[Number.isInteger(Number(key)) ? Number(key) : key], object);
}

function setAtPath(object, path, value) {
  const keys = path.split(".");
  let cursor = object;

  keys.forEach((key, index) => {
    const isLast = index === keys.length - 1;
    const normalizedKey = /^\d+$/.test(key) ? Number(key) : key;
    if (isLast) {
      cursor[normalizedKey] = value;
      return;
    }

    const nextIsArray = /^\d+$/.test(keys[index + 1]);
    const currentValue = cursor[normalizedKey];
    const hasWrongContainerType =
      currentValue == null ||
      typeof currentValue !== "object" ||
      (nextIsArray && !Array.isArray(currentValue)) ||
      (!nextIsArray && Array.isArray(currentValue));
    if (hasWrongContainerType) {
      cursor[normalizedKey] = nextIsArray ? [] : {};
    }
    cursor = cursor[normalizedKey];
  });
}

async function translate(locale, sourceEntries) {
  const [languageName, localeGuidance] = localeProfiles[locale];
  const keys = Object.keys(sourceEntries);
  const prompt = [
    `Translate only the JSON values into ${languageName}.`,
    localeGuidance,
    "Use culturally neutral, respectful, idiomatic wording suitable for a global App Store productivity app.",
    "Adapt short English marketing idioms rather than translating them literally.",
    "Keep every JSON key exactly unchanged.",
    "Preserve Screenshot (App) Maker, App Store, Ollama, Apple product names, file formats, URLs, commands, HTML entities, and the exact HTML tag structure.",
    "Return one valid JSON object only, with exactly the same keys and no commentary.",
    JSON.stringify(sourceEntries),
  ].join("\n");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${ollamaURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          think: false,
          messages: [{ role: "user", content: prompt }],
          options: { temperature: 0.15 },
          keep_alive: "10m",
        }),
      });

      if (!response.ok) {
        throw new Error(`${locale}: Ollama returned ${response.status}`);
      }

      const body = await response.json();
      const translated = JSON.parse(body.message.content);
      const translatedKeys = Object.keys(translated);
      if (
        translatedKeys.length === keys.length &&
        keys.every((key) => typeof translated[key] === "string")
      ) {
        return translated;
      }
    } catch (error) {
      if (attempt === 3) throw error;
    }

    if (attempt === 3) {
      throw new Error(`${locale}: model output did not preserve the source keys`);
    }
  }
}

const english = JSON.parse(await readFile(resolve(localeRoot, "en.json"), "utf8"));
const englishEntries = flatten(english);
const localeFiles = (await readdir(localeRoot))
  .filter((fileName) => fileName.endsWith(".json") && fileName !== "en.json")
  .sort();

async function fillLocale(fileName) {
  const locale = fileName.replace(/\.json$/, "");
  if (!localeProfiles[locale]) return;

  const path = resolve(localeRoot, fileName);
  const dictionary = JSON.parse(await readFile(path, "utf8"));
  const needsForcedRefresh =
    valueAtPath(dictionary, "common.downloadIos") === undefined;
  const sourceEntries = Object.fromEntries(
    Object.entries(englishEntries).filter(
      ([key]) =>
        valueAtPath(dictionary, key) === undefined ||
        (needsForcedRefresh && forcedPaths.has(key)),
    ),
  );

  if (Object.keys(sourceEntries).length === 0) {
    console.log(`${locale}: already complete`);
    return;
  }

  console.log(`${locale}: translating ${Object.keys(sourceEntries).length} strings`);
  const translated = await translate(locale, sourceEntries);
  Object.entries(translated).forEach(([key, value]) =>
    setAtPath(dictionary, key, value),
  );
  await writeFile(path, `${JSON.stringify(dictionary, null, 2)}\n`, "utf8");
}

const queue = [...localeFiles];
const workerCount = 1;
await Promise.all(
  Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      await fillLocale(queue.shift());
    }
  }),
);
