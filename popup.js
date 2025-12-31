/* ═══════════════════════════════════════════════════════════════════════════
   FUSION BROWSE ASSISTANT - Popup Script
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// TRANSLATIONS
// ─────────────────────────────────────────────────────────────────────────────

const POPUP_TRANSLATIONS = {
  fr: {
    "popup.subtitle": "Assistant IA contextuel",
    "popup.status.checking": "Vérification...",
    "popup.status.connected": "API connectée • Prêt",
    "popup.status.error": "Erreur de connexion API",
    "popup.status.notConfigured": "API non configurée",
    "popup.openAssistant": "Ouvrir l'assistant",
    "popup.quickSummary": "Résumé rapide",
    "popup.quickSimplify": "Vulgariser",
    "popup.quickAnalyze": "Analyse critique",
    "popup.settings": "Paramètres",
    "popup.config.title": "Configuration API",
    "popup.config.apiKey": "Clé API Mistral",
    "popup.config.save": "Enregistrer",
    "popup.config.test": "Tester",
    "popup.config.findKey": "🔑 Où trouver ma clé API ?",
    "popup.config.enterKey": "Entrez une clé API valide.",
    "popup.config.saved": "Clé enregistrée !",
    "popup.config.noKey": "Aucune clé à tester.",
    "popup.config.testing": "Test en cours...",
    "popup.config.valid": "✅ Clé valide !",
    "popup.config.invalid": "❌ Clé invalide",
    "popup.config.configureFirst": "Configurez d'abord votre clé API.",
    "popup.footer": "Fusion Browse Assistant v1.0.0"
  },
  en: {
    "popup.subtitle": "Contextual AI Assistant",
    "popup.status.checking": "Checking...",
    "popup.status.connected": "API connected • Ready",
    "popup.status.error": "API connection error",
    "popup.status.notConfigured": "API not configured",
    "popup.openAssistant": "Open assistant",
    "popup.quickSummary": "Quick summary",
    "popup.quickSimplify": "Simplify",
    "popup.quickAnalyze": "Critical analysis",
    "popup.settings": "Settings",
    "popup.config.title": "API Configuration",
    "popup.config.apiKey": "Mistral API Key",
    "popup.config.save": "Save",
    "popup.config.test": "Test",
    "popup.config.findKey": "🔑 Where to find my API key?",
    "popup.config.enterKey": "Enter a valid API key.",
    "popup.config.saved": "Key saved!",
    "popup.config.noKey": "No key to test.",
    "popup.config.testing": "Testing...",
    "popup.config.valid": "✅ Key valid!",
    "popup.config.invalid": "❌ Invalid key",
    "popup.config.configureFirst": "Configure your API key first.",
    "popup.footer": "Fusion Browse Assistant v1.0.0"
  },
  de: {
    "popup.subtitle": "Kontextueller KI-Assistent",
    "popup.status.checking": "Überprüfung...",
    "popup.status.connected": "API verbunden • Bereit",
    "popup.status.error": "API-Verbindungsfehler",
    "popup.status.notConfigured": "API nicht konfiguriert",
    "popup.openAssistant": "Assistent öffnen",
    "popup.quickSummary": "Schnelle Zusammenfassung",
    "popup.quickSimplify": "Vereinfachen",
    "popup.quickAnalyze": "Kritische Analyse",
    "popup.settings": "Einstellungen",
    "popup.config.title": "API-Konfiguration",
    "popup.config.apiKey": "Mistral API-Schlüssel",
    "popup.config.save": "Speichern",
    "popup.config.test": "Testen",
    "popup.config.findKey": "🔑 Wo finde ich meinen API-Schlüssel?",
    "popup.config.enterKey": "Gib einen gültigen API-Schlüssel ein.",
    "popup.config.saved": "Schlüssel gespeichert!",
    "popup.config.noKey": "Kein Schlüssel zum Testen.",
    "popup.config.testing": "Testen...",
    "popup.config.valid": "✅ Schlüssel gültig!",
    "popup.config.invalid": "❌ Ungültiger Schlüssel",
    "popup.config.configureFirst": "Konfiguriere zuerst deinen API-Schlüssel.",
    "popup.footer": "Fusion Browse Assistant v1.0.0"
  },
  es: {
    "popup.subtitle": "Asistente IA contextual",
    "popup.status.checking": "Verificando...",
    "popup.status.connected": "API conectada • Listo",
    "popup.status.error": "Error de conexión API",
    "popup.status.notConfigured": "API no configurada",
    "popup.openAssistant": "Abrir asistente",
    "popup.quickSummary": "Resumen rápido",
    "popup.quickSimplify": "Simplificar",
    "popup.quickAnalyze": "Análisis crítico",
    "popup.settings": "Configuración",
    "popup.config.title": "Configuración API",
    "popup.config.apiKey": "Clave API Mistral",
    "popup.config.save": "Guardar",
    "popup.config.test": "Probar",
    "popup.config.findKey": "🔑 ¿Dónde encontrar mi clave API?",
    "popup.config.enterKey": "Introduce una clave API válida.",
    "popup.config.saved": "¡Clave guardada!",
    "popup.config.noKey": "No hay clave para probar.",
    "popup.config.testing": "Probando...",
    "popup.config.valid": "✅ ¡Clave válida!",
    "popup.config.invalid": "❌ Clave inválida",
    "popup.config.configureFirst": "Configura primero tu clave API.",
    "popup.footer": "Fusion Browse Assistant v1.0.0"
  }
};

let currentLang = "en";

// Detect browser language and return supported language code
function detectBrowserLanguage() {
  const browserLang = navigator.language || navigator.userLanguage || "en";
  const langCode = browserLang.split("-")[0].toLowerCase();
  
  // Return the language if supported, otherwise default to English
  if (POPUP_TRANSLATIONS[langCode]) {
    return langCode;
  }
  return "en";
}

// Get stored language or detect from browser
async function getLanguage() {
  return new Promise(resolve => {
    chrome.storage.local.get(["mistralLanguage"], (result) => {
      if (result.mistralLanguage && POPUP_TRANSLATIONS[result.mistralLanguage]) {
        resolve(result.mistralLanguage);
      } else {
        // Auto-detect from browser
        const detected = detectBrowserLanguage();
        // Save the detected language
        chrome.storage.local.set({ mistralLanguage: detected });
        resolve(detected);
      }
    });
  });
}

// Translation function
function t(key) {
  return POPUP_TRANSLATIONS[currentLang]?.[key] || POPUP_TRANSLATIONS["en"]?.[key] || key;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────

const statusEl = document.getElementById("popup-status");
const statusText = statusEl.querySelector(".popup-status-text");

const openPanelBtn = document.getElementById("open-panel-btn");
const quickSummaryBtn = document.getElementById("quick-summary");
const quickSimplifyBtn = document.getElementById("quick-simplify");
const quickCritiqueBtn = document.getElementById("quick-critique");
const openSettingsBtn = document.getElementById("open-settings");

const configSection = document.getElementById("popup-config");
const closeConfigBtn = document.getElementById("close-config");
const apiKeyInput = document.getElementById("api-key-input");
const toggleKeyBtn = document.getElementById("toggle-key");
const saveKeyBtn = document.getElementById("save-key");
const testKeyBtn = document.getElementById("test-key");
const configMessage = document.getElementById("config-message");

// ─────────────────────────────────────────────────────────────────────────────
// APPLY TRANSLATIONS
// ─────────────────────────────────────────────────────────────────────────────

function applyTranslations() {
  // Subtitle
  const subtitle = document.getElementById("popup-subtitle");
  if (subtitle) subtitle.textContent = t("popup.subtitle");

  // Open assistant button
  const openBtnText = document.getElementById("open-panel-text");
  if (openBtnText) openBtnText.textContent = t("popup.openAssistant");

  // Quick action tooltips
  if (quickSummaryBtn) quickSummaryBtn.title = t("popup.quickSummary");
  if (quickSimplifyBtn) quickSimplifyBtn.title = t("popup.quickSimplify");
  if (quickCritiqueBtn) quickCritiqueBtn.title = t("popup.quickAnalyze");
  if (openSettingsBtn) openSettingsBtn.title = t("popup.settings");

  // Config section
  const configTitle = document.getElementById("config-title");
  if (configTitle) configTitle.textContent = t("popup.config.title");

  const apiKeyLabel = document.getElementById("api-key-label");
  if (apiKeyLabel) apiKeyLabel.textContent = t("popup.config.apiKey");

  if (saveKeyBtn) saveKeyBtn.textContent = t("popup.config.save");
  if (testKeyBtn) testKeyBtn.textContent = t("popup.config.test");

  const helpLink = document.getElementById("help-link");
  if (helpLink) helpLink.textContent = t("popup.config.findKey");

  // Footer
  const footer = document.getElementById("popup-footer-text");
  if (footer) footer.textContent = t("popup.footer");
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  // Get language first
  currentLang = await getLanguage();
  
  // Apply translations
  applyTranslations();
  
  // Check API key status
  const apiKey = await getStoredKey();
  updateStatus(apiKey ? "connected" : "none");
  
  if (apiKey) {
    apiKeyInput.value = apiKey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────────

function updateStatus(state) {
  statusEl.className = "popup-status";
  
  switch (state) {
    case "connected":
      statusEl.classList.add("connected");
      statusText.textContent = t("popup.status.connected");
      break;
    case "error":
      statusEl.classList.add("error");
      statusText.textContent = t("popup.status.error");
      break;
    default:
      statusText.textContent = t("popup.status.notConfigured");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OUVRIR LE PANNEAU
// ─────────────────────────────────────────────────────────────────────────────

async function openPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Injecter le content script si nécessaire et envoyer le message
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["contentScript.js"]
    });
  } catch (e) {
    // Le script est peut-être déjà injecté
  }

  // Envoyer le message pour toggle le dock
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggleDock" });
  } catch (e) {
    // Ignorer les erreurs si le content script n'est pas prêt
  }
  
  // Fermer le popup
  window.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS RAPIDES
// ─────────────────────────────────────────────────────────────────────────────

async function executeQuickAction(actionType) {
  const apiKey = await getStoredKey();
  if (!apiKey) {
    showConfigMessage("error", t("popup.config.configureFirst"));
    configSection.classList.remove("hidden");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Ouvrir le panneau et exécuter l'action
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["contentScript.js"]
    });
  } catch (e) {
    // Script déjà injecté
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggleDock" });
  } catch (e) {
    // Ignorer
  }
  
  // Petit délai pour que le dock s'ouvre avant d'exécuter l'action
  setTimeout(async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { 
        type: "executeAction", 
        action: actionType 
      });
    } catch (e) {
      // Ignorer
    }
  }, 300);

  window.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

function toggleConfig() {
  configSection.classList.toggle("hidden");
}

function toggleKeyVisibility() {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  toggleKeyBtn.textContent = apiKeyInput.type === "password" ? "👁️" : "🙈";
}

async function saveKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showConfigMessage("error", t("popup.config.enterKey"));
    return;
  }

  await chrome.storage.local.set({ mistralApiKey: key });
  showConfigMessage("success", t("popup.config.saved"));
  updateStatus("connected");
}

async function testKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showConfigMessage("error", t("popup.config.noKey"));
    return;
  }

  showConfigMessage("", t("popup.config.testing"));
  
  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "testApiKey", apiKey: key }, resolve);
  });

  if (result?.valid) {
    showConfigMessage("success", t("popup.config.valid"));
    updateStatus("connected");
  } else {
    showConfigMessage("error", `${t("popup.config.invalid")} ${result?.error || ""}`);
    updateStatus("error");
  }
}

function showConfigMessage(type, text) {
  configMessage.className = "popup-config-message";
  if (type) configMessage.classList.add(type);
  configMessage.textContent = text;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getStoredKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(["mistralApiKey"], (result) => {
      resolve(result.mistralApiKey || "");
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

openPanelBtn.addEventListener("click", openPanel);
quickSummaryBtn.addEventListener("click", () => executeQuickAction("summary"));
quickSimplifyBtn.addEventListener("click", () => executeQuickAction("simplify"));
quickCritiqueBtn.addEventListener("click", () => executeQuickAction("critique"));
openSettingsBtn.addEventListener("click", toggleConfig);
closeConfigBtn.addEventListener("click", toggleConfig);
toggleKeyBtn.addEventListener("click", toggleKeyVisibility);
saveKeyBtn.addEventListener("click", saveKey);
testKeyBtn.addEventListener("click", testKey);

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

init();
