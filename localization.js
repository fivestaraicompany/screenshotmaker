const SUPPORTED_LANGUAGES = [
  "en",
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "es-MX",
  "fi",
  "fr",
  "fr-CA",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "nb",
  "nl",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sk",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-Hans",
  "zh-Hant",
];

const LANGUAGE_LABELS = {
  en: "English",
  af: "Afrikaans",
  am: "አማርኛ",
  ar: "العربية",
  az: "Azərbaycanca",
  be: "Беларуская",
  bg: "Български",
  bn: "বাংলা",
  ca: "Català",
  cs: "Čeština",
  da: "Dansk",
  de: "Deutsch",
  el: "Ελληνικά",
  es: "Español",
  "es-MX": "Español (México)",
  fi: "Suomi",
  fr: "Français",
  "fr-CA": "Français (Canada)",
  he: "עברית",
  hi: "हिन्दी",
  hr: "Hrvatski",
  hu: "Magyar",
  id: "Bahasa Indonesia",
  it: "Italiano",
  ja: "日本語",
  ko: "한국어",
  ms: "Bahasa Melayu",
  nb: "Norsk Bokmål",
  nl: "Nederlands",
  pl: "Polski",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  ro: "Română",
  ru: "Русский",
  sk: "Slovenčina",
  sv: "Svenska",
  th: "ไทย",
  tr: "Türkçe",
  uk: "Українська",
  vi: "Tiếng Việt",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

const RTL_LANGUAGES = new Set(["ar", "he"]);
const STORAGE_KEY = "screenshotMakerLanguage";
const dictionaryCache = new Map();

function normalizeLanguage(value) {
  if (!value) return null;

  const normalized = String(value)
    .trim()
    .replaceAll("_", "-")
    .toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find(
    (language) => language.toLowerCase() === normalized,
  );
  if (exact) return exact;

  const [base, region] = normalized.split("-");
  if (base === "zh") {
    return ["tw", "hk", "mo", "hant"].includes(region)
      ? "zh-Hant"
      : "zh-Hans";
  }
  if (base === "pt") return region === "br" ? "pt-BR" : "pt-PT";
  if (base === "fr" && region === "ca") return "fr-CA";
  if (base === "es" && region === "mx") return "es-MX";
  if (base === "no") return "nb";
  if (base === "iw") return "he";
  if (base === "in") return "id";

  return (
    SUPPORTED_LANGUAGES.find((language) => language.toLowerCase() === base) ??
    null
  );
}

function initialLanguage() {
  const urlLanguage = normalizeLanguage(
    new URL(window.location.href).searchParams.get("lang"),
  );
  if (urlLanguage) return urlLanguage;

  let storedLanguage = null;
  try {
    storedLanguage = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage may be unavailable in privacy-focused browser modes.
  }
  if (storedLanguage) return storedLanguage;

  for (const browserLanguage of navigator.languages ?? [navigator.language]) {
    const supportedLanguage = normalizeLanguage(browserLanguage);
    if (supportedLanguage) return supportedLanguage;
  }

  return "en";
}

function valueAtPath(dictionary, path) {
  return path
    .split(".")
    .reduce(
      (value, key) =>
        value && Object.hasOwn(value, key) ? value[key] : undefined,
      dictionary,
    );
}

async function fetchDictionary(language) {
  if (!dictionaryCache.has(language)) {
    dictionaryCache.set(
      language,
      fetch(`./i18n/${language}.json`).then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load language resource: ${language}`);
        }
        return response.json();
      }),
    );
  }
  return dictionaryCache.get(language);
}

function translatedValue(primary, fallback, key) {
  return valueAtPath(primary, key) ?? valueAtPath(fallback, key);
}

function setLocalizedHtml(element, value) {
  const template = document.createElement("template");
  template.innerHTML = value;
  const allowedTags = new Set(["BR", "CODE", "SPAN", "STRONG"]);

  template.content.querySelectorAll("*").forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }

    [...node.attributes].forEach((attribute) => {
      const isBrandClass =
        node.tagName === "SPAN" &&
        attribute.name === "class" &&
        attribute.value === "brand-soft";
      if (!isBrandClass) node.removeAttribute(attribute.name);
    });
  });

  element.replaceChildren(template.content.cloneNode(true));
}

function updateLocalizedLinks(language) {
  document.querySelectorAll("[data-keep-lang]").forEach((link) => {
    const url = new URL(link.getAttribute("href"), window.location.href);
    if (language === "en") {
      url.searchParams.delete("lang");
    } else {
      url.searchParams.set("lang", language);
    }
    link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
  });
}

function applyDictionary(language, dictionary, englishDictionary) {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = translatedValue(
      dictionary,
      englishDictionary,
      element.dataset.i18n,
    );
    if (typeof value === "string") element.textContent = value;
  });

  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const value = translatedValue(
      dictionary,
      englishDictionary,
      element.dataset.i18nHtml,
    );
    if (typeof value === "string") setLocalizedHtml(element, value);
  });

  document.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    element.dataset.i18nAttr.split("|").forEach((entry) => {
      const separator = entry.indexOf(":");
      if (separator === -1) return;
      const attribute = entry.slice(0, separator);
      const key = entry.slice(separator + 1);
      const value = translatedValue(dictionary, englishDictionary, key);
      if (typeof value === "string") element.setAttribute(attribute, value);
    });
  });

  const titleKey = document.documentElement.dataset.metaTitleKey;
  const descriptionKey = document.documentElement.dataset.metaDescriptionKey;
  const title = titleKey
    ? translatedValue(dictionary, englishDictionary, titleKey)
    : null;
  const description = descriptionKey
    ? translatedValue(dictionary, englishDictionary, descriptionKey)
    : null;

  if (typeof title === "string") document.title = title;
  if (typeof description === "string") {
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", description);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", description);
    document
      .querySelector('meta[name="twitter:description"]')
      ?.setAttribute("content", description);
  }
  if (typeof title === "string") {
    document
      .querySelector('meta[property="og:title"]')
      ?.setAttribute("content", title);
    document
      .querySelector('meta[name="twitter:title"]')
      ?.setAttribute("content", title);
  }

  document.documentElement.lang = language;
  document.documentElement.dir = RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
  document.querySelectorAll("[data-language-code]").forEach((element) => {
    element.textContent = language.toUpperCase();
  });
  updateLocalizedLinks(language);
}

function createLanguageDialog(englishDictionary) {
  const dialog = document.createElement("dialog");
  dialog.className = "language-dialog";
  dialog.id = "languageDialog";
  dialog.innerHTML = `
    <div class="language-dialog-header">
      <div>
        <span class="language-dialog-kicker" data-i18n="language.kicker">${valueAtPath(englishDictionary, "language.kicker")}</span>
        <strong id="languageDialogTitle" data-i18n="language.title">${valueAtPath(englishDictionary, "language.title")}</strong>
      </div>
      <button class="language-dialog-close" type="button" data-language-close data-i18n-attr="aria-label:language.close" aria-label="${valueAtPath(englishDictionary, "language.close")}">×</button>
    </div>
    <div class="language-list"></div>
    <p class="language-dialog-hint" data-i18n="language.hint">${valueAtPath(englishDictionary, "language.hint")}</p>
  `;

  const list = dialog.querySelector(".language-list");
  SUPPORTED_LANGUAGES.forEach((language) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "language-option";
    button.dataset.language = language;
    button.innerHTML = `
      <span>${LANGUAGE_LABELS[language]}</span>
      <small>${language}</small>
    `;
    list.append(button);
  });

  dialog.querySelector("[data-language-close]").addEventListener("click", () => {
    dialog.close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

async function initializeLocalization() {
  const englishDictionary = await fetchDictionary("en");
  const dialog = createLanguageDialog(englishDictionary);
  const buttons = document.querySelectorAll("[data-language-button]");
  let currentLanguage = initialLanguage();

  async function selectLanguage(language, updateUrl = false) {
    const normalized = normalizeLanguage(language) ?? "en";
    let dictionary = englishDictionary;

    if (normalized !== "en") {
      try {
        dictionary = await fetchDictionary(normalized);
      } catch {
        dictionary = englishDictionary;
      }
    }

    currentLanguage = normalized;
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // The URL still preserves the selected language when storage is blocked.
    }
    applyDictionary(normalized, dictionary, englishDictionary);

    dialog.querySelectorAll(".language-option").forEach((option) => {
      const isSelected = option.dataset.language === normalized;
      option.classList.toggle("selected", isSelected);
      option.setAttribute("aria-current", isSelected ? "true" : "false");
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (normalized === "en") {
        url.searchParams.delete("lang");
      } else {
        url.searchParams.set("lang", normalized);
      }
      history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => dialog.showModal());
  });

  dialog.querySelectorAll(".language-option").forEach((option) => {
    option.addEventListener("click", async () => {
      await selectLanguage(option.dataset.language, true);
      dialog.close();
    });
  });

  window.addEventListener("popstate", () => {
    const language =
      normalizeLanguage(new URL(window.location.href).searchParams.get("lang")) ??
      currentLanguage;
    selectLanguage(language);
  });

  await selectLanguage(currentLanguage);
}

initializeLocalization().catch(() => {
  document.documentElement.lang = "en";
});
