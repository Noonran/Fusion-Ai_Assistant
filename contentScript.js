/* ═══════════════════════════════════════════════════════════════════════════
   FUSION BROWSE ASSISTANT - Content Script
   Panneau latéral docké à droite avec interface complète
   ═══════════════════════════════════════════════════════════════════════════ */

// Éviter les multiples injections
if (window.__MISTRAL_ASSISTANT_LOADED__) {
  // Script déjà chargé, ne pas réexécuter
} else {
  window.__MISTRAL_ASSISTANT_LOADED__ = true;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS EXTRACTION TEXTE
// ─────────────────────────────────────────────────────────────────────────────

function cleanText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function getPageText() {
  const bodyText = document.body?.innerText || "";
  return cleanText(bodyText);
}

function getSelectionText() {
  const selection = window.getSelection();
  return cleanText(selection ? selection.toString() : "");
}

function getPageMeta() {
  return {
    title: document.title || "Page sans titre",
    url: window.location.href,
    favicon: `https://www.google.com/s2/favicons?domain=${window.location.hostname}&sz=32`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function isYouTubePage() {
  return window.location.hostname.includes('youtube.com') && 
         (window.location.pathname.includes('/watch') || window.location.pathname.includes('/shorts'));
}

function getYouTubeVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');
  if (videoId) return videoId;
  
  // Pour les shorts
  const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch) return shortsMatch[1];
  
  return null;
}

function extractYouTubeInfo() {
  if (!isYouTubePage()) {
    return { error: "not_youtube", message: "Cette page n'est pas une vidéo YouTube" };
  }

  const videoId = getYouTubeVideoId();
  if (!videoId) {
    return { error: "no_video_id", message: t("error.noVideoId") };
  }

  // Extraire le titre
  const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata, #title h1, ytd-watch-metadata h1');
  const title = titleEl?.textContent?.trim() || document.title.replace(' - YouTube', '').trim();

  // Extraire la description
  const descEl = document.querySelector('#description-inner, ytd-text-inline-expander, #description');
  let description = descEl?.textContent?.trim() || "";
  description = description.slice(0, 3000); // Limiter

  // Extraire le nom de la chaîne
  const channelEl = document.querySelector('#channel-name a, ytd-channel-name a, #owner-name a');
  const channel = channelEl?.textContent?.trim() || "";

  // Extraire les vues et la date
  const viewsEl = document.querySelector('#info-strings yt-formatted-string, #info span');
  const views = viewsEl?.textContent?.trim() || "";

  // Extraire la durée
  const durationEl = document.querySelector('.ytp-time-duration');
  const duration = durationEl?.textContent?.trim() || "";

  // Extraire les chapitres s'ils existent
  const chapters = [];
  document.querySelectorAll('ytd-macro-markers-list-item-renderer, ytd-chapter-renderer').forEach((chapterEl, index) => {
    if (index < 30) { // Limiter à 30 chapitres
      const timeEl = chapterEl.querySelector('#time, .ytd-chapter-renderer-time');
      const titleEl = chapterEl.querySelector('#details h4, .ytd-chapter-renderer-title');
      if (timeEl && titleEl) {
        chapters.push({
          time: timeEl.textContent?.trim() || "",
          title: titleEl.textContent?.trim() || ""
        });
      }
    }
  });

  // Extraire les sous-titres/transcript
  let transcript = "";
  let captionTracks = [];
  
  // Méthode 1: Extraire depuis ytInitialPlayerResponse (contient les URLs des sous-titres)
  try {
    // Chercher dans tous les scripts
    const pageHtml = document.documentElement.innerHTML;
    
    // Pattern plus large pour trouver captionTracks
    const captionMatch = pageHtml.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/);
    if (captionMatch) {
      try {
        const captionsData = JSON.parse(captionMatch[1]);
        if (captionsData && captionsData.length > 0) {
          captionTracks = captionsData.map(c => ({
            languageCode: c.languageCode,
            name: c.name?.simpleText || c.languageCode,
            baseUrl: c.baseUrl,
            isAutoGenerated: c.kind === 'asr'
          }));
        }
      } catch (e) {}
    }
    
    // Méthode alternative: chercher ytInitialPlayerResponse
    if (!captionTracks.length) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('captionTracks')) {
          const match = text.match(/"captionTracks"\s*:\s*(\[.*?\])/s);
          if (match) {
            try {
              const parsed = JSON.parse(match[1].replace(/\\"/g, '"'));
              if (parsed && parsed.length > 0) {
                captionTracks = parsed.map(c => ({
                  languageCode: c.languageCode,
                  name: c.name?.simpleText || c.languageCode,
                  baseUrl: c.baseUrl,
                  isAutoGenerated: c.kind === 'asr'
                }));
              }
            } catch (e) {}
          }
          if (captionTracks.length) break;
        }
      }
    }
  } catch (e) {
    console.log("Erreur extraction captions:", e);
  }
  
  // Méthode 2: Essayer le panel de transcript visible dans le DOM
  const transcriptPanel = document.querySelector('ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
  if (transcriptPanel) {
    const segments = transcriptPanel.querySelectorAll('ytd-transcript-segment-renderer, yt-formatted-string.segment-text');
    segments.forEach((seg, index) => {
      if (index < 2000) { // Limite élevée pour vidéos longues
        const time = seg.querySelector('.segment-timestamp')?.textContent?.trim() || "";
        const text = seg.querySelector('.segment-text')?.textContent?.trim() || seg.textContent?.trim() || "";
        if (text) {
          transcript += `[${time}] ${text}\n`;
        }
      }
    });
  }

  // Extraire les commentaires populaires (premiers)
  const comments = [];
  document.querySelectorAll('ytd-comment-thread-renderer').forEach((commentEl, index) => {
    if (index < 5) {
      const textEl = commentEl.querySelector('#content-text');
      const authorEl = commentEl.querySelector('#author-text');
      if (textEl) {
        comments.push({
          author: authorEl?.textContent?.trim() || "Anonymous",
          text: textEl.textContent?.trim().slice(0, 500) || ""
        });
      }
    }
  });

  return {
    videoId,
    title,
    channel,
    description,
    duration,
    views,
    chapters,
    transcript,
    captionTracks,
    comments,
    url: window.location.href
  };
}

// Fonction pour récupérer le transcript depuis l'URL des sous-titres
async function fetchYouTubeTranscript(captionUrl) {
  try {
    // Ajouter le format JSON aux paramètres
    const url = new URL(captionUrl);
    url.searchParams.set('fmt', 'json3');
    
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error('Erreur fetch transcript');
    
    const data = await response.json();
    
    let transcriptText = "";
    if (data.events) {
      for (const event of data.events) {
        if (event.segs) {
          const text = event.segs.map(s => s.utf8 || '').join('');
          if (text.trim()) {
            const timeMs = event.tStartMs || 0;
            const seconds = Math.floor(timeMs / 1000);
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            const timeStr = `${minutes}:${secs.toString().padStart(2, '0')}`;
            transcriptText += `[${timeStr}] ${text.trim()}\n`;
          }
        }
      }
    }
    
    return transcriptText;
  } catch (error) {
    console.error("Erreur fetch transcript:", error);
    return null;
  }
}

// Fonction pour télécharger le transcript en fichier .txt
function downloadTranscriptAsFile(transcript, videoTitle) {
  const sanitizedTitle = videoTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  const filename = `transcript_${sanitizedTitle}.txt`;
  
  const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  
  return filename;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADUCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const TRANSLATIONS = {
  fr: {
    // Header
    "header.title": "Fusion Assistant",
    "header.status.connected": "Connecté",
    "header.status.notConfigured": "Non configuré",
    "header.status.error": "Erreur API",
    "header.status.warning": "Attention",
    
    // Tabs
    "tabs.chat": "💬 Chat",
    "tabs.actions": "⚡ Actions",
    "tabs.agents": "🤖 Agents",
    "tabs.integration": "🔗 Intégration",
    
    // Settings
    "settings.title": "Configuration Mistral",
    "settings.language": "🌍 Langue de l'extension",
    "settings.model": "🤖 Modèle IA",
    "settings.modelSaved": "Modèle enregistré !",
    "settings.apiKey": "🔑 Clé API Mistral",
    "settings.save": "Enregistrer",
    "settings.test": "Tester",
    "settings.delete": "Supprimer",
    "settings.agents": "🤖 Mes Agents",
    "settings.addAgent": "+ Ajouter un agent",
    "settings.agentName": "Nom de l'agent",
    "settings.agentId": "ID (ag:xxxxxxxx...)",
    "settings.cancel": "Annuler",
    "settings.findKey": "🔑 Où trouver ma clé API ?",
    "settings.createAgent": "🤖 Créer un agent",
    "settings.checkUpdate": "🔄 Vérifier les mises à jour",
    "settings.updateAvailable": "✨ Nouvelle version disponible !",
    "settings.upToDate": "✅ À jour",
    "settings.keySaved": "Clé enregistrée !",
    "settings.keyValid": "✅ Clé valide !",
    "settings.keyInvalid": "❌ Clé invalide",
    "settings.keyDeleted": "Clé supprimée",
    "settings.langSaved": "Langue enregistrée !",
    "settings.agentAdded": "Agent ajouté !",
    "settings.enterKey": "Veuillez entrer une clé API.",
    "settings.noKeyToTest": "Aucune clé à tester.",
    "settings.testing": "Test en cours...",
    "settings.enterAgentName": "Veuillez entrer un nom pour l'agent",
    "settings.enterAgentId": "Veuillez entrer l'ID de l'agent",
    "settings.invalidAgentId": "L'ID doit commencer par 'ag:'",
    "settings.agentExists": "Cet agent existe déjà",
    "settings.confirmDeleteAgent": "Supprimer l'agent",
    "settings.confirmDeleteKey": "Supprimer la clé API ?",
    "settings.agentDeleted": "Agent supprimé",
    "agents.noDate": "Non disponible",
    
    // Onboarding
    "onboarding.title": "Configure ton assistant",
    "onboarding.desc": "Pour utiliser Fusion Browse Assistant, ajoute ta clé API Mistral. Elle est stockée uniquement sur ton navigateur.",
    "onboarding.placeholder": "Colle ta clé API ici (sk-...)",
    "onboarding.save": "Enregistrer et commencer",
    
    // Chat
    "chat.empty.title": "Bienvenue !",
    "chat.empty.desc": "Posez une question ou utilisez une action rapide ci-dessous.",
    "chat.placeholder": "Posez une question sur cette page...",
    "chat.send": "Envoyer",
    
    // Quick actions
    "quick.summary": "📝 Résumé",
    "quick.simplify": "🎓 Vulgariser",
    "quick.analyze": "🔍 Analyse",
    "quick.selection": "✂️ Utiliser la sélection",
    
    // Action sections
    "action.section.analysis": "📊 Analyse de page",
    "action.section.rewrite": "✍️ Réécriture professionnelle",
    "action.section.generate": "🚀 Génération de contenu",
    
    // Action cards - Analysis
    "action.summary.title": "Résumé",
    "action.summary.desc": "Points clés en quelques lignes",
    "action.critique.title": "Analyse complète",
    "action.critique.desc": "Analyse + recherche web + sources",
    "action.highlight.title": "Surligner les idées clés",
    "action.highlight.desc": "Surligne arguments, définitions, chiffres clés",
    "action.extract.title": "Extraire les données",
    "action.extract.desc": "Tableaux CSV, listes, concepts clés",
    "action.compare.title": "Comparer des pages",
    "action.compare.desc": "Tableau comparatif multi-onglets",
    
    // Action cards - Rewrite
    "action.simplify.title": "Simplifier (enfant 10 ans)",
    "action.simplify.desc": "Vocabulaire simple, exemples concrets",
    "action.scientific.title": "Style scientifique",
    "action.scientific.desc": "Ton académique et précis",
    "action.journalistic.title": "Style journalistique",
    "action.journalistic.desc": "Accroche, pyramide inversée",
    "action.marketing.title": "Style marketing",
    "action.marketing.desc": "Persuasif, call-to-action",
    "action.uxcopy.title": "Style UX Copy",
    "action.uxcopy.desc": "Clair, actionnable, guidant",
    "action.twitter.title": "Thread Twitter/X",
    "action.twitter.desc": "Format viral en plusieurs tweets",
    "action.linkedin.title": "Post LinkedIn",
    "action.linkedin.desc": "Storytelling professionnel",
    
    // Action cards - Generate
    "action.articleplan.title": "Plan d'article",
    "action.articleplan.desc": "Structure complète + SEO",
    "action.youtubeplan.title": "Plan vidéo YouTube",
    "action.youtubeplan.desc": "Script, chapitres, description",
    "action.emailseq.title": "Séquence email",
    "action.emailseq.desc": "Emails structurés avec CTA",
    "action.tutorial.title": "Tutoriel structuré",
    "action.tutorial.desc": "Étapes détaillées + check-list",
    "action.contactemail.title": "Prise de contact",
    "action.contactemail.desc": "Email professionnel avec analyse du contexte",
    "action.translate.title": "Traduire",
    "action.translate.desc": "Traduire le contenu principal",
    
    // YouTube & Agent sections
    "action.section.youtube": "🎬 YouTube",
    "action.section.agent": "🤖 Agent intelligent",
    "action.ytsum.title": "Résumer la vidéo",
    "action.ytsum.desc": "Résumé complet avec chapitres et points clés",
    "action.ytkey.title": "Points clés",
    "action.ytkey.desc": "Les idées principales en bullet points",
    "action.yttrans.title": "Extraire le transcript",
    "action.yttrans.desc": "Texte complet de la vidéo si disponible",
    "action.pageagent.title": "Agent de Page",
    "action.pageagent.desc": "L'IA analyse et interagit avec la page",
    
    // YouTube actions (legacy)
    "action.youtube.section": "🎬 YouTube",
    "action.youtube.summarize.title": "Résumer la vidéo",
    "action.youtube.summarize.desc": "Résumé complet avec chapitres et points clés",
    "action.youtube.keyPoints.title": "Points clés",
    "action.youtube.keyPoints.desc": "Les idées principales en bullet points",
    "action.youtube.transcript.title": "Extraire le transcript",
    "action.youtube.transcript.desc": "Texte complet de la vidéo si disponible",
    "action.youtube.notYoutube": "Cette fonctionnalité est réservée aux vidéos YouTube",
    "action.youtube.analyzing": "Analyse de la vidéo en cours...",
    
    // Agents tab
    "agents.title": "Agent actif",
    "agents.desc": "Sélectionnez l'agent à utiliser pour vos conversations",
    "agents.default": "🔹 Mistral Small (par défaut)",
    "agents.noAgent": "Sélectionner un agent...",
    "agents.manage": "⚙️",
    "agents.empty.title": "Discutez avec un Agent",
    "agents.empty.desc": "Sélectionnez un agent ci-dessus pour démarrer une conversation dédiée.",
    "agents.addFirst": "➕ Ajouter un agent",
    "agents.placeholder": "Posez une question à l'agent...",
    "agents.selectFirst": "Veuillez sélectionner un agent",
    "agents.thinking": "L'agent réfléchit...",
    "agents.welcome": "Bonjour ! Je suis **{name}**. Comment puis-je vous aider ?",
    
    // Integration
    "integration.title": "Intégrations Documents",
    "integration.desc": "Connectez vos Google Docs, Slides et Sheets pour les analyser et modifier avec l'IA",
    "integration.placeholder": "Collez un lien Google Docs/Slides/Sheets...",
    "integration.add": "Ajouter",
    "integration.empty": "Aucun document connecté",
    "integration.emptyHint": "Ajoutez un lien pour commencer",
    "integration.analyze": "📊 Analyser",
    "integration.summarize": "📝 Résumer",
    "integration.suggest": "💡 Suggestions",
    "integration.inputPlaceholder": "Demandez une modification ou analyse...",
    "integration.docAdded": "Document ajouté",
    "integration.docRemoved": "Document supprimé",
    "integration.invalidUrl": "URL non reconnue. Utilisez un lien Google Docs, Sheets ou Slides.",
    "integration.alreadyAdded": "Ce document est déjà ajouté.",
    "integration.cannotExtractId": "Impossible d'extraire l'ID du document.",
    "integration.enterUrl": "Veuillez entrer une URL",
    "integration.selectFirst": "Sélectionnez d'abord un document",
    "integration.confirmDelete": "Supprimer ce document ?",
    "integration.selected": "**{title}** sélectionné.\n\nJe peux analyser, résumer ou vous aider à modifier ce document. Que souhaitez-vous faire ?",
    
    // Context
    "context.refreshed": "Contexte actualisé !",
    "context.title": "Contexte de la page",
    "context.refresh": "🔄",
    
    // Errors
    "error.noKey": "Configure ta clé Mistral pour activer cette fonctionnalité.",
    "error.api": "Erreur lors de l'appel API.",
    "error.generic": "Une erreur est survenue.",
    
    // Chat messages
    "chat.noResponse": "Pas de réponse.",
    "chat.analyzing": "Analyse en cours...",
    "chat.copy": "Copier",
    "chat.regenerate": "Régénérer",
    "chat.copied": "Copié !",
    "chat.extracting": "Extraction des informations...",
    "chat.searching": "Recherche d'informations complémentaires en cours...",
    "chat.comparing": "Comparaison en cours...",
    "chat.extractingData": "Extraction des données en cours...",
    "chat.highlightingIdeas": "Identification des idées clés, arguments et chiffres importants...",
    "chat.pageAgentWorking": "Analyse de la page et du comportement en cours...",
    "chat.extractingContent": "Extraction du contenu en cours...",
    "chat.testingKey": "Test de la clé en cours...",
    "chat.verifying": "Vérification...",
    "chat.saveAndTest": "Enregistrer et tester",
    "chat.keyValidRedirect": "Clé valide ! Redirection...",
    "chat.keyInvalidCheck": "Clé invalide. Vérifiez-la.",
    "chat.error": "Erreur",
    "integration.addCurrentPage": "Ajouter cette page",
    "integration.contentAvailable": "Contenu disponible",
    "integration.openDocToAnalyze": "Ouvrir le document pour analyser",
    "integration.openDocAndRetry": "Ouvre le document dans un onglet puis réessaie",
    "ui.changeLanguage": "Changer la langue",
    "ui.settings": "Paramètres",
    "ui.checkUpdates": "Vérifier les mises à jour",
    "ui.refreshContent": "Actualiser le contenu",
    "ui.manageAgents": "Gérer les agents",
    "ui.refreshDocContent": "Rafraîchir le contenu",
    "ui.close": "Fermer",
    "ui.send": "Envoyer",
    "ui.add": "Ajouter",
    "ui.open": "Ouvrir",
    "ui.delete": "Supprimer",
    "ui.apiStatus": "Statut API",
    "error.noVideoId": "Impossible de trouver l'ID de la vidéo",
    "error.noResponse": "Pas de réponse.",
    "error.tooManyRequests": "Trop de requêtes. Attendez un moment.",
    "error.connectionError": "Erreur de connexion",
    "error.apiError": "Erreur lors de l'appel API",
    "chat.preparingComparison": "Préparation de la comparaison...",
    "chat.retrievingTabs": "Récupération des onglets ouverts...",
    "onboarding.findKey": "Où trouver ma clé ?",
    "model.recommended": "Recommandé",
    "agents.add": "+ Ajouter",
    "actionLabel.summary": "📝 Résumé de la page",
    "actionLabel.detailed": "📚 Résumé détaillé",
    "actionLabel.simplify": "🎓 Vulgarisation",
    "actionLabel.translate": "🌍 Traduction",
    "actionLabel.critique": "🔍 Analyse complète",
    "actionLabel.plan": "📋 Plan de contenu",
    "actionLabel.pageAgent": "🤖 Agent de Page",
    "actionLabel.highlightKeyIdeas": "🖍️ Idées clés identifiées",
    "actionLabel.extractData": "📦 Données extraites",
    "actionLabel.comparePages": "⚖️ Comparaison de pages",
    "actionLabel.rewriteScientific": "🔬 Réécriture scientifique",
    "actionLabel.rewriteJournalistic": "📰 Réécriture journalistique",
    "actionLabel.rewriteMarketing": "🎯 Réécriture marketing",
    "actionLabel.rewriteUXCopy": "💻 Réécriture UX",
    "actionLabel.rewriteTwitterThread": "🐦 Thread Twitter",
    "actionLabel.rewriteLinkedIn": "💼 Post LinkedIn",
    "actionLabel.generateArticlePlan": "📝 Plan d'article",
    "actionLabel.generateYouTubePlan": "🎬 Plan YouTube",
    "actionLabel.generateEmailSequence": "📧 Séquence email",
    "actionLabel.generateTutorial": "📖 Tutoriel structuré",
    "actionLabel.generateContactEmail": "✉️ Prise de contact"
  },
  
  en: {
    // Header
    "header.title": "Fusion Assistant",
    "header.status.connected": "Connected",
    "header.status.notConfigured": "Not configured",
    "header.status.error": "API Error",
    "header.status.warning": "Warning",
    
    // Tabs
    "tabs.chat": "💬 Chat",
    "tabs.actions": "⚡ Actions",
    "tabs.agents": "🤖 Agents",
    "tabs.integration": "🔗 Integration",
    
    // Settings
    "settings.title": "Mistral Configuration",
    "settings.language": "🌍 Extension Language",
    "settings.model": "🤖 AI Model",
    "settings.modelSaved": "Model saved!",
    "settings.apiKey": "🔑 Mistral API Key",
    "settings.save": "Save",
    "settings.test": "Test",
    "settings.delete": "Delete",
    "settings.agents": "🤖 My Agents",
    "settings.addAgent": "+ Add an agent",
    "settings.agentName": "Agent name",
    "settings.agentId": "ID (ag:xxxxxxxx...)",
    "settings.cancel": "Cancel",
    "settings.findKey": "🔑 Where to find my API key?",
    "settings.createAgent": "🤖 Create an agent",
    "settings.checkUpdate": "🔄 Check for updates",
    "settings.updateAvailable": "✨ New version available!",
    "settings.upToDate": "✅ Up to date",
    "settings.keySaved": "Key saved!",
    "settings.keyValid": "✅ Valid key!",
    "settings.keyInvalid": "❌ Invalid key",
    "settings.keyDeleted": "Key deleted",
    "settings.langSaved": "Language saved!",
    "settings.agentAdded": "Agent added!",
    "settings.enterKey": "Please enter an API key.",
    "settings.noKeyToTest": "No key to test.",
    "settings.testing": "Testing...",
    "settings.enterAgentName": "Please enter a name for the agent",
    "settings.enterAgentId": "Please enter the agent ID",
    "settings.invalidAgentId": "ID must start with 'ag:'",
    "settings.agentExists": "This agent already exists",
    "settings.confirmDeleteAgent": "Delete agent",
    "settings.confirmDeleteKey": "Delete API key?",
    "settings.agentDeleted": "Agent deleted",
    "agents.noDate": "Not available",
    
    // Onboarding
    "onboarding.title": "Configure your assistant",
    "onboarding.desc": "To use Fusion Browse Assistant, add your Mistral API key. It is stored only in your browser.",
    "onboarding.placeholder": "Paste your API key here (sk-...)",
    "onboarding.save": "Save and start",
    
    // Chat
    "chat.empty.title": "Welcome!",
    "chat.empty.desc": "Ask a question or use a quick action below.",
    "chat.placeholder": "Ask a question about this page...",
    "chat.send": "Send",
    
    // Quick actions
    "quick.summary": "📝 Summary",
    "quick.simplify": "🎓 Simplify",
    "quick.analyze": "🔍 Analyze",
    "quick.selection": "✂️ Use selection",
    
    // Action sections
    "action.section.analysis": "📊 Page Analysis",
    "action.section.rewrite": "✍️ Professional Rewriting",
    "action.section.generate": "🚀 Content Generation",
    
    // Action cards - Analysis
    "action.summary.title": "Summary",
    "action.summary.desc": "Key points in a few lines",
    "action.critique.title": "Full Analysis",
    "action.critique.desc": "Analysis + web research + sources",
    "action.highlight.title": "Highlight Key Ideas",
    "action.highlight.desc": "Highlight arguments, definitions, key figures",
    "action.extract.title": "Extract Data",
    "action.extract.desc": "CSV tables, lists, key concepts",
    "action.compare.title": "Compare Pages",
    "action.compare.desc": "Multi-tab comparison table",
    
    // Action cards - Rewrite
    "action.simplify.title": "Simplify (10 year old)",
    "action.simplify.desc": "Simple vocabulary, concrete examples",
    "action.scientific.title": "Scientific Style",
    "action.scientific.desc": "Academic and precise tone",
    "action.journalistic.title": "Journalistic Style",
    "action.journalistic.desc": "Hook, inverted pyramid",
    "action.marketing.title": "Marketing Style",
    "action.marketing.desc": "Persuasive, call-to-action",
    "action.uxcopy.title": "UX Copy Style",
    "action.uxcopy.desc": "Clear, actionable, guiding",
    "action.twitter.title": "Twitter/X Thread",
    "action.twitter.desc": "Viral format in multiple tweets",
    "action.linkedin.title": "LinkedIn Post",
    "action.linkedin.desc": "Professional storytelling",
    
    // Action cards - Generate
    "action.articleplan.title": "Article Plan",
    "action.articleplan.desc": "Complete structure + SEO",
    "action.youtubeplan.title": "YouTube Video Plan",
    "action.youtubeplan.desc": "Script, chapters, description",
    "action.emailseq.title": "Email Sequence",
    "action.emailseq.desc": "Structured emails with CTA",
    "action.tutorial.title": "Structured Tutorial",
    "action.tutorial.desc": "Detailed steps + checklist",
    "action.contactemail.title": "Contact Request",
    "action.contactemail.desc": "Professional email with context analysis",
    "action.translate.title": "Translate",
    "action.translate.desc": "Translate main content",
    
    // YouTube & Agent sections
    "action.section.youtube": "🎬 YouTube",
    "action.section.agent": "🤖 Intelligent Agent",
    "action.ytsum.title": "Summarize video",
    "action.ytsum.desc": "Complete summary with chapters and key points",
    "action.ytkey.title": "Key points",
    "action.ytkey.desc": "Main ideas in bullet points",
    "action.yttrans.title": "Extract transcript",
    "action.yttrans.desc": "Full video text if available",
    "action.pageagent.title": "Page Agent",
    "action.pageagent.desc": "AI analyzes and interacts with the page",
    
    // YouTube actions (legacy)
    "action.youtube.section": "🎬 YouTube",
    "action.youtube.summarize.title": "Summarize video",
    "action.youtube.summarize.desc": "Complete summary with chapters and key points",
    "action.youtube.keyPoints.title": "Key points",
    "action.youtube.keyPoints.desc": "Main ideas in bullet points",
    "action.youtube.transcript.title": "Extract transcript",
    "action.youtube.transcript.desc": "Full video text if available",
    "action.youtube.notYoutube": "This feature is for YouTube videos only",
    "action.youtube.analyzing": "Analyzing video...",
    
    // Agents tab
    "agents.title": "Active Agent",
    "agents.desc": "Select the agent to use for your conversations",
    "agents.default": "🔹 Mistral Small (default)",
    "agents.noAgent": "Select an agent...",
    "agents.manage": "⚙️",
    "agents.empty.title": "Chat with an Agent",
    "agents.empty.desc": "Select an agent above to start a dedicated conversation.",
    "agents.addFirst": "➕ Add an agent",
    "agents.placeholder": "Ask a question to the agent...",
    "agents.selectFirst": "Please select an agent",
    "agents.thinking": "Agent is thinking...",
    "agents.welcome": "Hello! I am **{name}**. How can I help you?",
    
    // Integration
    "integration.title": "Document Integrations",
    "integration.desc": "Connect your Google Docs, Slides and Sheets to analyze and modify them with AI",
    "integration.placeholder": "Paste a Google Docs/Slides/Sheets link...",
    "integration.add": "Add",
    "integration.empty": "No documents connected",
    "integration.emptyHint": "Add a link to get started",
    "integration.analyze": "📊 Analyze",
    "integration.summarize": "📝 Summarize",
    "integration.suggest": "💡 Suggestions",
    "integration.inputPlaceholder": "Ask for a modification or analysis...",
    "integration.docAdded": "Document added",
    "integration.docRemoved": "Document removed",
    "integration.invalidUrl": "Unrecognized URL. Use a Google Docs, Sheets or Slides link.",
    "integration.alreadyAdded": "This document is already added.",
    "integration.cannotExtractId": "Cannot extract document ID.",
    "integration.enterUrl": "Please enter a URL",
    "integration.selectFirst": "Select a document first",
    "integration.confirmDelete": "Delete this document?",
    "integration.selected": "**{title}** selected.\n\nI can analyze, summarize, or help you modify this document. What would you like to do?",
    
    // Context
    "context.refreshed": "Context refreshed!",
    "context.title": "Page context",
    "context.refresh": "🔄",
    
    // Errors
    "error.noKey": "Configure your Mistral key to enable this feature.",
    "error.api": "Error during API call.",
    "error.generic": "An error occurred.",
    
    // Chat messages
    "chat.noResponse": "No response.",
    "chat.analyzing": "Analyzing...",
    "chat.copy": "Copy",
    "chat.regenerate": "Regenerate",
    "chat.copied": "Copied!",
    "chat.extracting": "Extracting information...",
    "chat.searching": "Searching for additional information...",
    "chat.comparing": "Comparing...",
    "chat.extractingData": "Extracting data...",
    "chat.highlightingIdeas": "Identifying key ideas, arguments and important figures...",
    "chat.pageAgentWorking": "Analyzing page and behavior...",
    "chat.extractingContent": "Extracting content...",
    "chat.testingKey": "Testing key...",
    "chat.verifying": "Verifying...",
    "chat.saveAndTest": "Save and test",
    "chat.keyValidRedirect": "Valid key! Redirecting...",
    "chat.keyInvalidCheck": "Invalid key. Please check it.",
    "chat.error": "Error",
    "integration.addCurrentPage": "Add this page",
    "integration.contentAvailable": "Content available",
    "integration.openDocToAnalyze": "Open document to analyze",
    "integration.openDocAndRetry": "Open the document in a tab and try again",
    "ui.changeLanguage": "Change language",
    "ui.settings": "Settings",
    "ui.checkUpdates": "Check for updates",
    "ui.refreshContent": "Refresh content",
    "ui.manageAgents": "Manage agents",
    "ui.refreshDocContent": "Refresh content",
    "ui.close": "Close",
    "ui.send": "Send",
    "ui.add": "Add",
    "ui.open": "Open",
    "ui.delete": "Delete",
    "ui.apiStatus": "API Status",
    "error.noVideoId": "Unable to find video ID",
    "error.noResponse": "No response.",
    "error.tooManyRequests": "Too many requests. Please wait.",
    "error.connectionError": "Connection error",
    "error.apiError": "API call error",
    "chat.preparingComparison": "Preparing comparison...",
    "chat.retrievingTabs": "Retrieving open tabs...",
    "onboarding.findKey": "Where to find my key?",
    "model.recommended": "Recommended",
    "agents.add": "+ Add",
    "actionLabel.summary": "📝 Page Summary",
    "actionLabel.detailed": "📚 Detailed Summary",
    "actionLabel.simplify": "🎓 Simplification",
    "actionLabel.translate": "🌍 Translation",
    "actionLabel.critique": "🔍 Full Analysis",
    "actionLabel.plan": "📋 Content Plan",
    "actionLabel.pageAgent": "🤖 Page Agent",
    "actionLabel.highlightKeyIdeas": "🖍️ Key Ideas Identified",
    "actionLabel.extractData": "📦 Data Extracted",
    "actionLabel.comparePages": "⚖️ Page Comparison",
    "actionLabel.rewriteScientific": "🔬 Scientific Rewrite",
    "actionLabel.rewriteJournalistic": "📰 Journalistic Rewrite",
    "actionLabel.rewriteMarketing": "🎯 Marketing Rewrite",
    "actionLabel.rewriteUXCopy": "💻 UX Copy Rewrite",
    "actionLabel.rewriteTwitterThread": "🐦 Twitter Thread",
    "actionLabel.rewriteLinkedIn": "💼 LinkedIn Post",
    "actionLabel.generateArticlePlan": "📝 Article Plan",
    "actionLabel.generateYouTubePlan": "🎬 YouTube Plan",
    "actionLabel.generateEmailSequence": "📧 Email Sequence",
    "actionLabel.generateTutorial": "📖 Structured Tutorial",
    "actionLabel.generateContactEmail": "✉️ Contact Request"
  },
  
  de: {
    // Header
    "header.title": "Mistral Assistent",
    "header.status.connected": "Verbunden",
    "header.status.notConfigured": "Nicht konfiguriert",
    "header.status.error": "API-Fehler",
    "header.status.warning": "Warnung",
    
    // Tabs
    "tabs.chat": "💬 Chat",
    "tabs.actions": "⚡ Aktionen",
    "tabs.agents": "🤖 Agenten",
    "tabs.integration": "🔗 Integration",
    
    // Settings
    "settings.title": "Mistral Konfiguration",
    "settings.language": "🌍 Sprache der Erweiterung",
    "settings.model": "🤖 KI-Modell",
    "settings.modelSaved": "Modell gespeichert!",
    "settings.apiKey": "🔑 Mistral API-Schlüssel",
    "settings.save": "Speichern",
    "settings.test": "Testen",
    "settings.delete": "Löschen",
    "settings.agents": "🤖 Meine Agenten",
    "settings.addAgent": "+ Agent hinzufügen",
    "settings.agentName": "Name des Agenten",
    "settings.agentId": "ID (ag:xxxxxxxx...)",
    "settings.cancel": "Abbrechen",
    "settings.findKey": "🔑 Wo finde ich meinen API-Schlüssel?",
    "settings.createAgent": "🤖 Agent erstellen",
    "settings.checkUpdate": "🔄 Nach Updates suchen",
    "settings.updateAvailable": "✨ Neue Version verfügbar!",
    "settings.upToDate": "✅ Aktuell",
    "settings.keySaved": "Schlüssel gespeichert!",
    "settings.keyValid": "✅ Gültiger Schlüssel!",
    "settings.keyInvalid": "❌ Ungültiger Schlüssel",
    "settings.keyDeleted": "Schlüssel gelöscht",
    "settings.langSaved": "Sprache gespeichert!",
    "settings.agentAdded": "Agent hinzugefügt!",
    "settings.enterKey": "Bitte geben Sie einen API-Schlüssel ein.",
    "settings.noKeyToTest": "Kein Schlüssel zum Testen.",
    "settings.testing": "Test läuft...",
    "settings.enterAgentName": "Bitte geben Sie einen Namen für den Agenten ein",
    "settings.enterAgentId": "Bitte geben Sie die Agenten-ID ein",
    "settings.invalidAgentId": "ID muss mit 'ag:' beginnen",
    "settings.agentExists": "Dieser Agent existiert bereits",
    "settings.confirmDeleteAgent": "Agent löschen",
    "settings.confirmDeleteKey": "API-Schlüssel löschen?",
    "settings.agentDeleted": "Agent gelöscht",
    "agents.noDate": "Nicht verfügbar",
    
    // Onboarding
    "onboarding.title": "Konfiguriere deinen Assistenten",
    "onboarding.desc": "Um Fusion Browse Assistant zu nutzen, füge deinen Mistral API-Schlüssel hinzu. Er wird nur in deinem Browser gespeichert.",
    "onboarding.placeholder": "API-Schlüssel hier einfügen (sk-...)",
    "onboarding.save": "Speichern und starten",
    
    // Chat
    "chat.empty.title": "Willkommen!",
    "chat.empty.desc": "Stelle eine Frage oder nutze eine Schnellaktion unten.",
    "chat.placeholder": "Stelle eine Frage zu dieser Seite...",
    "chat.send": "Senden",
    
    // Quick actions
    "quick.summary": "📝 Zusammenfassung",
    "quick.simplify": "🎓 Vereinfachen",
    "quick.analyze": "🔍 Analyse",
    "quick.selection": "✂️ Auswahl verwenden",
    
    // Action sections
    "action.section.analysis": "📊 Seitenanalyse",
    "action.section.rewrite": "✍️ Professionelles Umschreiben",
    "action.section.generate": "🚀 Inhaltserstellung",
    
    // Action cards - Analysis
    "action.summary.title": "Zusammenfassung",
    "action.summary.desc": "Kernpunkte in wenigen Zeilen",
    "action.critique.title": "Vollständige Analyse",
    "action.critique.desc": "Analyse + Webrecherche + Quellen",
    "action.highlight.title": "Schlüsselideen hervorheben",
    "action.highlight.desc": "Argumente, Definitionen, Schlüsselzahlen hervorheben",
    "action.extract.title": "Daten extrahieren",
    "action.extract.desc": "CSV-Tabellen, Listen, Schlüsselkonzepte",
    "action.compare.title": "Seiten vergleichen",
    "action.compare.desc": "Multi-Tab Vergleichstabelle",
    
    // Action cards - Rewrite
    "action.simplify.title": "Vereinfachen (10 Jahre alt)",
    "action.simplify.desc": "Einfaches Vokabular, konkrete Beispiele",
    "action.scientific.title": "Wissenschaftlicher Stil",
    "action.scientific.desc": "Akademischer und präziser Ton",
    "action.journalistic.title": "Journalistischer Stil",
    "action.journalistic.desc": "Hook, umgekehrte Pyramide",
    "action.marketing.title": "Marketing Stil",
    "action.marketing.desc": "Überzeugend, Call-to-Action",
    "action.uxcopy.title": "UX Copy Stil",
    "action.uxcopy.desc": "Klar, handlungsorientiert, führend",
    "action.twitter.title": "Twitter/X Thread",
    "action.twitter.desc": "Virales Format in mehreren Tweets",
    "action.linkedin.title": "LinkedIn Post",
    "action.linkedin.desc": "Professionelles Storytelling",
    
    // Action cards - Generate
    "action.articleplan.title": "Artikelplan",
    "action.articleplan.desc": "Vollständige Struktur + SEO",
    "action.youtubeplan.title": "YouTube Video Plan",
    "action.youtubeplan.desc": "Script, Kapitel, Beschreibung",
    "action.emailseq.title": "E-Mail-Sequenz",
    "action.emailseq.desc": "Strukturierte E-Mails mit CTA",
    "action.tutorial.title": "Strukturiertes Tutorial",
    "action.tutorial.desc": "Detaillierte Schritte + Checkliste",
    "action.contactemail.title": "Kontaktanfrage",
    "action.contactemail.desc": "Professionelle E-Mail mit Kontextanalyse",
    "action.translate.title": "Übersetzen",
    "action.translate.desc": "Hauptinhalt übersetzen",
    
    // YouTube & Agent sections
    "action.section.youtube": "🎬 YouTube",
    "action.section.agent": "🤖 Intelligenter Agent",
    "action.ytsum.title": "Video zusammenfassen",
    "action.ytsum.desc": "Vollständige Zusammenfassung mit Kapiteln und Kernpunkten",
    "action.ytkey.title": "Kernpunkte",
    "action.ytkey.desc": "Hauptideen als Stichpunkte",
    "action.yttrans.title": "Transkript extrahieren",
    "action.yttrans.desc": "Vollständiger Videotext falls verfügbar",
    "action.pageagent.title": "Seiten-Agent",
    "action.pageagent.desc": "KI analysiert und interagiert mit der Seite",
    
    // YouTube actions (legacy)
    "action.youtube.section": "🎬 YouTube",
    "action.youtube.summarize.title": "Video zusammenfassen",
    "action.youtube.summarize.desc": "Vollständige Zusammenfassung mit Kapiteln und Kernpunkten",
    "action.youtube.keyPoints.title": "Kernpunkte",
    "action.youtube.keyPoints.desc": "Hauptideen als Stichpunkte",
    "action.youtube.transcript.title": "Transkript extrahieren",
    "action.youtube.transcript.desc": "Vollständiger Videotext falls verfügbar",
    "action.youtube.notYoutube": "Diese Funktion ist nur für YouTube-Videos",
    "action.youtube.analyzing": "Video wird analysiert...",
    
    // Agents tab
    "agents.title": "Aktiver Agent",
    "agents.desc": "Wähle den Agenten für deine Gespräche",
    "agents.default": "🔹 Mistral Small (Standard)",
    "agents.noAgent": "Agent auswählen...",
    "agents.manage": "⚙️",
    "agents.empty.title": "Chat mit einem Agenten",
    "agents.empty.desc": "Wähle oben einen Agenten für ein dediziertes Gespräch.",
    "agents.addFirst": "➕ Agent hinzufügen",
    "agents.placeholder": "Stelle dem Agenten eine Frage...",
    "agents.selectFirst": "Bitte wähle einen Agenten aus",
    "agents.thinking": "Agent denkt nach...",
    "agents.welcome": "Hallo! Ich bin **{name}**. Wie kann ich dir helfen?",
    
    // Integration
    "integration.title": "Dokumenten-Integrationen",
    "integration.desc": "Verbinde deine Google Docs, Slides und Sheets, um sie mit KI zu analysieren und zu bearbeiten",
    "integration.placeholder": "Füge einen Google Docs/Slides/Sheets-Link ein...",
    "integration.add": "Hinzufügen",
    "integration.empty": "Keine Dokumente verbunden",
    "integration.emptyHint": "Füge einen Link hinzu, um zu beginnen",
    "integration.analyze": "📊 Analysieren",
    "integration.summarize": "📝 Zusammenfassen",
    "integration.suggest": "💡 Vorschläge",
    "integration.inputPlaceholder": "Frage nach einer Änderung oder Analyse...",
    "integration.docAdded": "Dokument hinzugefügt",
    "integration.docRemoved": "Dokument entfernt",
    "integration.invalidUrl": "URL nicht erkannt. Verwende einen Google Docs, Sheets oder Slides-Link.",
    "integration.alreadyAdded": "Dieses Dokument ist bereits hinzugefügt.",
    "integration.cannotExtractId": "Dokument-ID kann nicht extrahiert werden.",
    "integration.enterUrl": "Bitte gib eine URL ein",
    "integration.selectFirst": "Wähle zuerst ein Dokument aus",
    "integration.confirmDelete": "Dieses Dokument löschen?",
    "integration.selected": "**{title}** ausgewählt.\n\nIch kann dieses Dokument analysieren, zusammenfassen oder dir bei der Bearbeitung helfen. Was möchtest du tun?",
    
    // Context
    "context.refreshed": "Kontext aktualisiert!",
    "context.title": "Seitenkontext",
    "context.refresh": "🔄",
    
    // Errors
    "error.noKey": "Konfiguriere deinen Mistral-Schlüssel, um diese Funktion zu aktivieren.",
    "error.api": "Fehler beim API-Aufruf.",
    "error.generic": "Ein Fehler ist aufgetreten.",
    
    // Chat messages
    "chat.noResponse": "Keine Antwort.",
    "chat.analyzing": "Analyse läuft...",
    "chat.copy": "Kopieren",
    "chat.regenerate": "Neu generieren",
    "chat.copied": "Kopiert!",
    "chat.extracting": "Informationen werden extrahiert...",
    "chat.searching": "Suche nach zusätzlichen Informationen...",
    "chat.comparing": "Vergleich läuft...",
    "chat.extractingData": "Daten werden extrahiert...",
    "chat.highlightingIdeas": "Identifizierung von Schlüsselideen, Argumenten und wichtigen Zahlen...",
    "chat.pageAgentWorking": "Analyse der Seite und des Verhaltens...",
    "chat.extractingContent": "Inhalt wird extrahiert...",
    "chat.testingKey": "Schlüssel wird getestet...",
    "chat.verifying": "Überprüfung...",
    "chat.saveAndTest": "Speichern und testen",
    "chat.keyValidRedirect": "Gültiger Schlüssel! Weiterleitung...",
    "chat.keyInvalidCheck": "Ungültiger Schlüssel. Bitte überprüfen.",
    "chat.error": "Fehler",
    "integration.addCurrentPage": "Diese Seite hinzufügen",
    "integration.contentAvailable": "Inhalt verfügbar",
    "integration.openDocToAnalyze": "Dokument öffnen zur Analyse",
    "integration.openDocAndRetry": "Öffne das Dokument in einem Tab und versuche es erneut",
    "ui.changeLanguage": "Sprache ändern",
    "ui.settings": "Einstellungen",
    "ui.checkUpdates": "Nach Updates suchen",
    "ui.refreshContent": "Inhalt aktualisieren",
    "ui.manageAgents": "Agenten verwalten",
    "ui.refreshDocContent": "Inhalt aktualisieren",
    "ui.close": "Schließen",
    "ui.send": "Senden",
    "ui.add": "Hinzufügen",
    "ui.open": "Öffnen",
    "ui.delete": "Löschen",
    "ui.apiStatus": "API-Status",
    "error.noVideoId": "Video-ID nicht gefunden",
    "error.noResponse": "Keine Antwort.",
    "error.tooManyRequests": "Zu viele Anfragen. Bitte warten.",
    "error.connectionError": "Verbindungsfehler",
    "error.apiError": "API-Aufruffehler",
    "chat.preparingComparison": "Vergleich wird vorbereitet...",
    "chat.retrievingTabs": "Offene Tabs werden abgerufen...",
    "onboarding.findKey": "Wo finde ich meinen Schlüssel?",
    "model.recommended": "Empfohlen",
    "agents.add": "+ Hinzufügen",
    "actionLabel.summary": "📝 Seitenzusammenfassung",
    "actionLabel.detailed": "📚 Detaillierte Zusammenfassung",
    "actionLabel.simplify": "🎓 Vereinfachung",
    "actionLabel.translate": "🌍 Übersetzung",
    "actionLabel.critique": "🔍 Vollständige Analyse",
    "actionLabel.plan": "📋 Inhaltsplan",
    "actionLabel.pageAgent": "🤖 Seiten-Agent",
    "actionLabel.highlightKeyIdeas": "🖍️ Schlüsselideen identifiziert",
    "actionLabel.extractData": "📦 Daten extrahiert",
    "actionLabel.comparePages": "⚖️ Seitenvergleich",
    "actionLabel.rewriteScientific": "🔬 Wissenschaftliches Umschreiben",
    "actionLabel.rewriteJournalistic": "📰 Journalistisches Umschreiben",
    "actionLabel.rewriteMarketing": "🎯 Marketing Umschreiben",
    "actionLabel.rewriteUXCopy": "💻 UX-Text Umschreiben",
    "actionLabel.rewriteTwitterThread": "🐦 Twitter-Thread",
    "actionLabel.rewriteLinkedIn": "💼 LinkedIn-Beitrag",
    "actionLabel.generateArticlePlan": "📝 Artikelplan",
    "actionLabel.generateYouTubePlan": "🎬 YouTube-Plan",
    "actionLabel.generateEmailSequence": "📧 E-Mail-Sequenz",
    "actionLabel.generateTutorial": "📖 Strukturiertes Tutorial",
    "actionLabel.generateContactEmail": "✉️ Kontaktanfrage"
  },
  
  es: {
    // Header
    "header.title": "Asistente Mistral",
    "header.status.connected": "Conectado",
    "header.status.notConfigured": "No configurado",
    "header.status.error": "Error API",
    "header.status.warning": "Atención",
    
    // Tabs
    "tabs.chat": "💬 Chat",
    "tabs.actions": "⚡ Acciones",
    "tabs.agents": "🤖 Agentes",
    "tabs.integration": "🔗 Integración",
    
    // Settings
    "settings.title": "Configuración Mistral",
    "settings.language": "🌍 Idioma de la extensión",
    "settings.model": "🤖 Modelo IA",
    "settings.modelSaved": "¡Modelo guardado!",
    "settings.apiKey": "🔑 Clave API Mistral",
    "settings.save": "Guardar",
    "settings.test": "Probar",
    "settings.delete": "Eliminar",
    "settings.agents": "🤖 Mis Agentes",
    "settings.addAgent": "+ Añadir un agente",
    "settings.agentName": "Nombre del agente",
    "settings.agentId": "ID (ag:xxxxxxxx...)",
    "settings.cancel": "Cancelar",
    "settings.findKey": "🔑 ¿Dónde encontrar mi clave API?",
    "settings.createAgent": "🤖 Crear un agente",
    "settings.checkUpdate": "🔄 Buscar actualizaciones",
    "settings.updateAvailable": "✨ ¡Nueva versión disponible!",
    "settings.upToDate": "✅ Actualizado",
    "settings.keySaved": "¡Clave guardada!",
    "settings.keyValid": "✅ ¡Clave válida!",
    "settings.keyInvalid": "❌ Clave inválida",
    "settings.keyDeleted": "Clave eliminada",
    "settings.langSaved": "¡Idioma guardado!",
    "settings.agentAdded": "¡Agente añadido!",
    "settings.enterKey": "Por favor, introduzca una clave API.",
    "settings.noKeyToTest": "No hay clave para probar.",
    "settings.testing": "Probando...",
    "settings.enterAgentName": "Por favor, introduzca un nombre para el agente",
    "settings.enterAgentId": "Por favor, introduzca el ID del agente",
    "settings.invalidAgentId": "El ID debe empezar con 'ag:'",
    "settings.agentExists": "Este agente ya existe",
    "settings.confirmDeleteAgent": "Eliminar agente",
    "settings.confirmDeleteKey": "¿Eliminar clave API?",
    "settings.agentDeleted": "Agente eliminado",
    "agents.noDate": "No disponible",
    
    // Onboarding
    "onboarding.title": "Configura tu asistente",
    "onboarding.desc": "Para usar Fusion Browse Assistant, añade tu clave API Mistral. Se almacena solo en tu navegador.",
    "onboarding.placeholder": "Pega tu clave API aquí (sk-...)",
    "onboarding.save": "Guardar y comenzar",
    
    // Chat
    "chat.empty.title": "¡Bienvenido!",
    "chat.empty.desc": "Haz una pregunta o usa una acción rápida abajo.",
    "chat.placeholder": "Haz una pregunta sobre esta página...",
    "chat.send": "Enviar",
    
    // Quick actions
    "quick.summary": "📝 Resumen",
    "quick.simplify": "🎓 Simplificar",
    "quick.analyze": "🔍 Análisis",
    "quick.selection": "✂️ Usar selección",
    
    // Action sections
    "action.section.analysis": "📊 Análisis de página",
    "action.section.rewrite": "✍️ Reescritura profesional",
    "action.section.generate": "🚀 Generación de contenido",
    
    // Action cards - Analysis
    "action.summary.title": "Resumen",
    "action.summary.desc": "Puntos clave en pocas líneas",
    "action.critique.title": "Análisis completo",
    "action.critique.desc": "Análisis + búsqueda web + fuentes",
    "action.highlight.title": "Resaltar ideas clave",
    "action.highlight.desc": "Resaltar argumentos, definiciones, cifras clave",
    "action.extract.title": "Extraer datos",
    "action.extract.desc": "Tablas CSV, listas, conceptos clave",
    "action.compare.title": "Comparar páginas",
    "action.compare.desc": "Tabla comparativa multi-pestañas",
    
    // Action cards - Rewrite
    "action.simplify.title": "Simplificar (10 años)",
    "action.simplify.desc": "Vocabulario simple, ejemplos concretos",
    "action.scientific.title": "Estilo científico",
    "action.scientific.desc": "Tono académico y preciso",
    "action.journalistic.title": "Estilo periodístico",
    "action.journalistic.desc": "Gancho, pirámide invertida",
    "action.marketing.title": "Estilo marketing",
    "action.marketing.desc": "Persuasivo, llamada a la acción",
    "action.uxcopy.title": "Estilo UX Copy",
    "action.uxcopy.desc": "Claro, accionable, guía",
    "action.twitter.title": "Hilo Twitter/X",
    "action.twitter.desc": "Formato viral en varios tweets",
    "action.linkedin.title": "Post LinkedIn",
    "action.linkedin.desc": "Storytelling profesional",
    
    // Action cards - Generate
    "action.articleplan.title": "Plan de artículo",
    "action.articleplan.desc": "Estructura completa + SEO",
    "action.youtubeplan.title": "Plan video YouTube",
    "action.youtubeplan.desc": "Guión, capítulos, descripción",
    "action.emailseq.title": "Secuencia de emails",
    "action.emailseq.desc": "Emails estructurados con CTA",
    "action.tutorial.title": "Tutorial estructurado",
    "action.tutorial.desc": "Pasos detallados + checklist",
    "action.contactemail.title": "Solicitud de contacto",
    "action.contactemail.desc": "Email profesional con análisis del contexto",
    "action.translate.title": "Traducir",
    "action.translate.desc": "Traducir contenido principal",
    
    // YouTube & Agent sections
    "action.section.youtube": "🎬 YouTube",
    "action.section.agent": "🤖 Agente inteligente",
    "action.ytsum.title": "Resumir video",
    "action.ytsum.desc": "Resumen completo con capítulos y puntos clave",
    "action.ytkey.title": "Puntos clave",
    "action.ytkey.desc": "Ideas principales en viñetas",
    "action.yttrans.title": "Extraer transcripción",
    "action.yttrans.desc": "Texto completo del video si disponible",
    "action.pageagent.title": "Agente de Página",
    "action.pageagent.desc": "La IA analiza e interactúa con la página",
    
    // YouTube actions (legacy)
    "action.youtube.section": "🎬 YouTube",
    "action.youtube.summarize.title": "Resumir video",
    "action.youtube.summarize.desc": "Resumen completo con capítulos y puntos clave",
    "action.youtube.keyPoints.title": "Puntos clave",
    "action.youtube.keyPoints.desc": "Ideas principales en viñetas",
    "action.youtube.transcript.title": "Extraer transcripción",
    "action.youtube.transcript.desc": "Texto completo del video si está disponible",
    "action.youtube.notYoutube": "Esta función es solo para videos de YouTube",
    "action.youtube.analyzing": "Analizando video...",
    
    // Agents tab
    "agents.title": "Agente activo",
    "agents.desc": "Selecciona el agente para tus conversaciones",
    "agents.default": "🔹 Mistral Small (por defecto)",
    "agents.noAgent": "Seleccionar un agente...",
    "agents.manage": "⚙️",
    "agents.empty.title": "Chatea con un Agente",
    "agents.empty.desc": "Selecciona un agente arriba para iniciar una conversación dedicada.",
    "agents.addFirst": "➕ Añadir un agente",
    "agents.placeholder": "Haz una pregunta al agente...",
    "agents.selectFirst": "Por favor, selecciona un agente",
    "agents.thinking": "El agente está pensando...",
    "agents.welcome": "¡Hola! Soy **{name}**. ¿Cómo puedo ayudarte?",
    
    // Integration
    "integration.title": "Integraciones de Documentos",
    "integration.desc": "Conecta tus Google Docs, Slides y Sheets para analizarlos y modificarlos con IA",
    "integration.placeholder": "Pega un enlace de Google Docs/Slides/Sheets...",
    "integration.add": "Añadir",
    "integration.empty": "No hay documentos conectados",
    "integration.emptyHint": "Añade un enlace para empezar",
    "integration.analyze": "📊 Analizar",
    "integration.summarize": "📝 Resumir",
    "integration.suggest": "💡 Sugerencias",
    "integration.inputPlaceholder": "Pide una modificación o análisis...",
    "integration.docAdded": "Documento añadido",
    "integration.docRemoved": "Documento eliminado",
    "integration.invalidUrl": "URL no reconocida. Usa un enlace de Google Docs, Sheets o Slides.",
    "integration.alreadyAdded": "Este documento ya está añadido.",
    "integration.cannotExtractId": "No se puede extraer el ID del documento.",
    "integration.enterUrl": "Por favor, introduce una URL",
    "integration.selectFirst": "Selecciona primero un documento",
    "integration.confirmDelete": "¿Eliminar este documento?",
    "integration.selected": "**{title}** seleccionado.\n\nPuedo analizar, resumir o ayudarte a modificar este documento. ¿Qué te gustaría hacer?",
    
    // Context
    "context.refreshed": "¡Contexto actualizado!",
    "context.title": "Contexto de la página",
    "context.refresh": "🔄",
    
    // Errors
    "error.noKey": "Configura tu clave Mistral para activar esta función.",
    "error.api": "Error durante la llamada API.",
    "error.generic": "Ha ocurrido un error.",
    
    // Chat messages
    "chat.noResponse": "Sin respuesta.",
    "chat.analyzing": "Analizando...",
    "chat.copy": "Copiar",
    "chat.regenerate": "Regenerar",
    "chat.copied": "¡Copiado!",
    "chat.extracting": "Extrayendo información...",
    "chat.searching": "Buscando información adicional...",
    "chat.comparing": "Comparando...",
    "chat.extractingData": "Extrayendo datos...",
    "chat.highlightingIdeas": "Identificando ideas clave, argumentos y cifras importantes...",
    "chat.pageAgentWorking": "Analizando página y comportamiento...",
    "chat.extractingContent": "Extrayendo contenido...",
    "chat.testingKey": "Probando clave...",
    "chat.verifying": "Verificando...",
    "chat.saveAndTest": "Guardar y probar",
    "chat.keyValidRedirect": "¡Clave válida! Redirigiendo...",
    "chat.keyInvalidCheck": "Clave inválida. Por favor, verifícala.",
    "chat.error": "Error",
    "integration.addCurrentPage": "Agregar esta página",
    "integration.contentAvailable": "Contenido disponible",
    "integration.openDocToAnalyze": "Abrir documento para analizar",
    "integration.openDocAndRetry": "Abre el documento en una pestaña e intenta de nuevo",
    "ui.changeLanguage": "Cambiar idioma",
    "ui.settings": "Configuración",
    "ui.checkUpdates": "Buscar actualizaciones",
    "ui.refreshContent": "Actualizar contenido",
    "ui.manageAgents": "Gestionar agentes",
    "ui.refreshDocContent": "Actualizar contenido",
    "ui.close": "Cerrar",
    "ui.send": "Enviar",
    "ui.add": "Añadir",
    "ui.open": "Abrir",
    "ui.delete": "Eliminar",
    "ui.apiStatus": "Estado API",
    "error.noVideoId": "No se puede encontrar el ID del video",
    "error.noResponse": "Sin respuesta.",
    "error.tooManyRequests": "Demasiadas solicitudes. Por favor espere.",
    "error.connectionError": "Error de conexión",
    "error.apiError": "Error de llamada API",
    "chat.preparingComparison": "Preparando comparación...",
    "chat.retrievingTabs": "Obteniendo pestañas abiertas...",
    "onboarding.findKey": "¿Dónde encontrar mi clave?",
    "model.recommended": "Recomendado",
    "agents.add": "+ Añadir",
    "actionLabel.summary": "📝 Resumen de la página",
    "actionLabel.detailed": "📚 Resumen detallado",
    "actionLabel.simplify": "🎓 Simplificación",
    "actionLabel.translate": "🌍 Traducción",
    "actionLabel.critique": "🔍 Análisis completo",
    "actionLabel.plan": "📋 Plan de contenido",
    "actionLabel.pageAgent": "🤖 Agente de Página",
    "actionLabel.highlightKeyIdeas": "🖍️ Ideas clave identificadas",
    "actionLabel.extractData": "📦 Datos extraídos",
    "actionLabel.comparePages": "⚖️ Comparación de páginas",
    "actionLabel.rewriteScientific": "🔬 Reescritura científica",
    "actionLabel.rewriteJournalistic": "📰 Reescritura periodística",
    "actionLabel.rewriteMarketing": "🎯 Reescritura de marketing",
    "actionLabel.rewriteUXCopy": "💻 Reescritura UX",
    "actionLabel.rewriteTwitterThread": "🐦 Hilo de Twitter",
    "actionLabel.rewriteLinkedIn": "💼 Post de LinkedIn",
    "actionLabel.generateArticlePlan": "📝 Plan de artículo",
    "actionLabel.generateYouTubePlan": "🎬 Plan de YouTube",
    "actionLabel.generateEmailSequence": "📧 Secuencia de emails",
    "actionLabel.generateTutorial": "📖 Tutorial estructurado",
    "actionLabel.generateContactEmail": "✉️ Solicitud de contacto"
  }
};

// Langue actuelle (sera détectée automatiquement)
let currentLang = "en";

// Fonction de traduction
function t(key) {
  return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS["fr"][key] || key;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DE PAGE - SNAPSHOTS
// ─────────────────────────────────────────────────────────────────────────────

function buildPageSnapshot() {
  // Récupérer les titres de la page
  const headings = [];
  document.querySelectorAll('h1, h2, h3').forEach((h, index) => {
    if (index < 20) { // Limiter à 20 titres
      headings.push({
        level: h.tagName.toLowerCase(),
        text: cleanText(h.textContent).slice(0, 100)
      });
    }
  });

  // Récupérer un extrait du contenu principal
  let textSample = "";
  const mainContent = document.querySelector('main, article, .content, #content, .post, .article') || document.body;
  if (mainContent) {
    textSample = cleanText(mainContent.innerText).slice(0, 3000);
  }

  // Meta description
  const metaDesc = document.querySelector('meta[name="description"]')?.content || "";

  // Éléments interactifs
  const interactiveElements = {
    links: document.querySelectorAll('a[href]').length,
    buttons: document.querySelectorAll('button, input[type="button"], input[type="submit"]').length,
    forms: document.querySelectorAll('form').length,
    images: document.querySelectorAll('img').length
  };

  return {
    title: document.title || "Sans titre",
    url: window.location.href,
    metaDescription: metaDesc.slice(0, 200),
    headings,
    textSample,
    interactiveElements,
    timestamp: Date.now()
  };
}

function buildUserBehaviorSnapshot() {
  // Pourcentage de scroll
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPercent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;

  // Texte sélectionné
  const selection = getSelectionText();

  // Élément actuellement visible au centre de l'écran
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const centerElement = document.elementFromPoint(centerX, centerY);
  let visibleContext = "";
  if (centerElement) {
    visibleContext = cleanText(centerElement.textContent || "").slice(0, 200);
  }

  return {
    scrollPercent,
    selection: selection ? selection.slice(0, 500) : null,
    visibleContext,
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    timestamp: Date.now()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DE PAGE - EXÉCUTION DES ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Stockage des éléments modifiés pour cleanup
let agentHighlights = [];
let agentTooltips = [];

function executeAgentActions(actions) {
  // Nettoyer les actions précédentes
  cleanupAgentActions();

  if (!Array.isArray(actions)) return;

  actions.forEach((action, index) => {
    // Petit délai entre chaque action pour un effet visuel
    setTimeout(() => {
      try {
        switch (action.type) {
          case 'HIGHLIGHT':
            executeHighlight(action.selector);
            break;
          case 'SCROLL_TO':
            executeScrollTo(action.selector);
            break;
          case 'SHOW_TOOLTIP':
            executeShowTooltip(action.selector, action.text);
            break;
          default:
            console.warn(`[Agent] Action inconnue: ${action.type}`);
        }
      } catch (err) {
        console.warn(`[Agent] Erreur action ${action.type}:`, err);
      }
    }, index * 300);
  });
}

function executeHighlight(selector) {
  if (!selector) return;
  
  const elements = document.querySelectorAll(selector);
  if (elements.length === 0) {
    console.warn(`[Agent] Aucun élément trouvé pour: ${selector}`);
    return;
  }

  elements.forEach(el => {
    // Sauvegarder le style original
    const originalStyle = el.getAttribute('style') || '';
    el.dataset.agentOriginalStyle = originalStyle;
    
    // Appliquer le surlignage
    el.style.cssText += `
      background: linear-gradient(135deg, rgba(255, 217, 61, 0.3) 0%, rgba(255, 107, 53, 0.3) 100%) !important;
      outline: 2px solid rgba(255, 165, 27, 0.6) !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
      transition: all 0.3s ease !important;
    `;
    
    agentHighlights.push(el);
  });
}

function executeScrollTo(selector) {
  if (!selector) return;
  
  const element = document.querySelector(selector);
  if (!element) {
    console.warn(`[Agent] Aucun élément trouvé pour scroll: ${selector}`);
    return;
  }

  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });

  // Flash temporaire pour attirer l'attention
  const originalBg = element.style.backgroundColor;
  element.style.transition = 'background-color 0.3s ease';
  element.style.backgroundColor = 'rgba(255, 217, 61, 0.4)';
  
  setTimeout(() => {
    element.style.backgroundColor = originalBg;
  }, 1000);
}

function executeShowTooltip(selector, text) {
  if (!selector || !text) return;
  
  const element = document.querySelector(selector);
  if (!element) {
    console.warn(`[Agent] Aucun élément trouvé pour tooltip: ${selector}`);
    return;
  }

  // Créer le tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'mist-agent-tooltip';
  tooltip.innerHTML = `
    <div class="mist-agent-tooltip-content">
      <div class="mist-agent-tooltip-icon">💡</div>
      <div class="mist-agent-tooltip-text">${escapeHtmlBasic(text)}</div>
      <button class="mist-agent-tooltip-close">✕</button>
    </div>
    <div class="mist-agent-tooltip-arrow"></div>
  `;

  // Positionner le tooltip
  document.body.appendChild(tooltip);
  
  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  let top = rect.top + window.scrollY - tooltipRect.height - 10;
  let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);
  
  // Ajuster si hors écran
  if (top < window.scrollY + 10) {
    top = rect.bottom + window.scrollY + 10;
    tooltip.classList.add('mist-agent-tooltip-bottom');
  }
  if (left < 10) left = 10;
  if (left + tooltipRect.width > window.innerWidth - 10) {
    left = window.innerWidth - tooltipRect.width - 10;
  }
  
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  
  // Animation d'entrée
  setTimeout(() => tooltip.classList.add('visible'), 10);
  
  // Bouton de fermeture
  tooltip.querySelector('.mist-agent-tooltip-close').addEventListener('click', () => {
    tooltip.classList.remove('visible');
    setTimeout(() => tooltip.remove(), 200);
  });
  
  agentTooltips.push(tooltip);
}

function escapeHtmlBasic(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function cleanupAgentActions() {
  // Nettoyer les highlights
  agentHighlights.forEach(el => {
    if (el && el.dataset.agentOriginalStyle !== undefined) {
      el.setAttribute('style', el.dataset.agentOriginalStyle);
      delete el.dataset.agentOriginalStyle;
    }
  });
  agentHighlights = [];

  // Nettoyer les tooltips
  agentTooltips.forEach(tooltip => {
    if (tooltip && tooltip.parentNode) {
      tooltip.remove();
    }
  });
  agentTooltips = [];

  // Nettoyer aussi les éléments orphelins
  document.querySelectorAll('.mist-agent-tooltip').forEach(el => el.remove());
}

// ─────────────────────────────────────────────────────────────────────────────
// INJECTION DES STYLES
// ─────────────────────────────────────────────────────────────────────────────

function injectDockStyles() {
  if (document.getElementById("mistral-dock-style")) return;

  const style = document.createElement("style");
  style.id = "mistral-dock-style";
  style.textContent = `
    /* ══════════════════════════════════════════════════════════════════════
       VARIABLES MISTRAL - Palette du logo pixel art
       ══════════════════════════════════════════════════════════════════════ */
    :root {
      --mist-bg-deep: #1a1a1a;
      --mist-bg-panel: #212121;
      --mist-bg-elevated: #2a2a2a;
      --mist-bg-input: #333333;
      --mist-border: rgba(255, 255, 255, 0.08);
      --mist-border-focus: rgba(255, 217, 61, 0.5);
      --mist-text: #f5f5f5;
      --mist-text-muted: #9a9a9a;
      --mist-text-dim: #666666;
      /* Couleurs du logo Mistral */
      --mist-yellow: #FFD93D;
      --mist-orange-light: #FFA41B;
      --mist-orange: #FF6B35;
      --mist-orange-dark: #FF4500;
      --mist-red: #E62E2E;
      /* Gradients inspirés du logo */
      --mist-accent-gradient: linear-gradient(180deg, #FFD93D 0%, #FFA41B 25%, #FF6B35 50%, #FF4500 75%, #E62E2E 100%);
      --mist-accent-gradient-horizontal: linear-gradient(90deg, #FFD93D 0%, #FF6B35 50%, #E62E2E 100%);
      --mist-accent-gradient-soft: linear-gradient(135deg, #FFD93D 0%, #FF6B35 100%);
      --mist-success: #22c55e;
      --mist-error: #E62E2E;
      --mist-warning: #FFA41B;
      --mist-radius-sm: 8px;
      --mist-radius-md: 12px;
      --mist-radius-lg: 16px;
      --mist-radius-xl: 20px;
      --mist-radius-pill: 999px;
      --mist-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
      --mist-shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5);
      --mist-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.6);
      --mist-shadow-glow: 0 0 30px rgba(255, 165, 27, 0.25);
      --mist-shadow-glow-yellow: 0 0 25px rgba(255, 217, 61, 0.3);
      --mist-shadow-glow-red: 0 0 25px rgba(230, 46, 46, 0.3);
      --mist-transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* ══════════════════════════════════════════════════════════════════════
       ANIMATIONS
       ══════════════════════════════════════════════════════════════════════ */
    @keyframes mist-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @keyframes mist-slide-out {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }

    /* Masquer les scrollbars tout en gardant le scroll */
    #mistral-browse-assistant-dock ::-webkit-scrollbar,
    #mistral-browse-assistant-dock *::-webkit-scrollbar,
    .mist-dock ::-webkit-scrollbar,
    .mist-dock *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
      background: transparent !important;
    }

    #mistral-browse-assistant-dock,
    #mistral-browse-assistant-dock *,
    .mist-dock,
    .mist-dock * {
      scrollbar-width: none !important; /* Firefox */
      -ms-overflow-style: none !important; /* IE/Edge */
    }

    .mist-chat::-webkit-scrollbar,
    .mist-actions-grid::-webkit-scrollbar,
    .mist-agents-tab::-webkit-scrollbar,
    .mist-agent-messages::-webkit-scrollbar,
    .mist-settings-panel::-webkit-scrollbar {
      width: 0 !important;
      display: none !important;
    }

    .mist-chat,
    .mist-actions-grid,
    .mist-agents-tab,
    .mist-agent-messages,
    .mist-settings-panel {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    @keyframes mist-fade-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes mist-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    @keyframes mist-typing {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-4px); }
    }

    @keyframes mist-glow-pulse {
      0%, 100% { box-shadow: 0 0 20px rgba(255, 107, 53, 0.15); }
      50% { box-shadow: 0 0 35px rgba(255, 107, 53, 0.3); }
    }

    /* ══════════════════════════════════════════════════════════════════════
       RESET CSS COMPLET - Isolation des styles de la page hôte
       ══════════════════════════════════════════════════════════════════════ */
    .mist-dock,
    .mist-dock *,
    .mist-dock *::before,
    .mist-dock *::after {
      all: revert;
      box-sizing: border-box !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      line-height: 1.5 !important;
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       PANNEAU PRINCIPAL
       ══════════════════════════════════════════════════════════════════════ */
    .mist-dock {
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 450px !important;
      max-width: 100vw !important;
      height: 100vh !important;
      background: var(--mist-bg-deep) !important;
      color: var(--mist-text) !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.5 !important;
      display: flex !important;
      flex-direction: column !important;
      border-left: 1px solid var(--mist-border) !important;
      box-shadow: var(--mist-shadow-lg), inset 1px 0 0 rgba(255, 255, 255, 0.02) !important;
      z-index: 2147483646 !important;
      animation: mist-slide-in 0.3s ease-out forwards !important;
      isolation: isolate !important;
      contain: layout style paint !important;
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;
      text-rendering: optimizeLegibility !important;
      letter-spacing: normal !important;
      word-spacing: normal !important;
      text-transform: none !important;
      text-indent: 0 !important;
      text-shadow: none !important;
      white-space: normal !important;
      word-break: normal !important;
      word-wrap: normal !important;
      direction: ltr !important;
      writing-mode: horizontal-tb !important;
    }

    .mist-dock.closing {
      animation: mist-slide-out 0.25s ease-in forwards !important;
    }

    .mist-dock * {
      box-sizing: border-box !important;
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       HEADER
       ══════════════════════════════════════════════════════════════════════ */
    .mist-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 14px 16px !important;
      margin: 0 !important;
      background: linear-gradient(180deg, rgba(255, 107, 53, 0.04) 0%, transparent 100%) !important;
      border-bottom: 1px solid var(--mist-border) !important;
      flex-shrink: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
      height: auto !important;
      min-height: 64px !important;
      max-height: 64px !important;
    }

    .mist-header-left {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-logo {
      width: 44px !important;
      height: 44px !important;
      min-width: 44px !important;
      min-height: 44px !important;
      max-width: 44px !important;
      max-height: 36px !important;
      border-radius: 8px !important;
      background: #2a2a2a !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 0 30px rgba(255, 165, 27, 0.25) !important;
      animation: mist-glow-pulse 3s ease-in-out infinite !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
      flex-shrink: 0 !important;
    }

    .mist-logo img {
      width: 40px !important;
      height: 40px !important;
      min-width: 40px !important;
      min-height: 40px !important;
      image-rendering: auto !important;
      object-fit: contain !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-brand {
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-brand-name {
      font-size: 14px !important;
      font-weight: 600 !important;
      letter-spacing: -0.01em !important;
      background: linear-gradient(90deg, #FFD93D 0%, #FF6B35 50%, #E62E2E 100%) !important;
      -webkit-background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      background-clip: text !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.3 !important;
    }

    .mist-brand-sub {
      font-size: 11px !important;
      color: #9a9a9a !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.3 !important;
    }

    .mist-header-right {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-status-badge {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 12px !important;
      height: 12px !important;
      min-width: 12px !important;
      min-height: 12px !important;
      max-width: 12px !important;
      max-height: 12px !important;
      border-radius: 50% !important;
      background: transparent !important;
      transition: all var(--mist-transition) !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-status-dot {
      width: 10px !important;
      height: 10px !important;
      min-width: 10px !important;
      min-height: 10px !important;
      max-width: 10px !important;
      max-height: 10px !important;
      border-radius: 50% !important;
      background: var(--mist-orange-light) !important;
      box-shadow: 0 0 6px rgba(255, 140, 0, 0.5) !important;
      transition: all var(--mist-transition) !important;
    }

    .mist-status-badge.connected .mist-status-dot {
      background: var(--mist-success) !important;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.6) !important;
    }

    .mist-status-badge.error .mist-status-dot {
      background: var(--mist-red) !important;
      box-shadow: 0 0 6px rgba(230, 46, 46, 0.6) !important;
    }

    .mist-status-badge.warning .mist-status-dot {
      background: var(--mist-orange) !important;
      box-shadow: 0 0 6px rgba(255, 140, 0, 0.6) !important;
    }

    .mist-icon-btn {
      all: unset !important;
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      max-width: 32px !important;
      max-height: 32px !important;
      border-radius: 8px !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      background: #2a2a2a !important;
      color: #9a9a9a !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      font-size: 14px !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      line-height: 1 !important;
      flex-shrink: 0 !important;
    }

    .mist-icon-btn:hover {
      background: #333333 !important;
      border-color: rgba(255, 217, 61, 0.5) !important;
      color: #f5f5f5 !important;
      transform: translateY(-1px) !important;
    }

    /* Bouton Langue */
    .mist-lang-btn {
      font-size: 12px !important;
      padding: 0 !important;
      line-height: 1 !important;
      width: 32px !important;
      height: 32px !important;
    }

    .mist-icon-btn:active {
      transform: translateY(0) !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       PANNEAU SETTINGS (OVERLAY)
       ══════════════════════════════════════════════════════════════════════ */
    .mist-settings-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all var(--mist-transition);
    }

    .mist-settings-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .mist-settings-panel {
      position: absolute;
      top: 60px;
      left: 16px;
      right: 16px;
      background: var(--mist-bg-panel);
      border: 1px solid var(--mist-border);
      border-radius: var(--mist-radius-lg);
      padding: 20px;
      box-shadow: var(--mist-shadow-lg);
      transform: translateY(-12px);
      opacity: 0;
      transition: all 0.25s ease-out;
    }

    .mist-settings-overlay.open .mist-settings-panel {
      transform: translateY(0);
      opacity: 1;
    }

    .mist-settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .mist-settings-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--mist-text);
    }

    .mist-settings-close {
      width: 28px;
      height: 28px;
      border-radius: var(--mist-radius-sm);
      border: none;
      background: var(--mist-bg-elevated);
      color: var(--mist-text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--mist-transition);
    }

    .mist-settings-close:hover {
      background: var(--mist-bg-input);
      color: var(--mist-text);
    }

    .mist-field {
      margin-bottom: 14px;
    }

    .mist-field-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--mist-text-muted);
      margin-bottom: 6px;
    }

    .mist-field-row {
      display: flex;
      gap: 8px;
    }

    .mist-input {
      flex: 1;
      padding: 10px 12px;
      border-radius: var(--mist-radius-md);
      border: 1px solid var(--mist-border);
      background: var(--mist-bg-input);
      color: var(--mist-text);
      font-size: 13px;
      outline: none;
      transition: all var(--mist-transition);
    }

    .mist-input::placeholder {
      color: var(--mist-text-dim);
    }

    .mist-input:focus {
      border-color: var(--mist-border-focus);
      box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
    }

    .mist-input-select {
      cursor: pointer !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      -moz-appearance: none !important;
      background-color: var(--mist-bg-input) !important;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E") !important;
      background-repeat: no-repeat !important;
      background-position: right 12px center !important;
      padding-right: 36px !important;
      color: var(--mist-text) !important;
      border: 1px solid var(--mist-border) !important;
    }

    .mist-input-select:focus {
      border-color: var(--mist-orange) !important;
      box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.2) !important;
    }

    .mist-input-select option {
      background: var(--mist-bg-panel) !important;
      color: var(--mist-text) !important;
      padding: 8px !important;
    }

    .mist-btn {
      all: unset !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 10px 14px !important;
      margin: 0 !important;
      border-radius: var(--mist-radius-md) !important;
      border: 1px solid var(--mist-border) !important;
      background: var(--mist-bg-elevated) !important;
      color: var(--mist-text) !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      transition: all var(--mist-transition) !important;
      box-sizing: border-box !important;
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      line-height: 1.4 !important;
    }

    .mist-btn:hover {
      background: var(--mist-bg-input) !important;
      border-color: var(--mist-border-focus) !important;
      transform: translateY(-1px) !important;
    }

    .mist-btn:active {
      transform: translateY(0) !important;
    }

    .mist-btn-primary {
      background: var(--mist-accent-gradient-soft) !important;
      border: none !important;
      color: var(--mist-bg-deep) !important;
      font-weight: 600 !important;
      box-shadow: var(--mist-shadow-glow) !important;
    }

    .mist-btn-primary:hover {
      box-shadow: var(--mist-shadow-glow-yellow) !important;
      background: var(--mist-accent-gradient-soft) !important;
    }

    .mist-btn-danger {
      border-color: rgba(239, 68, 68, 0.3) !important;
      color: var(--mist-error) !important;
    }

    .mist-btn-danger:hover {
      background: rgba(239, 68, 68, 0.1) !important;
      border-color: var(--mist-error) !important;
    }

    .mist-settings-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }

    .mist-settings-message {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: var(--mist-radius-md);
      font-size: 12px;
      display: none;
    }

    .mist-settings-message.show {
      display: block;
      animation: mist-fade-in 0.2s ease-out;
    }

    .mist-settings-message.success {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: var(--mist-success);
    }

    .mist-settings-message.error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--mist-error);
    }

    .mist-settings-divider {
      height: 1px;
      background: var(--mist-border);
      margin: 14px 0;
    }

    .mist-settings-help {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--mist-border);
    }

    .mist-settings-help-link {
      font-size: 12px;
      color: var(--mist-orange-light);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all var(--mist-transition);
    }

    .mist-settings-help-link:hover {
      color: var(--mist-yellow);
    }

    .mist-settings-help-separator {
      color: var(--mist-text-dim);
      margin: 0 8px;
    }

    /* Bouton de mise à jour */
    .mist-update-btn {
      all: unset !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      padding: 4px 8px !important;
      border-radius: 6px !important;
      transition: all 0.2s ease !important;
      font-size: 14px !important;
    }

    .mist-update-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
    }

    .mist-update-icon {
      display: inline-block !important;
    }

    /* État: vérification en cours */
    .mist-update-checking {
      filter: grayscale(100%) opacity(0.5) !important;
      animation: mist-spin 1s linear infinite !important;
    }

    /* État: pas de mise à jour (grisé) */
    .mist-update-none {
      filter: grayscale(100%) opacity(0.5) !important;
    }

    /* État: mise à jour disponible (coloré avec animation) */
    .mist-update-available {
      filter: none !important;
      animation: mist-pulse 1.5s ease-in-out infinite !important;
    }

    @keyframes mist-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes mist-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    /* Section Agents dans Settings */
    .mist-settings-agents {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--mist-border);
    }

    .mist-settings-agents-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .mist-settings-agent-wrapper {
      display: flex;
      flex-direction: column;
      gap: 0;
      width: 100%;
    }

    .mist-settings-agent-item {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      padding: 10px 14px !important;
      background: var(--mist-bg-panel) !important;
      border-radius: var(--mist-radius-md) !important;
      border: 1px solid var(--mist-border) !important;
      transition: all var(--mist-transition) !important;
      cursor: pointer !important;
      text-align: left !important;
      font-size: 12px !important;
      min-width: 120px;
    }

    .mist-settings-agent-item:hover {
      border-color: var(--mist-orange) !important;
      background: var(--mist-bg-elevated) !important;
    }

    .mist-settings-agent-item-header {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mist-settings-agent-item-name {
      font-weight: 600;
      font-size: 13px;
      color: var(--mist-text);
    }

    .mist-settings-agent-item-id {
      font-size: 10px;
      color: var(--mist-text-dim);
      font-family: 'Consolas', 'Monaco', monospace;
    }

    /* Détails étendus (cachés par défaut) */
    .mist-settings-agent-item-details {
      display: none !important;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--mist-border);
    }

    .mist-settings-agent-item.expanded .mist-settings-agent-item-details {
      display: flex !important;
    }

    .mist-settings-agent-item.expanded .mist-settings-agent-item-id-short {
      display: none !important;
    }

    .mist-settings-agent-item-row {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .mist-settings-agent-item-label {
      font-size: 9px;
      color: var(--mist-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mist-settings-agent-item-value {
      font-size: 11px;
      color: var(--mist-text);
      font-family: 'Consolas', 'Monaco', monospace;
      word-break: break-all;
    }

    .mist-settings-agent-item-delete {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      background: rgba(255, 82, 82, 0.1);
      border: 1px solid rgba(255, 82, 82, 0.3);
      border-radius: var(--mist-radius-sm);
      color: #ff5252;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 4px;
    }

    .mist-settings-agent-item-delete:hover {
      background: rgba(255, 82, 82, 0.2);
      border-color: #ff5252;
    }

    /* Popup détails agent */
    .mist-agent-popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10002;
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s ease;
    }

    .mist-agent-popup-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .mist-agent-popup {
      background: var(--mist-bg-elevated);
      border: 1px solid var(--mist-border);
      border-radius: var(--mist-radius-lg);
      padding: 20px;
      min-width: 280px;
      max-width: 340px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      transform: scale(0.9);
      transition: transform 0.2s ease;
    }

    .mist-agent-popup-overlay.open .mist-agent-popup {
      transform: scale(1);
    }

    .mist-agent-popup-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--mist-border);
    }

    .mist-agent-popup-icon {
      font-size: 32px;
    }

    .mist-agent-popup-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--mist-text);
    }

    .mist-agent-popup-close {
      margin-left: auto;
      background: transparent;
      border: none;
      color: var(--mist-text-muted);
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }

    .mist-agent-popup-close:hover {
      color: var(--mist-text);
    }

    .mist-agent-popup-field {
      margin-bottom: 12px;
    }

    .mist-agent-popup-label {
      font-size: 10px;
      text-transform: uppercase;
      color: var(--mist-text-muted);
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }

    .mist-agent-popup-value {
      font-size: 12px;
      color: var(--mist-text);
      background: var(--mist-bg-input);
      padding: 8px 10px;
      border-radius: var(--mist-radius-sm);
      word-break: break-all;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    .mist-agent-popup-date {
      font-family: inherit;
    }

    .mist-agent-popup-actions {
      margin-top: 16px;
      display: flex;
      gap: 8px;
    }

    .mist-agent-popup-delete {
      flex: 1;
      background: rgba(255, 82, 82, 0.15);
      border: 1px solid rgba(255, 82, 82, 0.4);
      color: #ff5252;
      padding: 10px 16px;
      border-radius: var(--mist-radius-md);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    .mist-agent-popup-delete:hover {
      background: rgba(255, 82, 82, 0.25);
      border-color: #ff5252;
    }

    .mist-settings-agent-item-delete {
      width: 24px;
      height: 24px;
      border-radius: var(--mist-radius-sm);
      border: none;
      background: transparent;
      color: var(--mist-text-dim);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all var(--mist-transition);
    }

    .mist-settings-agent-item-delete:hover {
      background: rgba(230, 46, 46, 0.15);
      color: var(--mist-red);
    }

    .mist-btn-add-agent {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 10px 14px !important;
      min-width: 120px;
      min-height: 52px;
      border-style: dashed !important;
      background: transparent !important;
      color: var(--mist-text-muted) !important;
      border-radius: var(--mist-radius-md) !important;
      cursor: pointer;
    }

    .mist-btn-add-agent:hover {
      border-color: var(--mist-yellow) !important;
      color: var(--mist-yellow) !important;
      background: rgba(255, 217, 61, 0.05) !important;
    }

    .mist-settings-agent-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      background: var(--mist-bg-input);
      border-radius: var(--mist-radius-md);
      border: 1px solid var(--mist-border);
    }

    .mist-settings-agent-form-actions {
      display: flex;
      gap: 8px;
    }

    .mist-settings-agent-form-actions .mist-btn {
      flex: 1;
    }

    .mist-btn-full {
      width: 100%;
    }

    /* ══════════════════════════════════════════════════════════════════════
       ONBOARDING (ÉCRAN INITIAL)
       ══════════════════════════════════════════════════════════════════════ */
    .mist-onboarding {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
      text-align: center;
    }

    .mist-onboarding-icon {
      width: 72px;
      height: 72px;
      border-radius: var(--mist-radius-lg);
      background: var(--mist-bg-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
      box-shadow: var(--mist-shadow-glow);
      animation: mist-glow-pulse 3s ease-in-out infinite;
      overflow: hidden;
    }

    .mist-onboarding-icon img {
      width: 56px;
      height: 56px;
      image-rendering: pixelated;
      object-fit: contain;
    }

    .mist-onboarding-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
      background: var(--mist-accent-gradient-horizontal);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .mist-onboarding-desc {
      font-size: 13px;
      color: var(--mist-text-muted);
      max-width: 280px;
      margin-bottom: 28px;
      line-height: 1.6;
    }

    .mist-onboarding-form {
      width: 100%;
      max-width: 300px;
    }

    .mist-onboarding-input {
      width: 100%;
      padding: 14px 16px;
      border-radius: var(--mist-radius-lg);
      border: 1px solid var(--mist-border);
      background: var(--mist-bg-input);
      color: var(--mist-text);
      font-size: 14px;
      outline: none;
      margin-bottom: 12px;
      transition: all var(--mist-transition);
    }

    .mist-onboarding-input:focus {
      border-color: var(--mist-border-focus);
      box-shadow: 0 0 0 4px rgba(255, 107, 53, 0.1);
    }

    .mist-onboarding-btn {
      width: 100%;
      padding: 14px;
      border-radius: var(--mist-radius-lg);
      border: none;
      background: var(--mist-accent-gradient-soft);
      color: var(--mist-bg-deep);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--mist-transition);
      box-shadow: var(--mist-shadow-glow);
    }

    .mist-onboarding-btn:hover {
      transform: translateY(-2px);
      box-shadow: var(--mist-shadow-glow-yellow);
    }

    .mist-onboarding-btn:active {
      transform: translateY(0);
    }

    .mist-onboarding-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .mist-onboarding-status {
      margin-top: 16px;
      font-size: 13px;
      min-height: 20px;
    }

    .mist-onboarding-status.success {
      color: var(--mist-success);
    }

    .mist-onboarding-status.error {
      color: var(--mist-error);
    }

    .mist-onboarding-help {
      margin-top: 20px;
      font-size: 12px;
      color: var(--mist-text-dim);
    }

    .mist-onboarding-help a {
      color: var(--mist-orange-light);
      text-decoration: none;
      transition: color var(--mist-transition);
    }

    .mist-onboarding-help a:hover {
      color: var(--mist-yellow);
    }

    /* ══════════════════════════════════════════════════════════════════════
       ONGLETS
       ══════════════════════════════════════════════════════════════════════ */
    .mist-tabs {
      display: flex !important;
      padding: 0 !important;
      margin: 0 !important;
      border-bottom: 1px solid var(--mist-border) !important;
      background: var(--mist-bg-panel) !important;
      flex-shrink: 0 !important;
      z-index: 1 !important;
      justify-content: center !important;
      list-style: none !important;
      width: 100% !important;
      height: auto !important;
      min-height: 44px !important;
      max-height: 44px !important;
    }

    .mist-tab {
      all: unset !important;
      flex: 1 1 auto !important;
      padding: 12px 8px !important;
      margin: 0 !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      color: var(--mist-text-muted) !important;
      border: none !important;
      background: transparent !important;
      text-align: center !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      position: relative !important;
      transition: all var(--mist-transition) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-sizing: border-box !important;
      line-height: 1.4 !important;
      height: 44px !important;
      min-width: 0 !important;
      max-width: none !important;
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif !important;
    }

    .mist-tab:hover {
      color: var(--mist-text) !important;
      background: transparent !important;
    }

    .mist-tab.active {
      color: var(--mist-yellow) !important;
      background: transparent !important;
    }

    .mist-tab.active::after {
      content: '' !important;
      position: absolute !important;
      bottom: -1px !important;
      left: 16px !important;
      right: 16px !important;
      height: 2px !important;
      background: var(--mist-accent-gradient-horizontal) !important;
      border-radius: 2px 2px 0 0 !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       CONTEXTE PAGE
       ══════════════════════════════════════════════════════════════════════ */
    .mist-context {
      padding: 12px 16px !important;
      margin: 0 !important;
      background: #212121 !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      flex-shrink: 0 !important;
      z-index: 1 !important;
      width: 100% !important;
      box-sizing: border-box !important;
      height: auto !important;
      min-height: 52px !important;
    }

    .mist-context-favicon {
      width: 20px !important;
      height: 20px !important;
      min-width: 20px !important;
      min-height: 20px !important;
      max-width: 20px !important;
      max-height: 20px !important;
      border-radius: 4px !important;
      background: #2a2a2a !important;
      margin: 0 !important;
      padding: 0 !important;
      flex-shrink: 0 !important;
    }

    .mist-context-info {
      flex: 1 !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-context-title {
      font-size: 12px !important;
      font-weight: 500 !important;
      color: #f5f5f5 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.4 !important;
    }

    .mist-context-url {
      font-size: 11px !important;
      color: #666666 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.4 !important;
    }

    .mist-context-refresh {
      all: unset !important;
      width: 28px !important;
      height: 28px !important;
      min-width: 28px !important;
      min-height: 28px !important;
      max-width: 28px !important;
      max-height: 28px !important;
      border-radius: 8px !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      background: #2a2a2a !important;
      color: #9a9a9a !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 12px !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      flex-shrink: 0 !important;
    }

    .mist-context-refresh:hover {
      background: #333333 !important;
      color: #f5f5f5 !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       CONTENEUR PRINCIPAL (après onboarding)
       ══════════════════════════════════════════════════════════════════════ */
    .mist-main {
      flex: 1 1 auto !important;
      display: flex !important;
      flex-direction: column !important;
      min-height: 0 !important;
      overflow: hidden !important;
      position: relative !important;
      box-sizing: border-box !important;
      height: 100% !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       ZONE CHAT
       ══════════════════════════════════════════════════════════════════════ */
    .mist-chat {
      flex: 1 1 auto !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      padding: 16px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 16px !important;
      min-height: 0 !important;
      max-height: none !important;
      height: auto !important;
      position: relative !important;
      box-sizing: border-box !important;
      -webkit-overflow-scrolling: touch !important;
    }

    .mist-chat::-webkit-scrollbar {
      width: 6px !important;
      display: block !important;
    }

    .mist-chat::-webkit-scrollbar-track {
      background: transparent !important;
    }

    .mist-chat::-webkit-scrollbar-thumb {
      background: var(--mist-border) !important;
      border-radius: 3px !important;
    }

    .mist-chat::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.12) !important;
    }

    .mist-message {
      all: unset !important;
      display: flex !important;
      gap: 10px !important;
      animation: mist-fade-in 0.3s ease-out !important;
      box-sizing: border-box !important;
      width: 100% !important;
      max-width: 100% !important;
      flex-shrink: 0 !important;
    }

    .mist-message.user {
      flex-direction: row-reverse !important;
    }

    .mist-message-avatar {
      all: unset !important;
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      max-width: 32px !important;
      max-height: 32px !important;
      border-radius: 6px !important;
      background: #2a2a2a !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #888888 !important;
      flex-shrink: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      border: none !important;
      box-shadow: none !important;
    }

    .mist-message-avatar img {
      width: 100% !important;
      height: 100% !important;
      object-fit: contain !important;
      border: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-message.assistant .mist-message-avatar {
      background: #2a2a2a !important;
      padding: 2px !important;
    }

    .mist-message.assistant .mist-message-avatar img {
      image-rendering: pixelated !important;
    }

    .mist-message.user .mist-message-avatar {
      background: #f5f5f5 !important;
      padding: 4px !important;
    }

    .mist-message.user .mist-message-avatar img {
      filter: invert(0) !important;
    }

    .mist-message-content {
      all: unset !important;
      flex: 1 1 auto !important;
      max-width: 85% !important;
      display: block !important;
      box-sizing: border-box !important;
    }

    .mist-message-action {
      all: unset !important;
      font-size: 10px !important;
      color: #FFB347 !important;
      margin-bottom: 4px !important;
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }

    .mist-message-bubble {
      all: unset !important;
      display: block !important;
      padding: 12px 14px !important;
      border-radius: 12px !important;
      font-size: 13px !important;
      line-height: 1.6 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      box-sizing: border-box !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
    }

    .mist-message.user .mist-message-bubble {
      background: linear-gradient(135deg, #FF7000, #FFA500) !important;
      color: #1a1a1a !important;
      border-bottom-right-radius: 4px !important;
      border: none !important;
    }

    .mist-message.assistant .mist-message-bubble {
      background: #2a2a2a !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      border-bottom-left-radius: 4px !important;
      color: #f5f5f5 !important;
    }

    .mist-message-bubble h1,
    .mist-message-bubble h2,
    .mist-message-bubble h3,
    .mist-message-bubble h4,
    .mist-message-bubble h5,
    .mist-message-bubble h6 {
      margin: 16px 0 8px 0;
      font-weight: 600;
      line-height: 1.3;
    }

    .mist-message-bubble h1:first-child,
    .mist-message-bubble h2:first-child,
    .mist-message-bubble h3:first-child,
    .mist-message-bubble h4:first-child,
    .mist-message-bubble h5:first-child,
    .mist-message-bubble h6:first-child {
      margin-top: 0;
    }

    .mist-message-bubble h1 {
      font-size: 18px;
      color: var(--mist-yellow);
      border-bottom: 1px solid var(--mist-border);
      padding-bottom: 6px;
    }

    .mist-message-bubble h2 {
      font-size: 16px;
      color: var(--mist-yellow);
    }

    .mist-message-bubble h3 {
      font-size: 14px;
      color: var(--mist-orange-light);
    }

    .mist-message-bubble h4 {
      font-size: 13px;
      color: var(--mist-orange);
    }

    .mist-message-bubble h5 {
      font-size: 12px;
      color: var(--mist-orange);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mist-message-bubble h6 {
      font-size: 11px;
      color: var(--mist-text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mist-message-bubble ul,
    .mist-message-bubble ol {
      margin: 8px 0;
      padding-left: 20px;
    }

    .mist-message-bubble li {
      margin: 4px 0;
    }

    .mist-message-bubble strong {
      color: var(--mist-yellow);
      font-weight: 600;
    }

    .mist-message-bubble em {
      font-style: italic;
      color: var(--mist-text-muted);
    }

    .mist-message-bubble code {
      background: var(--mist-bg-input);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
    }

    .mist-message-bubble pre {
      background: var(--mist-bg-input);
      padding: 12px;
      border-radius: var(--mist-radius-sm);
      overflow-x: auto;
      margin: 8px 0;
    }

    .mist-message-bubble pre code {
      background: none;
      padding: 0;
    }

    .mist-message-bubble a,
    .mist-message-bubble .mist-link {
      color: var(--mist-yellow);
      text-decoration: none;
      border-bottom: 1px solid var(--mist-orange);
      transition: all var(--mist-transition);
      word-break: break-all;
    }

    .mist-message-bubble a:hover,
    .mist-message-bubble .mist-link:hover {
      color: var(--mist-orange-light);
      border-bottom-color: var(--mist-yellow);
    }

    /* Styles pour les tableaux Markdown */
    .mist-table-wrapper {
      overflow-x: auto;
      margin: 12px 0;
      border-radius: 8px;
      border: 1px solid var(--mist-border);
    }

    .mist-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      background: var(--mist-bg-elevated);
    }

    .mist-table th,
    .mist-table td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--mist-border);
      vertical-align: top;
    }

    .mist-table th {
      background: linear-gradient(135deg, var(--mist-orange) 0%, var(--mist-red) 100%);
      color: white;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mist-table tr:last-child td {
      border-bottom: none;
    }

    .mist-table tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }

    .mist-table tr:hover {
      background: rgba(255, 140, 0, 0.05);
    }

    .mist-table td {
      color: var(--mist-text);
      line-height: 1.5;
    }

    .mist-table td strong {
      color: var(--mist-yellow);
    }

    .mist-message-bubble p {
      margin: 8px 0;
    }

    .mist-message-bubble p:first-child {
      margin-top: 0;
    }

    .mist-message-bubble p:last-child {
      margin-bottom: 0;
    }

    .mist-message-actions {
      all: unset !important;
      display: flex !important;
      flex-direction: row !important;
      gap: 8px !important;
      margin-top: 8px !important;
      padding: 0 !important;
      border: none !important;
      background: none !important;
      box-sizing: border-box !important;
    }

    .mist-message-action-btn {
      all: unset !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 11px !important;
      font-weight: 400 !important;
      color: #888888 !important;
      background: none !important;
      background-color: transparent !important;
      border: none !important;
      border-radius: 0 !important;
      cursor: pointer !important;
      padding: 2px 4px !important;
      margin: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 4px !important;
      transition: color 0.2s ease !important;
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      line-height: 1.4 !important;
      box-shadow: none !important;
      min-width: auto !important;
      min-height: auto !important;
      max-width: none !important;
      max-height: none !important;
      width: auto !important;
      height: auto !important;
      box-sizing: border-box !important;
    }

    .mist-message-action-btn:hover {
      color: #f5f5f5 !important;
      background: none !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    .mist-message-action-btn:focus {
      outline: none !important;
      box-shadow: none !important;
    }

    .mist-message-action-btn:active {
      background: none !important;
      transform: none !important;
    }

    /* État de chargement */
    .mist-typing {
      display: flex;
      gap: 4px;
      padding: 12px 14px;
    }

    .mist-typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--mist-orange-light);
      animation: mist-typing 1.2s ease-in-out infinite;
    }

    .mist-typing-dot:nth-child(1) {
      background: var(--mist-yellow);
    }

    .mist-typing-dot:nth-child(2) {
      background: var(--mist-orange);
    }

    .mist-typing-dot:nth-child(3) {
      background: var(--mist-red);
    }

    .mist-typing-dot:nth-child(2) {
      animation-delay: 0.2s;
    }

    .mist-typing-dot:nth-child(3) {
      animation-delay: 0.4s;
    }

    /* Message vide / placeholder */
    .mist-chat-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 32px;
      color: var(--mist-text-muted);
    }

    .mist-chat-empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.3;
    }

    .mist-chat-empty-text {
      font-size: 14px;
      max-width: 240px;
      line-height: 1.6;
    }

    /* ══════════════════════════════════════════════════════════════════════
       ZONE ACTIONS RAPIDES
       ══════════════════════════════════════════════════════════════════════ */
    .mist-actions-grid {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 16px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      align-content: start;
      min-height: 0;
    }

    .mist-action-card {
      padding: 16px;
      border-radius: var(--mist-radius-lg);
      border: 1px solid var(--mist-border);
      background: var(--mist-bg-panel);
      cursor: pointer;
      transition: all var(--mist-transition);
    }

    .mist-action-card:hover {
      background: var(--mist-bg-elevated);
      border-color: var(--mist-border-focus);
      transform: translateY(-2px);
      box-shadow: var(--mist-shadow-md);
    }

    .mist-action-card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .mist-action-card-icon {
      width: 32px;
      height: 32px;
      border-radius: var(--mist-radius-sm);
      background: var(--mist-bg-input);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .mist-action-card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--mist-text);
    }

    .mist-action-card-desc {
      font-size: 12px;
      color: var(--mist-text-muted);
      line-height: 1.5;
    }

    /* Carte spéciale Agent de Page */
    .mist-action-card-special {
      background: linear-gradient(135deg, rgba(255, 217, 61, 0.08) 0%, rgba(255, 107, 53, 0.08) 100%);
      border-color: rgba(255, 165, 27, 0.3);
    }

    .mist-action-card-special:hover {
      border-color: rgba(255, 217, 61, 0.5);
      box-shadow: var(--mist-shadow-md), 0 0 20px rgba(255, 165, 27, 0.15);
    }

    /* Carte désactivée (Coming Soon) */
    .mist-action-card-disabled {
      opacity: 0.5 !important;
      pointer-events: none !important;
      cursor: not-allowed !important;
      filter: grayscale(50%) !important;
    }

    .mist-action-card-disabled:hover {
      transform: none !important;
      box-shadow: var(--mist-shadow-sm) !important;
      border-color: var(--mist-border) !important;
    }

    .mist-badge-coming-soon {
      font-size: 9px !important;
      font-weight: 700 !important;
      padding: 2px 8px !important;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%) !important;
      color: white !important;
      border-radius: 10px !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
      margin-left: auto !important;
      flex-shrink: 0 !important;
    }

    .mist-action-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: var(--mist-radius-pill);
      background: var(--mist-accent-gradient-soft);
      color: var(--mist-bg-deep);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Sections d'actions */
    .mist-action-section {
      margin-bottom: 20px;
    }

    .mist-action-section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--mist-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--mist-border);
    }

    /* ══════════════════════════════════════════════════════════════════════
       ONGLET AGENTS (simplifié)
       ══════════════════════════════════════════════════════════════════════ */
    .mist-agents-tab {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-height: 0;
    }

    .mist-agents-selector {
      background: linear-gradient(135deg, rgba(255, 217, 61, 0.08) 0%, rgba(255, 107, 53, 0.08) 100%);
      border: 1px solid rgba(255, 165, 27, 0.25);
      border-radius: var(--mist-radius-lg);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .mist-agents-selector-header {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .mist-agents-selector-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--mist-radius-md);
      background: var(--mist-accent-gradient-soft);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
    }

    .mist-agents-selector-text h3 {
      margin: 0 0 4px 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--mist-text);
    }

    .mist-agents-selector-text p {
      margin: 0;
      font-size: 12px;
      color: var(--mist-text-muted);
    }

    .mist-select-large {
      padding: 14px 16px;
      font-size: 14px;
      background: var(--mist-bg-deep);
      border-color: rgba(255, 165, 27, 0.3);
    }

    .mist-select-large:focus {
      border-color: var(--mist-yellow);
      box-shadow: 0 0 0 3px rgba(255, 217, 61, 0.15);
    }

    .mist-agents-selector-info {
      text-align: center;
      padding: 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: var(--mist-radius-md);
    }

    .mist-agents-selector-info p {
      margin: 0 0 4px 0;
      font-size: 13px;
      color: var(--mist-text-muted);
    }

    .mist-agents-selector-info span {
      font-size: 11px;
      color: var(--mist-text-dim);
    }

    .mist-agents-selector-info.has-agents {
      display: none;
    }

    .mist-btn-settings {
      margin-top: auto;
      background: var(--mist-bg-panel);
      border-color: var(--mist-border);
    }

    .mist-btn-settings:hover {
      border-color: var(--mist-yellow);
      color: var(--mist-yellow);
    }

    /* Select */
    .mist-select {
      width: 100%;
      padding: 10px 12px;
      border-radius: var(--mist-radius-md);
      border: 1px solid var(--mist-border);
      background: var(--mist-bg-input);
      color: var(--mist-text);
      font-size: 13px;
      cursor: pointer;
      outline: none;
      transition: all var(--mist-transition);
    }

    .mist-select:focus {
      border-color: var(--mist-border-focus);
    }

    .mist-select option {
      background: var(--mist-bg-panel);
      color: var(--mist-text);
    }

    /* Header Agent */
    .mist-agent-header {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      background: var(--mist-bg-elevated);
      border-bottom: 1px solid var(--mist-border);
      flex-shrink: 0;
    }

    .mist-agent-select-inline {
      flex: 1;
      padding: 8px 12px;
      font-size: 13px;
    }

    .mist-agent-settings-btn {
      flex-shrink: 0;
    }

    /* Chat Agent */
    .mist-agent-chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .mist-agent-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 30px 20px;
      color: var(--mist-text-muted);
    }

    .mist-agent-empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.6;
    }

    .mist-agent-empty h3 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--mist-text);
    }

    .mist-agent-empty p {
      margin: 0 0 16px 0;
      font-size: 13px;
      line-height: 1.5;
    }

    .mist-agent-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Message Agent */
    .mist-agent-message {
      display: flex;
      gap: 10px;
      max-width: 95%;
    }

    .mist-agent-message.user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .mist-agent-message.agent {
      align-self: flex-start;
    }

    .mist-agent-message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      object-fit: cover;
    }

    .mist-agent-message-bubble {
      padding: 10px 14px;
      border-radius: var(--mist-radius-lg);
      font-size: 13px;
      line-height: 1.5;
    }

    .mist-agent-message.user .mist-agent-message-bubble {
      background: var(--mist-accent-gradient-soft);
      color: var(--mist-text);
      border-bottom-right-radius: 4px;
    }

    .mist-agent-message.agent .mist-agent-message-bubble {
      background: var(--mist-bg-panel);
      border: 1px solid var(--mist-border);
      border-bottom-left-radius: 4px;
    }

    /* Input Agent */
    .mist-agent-input-area {
      padding: 12px 16px;
      background: var(--mist-bg-elevated);
      border-top: 1px solid var(--mist-border);
      flex-shrink: 0;
    }

    .mist-agent-input-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .mist-agent-input {
      flex: 1;
      resize: none;
      min-height: 38px;
      max-height: 120px;
      padding: 10px 14px;
      font-size: 13px;
      line-height: 1.4;
    }

    .mist-agent-send {
      width: 38px;
      height: 38px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .mist-agent-send span {
      font-size: 16px;
    }

    /* Typing indicator pour agent */
    .mist-agent-typing {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: var(--mist-bg-panel);
      border: 1px solid var(--mist-border);
      border-radius: var(--mist-radius-lg);
      border-bottom-left-radius: 4px;
      font-size: 12px;
      color: var(--mist-text-muted);
    }

    .mist-agent-typing-dots {
      display: flex;
      gap: 3px;
    }

    .mist-agent-typing-dots span {
      width: 6px;
      height: 6px;
      background: var(--mist-orange);
      border-radius: 50%;
      animation: agentTyping 1.2s infinite;
    }

    .mist-agent-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .mist-agent-typing-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes agentTyping {
      0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
      30% { opacity: 1; transform: scale(1); }
    }

    /* ══════════════════════════════════════════════════════════════════════
       TAB: INTÉGRATION
       ══════════════════════════════════════════════════════════════════════ */
    .mist-integration-tab {
      flex: 1 !important;
      overflow: hidden !important;
      padding: 16px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      min-height: 0 !important;
    }

    .mist-integration-tab::-webkit-scrollbar {
      width: 0 !important;
      display: none !important;
    }

    /* Panneau déroulant */
    .mist-integration-panel {
      background: var(--mist-bg-elevated);
      border: 1px solid var(--mist-border);
      border-radius: var(--mist-radius-lg);
      overflow: hidden;
      margin-bottom: 12px;
    }

    .mist-integration-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      cursor: pointer;
      background: linear-gradient(135deg, rgba(66, 133, 244, 0.1) 0%, rgba(52, 168, 83, 0.1) 100%);
      transition: background 0.2s;
    }

    .mist-integration-panel-header:hover {
      background: linear-gradient(135deg, rgba(66, 133, 244, 0.15) 0%, rgba(52, 168, 83, 0.15) 100%);
    }

    .mist-integration-panel-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .mist-integration-toggle-icon {
      font-size: 12px;
      color: var(--mist-text-muted);
      transition: transform 0.3s ease;
    }

    .mist-integration-panel.collapsed .mist-integration-toggle-icon {
      transform: rotate(-90deg);
    }

    .mist-integration-panel-content {
      padding: 12px;
      border-top: 1px solid var(--mist-border);
      max-height: 400px;
      overflow-y: auto;
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.3s ease;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    
    .mist-integration-panel-content::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
    }

    .mist-integration-panel.collapsed .mist-integration-panel-content {
      max-height: 0;
      padding: 0 12px;
      opacity: 0;
      overflow: hidden;
      border-top: none;
    }

    .mist-integration-header-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      background: linear-gradient(135deg, rgba(66, 133, 244, 0.2) 0%, rgba(52, 168, 83, 0.2) 100%);
      border-radius: var(--mist-radius-md);
      flex-shrink: 0;
    }

    .mist-integration-header-text h3 {
      margin: 0 0 2px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--mist-text);
    }

    .mist-integration-header-text p {
      margin: 0;
      font-size: 11px;
      color: var(--mist-text-muted);
      line-height: 1.3;
    }

    .mist-btn-full {
      width: 100%;
      margin-bottom: 10px;
      padding: 10px;
      background: linear-gradient(135deg, rgba(66, 133, 244, 0.2) 0%, rgba(52, 168, 83, 0.2) 100%);
      border: 1px solid rgba(66, 133, 244, 0.3);
    }

    .mist-btn-full:hover {
      background: linear-gradient(135deg, rgba(66, 133, 244, 0.3) 0%, rgba(52, 168, 83, 0.3) 100%);
    }

    .mist-integration-add {
      background: var(--mist-bg-input);
      border: 1px solid var(--mist-border);
      border-radius: var(--mist-radius-md);
      padding: 10px;
      margin-bottom: 10px;
    }

    .mist-integration-input-row {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }

    .mist-integration-url {
      flex: 1;
      padding: 10px 14px;
      font-size: 13px;
    }

    .mist-integration-add-btn {
      width: 42px;
      height: 42px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    .mist-integration-hint {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .mist-integration-hint span {
      font-size: 11px;
      color: var(--mist-text-muted);
      padding: 4px 10px;
      background: var(--mist-bg-panel);
      border-radius: var(--mist-radius-pill);
      border: 1px solid var(--mist-border);
    }

    .mist-integration-docs {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      overflow-y: auto;
    }

    .mist-integration-docs::-webkit-scrollbar {
      width: 0 !important;
      display: none !important;
    }

    .mist-integration-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
      color: var(--mist-text-muted);
    }

    .mist-integration-empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .mist-integration-empty p {
      margin: 0 0 6px 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--mist-text);
    }

    .mist-integration-empty span {
      font-size: 12px;
    }

    /* Document Card */
    .mist-integration-doc {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: var(--mist-bg-elevated);
      border: 1px solid var(--mist-border);
      border-radius: var(--mist-radius-md);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .mist-integration-doc:hover {
      border-color: var(--mist-orange);
      background: rgba(255, 140, 0, 0.05);
    }

    .mist-integration-doc.active {
      border-color: var(--mist-orange);
      background: linear-gradient(135deg, rgba(255, 217, 61, 0.08) 0%, rgba(255, 107, 53, 0.08) 100%);
    }

    .mist-integration-doc-icon {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      border-radius: var(--mist-radius-sm);
      flex-shrink: 0;
    }

    .mist-integration-doc-icon.docs { background: rgba(66, 133, 244, 0.15); }
    .mist-integration-doc-icon.sheets { background: rgba(52, 168, 83, 0.15); }
    .mist-integration-doc-icon.slides { background: rgba(251, 188, 4, 0.15); }
    .mist-integration-doc-icon.drive { background: rgba(234, 67, 53, 0.15); }

    .mist-integration-doc-info {
      flex: 1;
      min-width: 0;
    }

    .mist-integration-doc-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--mist-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .mist-integration-doc-type {
      font-size: 11px;
      color: var(--mist-text-muted);
    }

    .mist-integration-doc-actions {
      display: flex;
      gap: 6px;
    }

    .mist-integration-doc-btn {
      all: unset;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--mist-radius-sm);
      cursor: pointer;
      opacity: 0.6;
      transition: all 0.2s ease;
    }

    .mist-integration-doc-btn:hover {
      opacity: 1;
      background: var(--mist-bg-panel);
    }

    .mist-integration-doc-btn.delete:hover {
      color: var(--mist-red);
    }

    /* Wrapper pour chat + input en bas */
    .mist-integration-chat-wrapper {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      min-height: 0 !important;
      overflow: hidden !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    
    .mist-integration-chat-wrapper::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
    }

    /* Chat Intégration - Même look que le chat principal */
    .mist-integration-chat {
      flex: 1 !important;
      overflow-y: auto !important;
      min-height: 50px !important;
      padding: 8px 0 !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    
    .mist-integration-chat::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
    }
    
    /* Masquer aussi sur les messages */
    .mist-integration-messages {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    
    .mist-integration-messages::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
    }

    .mist-integration-messages {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      padding: 8px 0 !important;
    }

    /* Les messages dans l'intégration héritent des mêmes styles */
    .mist-integration-messages .mist-message {
      display: flex !important;
      gap: 10px !important;
      animation: mist-fade-in 0.3s ease-out !important;
      width: 100% !important;
    }
    
    .mist-integration-messages .mist-message-avatar {
      width: 32px !important;
      height: 32px !important;
      border-radius: 50% !important;
      flex-shrink: 0 !important;
    }
    
    .mist-integration-messages .mist-message-bubble {
      flex: 1 !important;
      padding: 12px 14px !important;
      border-radius: 12px !important;
      font-size: 13px !important;
      line-height: 1.6 !important;
    }
    
    .mist-integration-messages .mist-message.user .mist-message-bubble {
      background: linear-gradient(135deg, #FF7000, #FFA500) !important;
      color: #1a1a1a !important;
      border-bottom-right-radius: 4px !important;
    }
    
    .mist-integration-messages .mist-message.assistant .mist-message-bubble {
      background: #2a2a2a !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      border-bottom-left-radius: 4px !important;
      color: #f5f5f5 !important;
    }
    
    .mist-integration-messages .mist-message-actions {
      display: flex !important;
      gap: 8px !important;
      margin-top: 6px !important;
      margin-left: 42px !important;
      opacity: 0 !important;
      transition: opacity 0.2s !important;
    }
    
    .mist-integration-messages .mist-message:hover .mist-message-actions {
      opacity: 1 !important;
    }
    
    .mist-integration-messages .mist-message-action-btn {
      font-size: 11px !important;
      color: #888888 !important;
      background: none !important;
      border: none !important;
      cursor: pointer !important;
      padding: 2px 4px !important;
    }
    
    .mist-integration-messages .mist-message-action-btn:hover {
      color: #f5f5f5 !important;
    }

    /* Input area en bas - style chatbar */
    .mist-integration-input-area {
      flex-shrink: 0 !important;
      padding: 12px 0 0 0 !important;
      border-top: 1px solid var(--mist-border) !important;
      margin-top: auto !important;
      background: var(--mist-bg) !important;
    }

    .mist-integration-actions {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    /* Status badges pour docs */
    .mist-integration-doc-status {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: var(--mist-radius-pill);
      font-weight: 500;
    }

    .mist-integration-doc-status.loading {
      background: rgba(66, 133, 244, 0.15);
      color: #4285f4;
    }

    .mist-integration-doc-status.ready {
      background: rgba(52, 168, 83, 0.15);
      color: #34a853;
    }

    .mist-integration-doc-status.error {
      background: rgba(234, 67, 53, 0.15);
      color: #ea4335;
    }

    /* ══════════════════════════════════════════════════════════════════════
       BARRE D'INPUT
       ══════════════════════════════════════════════════════════════════════ */
    .mist-input-area {
      padding: 12px 16px 16px !important;
      background: linear-gradient(180deg, transparent 0%, var(--mist-bg-deep) 30%) !important;
      border-top: 1px solid var(--mist-border) !important;
      flex-shrink: 0 !important;
      margin: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }

    .mist-chips {
      display: flex !important;
      gap: 6px !important;
      margin: 0 0 10px 0 !important;
      padding: 0 !important;
      flex-wrap: nowrap !important;
      overflow-x: auto !important;
      list-style: none !important;
      width: 100% !important;
    }

    .mist-chip {
      all: unset !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 6px 12px !important;
      margin: 0 !important;
      border-radius: var(--mist-radius-pill) !important;
      border: 1px solid var(--mist-border) !important;
      background: var(--mist-bg-elevated) !important;
      color: var(--mist-text-muted) !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif !important;
      cursor: pointer !important;
      transition: all var(--mist-transition) !important;
      white-space: nowrap !important;
      box-sizing: border-box !important;
      text-decoration: none !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      line-height: 1.4 !important;
      height: auto !important;
      min-height: 28px !important;
    }

    .mist-chip:hover {
      background: var(--mist-bg-input) !important;
      border-color: var(--mist-border-focus) !important;
      color: var(--mist-text) !important;
    }

    .mist-chip.selection {
      border-color: var(--mist-yellow) !important;
      color: var(--mist-yellow) !important;
      background: rgba(255, 191, 0, 0.1) !important;
      display: none !important;
      flex-shrink: 0 !important;
    }

    .mist-chip.selection.visible {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
    }

    .mist-chatbar {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 10px 12px !important;
      margin: 0 !important;
      border-radius: var(--mist-radius-xl) !important;
      border: 1px solid var(--mist-border) !important;
      background: var(--mist-bg-input) !important;
      transition: all var(--mist-transition) !important;
      box-shadow: 0 0 15px rgba(255, 140, 0, 0.15), 0 0 30px rgba(255, 100, 0, 0.1) !important;
      box-sizing: border-box !important;
      width: 100% !important;
    }

    .mist-chatbar:focus-within {
      border-color: var(--mist-border-focus) !important;
      box-shadow: 0 0 0 4px rgba(255, 107, 53, 0.08) !important;
    }

    .mist-chatbar-logo {
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      border-radius: var(--mist-radius-sm) !important;
      background: var(--mist-bg-elevated) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-chatbar-logo img {
      width: 28px !important;
      height: 28px !important;
      image-rendering: pixelated !important;
      object-fit: contain !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    .mist-chatbar-input {
      all: unset !important;
      flex: 1 !important;
      border: none !important;
      background: transparent !important;
      color: var(--mist-text) !important;
      font-size: 14px !important;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif !important;
      outline: none !important;
      min-width: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      line-height: 1.4 !important;
      box-sizing: border-box !important;
    }

    .mist-chatbar-input::placeholder {
      color: var(--mist-text-dim) !important;
    }

    .mist-chatbar-send {
      all: unset !important;
      width: 36px !important;
      height: 36px !important;
      min-width: 36px !important;
      min-height: 36px !important;
      border-radius: var(--mist-radius-md) !important;
      border: none !important;
      background: var(--mist-accent-gradient-soft) !important;
      color: var(--mist-bg-deep) !important;
      font-size: 16px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all var(--mist-transition) !important;
      box-shadow: var(--mist-shadow-glow) !important;
      flex-shrink: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
    }

    .mist-chatbar-send:hover {
      transform: scale(1.05) !important;
      box-shadow: var(--mist-shadow-glow-yellow) !important;
    }

    .mist-chatbar-send:active {
      transform: scale(0.98) !important;
    }

    .mist-chatbar-send:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
      transform: none !important;
    }

    /* ══════════════════════════════════════════════════════════════════════
       ERROR BANNER
       ══════════════════════════════════════════════════════════════════════ */
    .mist-error-banner {
      padding: 10px 16px;
      background: rgba(239, 68, 68, 0.1);
      border-bottom: 1px solid rgba(239, 68, 68, 0.2);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--mist-error);
      cursor: pointer;
      transition: all var(--mist-transition);
      display: none;
    }

    .mist-error-banner.show {
      display: flex;
    }

    .mist-error-banner:hover {
      background: rgba(239, 68, 68, 0.15);
    }

    .mist-error-banner-icon {
      font-size: 14px;
    }

    .mist-error-banner-text {
      flex: 1;
    }

    /* ══════════════════════════════════════════════════════════════════════
       UTILITAIRES
       ══════════════════════════════════════════════════════════════════════ */
    .mist-hidden {
      display: none !important;
    }

    .mist-loading {
      pointer-events: none;
      opacity: 0.7;
    }

    /* ══════════════════════════════════════════════════════════════════════
       AGENT DE PAGE - TOOLTIPS
       ══════════════════════════════════════════════════════════════════════ */
    .mist-agent-tooltip {
      position: absolute;
      z-index: 2147483647;
      max-width: 300px;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: auto;
    }

    .mist-agent-tooltip.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .mist-agent-tooltip-content {
      background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
      border: 1px solid rgba(255, 165, 27, 0.4);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 165, 27, 0.15);
      font-family: 'Inter', -apple-system, sans-serif;
    }

    .mist-agent-tooltip-icon {
      font-size: 18px;
      flex-shrink: 0;
    }

    .mist-agent-tooltip-text {
      font-size: 13px;
      line-height: 1.5;
      color: #f5f5f5;
      flex: 1;
    }

    .mist-agent-tooltip-close {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      color: #9a9a9a;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      flex-shrink: 0;
      transition: all 0.2s ease;
    }

    .mist-agent-tooltip-close:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }

    .mist-agent-tooltip-arrow {
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 12px;
      height: 12px;
      background: #1a1a1a;
      border: 1px solid rgba(255, 165, 27, 0.4);
      border-top: none;
      border-left: none;
      transform: translateX(-50%) rotate(45deg);
    }

    .mist-agent-tooltip.mist-agent-tooltip-bottom .mist-agent-tooltip-arrow {
      top: -6px;
      bottom: auto;
      border: 1px solid rgba(255, 165, 27, 0.4);
      border-bottom: none;
      border-right: none;
      transform: translateX(-50%) rotate(45deg);
    }
  `;

  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION DU DOCK
// ─────────────────────────────────────────────────────────────────────────────

function buildDock() {
  if (document.querySelector(".mist-dock")) return;

  const pageMeta = getPageMeta();

  const dock = document.createElement("aside");
  dock.className = "mist-dock";
  dock.setAttribute("role", "complementary");
  dock.setAttribute("aria-label", "Assistant Fusion");

  // Logos
  const logoUrl = chrome.runtime.getURL("images/fusionai.png");
  const mistralLogoUrl = chrome.runtime.getURL("images/mistral.png");
  const agentLogoUrl = chrome.runtime.getURL("images/icon_agent.png");

  dock.innerHTML = `
    <!-- HEADER -->
    <header class="mist-header">
      <div class="mist-header-left">
        <div class="mist-logo"><img src="${logoUrl}" alt="Mistral"></div>
        <div class="mist-brand">
          <span class="mist-brand-name">Fusion Assistant</span>
          <span class="mist-brand-sub">Browse with AI</span>
        </div>
      </div>
      <div class="mist-header-right">
        <div class="mist-status-badge" id="mist-status-badge" title="Statut API">
          <span class="mist-status-dot"></span>
        </div>
        <button class="mist-icon-btn mist-lang-btn" id="mist-lang-btn" title="Changer la langue">🇫🇷</button>
        <button class="mist-icon-btn" id="mist-settings-btn" title="Paramètres">⚙️</button>
        <button class="mist-icon-btn" id="mist-close-btn" title="Fermer">✕</button>
          </div>
    </header>

    <!-- ERROR BANNER -->
    <div class="mist-error-banner" id="mist-error-banner">
      <span class="mist-error-banner-icon">⚠️</span>
      <span class="mist-error-banner-text" id="mist-error-text"></span>
        </div>

    <!-- SETTINGS OVERLAY -->
    <div class="mist-settings-overlay" id="mist-settings-overlay">
      <div class="mist-settings-panel">
        <div class="mist-settings-header">
          <span class="mist-settings-title">Configuration Mistral</span>
          <button class="mist-settings-close" id="mist-settings-close">✕</button>
        </div>
        
        <div class="mist-field">
          <label class="mist-field-label" data-i18n="settings.language">🌍 Langue de l'extension</label>
          <div class="mist-field-row">
            <select class="mist-input mist-input-select" id="mist-language-select">
              <option value="fr">🇫🇷 Français</option>
              <option value="en">🇬🇧 English</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="es">🇪🇸 Español</option>
            </select>
            <button class="mist-btn mist-btn-primary" id="mist-save-lang" data-i18n="settings.save">Enregistrer</button>
          </div>
        </div>

        <div class="mist-field">
          <label class="mist-field-label" data-i18n="settings.model">🤖 Modèle IA</label>
          <div class="mist-field-row">
            <select class="mist-input mist-input-select" id="mist-model-select">
              <option value="mistral-large-latest" id="mist-model-large">Mistral Large (Recommandé)</option>
              <option value="mistral-medium-latest">Mistral Medium</option>
              <option value="mistral-small-latest">Mistral Small (Rapide)</option>
              <option value="open-mistral-nemo">Mistral Nemo (Open)</option>
              <option value="codestral-latest">Codestral (Code)</option>
            </select>
            <button class="mist-btn mist-btn-primary" id="mist-save-model" data-i18n="settings.save">Enregistrer</button>
          </div>
        </div>

        <div class="mist-settings-divider"></div>

        <div class="mist-field">
          <label class="mist-field-label" data-i18n="settings.apiKey">🔑 Clé API Mistral</label>
          <div class="mist-field-row">
            <input type="password" class="mist-input" id="mist-api-input" placeholder="sk-..." autocomplete="off">
            <button class="mist-btn" id="mist-toggle-key">👁️</button>
          </div>
        </div>

        <div class="mist-settings-actions">
          <button class="mist-btn mist-btn-primary" id="mist-save-key">Enregistrer</button>
          <button class="mist-btn" id="mist-test-key">Tester</button>
          <button class="mist-btn mist-btn-danger" id="mist-delete-key">Supprimer</button>
        </div>

        <!-- Section Agents -->
        <div class="mist-settings-agents">
          <label class="mist-field-label" data-i18n="settings.agents">🤖 Mes Agents</label>
          
          <!-- Liste des agents + bouton ajouter -->
          <div class="mist-settings-agents-list" id="mist-settings-agents-list">
            <!-- Agents ajoutés dynamiquement -->
          </div>

          <!-- Formulaire d'ajout (caché par défaut) -->
          <div class="mist-settings-agent-form mist-hidden" id="mist-settings-agent-form">
            <input type="text" class="mist-input" id="mist-settings-agent-name" placeholder="Nom de l'agent">
            <input type="text" class="mist-input" id="mist-settings-agent-id" placeholder="ID (ag:xxxxxxxx...)">
            <div class="mist-settings-agent-form-actions">
              <button class="mist-btn mist-btn-primary" id="mist-settings-agent-save">Enregistrer</button>
              <button class="mist-btn" id="mist-settings-agent-cancel">Annuler</button>
            </div>
          </div>
          
          <div class="mist-settings-message" id="mist-settings-msg"></div>
        </div>

        <div class="mist-settings-help">
          <a href="https://console.mistral.ai/api-keys/" target="_blank" class="mist-settings-help-link">
            🔑 Où trouver ma clé API ?
          </a>
          <span class="mist-settings-help-separator">•</span>
          <a href="https://console.mistral.ai/build/agents" target="_blank" class="mist-settings-help-link">
            🤖 Créer un agent
          </a>
          <span class="mist-settings-help-separator">•</span>
          <button class="mist-update-btn" id="mist-check-update" title="Vérifier les mises à jour">
            <span class="mist-update-icon mist-update-checking">🔄</span>
          </button>
        </div>
      </div>
    </div>


    <!-- ONBOARDING (affiché si pas de clé) -->
    <div class="mist-onboarding" id="mist-onboarding">
      <div class="mist-onboarding-icon"><img src="${logoUrl}" alt="Mistral"></div>
      <h2 class="mist-onboarding-title">Configure ton assistant</h2>
      <p class="mist-onboarding-desc">
        Pour utiliser l'assistant, ajoute ta clé API Mistral. Elle est stockée uniquement sur ton navigateur.
      </p>
      <div class="mist-onboarding-form">
        <input type="password" class="mist-onboarding-input" id="mist-onboarding-key" placeholder="Colle ta clé API ici..." autocomplete="off">
        <button class="mist-onboarding-btn" id="mist-onboarding-save">
          Enregistrer et tester
        </button>
        <div class="mist-onboarding-status" id="mist-onboarding-status"></div>
        <p class="mist-onboarding-help">
          <a href="https://console.mistral.ai/api-keys/" target="_blank" id="mist-onboarding-find-key">Où trouver ma clé ?</a>
        </p>
      </div>
    </div>

    <!-- MAIN CONTENT (affiché si clé configurée) -->
    <div class="mist-main mist-hidden" id="mist-main">
      <!-- ONGLETS -->
      <nav class="mist-tabs">
        <button class="mist-tab active" data-tab="chat">💬 Chat</button>
        <button class="mist-tab" data-tab="actions">⚡ Actions</button>
        <button class="mist-tab" data-tab="agents">🤖 Agents</button>
        <button class="mist-tab" data-tab="integration">🔗 Intégration</button>
      </nav>

      <!-- CONTEXTE PAGE -->
      <div class="mist-context">
        <img class="mist-context-favicon" src="${pageMeta.favicon}" alt="" onerror="this.style.display='none'">
        <div class="mist-context-info">
          <div class="mist-context-title" id="mist-page-title">${escapeHtml(pageMeta.title)}</div>
          <div class="mist-context-url" id="mist-page-url">${pageMeta.url}</div>
        </div>
        <button class="mist-context-refresh" id="mist-refresh-context" title="Actualiser le contenu">🔄</button>
      </div>

      <!-- TAB: CHAT -->
      <div class="mist-chat" id="mist-chat-tab">
        <div class="mist-chat-empty" id="mist-chat-empty">
          <div class="mist-chat-empty-icon">💬</div>
          <p class="mist-chat-empty-text">Pose une question sur cette page ou utilise les actions rapides ci-dessous.</p>
        </div>
      </div>

      <!-- TAB: ACTIONS -->
      <div class="mist-actions-grid mist-hidden" id="mist-actions-tab">
        
        <!-- ═══ SECTION: ANALYSE ═══ -->
        <div class="mist-action-section">
          <div class="mist-action-section-title" id="mist-section-analysis"></div>
          
          <div class="mist-action-card" data-action="summary">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📝</div>
              <span class="mist-action-card-title" id="mist-action-summary-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-summary-desc"></p>
          </div>

          <div class="mist-action-card" data-action="critique">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🔍</div>
              <span class="mist-action-card-title" id="mist-action-critique-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-critique-desc"></p>
          </div>

          <div class="mist-action-card" data-action="highlightKeyIdeas">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🖍️</div>
              <span class="mist-action-card-title" id="mist-action-highlight-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-highlight-desc"></p>
          </div>

          <div class="mist-action-card" data-action="extractData">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📦</div>
              <span class="mist-action-card-title" id="mist-action-extract-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-extract-desc"></p>
          </div>

          <div class="mist-action-card" data-action="comparePages">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">⚖️</div>
              <span class="mist-action-card-title" id="mist-action-compare-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-compare-desc"></p>
          </div>
        </div>

        <!-- ═══ SECTION: RÉÉCRITURE ═══ -->
        <div class="mist-action-section">
          <div class="mist-action-section-title" id="mist-section-rewrite"></div>
          
          <div class="mist-action-card" data-action="simplify">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🎒</div>
              <span class="mist-action-card-title" id="mist-action-simplify-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-simplify-desc"></p>
          </div>

          <div class="mist-action-card" data-action="rewriteScientific">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🔬</div>
              <span class="mist-action-card-title" id="mist-action-scientific-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-scientific-desc"></p>
          </div>

          <div class="mist-action-card" data-action="rewriteJournalistic">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📰</div>
              <span class="mist-action-card-title" id="mist-action-journalistic-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-journalistic-desc"></p>
          </div>

          <div class="mist-action-card" data-action="rewriteMarketing">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🎯</div>
              <span class="mist-action-card-title" id="mist-action-marketing-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-marketing-desc"></p>
          </div>

          <div class="mist-action-card" data-action="rewriteUXCopy">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">💻</div>
              <span class="mist-action-card-title" id="mist-action-uxcopy-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-uxcopy-desc"></p>
          </div>

          <div class="mist-action-card" data-action="rewriteTwitterThread">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🐦</div>
              <span class="mist-action-card-title" id="mist-action-twitter-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-twitter-desc"></p>
          </div>

          <div class="mist-action-card" data-action="rewriteLinkedIn">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">💼</div>
              <span class="mist-action-card-title" id="mist-action-linkedin-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-linkedin-desc"></p>
          </div>
        </div>

        <!-- ═══ SECTION: GÉNÉRATION ═══ -->
        <div class="mist-action-section">
          <div class="mist-action-section-title" id="mist-section-generate"></div>
          
          <div class="mist-action-card" data-action="generateArticlePlan">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📝</div>
              <span class="mist-action-card-title" id="mist-action-articleplan-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-articleplan-desc"></p>
          </div>

          <div class="mist-action-card" data-action="generateYouTubePlan">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🎬</div>
              <span class="mist-action-card-title" id="mist-action-youtubeplan-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-youtubeplan-desc"></p>
          </div>

          <div class="mist-action-card" data-action="generateEmailSequence">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📧</div>
              <span class="mist-action-card-title" id="mist-action-emailseq-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-emailseq-desc"></p>
          </div>

          <div class="mist-action-card" data-action="generateTutorial">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📚</div>
              <span class="mist-action-card-title" id="mist-action-tutorial-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-tutorial-desc"></p>
          </div>

          <div class="mist-action-card" data-action="generateContactEmail">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">✉️</div>
              <span class="mist-action-card-title" id="mist-action-contactemail-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-contactemail-desc"></p>
          </div>

          <div class="mist-action-card" data-action="translate">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🌍</div>
              <span class="mist-action-card-title" id="mist-action-translate-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-translate-desc"></p>
          </div>
        </div>

        <!-- ═══ SECTION: YOUTUBE ═══ -->
        <div class="mist-action-section">
          <div class="mist-action-section-title" id="mist-section-youtube"></div>
          
          <div class="mist-action-card" data-action="summarizeYouTube">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📺</div>
              <span class="mist-action-card-title" id="mist-action-ytsum-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-ytsum-desc"></p>
          </div>

          <div class="mist-action-card" data-action="youtubeKeyPoints">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📌</div>
              <span class="mist-action-card-title" id="mist-action-ytkey-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-ytkey-desc"></p>
          </div>

          <div class="mist-action-card" data-action="youtubeTranscript">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">📝</div>
              <span class="mist-action-card-title" id="mist-action-yttrans-title"></span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-yttrans-desc"></p>
          </div>
        </div>

        <!-- ═══ SECTION: AGENT IA ═══ -->
        <div class="mist-action-section">
          <div class="mist-action-section-title" id="mist-section-agent"></div>
          
          <div class="mist-action-card mist-action-card-disabled" data-action="pageAgent" data-disabled="true">
            <div class="mist-action-card-header">
              <div class="mist-action-card-icon">🤖</div>
              <span class="mist-action-card-title" id="mist-action-pageagent-title"></span>
              <span class="mist-badge-coming-soon">Coming Soon</span>
            </div>
            <p class="mist-action-card-desc" id="mist-action-pageagent-desc"></p>
          </div>
        </div>
        
      </div>

      <!-- TAB: AGENTS -->
      <div class="mist-agents-tab mist-hidden" id="mist-agents-tab">
        
        <!-- Sélecteur d'agent en haut -->
        <div class="mist-agent-header">
          <select class="mist-select mist-agent-select-inline" id="mist-agent-select">
            <option value="" id="mist-agent-default-option">Sélectionner un agent...</option>
          </select>
          <button class="mist-icon-btn mist-agent-settings-btn" id="mist-agents-goto-settings" title="Gérer les agents">⚙️</button>
        </div>

        <!-- Zone de chat agent -->
        <div class="mist-agent-chat" id="mist-agent-chat">
          <!-- État vide quand pas d'agent sélectionné -->
          <div class="mist-agent-empty" id="mist-agent-empty">
            <div class="mist-agent-empty-icon">🤖</div>
            <h3>Discutez avec un Agent</h3>
            <p>Sélectionnez un agent ci-dessus pour démarrer une conversation dédiée.</p>
            <button class="mist-btn mist-btn-primary" id="mist-agent-add-first">
              ➕ Ajouter un agent
            </button>
          </div>

          <!-- Messages de l'agent -->
          <div class="mist-agent-messages mist-hidden" id="mist-agent-messages">
            <!-- Messages ajoutés dynamiquement -->
          </div>
        </div>

        <!-- Barre d'input agent -->
        <div class="mist-agent-input-area mist-hidden" id="mist-agent-input-area">
          <div class="mist-agent-input-row">
            <textarea class="mist-input mist-agent-input" id="mist-agent-input" placeholder="Posez une question à l'agent..." rows="1"></textarea>
            <button class="mist-btn mist-btn-primary mist-agent-send" id="mist-agent-send">
              <span>➤</span>
            </button>
          </div>
        </div>

      </div>

      <!-- TAB: INTEGRATION -->
      <div class="mist-integration-tab mist-hidden" id="mist-integration-tab">
        
        <!-- Carte déroulante - Documents -->
        <div class="mist-integration-panel">
          <div class="mist-integration-panel-header" id="mist-integration-toggle">
            <div class="mist-integration-panel-left">
              <div class="mist-integration-header-icon">🔗</div>
              <div class="mist-integration-header-text">
                <h3 id="mist-integration-title">Intégrations Documents</h3>
                <p id="mist-integration-desc">Connectez vos Google Docs, Slides et Sheets</p>
              </div>
            </div>
            <span class="mist-integration-toggle-icon" id="mist-integration-toggle-icon">▼</span>
          </div>
          
          <div class="mist-integration-panel-content" id="mist-integration-panel-content">
            <!-- Bouton pour utiliser la page courante si c'est un Google Doc -->
            <button class="mist-btn mist-btn-full mist-hidden" id="mist-integration-use-current">
              📄 Utiliser la page actuelle
            </button>
            
            <!-- Formulaire d'ajout de document -->
            <div class="mist-integration-add">
              <div class="mist-integration-input-row">
                <input type="text" class="mist-input mist-integration-url" id="mist-integration-url" placeholder="Collez un lien Google Docs/Slides/Sheets...">
                <button class="mist-btn mist-btn-primary mist-integration-add-btn" id="mist-integration-add-btn" title="Ajouter">➕</button>
              </div>
              <div class="mist-integration-hint">
                <span>📄 Docs</span>
                <span>📊 Sheets</span>
                <span>📽️ Slides</span>
                <span>📁 Drive</span>
              </div>
            </div>

            <!-- Liste des documents connectés -->
            <div class="mist-integration-docs" id="mist-integration-docs">
              <div class="mist-integration-empty" id="mist-integration-empty">
                <div class="mist-integration-empty-icon">📂</div>
                <p id="mist-integration-empty-text">Aucun document connecté</p>
                <span id="mist-integration-empty-hint">Ajoutez un lien pour commencer</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Conteneur chat + input (flex pour input en bas) -->
        <div class="mist-integration-chat-wrapper mist-hidden" id="mist-integration-chat-wrapper">
          <!-- Zone de chat intégration -->
          <div class="mist-integration-chat" id="mist-integration-chat">
            <div class="mist-integration-messages" id="mist-integration-messages">
              <!-- Messages ajoutés dynamiquement -->
            </div>
          </div>

          <!-- Barre d'input intégration - toujours en bas -->
          <div class="mist-integration-input-area" id="mist-integration-input-area">
            <div class="mist-integration-actions">
              <button class="mist-chip" data-integ-action="analyze">📊 Analyser</button>
              <button class="mist-chip" data-integ-action="summarize">📝 Résumer</button>
              <button class="mist-chip" data-integ-action="suggest">💡 Suggestions</button>
            </div>
            <div class="mist-chatbar">
              <div class="mist-chatbar-logo"><img src="${logoUrl}" alt="Fusion"></div>
              <input type="text" class="mist-chatbar-input mist-integration-input" id="mist-integration-input" placeholder="Demandez une modification ou analyse...">
              <button class="mist-chatbar-send mist-integration-send" id="mist-integration-send" title="Envoyer">➤</button>
            </div>
          </div>
        </div>

      </div>

      <!-- BARRE D'INPUT PRINCIPALE (Chat/Actions) -->
      <div class="mist-input-area" id="mist-main-input-area">
        <div class="mist-chips">
          <button class="mist-chip" data-quick="summary">📝 Résumé</button>
          <button class="mist-chip" data-quick="simplify">🎓 Vulgariser</button>
          <button class="mist-chip" data-quick="critique">🔍 Analyse</button>
          <button class="mist-chip selection" id="mist-selection-chip">
            ✂️ Utiliser la sélection
          </button>
        </div>
        <div class="mist-chatbar">
          <div class="mist-chatbar-logo"><img src="${logoUrl}" alt="Mistral"></div>
          <input type="text" class="mist-chatbar-input" id="mist-user-input" placeholder="Pose une question sur cette page...">
          <button class="mist-chatbar-send" id="mist-send-btn" title="Envoyer">➤</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dock);
  initDockEvents(dock);
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTION DES ÉVÉNEMENTS
// ─────────────────────────────────────────────────────────────────────────────

function initDockEvents(dock) {
  // Éléments
  const closeBtn = dock.querySelector("#mist-close-btn");
  const settingsBtn = dock.querySelector("#mist-settings-btn");
  const langBtn = dock.querySelector("#mist-lang-btn");
  const settingsOverlay = dock.querySelector("#mist-settings-overlay");
  const settingsClose = dock.querySelector("#mist-settings-close");
  const apiInput = dock.querySelector("#mist-api-input");
  const toggleKeyBtn = dock.querySelector("#mist-toggle-key");
  const saveKeyBtn = dock.querySelector("#mist-save-key");
  const testKeyBtn = dock.querySelector("#mist-test-key");
  const deleteKeyBtn = dock.querySelector("#mist-delete-key");
  const settingsMsg = dock.querySelector("#mist-settings-msg");
  const statusBadge = dock.querySelector("#mist-status-badge");
  const errorBanner = dock.querySelector("#mist-error-banner");
  const errorText = dock.querySelector("#mist-error-text");

  const onboarding = dock.querySelector("#mist-onboarding");
  const mainContent = dock.querySelector("#mist-main");
  const onboardingKey = dock.querySelector("#mist-onboarding-key");
  const onboardingSave = dock.querySelector("#mist-onboarding-save");
  const onboardingStatus = dock.querySelector("#mist-onboarding-status");

  const tabs = dock.querySelectorAll(".mist-tab");
  const chatTab = dock.querySelector("#mist-chat-tab");
  const actionsTab = dock.querySelector("#mist-actions-tab");
  const agentsTab = dock.querySelector("#mist-agents-tab");
  const integrationTab = dock.querySelector("#mist-integration-tab");
  const chatEmpty = dock.querySelector("#mist-chat-empty");
  const mainInputArea = dock.querySelector("#mist-main-input-area");

  const chips = dock.querySelectorAll(".mist-chip[data-quick]");
  const selectionChip = dock.querySelector("#mist-selection-chip");
  const actionCards = dock.querySelectorAll(".mist-action-card");
  const userInput = dock.querySelector("#mist-user-input");
  const sendBtn = dock.querySelector("#mist-send-btn");
  const refreshContext = dock.querySelector("#mist-refresh-context");

  // Agents - dans l'onglet
  const agentSelect = dock.querySelector("#mist-agent-select");
  const agentsGotoSettings = dock.querySelector("#mist-agents-goto-settings");
  const agentEmpty = dock.querySelector("#mist-agent-empty");
  const agentMessages = dock.querySelector("#mist-agent-messages");
  const agentInputArea = dock.querySelector("#mist-agent-input-area");
  const agentInput = dock.querySelector("#mist-agent-input");
  const agentSendBtn = dock.querySelector("#mist-agent-send");
  const agentAddFirst = dock.querySelector("#mist-agent-add-first");
  
  // Agents - dans les settings
  const settingsAgentsList = dock.querySelector("#mist-settings-agents-list");
  const btnAddAgent = dock.querySelector("#mist-btn-add-agent");
  const settingsAgentForm = dock.querySelector("#mist-settings-agent-form");
  const settingsAgentName = dock.querySelector("#mist-settings-agent-name");
  const settingsAgentId = dock.querySelector("#mist-settings-agent-id");
  const settingsAgentSave = dock.querySelector("#mist-settings-agent-save");
  const settingsAgentCancel = dock.querySelector("#mist-settings-agent-cancel");

  let currentSelection = "";
  let messages = [];
  let agents = [];
  let selectedAgentIndex = null; // Index de l'agent sélectionné pour le popup

  // ─── FERMER LE DOCK ───
  closeBtn.addEventListener("click", () => {
    dock.classList.add("closing");
    setTimeout(() => dock.remove(), 250);
  });

  // ─── BOUTON LANGUE ───
  const langFlagsMap = {
    fr: "🇫🇷",
    en: "🇬🇧",
    de: "🇩🇪",
    es: "🇪🇸"
  };

  // Le bouton drapeau ouvre les settings
  langBtn?.addEventListener("click", async () => {
    settingsOverlay.classList.add("open");
    loadApiKeyToInput();
    // S'assurer que les agents sont affichés
    if (agents.length === 0) {
      await loadAgents();
    } else {
      renderSettingsAgents();
    }
  });

  // Charger la langue actuelle au démarrage (défaut: fr)
  async function initLanguageDropdown() {
    let lang = await getLanguage();
    if (!lang) {
      lang = "fr";
      await saveLanguage(lang);
    }
    currentLang = lang; // Mettre à jour la langue globale
    langBtn.textContent = langFlagsMap[lang] || "🇫🇷";
    if (languageSelect) languageSelect.value = lang;
  }
  
  // Initialisation de la langue et des traductions
  initLanguageDropdown().then(() => {
    // Applique les traductions après un court délai pour que le DOM soit prêt
    setTimeout(() => applyTranslations(), 50);
  });

  // ─── SETTINGS ───
  const languageSelect = dock.querySelector("#mist-language-select");
  const saveLangBtn = dock.querySelector("#mist-save-lang");
  const modelSelect = dock.querySelector("#mist-model-select");
  const saveModelBtn = dock.querySelector("#mist-save-model");
  
  // Fonction pour appliquer les traductions à l'interface
  function applyTranslations() {
    // Tabs
    const tabChat = dock.querySelector('[data-tab="chat"]');
    const tabActions = dock.querySelector('[data-tab="actions"]');
    const tabAgents = dock.querySelector('[data-tab="agents"]');
    const tabIntegration = dock.querySelector('[data-tab="integration"]');
    if (tabChat) tabChat.textContent = t("tabs.chat");
    if (tabActions) tabActions.textContent = t("tabs.actions");
    if (tabAgents) tabAgents.textContent = t("tabs.agents");
    if (tabIntegration) tabIntegration.textContent = t("tabs.integration");
    
    // Settings title
    const settingsTitle = dock.querySelector(".mist-settings-title");
    if (settingsTitle) settingsTitle.textContent = t("settings.title");
    
    // Settings labels
    const langLabel = dock.querySelector('[data-i18n="settings.language"]');
    if (langLabel) langLabel.textContent = t("settings.language");
    
    const apiLabel = dock.querySelector('[data-i18n="settings.apiKey"]');
    if (apiLabel) apiLabel.textContent = t("settings.apiKey");
    
    const agentsLabel = dock.querySelector('[data-i18n="settings.agents"]');
    if (agentsLabel) agentsLabel.textContent = t("settings.agents");
    
    // Settings buttons
    if (saveLangBtn) saveLangBtn.textContent = t("settings.save");
    if (saveModelBtn) saveModelBtn.textContent = t("settings.save");
    const saveKeyBtn = dock.querySelector("#mist-save-key");
    if (saveKeyBtn) saveKeyBtn.textContent = t("settings.save");
    const testKeyBtn = dock.querySelector("#mist-test-key");
    if (testKeyBtn) testKeyBtn.textContent = t("settings.test");
    const deleteKeyBtn = dock.querySelector("#mist-delete-key");
    if (deleteKeyBtn) deleteKeyBtn.textContent = t("settings.delete");
    
    // Add agent button
    const addAgentBtn = dock.querySelector("#mist-btn-add-agent");
    if (addAgentBtn) addAgentBtn.textContent = t("settings.addAgent");
    
    // Agent form
    const agentNameInput = dock.querySelector("#mist-settings-agent-name");
    if (agentNameInput) agentNameInput.placeholder = t("settings.agentName");
    const agentIdInput = dock.querySelector("#mist-settings-agent-id");
    if (agentIdInput) agentIdInput.placeholder = t("settings.agentId");
    const agentSaveBtn = dock.querySelector("#mist-settings-agent-save");
    if (agentSaveBtn) agentSaveBtn.textContent = t("settings.save");
    const agentCancelBtn = dock.querySelector("#mist-settings-agent-cancel");
    if (agentCancelBtn) agentCancelBtn.textContent = t("settings.cancel");
    
    // Help links
    const findKeyLink = dock.querySelector('a[href*="api-keys"]');
    if (findKeyLink) findKeyLink.textContent = t("settings.findKey");
    const createAgentLink = dock.querySelector('a[href*="build/agents"]');
    if (createAgentLink) createAgentLink.textContent = t("settings.createAgent");
    
    // Onboarding
    const onboardingTitle = dock.querySelector(".mist-onboarding-title");
    if (onboardingTitle) onboardingTitle.textContent = t("onboarding.title");
    const onboardingDesc = dock.querySelector(".mist-onboarding-desc");
    if (onboardingDesc) onboardingDesc.textContent = t("onboarding.desc");
    const onboardingInput = dock.querySelector("#mist-onboarding-key");
    if (onboardingInput) onboardingInput.placeholder = t("onboarding.placeholder");
    const onboardingBtn = dock.querySelector("#mist-onboarding-save");
    if (onboardingBtn) onboardingBtn.textContent = t("onboarding.save");
    
    // Chat empty state
    const chatEmptyTitle = dock.querySelector("#mist-chat-empty h3");
    if (chatEmptyTitle) chatEmptyTitle.textContent = t("chat.empty.title");
    const chatEmptyDesc = dock.querySelector("#mist-chat-empty p");
    if (chatEmptyDesc) chatEmptyDesc.textContent = t("chat.empty.desc");
    
    // Chat input
    const userInput = dock.querySelector("#mist-user-input");
    if (userInput) userInput.placeholder = t("chat.placeholder");
    
    // Quick chips
    const chipSummary = dock.querySelector('[data-quick="summary"]');
    if (chipSummary) chipSummary.textContent = t("quick.summary");
    const chipSimplify = dock.querySelector('[data-quick="simplify"]');
    if (chipSimplify) chipSimplify.textContent = t("quick.simplify");
    const chipAnalyze = dock.querySelector('[data-quick="critique"]');
    if (chipAnalyze) chipAnalyze.textContent = t("quick.analyze");
    const chipSelection = dock.querySelector("#mist-selection-chip");
    if (chipSelection) chipSelection.textContent = t("quick.selection");
    
    // Action sections titles
    const sectionAnalysis = dock.querySelector("#mist-section-analysis");
    const sectionRewrite = dock.querySelector("#mist-section-rewrite");
    const sectionGenerate = dock.querySelector("#mist-section-generate");
    if (sectionAnalysis) sectionAnalysis.textContent = t("action.section.analysis");
    if (sectionRewrite) sectionRewrite.textContent = t("action.section.rewrite");
    if (sectionGenerate) sectionGenerate.textContent = t("action.section.generate");
    
    // Action cards - using IDs for direct translation
    const actionTranslations = [
      // Analysis section
      { id: "mist-action-summary", key: "summary" },
      { id: "mist-action-critique", key: "critique" },
      { id: "mist-action-highlight", key: "highlight" },
      { id: "mist-action-extract", key: "extract" },
      { id: "mist-action-compare", key: "compare" },
      // Rewrite section
      { id: "mist-action-simplify", key: "simplify" },
      { id: "mist-action-scientific", key: "scientific" },
      { id: "mist-action-journalistic", key: "journalistic" },
      { id: "mist-action-marketing", key: "marketing" },
      { id: "mist-action-uxcopy", key: "uxcopy" },
      { id: "mist-action-twitter", key: "twitter" },
      { id: "mist-action-linkedin", key: "linkedin" },
      // Generate section
      { id: "mist-action-articleplan", key: "articleplan" },
      { id: "mist-action-youtubeplan", key: "youtubeplan" },
      { id: "mist-action-emailseq", key: "emailseq" },
      { id: "mist-action-tutorial", key: "tutorial" },
      { id: "mist-action-contactemail", key: "contactemail" },
      { id: "mist-action-translate", key: "translate" },
      // YouTube section
      { id: "mist-action-ytsum", key: "ytsum" },
      { id: "mist-action-ytkey", key: "ytkey" },
      { id: "mist-action-yttrans", key: "yttrans" },
      // Agent section
      { id: "mist-action-pageagent", key: "pageagent" }
    ];
    
    actionTranslations.forEach(({ id, key }) => {
      const titleEl = dock.querySelector(`#${id}-title`);
      const descEl = dock.querySelector(`#${id}-desc`);
      if (titleEl) titleEl.textContent = t(`action.${key}.title`);
      if (descEl) descEl.textContent = t(`action.${key}.desc`);
    });
    
    // Section titles for YouTube and Agent
    const sectionYoutube = dock.querySelector("#mist-section-youtube");
    const sectionAgent = dock.querySelector("#mist-section-agent");
    if (sectionYoutube) sectionYoutube.textContent = t("action.section.youtube");
    if (sectionAgent) sectionAgent.textContent = t("action.section.agent");
    
    // AI badge
    const aiBadge = dock.querySelector(".mist-action-badge");
    if (aiBadge) aiBadge.textContent = t("action.badge.ai");
    
    // Agents tab
    const agentSelectDefault = dock.querySelector("#mist-agent-select option[value='']");
    if (agentSelectDefault) agentSelectDefault.textContent = t("agents.noAgent");
    const agentsManageBtn = dock.querySelector("#mist-agents-goto-settings");
    if (agentsManageBtn) agentsManageBtn.textContent = t("agents.manage");
    const agentsEmptyTitle = dock.querySelector("#mist-agent-empty h3");
    if (agentsEmptyTitle) agentsEmptyTitle.textContent = t("agents.empty.title");
    const agentsEmptyDesc = dock.querySelector("#mist-agent-empty p");
    if (agentsEmptyDesc) agentsEmptyDesc.textContent = t("agents.empty.desc");
    const agentsAddFirst = dock.querySelector("#mist-agent-add-first");
    if (agentsAddFirst) agentsAddFirst.textContent = t("agents.addFirst");
    const agentInput = dock.querySelector("#mist-agent-input");
    if (agentInput) agentInput.placeholder = t("agents.placeholder");
    
    // Integration tab
    const integrationTitle = dock.querySelector("#mist-integration-title");
    const integrationDesc = dock.querySelector("#mist-integration-desc");
    const integrationUrl = dock.querySelector("#mist-integration-url");
    const integrationEmptyText = dock.querySelector("#mist-integration-empty-text");
    const integrationEmptyHint = dock.querySelector("#mist-integration-empty-hint");
    const integrationInput = dock.querySelector("#mist-integration-input");
    if (integrationTitle) integrationTitle.textContent = t("integration.title");
    if (integrationDesc) integrationDesc.textContent = t("integration.desc");
    if (integrationUrl) integrationUrl.placeholder = t("integration.placeholder");
    if (integrationEmptyText) integrationEmptyText.textContent = t("integration.empty");
    if (integrationEmptyHint) integrationEmptyHint.textContent = t("integration.emptyHint");
    if (integrationInput) integrationInput.placeholder = t("integration.inputPlaceholder");

    // Integration quick actions
    const integAnalyzeBtn = dock.querySelector('[data-integ-action="analyze"]');
    const integSummarizeBtn = dock.querySelector('[data-integ-action="summarize"]');
    const integSuggestBtn = dock.querySelector('[data-integ-action="suggest"]');
    if (integAnalyzeBtn) integAnalyzeBtn.textContent = t("integration.analyze");
    if (integSummarizeBtn) integSummarizeBtn.textContent = t("integration.summarize");
    if (integSuggestBtn) integSuggestBtn.textContent = t("integration.suggest");
    
    // UI button titles
    const langBtn = dock.querySelector("#mist-lang-btn");
    if (langBtn) langBtn.title = t("ui.changeLanguage");
    const settingsBtn = dock.querySelector("#mist-settings-btn");
    if (settingsBtn) settingsBtn.title = t("ui.settings");
    const updateBtn = dock.querySelector("#mist-check-update");
    if (updateBtn) updateBtn.title = t("ui.checkUpdates");
    const refreshContextBtn = dock.querySelector("#mist-refresh-context");
    if (refreshContextBtn) refreshContextBtn.title = t("ui.refreshContent");
    if (agentsManageBtn) agentsManageBtn.title = t("ui.manageAgents");
    const closeBtn = dock.querySelector("#mist-close-btn");
    if (closeBtn) closeBtn.title = t("ui.close");
    const statusBadge = dock.querySelector("#mist-status-badge");
    if (statusBadge) statusBadge.title = t("ui.apiStatus");
    const sendBtn = dock.querySelector("#mist-send-btn");
    if (sendBtn) sendBtn.title = t("ui.send");
    const integSendBtn = dock.querySelector("#mist-integration-send");
    if (integSendBtn) integSendBtn.title = t("ui.send");
    const integAddBtn = dock.querySelector("#mist-integration-add-btn");
    if (integAddBtn) integAddBtn.title = t("ui.add");
    
    // Context
    const contextTitle = dock.querySelector(".mist-context-title");
    if (contextTitle) contextTitle.textContent = t("context.title");
    
    // Onboarding
    const onboardingFindKey = dock.querySelector("#mist-onboarding-find-key");
    if (onboardingFindKey) onboardingFindKey.textContent = t("onboarding.findKey");
    
    // Model select
    const modelLarge = dock.querySelector("#mist-model-large");
    if (modelLarge) modelLarge.textContent = `Mistral Large (${t("model.recommended")})`;
    
    // Status
    updateStatusTranslation();
  }
  
  function updateStatusTranslation() {
    // Le voyant de statut n'a plus de texte, juste un tooltip
    // qui est mis à jour automatiquement par updateStatus()
  }
  
  // Sauvegarder la langue et recharger les traductions
  saveLangBtn?.addEventListener("click", async () => {
    const lang = languageSelect.value;
    await saveLanguage(lang);
    currentLang = lang;
    
    // Mettre à jour le drapeau
    langBtn.textContent = langFlagsMap[lang];
    
    // Appliquer les traductions
    applyTranslations();
    
    showSettingsMessage("success", t("settings.langSaved"));
  });

  // Sauvegarder le modèle
  saveModelBtn?.addEventListener("click", async () => {
    const model = modelSelect.value;
    await saveModel(model);
    showSettingsMessage("success", t("settings.modelSaved"));
  });

  // Fonctions pour gérer le modèle
  async function saveModel(model) {
    return new Promise(resolve => {
      chrome.storage.local.set({ mistralModel: model }, resolve);
    });
  }

  async function getStoredModel() {
    return new Promise(resolve => {
      chrome.storage.local.get(["mistralModel"], (result) => {
        resolve(result.mistralModel || "mistral-large-latest");
      });
    });
  }

  // Charger le modèle stocké au démarrage
  async function loadStoredModel() {
    const model = await getStoredModel();
    if (modelSelect) {
      modelSelect.value = model;
    }
  }
  
  settingsBtn.addEventListener("click", async () => {
    settingsOverlay.classList.add("open");
    loadApiKeyToInput();
    // S'assurer que les agents sont affichés
    if (agents.length === 0) {
      await loadAgents();
    } else {
      renderSettingsAgents();
    }
  });

  settingsClose.addEventListener("click", () => {
    settingsOverlay.classList.remove("open");
  });

  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.remove("open");
    }
  });


  toggleKeyBtn.addEventListener("click", () => {
    apiInput.type = apiInput.type === "password" ? "text" : "password";
    toggleKeyBtn.textContent = apiInput.type === "password" ? "👁️" : "🙈";
  });

  saveKeyBtn.addEventListener("click", async () => {
    const key = apiInput.value.trim();
    if (!key) {
      showSettingsMessage("error", t("settings.enterKey"));
      return;
    }
    await saveApiKey(key);
    showSettingsMessage("success", t("settings.keySaved"));
    updateStatus("connected");
    setTimeout(() => settingsOverlay.classList.remove("open"), 800);
    showMainContent();
  });

  testKeyBtn.addEventListener("click", async () => {
    const key = apiInput.value.trim();
    if (!key) {
      showSettingsMessage("error", t("settings.noKeyToTest"));
      return;
    }
    showSettingsMessage("", t("settings.testing"));
    const result = await testApiKey(key);
    if (result.valid) {
      showSettingsMessage("success", t("settings.keyValid"));
      updateStatus("connected");
    } else {
      showSettingsMessage("error", `${t("settings.keyInvalid")} ${result.error || ""}`);
      updateStatus("error");
    }
  });

  deleteKeyBtn.addEventListener("click", async () => {
    if (confirm(t("settings.confirmDeleteKey"))) {
      await chrome.storage.local.remove("mistralApiKey");
      apiInput.value = "";
      showSettingsMessage("success", t("settings.keyDeleted"));
      updateStatus("");
      showOnboarding();
    }
  });

  // ─── UPDATE CHECK ───
  const checkUpdateBtn = dock.querySelector("#mist-check-update");
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener("click", () => {
      if (updateAvailable) {
        window.open(GITHUB_REPO_URL, "_blank");
      } else {
        checkForUpdates();
      }
    });
    // Vérifier les mises à jour au chargement
    setTimeout(() => checkForUpdates(), 2000);
  }

  // ─── ONBOARDING ───
  onboardingSave.addEventListener("click", async () => {
    const key = onboardingKey.value.trim();
    if (!key) {
      showOnboardingStatus("error", t("settings.enterKey"));
      return;
    }
    onboardingSave.disabled = true;
    onboardingSave.textContent = t("chat.verifying");
    showOnboardingStatus("", t("chat.testingKey"));

    const result = await testApiKey(key);
    if (result.valid) {
      await saveApiKey(key);
      showOnboardingStatus("success", `✅ ${t("chat.keyValidRedirect")}`);
      updateStatus("connected");
      setTimeout(() => showMainContent(), 600);
    } else {
      showOnboardingStatus("error", `❌ ${result.error || t("chat.keyInvalidCheck")}`);
    }
    onboardingSave.disabled = false;
    onboardingSave.textContent = t("chat.saveAndTest");
  });

  // ─── ONGLETS ───
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const tabName = tab.dataset.tab;
      // Masquer tous les onglets
      chatTab.classList.add("mist-hidden");
      actionsTab.classList.add("mist-hidden");
      agentsTab.classList.add("mist-hidden");
      integrationTab.classList.add("mist-hidden");
      
      // Afficher l'onglet sélectionné et gérer la barre d'input
      if (tabName === "chat") {
        chatTab.classList.remove("mist-hidden");
        mainInputArea.classList.remove("mist-hidden");
      } else if (tabName === "actions") {
        actionsTab.classList.remove("mist-hidden");
        mainInputArea.classList.add("mist-hidden"); // Cacher la barre d'input dans Actions
      } else if (tabName === "agents") {
        agentsTab.classList.remove("mist-hidden");
        mainInputArea.classList.add("mist-hidden"); // Cacher la barre d'input principale
        loadAgents(); // Charger les agents
      } else if (tabName === "integration") {
        integrationTab.classList.remove("mist-hidden");
        mainInputArea.classList.add("mist-hidden"); // Cacher la barre d'input principale
        loadIntegrationDocs(); // Charger les documents intégrés
        checkCurrentPageIsGoogleDoc(); // Vérifier si page courante est un Google Doc
      }
    });
  });

  // ─── CHIPS RAPIDES ───
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      const action = chip.dataset.quick;
      executeQuickAction(action);
    });
  });

  // ─── SÉLECTION ───
  document.addEventListener("mouseup", () => {
    currentSelection = getSelectionText();
    if (currentSelection.length > 10) {
      selectionChip.classList.add("visible");
    } else {
      selectionChip.classList.remove("visible");
    }
  });

  selectionChip.addEventListener("click", () => {
    if (currentSelection) {
      userInput.value = `Explique ce passage : "${currentSelection.slice(0, 100)}${currentSelection.length > 100 ? '...' : ''}"`;
      userInput.focus();
    }
  });

  // ─── CARTES D'ACTIONS ───
  actionCards.forEach(card => {
    card.addEventListener("click", () => {
      const action = card.dataset.action;
      executeQuickAction(action);
      // Basculer vers l'onglet chat
      tabs.forEach(t => t.classList.remove("active"));
      tabs[0].classList.add("active");
      chatTab.classList.remove("mist-hidden");
      actionsTab.classList.add("mist-hidden");
    });
  });

  // ─── ENVOI MESSAGE ───
  sendBtn.addEventListener("click", sendMessage);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ─── RAFRAÎCHIR CONTEXTE ───
  refreshContext.addEventListener("click", () => {
    const meta = getPageMeta();
    dock.querySelector("#mist-page-title").textContent = meta.title;
    dock.querySelector("#mist-page-url").textContent = meta.url;
    dock.querySelector(".mist-context-favicon").src = meta.favicon;
    showBannerMessage(t("context.refreshed"));
  });

  // ─── FONCTIONS HELPERS ───
  function showSettingsMessage(type, text) {
    settingsMsg.className = "mist-settings-message show";
    if (type) settingsMsg.classList.add(type);
    settingsMsg.textContent = text;
  }

  function showOnboardingStatus(type, text) {
    onboardingStatus.className = "mist-onboarding-status";
    if (type) onboardingStatus.classList.add(type);
    onboardingStatus.textContent = text;
  }

  function updateStatus(type) {
    statusBadge.className = "mist-status-badge";
    if (type) statusBadge.classList.add(type);
    // Tooltip pour indiquer l'état
    const tooltips = {
      connected: t("header.status.connected") || "Connecté",
      error: t("header.status.error") || "Erreur API",
      warning: t("header.status.warning") || "Attention",
      "": t("header.status.notConfigured") || "Non configuré"
    };
    statusBadge.title = tooltips[type] || tooltips[""];
  }

  function showBannerMessage(text, isError = false) {
    if (isError) {
      errorBanner.classList.add("show");
      errorText.textContent = text;
    } else {
      // Pour les succès, on peut juste mettre à jour le statut
      updateStatus("connected");
    }
  }

  function showOnboarding() {
    onboarding.classList.remove("mist-hidden");
    mainContent.classList.add("mist-hidden");
  }

  function showMainContent() {
    onboarding.classList.add("mist-hidden");
    mainContent.classList.remove("mist-hidden");
  }

  async function loadApiKeyToInput() {
    const key = await getStoredKey();
    if (key) {
      apiInput.value = key;
    }
    // Charger la langue
    const lang = await getStoredLanguage();
    const langSelect = dock.querySelector("#mist-language-select");
    if (langSelect && lang) {
      langSelect.value = lang;
    }
    
    // Charger le modèle
    await loadStoredModel();
  }

  // Detect browser language
  function detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage || "en";
    const langCode = browserLang.split("-")[0].toLowerCase();
    // Return the language if supported, otherwise default to English
    if (TRANSLATIONS[langCode]) {
      return langCode;
    }
    return "en";
  }

  // ─── UPDATE CHECK ───
  const CURRENT_VERSION = "1.0.0";
  const GITHUB_MANIFEST_URL = "https://raw.githubusercontent.com/Noonran/Fusion-Ai_Assistant/main/manifest.json";
  const GITHUB_REPO_URL = "https://github.com/Noonran/Fusion-Ai_Assistant";

  let updateAvailable = false;
  let latestVersion = null;

  async function checkForUpdates() {
    const updateBtn = dock.querySelector("#mist-check-update");
    const updateIcon = updateBtn?.querySelector(".mist-update-icon");
    
    if (!updateIcon) return;
    
    // État: vérification en cours
    updateIcon.className = "mist-update-icon mist-update-checking";
    updateIcon.textContent = "🔄";
    
    try {
      const response = await fetch(GITHUB_MANIFEST_URL, {
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch manifest");
      }
      
      const manifest = await response.json();
      latestVersion = manifest.version;
      
      // Comparer les versions
      if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
        updateAvailable = true;
        updateIcon.className = "mist-update-icon mist-update-available";
        updateIcon.textContent = "✨";
        updateBtn.title = t("settings.updateAvailable") + ` (v${latestVersion})`;
      } else {
        updateAvailable = false;
        updateIcon.className = "mist-update-icon mist-update-none";
        updateIcon.textContent = "✅";
        updateBtn.title = t("settings.upToDate") + ` (v${CURRENT_VERSION})`;
      }
    } catch (error) {
      console.log("Update check failed:", error);
      // En cas d'erreur, afficher grisé
      updateIcon.className = "mist-update-icon mist-update-none";
      updateIcon.textContent = "🔄";
      updateBtn.title = t("settings.checkUpdate");
    }
  }

  // Compare deux versions (retourne 1 si v1 > v2, -1 si v1 < v2, 0 si égales)
  function compareVersions(v1, v2) {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  async function getStoredLanguage() {
    return new Promise(resolve => {
      chrome.storage.local.get(["mistralLanguage"], (result) => {
        if (result.mistralLanguage && TRANSLATIONS[result.mistralLanguage]) {
          resolve(result.mistralLanguage);
        } else {
          // Auto-detect from browser
          const detected = detectBrowserLanguage();
          chrome.storage.local.set({ mistralLanguage: detected });
          resolve(detected);
        }
      });
    });
  }

  async function getLanguage() {
    const data = await chrome.storage.local.get("mistralLanguage");
    if (data.mistralLanguage && TRANSLATIONS[data.mistralLanguage]) {
      return data.mistralLanguage;
    }
    // Auto-detect from browser
    const detected = detectBrowserLanguage();
    chrome.storage.local.set({ mistralLanguage: detected });
    return detected;
  }

  async function saveLanguage(lang) {
    return new Promise(resolve => {
      chrome.storage.local.set({ mistralLanguage: lang }, resolve);
    });
  }

  // ─── GESTION DES AGENTS ───
  async function loadAgents() {
    const stored = await getStoredAgents();
    agents = stored.agents || [];
    const activeAgent = stored.activeAgent || "";
    renderSettingsAgents();
    updateAgentSelectorInfo();
    updateAgentSelect(activeAgent);
  }

  async function getStoredAgents() {
    return new Promise(resolve => {
      chrome.storage.local.get(["mistralAgents", "mistralActiveAgent"], (result) => {
        resolve({
          agents: result.mistralAgents || [],
          activeAgent: result.mistralActiveAgent || ""
        });
      });
    });
  }

  async function saveAgents() {
    return new Promise(resolve => {
      chrome.storage.local.set({ mistralAgents: agents }, resolve);
    });
  }

  async function setActiveAgent(agentId) {
    return new Promise(resolve => {
      chrome.storage.local.set({ mistralActiveAgent: agentId }, resolve);
    });
  }

  // Render agents dans les settings
  // Fonction pour tronquer l'ID de l'agent
  function truncateAgentId(id) {
    if (!id || id.length <= 20) return id;
    // Format: ag:5...mud:ec155a51
    const prefix = id.substring(0, 4); // "ag:5"
    const suffix = id.substring(id.length - 12); // "mud:ec155a51"
    return `${prefix}...${suffix}`;
  }

  function renderSettingsAgents() {
    if (!settingsAgentsList) return;
    
    // Générer les boutons d'agents avec détails intégrés
    let html = agents.map((agent, index) => `
      <div class="mist-settings-agent-item" data-index="${index}">
        <div class="mist-settings-agent-item-header">
          <span class="mist-settings-agent-item-name">🤖 ${escapeHtml(agent.name)}</span>
          <span class="mist-settings-agent-item-id mist-settings-agent-item-id-short">${truncateAgentId(escapeHtml(agent.id))}</span>
        </div>
        <div class="mist-settings-agent-item-details">
          <div class="mist-settings-agent-item-row">
            <span class="mist-settings-agent-item-label">ID Agent</span>
            <span class="mist-settings-agent-item-value">${escapeHtml(agent.id)}</span>
          </div>
          <div class="mist-settings-agent-item-row">
            <span class="mist-settings-agent-item-label">Ajouté le</span>
            <span class="mist-settings-agent-item-value">${agent.addedDate || "Non disponible"}</span>
          </div>
          <button class="mist-settings-agent-item-delete" data-delete-index="${index}">🗑️ Supprimer</button>
        </div>
      </div>
    `).join('');
    
    // Ajouter le bouton "+ Ajouter"
    html += `<div class="mist-btn mist-btn-add-agent" id="mist-btn-add-agent">${t("agents.add")}</div>`;
    
    settingsAgentsList.innerHTML = html;

    // Event listeners pour toggle expand/collapse
    settingsAgentsList.querySelectorAll(".mist-settings-agent-item").forEach(item => {
      item.addEventListener("click", (e) => {
        // Ne pas toggle si on clique sur le bouton supprimer
        if (e.target.classList.contains("mist-settings-agent-item-delete")) return;
        
        const isExpanded = item.classList.contains("expanded");
        
        // Fermer tous les autres
        settingsAgentsList.querySelectorAll(".mist-settings-agent-item").forEach(other => {
          other.classList.remove("expanded");
        });
        
        // Toggle celui-ci
        if (!isExpanded) {
          item.classList.add("expanded");
        }
        
        // Fermer le formulaire d'ajout si ouvert
        settingsAgentForm?.classList.add("mist-hidden");
      });
    });

    // Event listeners pour les boutons supprimer
    settingsAgentsList.querySelectorAll(".mist-settings-agent-item-delete").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.deleteIndex);
        if (index < 0 || index >= agents.length) return;
        
        const agent = agents[index];
        if (confirm(`${t("settings.confirmDeleteAgent")} "${agent.name}" ?`)) {
          agents.splice(index, 1);
          await saveAgents();
          renderSettingsAgents();
          updateAgentSelect();
          updateAgentSelectorInfo();
          showSettingsMessage("success", t("settings.agentDeleted") || "Agent supprimé");
        }
      });
    });

    // Re-attacher l'event listener pour le bouton ajouter
    const newBtnAddAgent = dock.querySelector("#mist-btn-add-agent");
    newBtnAddAgent?.addEventListener("click", () => {
      settingsAgentForm?.classList.toggle("mist-hidden");
      // Fermer tous les agents étendus
      settingsAgentsList.querySelectorAll(".mist-settings-agent-item").forEach(item => {
        item.classList.remove("expanded");
      });
    });
  }

  function updateAgentSelect(activeAgent = "") {
    if (!agentSelect) return;
    
    // Garder l'option par défaut
    agentSelect.innerHTML = `<option value="">${t("agents.noAgent") || "Sélectionner un agent..."}</option>`;
    
    // Ajouter les agents
    agents.forEach(agent => {
      const option = document.createElement("option");
      option.value = agent.id;
      option.textContent = `🤖 ${agent.name}`;
      agentSelect.appendChild(option);
    });

    // Sélectionner l'agent actif
    if (activeAgent) {
      agentSelect.value = activeAgent;
    }
  }

  function updateAgentSelectorInfo() {
    // Met à jour l'état vide de l'onglet agents
    if (agents.length > 0 && !agentSelect?.value) {
      // Il y a des agents mais aucun sélectionné
      agentEmpty?.classList.remove("mist-hidden");
    }
  }

  // Bouton annuler (formulaire d'ajout d'agent)
  settingsAgentCancel?.addEventListener("click", () => {
    settingsAgentForm?.classList.add("mist-hidden");
    if (settingsAgentName) settingsAgentName.value = "";
    if (settingsAgentId) settingsAgentId.value = "";
  });

  // Bouton sauvegarder l'agent
  settingsAgentSave?.addEventListener("click", async () => {
    const name = settingsAgentName?.value.trim() || "";
    const id = settingsAgentId?.value.trim() || "";

    if (!name) {
      showSettingsMessage("error", t("settings.enterAgentName"));
      return;
    }
    if (!id) {
      showSettingsMessage("error", t("settings.enterAgentId"));
      return;
    }
    if (!id.startsWith("ag:")) {
      showSettingsMessage("error", t("settings.invalidAgentId"));
      return;
    }

    // Vérifier si l'agent existe déjà
    if (agents.some(a => a.id === id)) {
      showSettingsMessage("error", t("settings.agentExists"));
      return;
    }

    // Ajouter l'agent avec la date d'ajout
    const now = new Date();
    const addedDate = now.toLocaleDateString(currentLang === "en" ? "en-US" : currentLang === "de" ? "de-DE" : currentLang === "es" ? "es-ES" : "fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    
    agents.push({ name, id, addedDate });
    await saveAgents();
    
    settingsAgentName.value = "";
    settingsAgentId.value = "";
    settingsAgentForm?.classList.add("mist-hidden");
    btnAddAgent?.classList.remove("mist-hidden");
    
    renderSettingsAgents();
    updateAgentSelect();
    updateAgentSelectorInfo();
    showSettingsMessage("success", `${t("settings.agentAdded")} ${name}`);
  });

  // Bouton "Gérer mes agents" dans l'onglet Agents
  agentsGotoSettings?.addEventListener("click", () => {
    settingsOverlay.classList.add("open");
    loadApiKeyToInput();
  });

  // Historique des messages agent (séparé du chat principal)
  let agentChatHistory = [];

  // Event listener pour changer l'agent actif
  agentSelect?.addEventListener("change", async () => {
    const agentId = agentSelect.value;
    await setActiveAgent(agentId);
    
    if (agentId) {
      // Agent sélectionné - afficher le chat
      const agent = agents.find(a => a.id === agentId);
      agentEmpty?.classList.add("mist-hidden");
      agentMessages?.classList.remove("mist-hidden");
      agentInputArea?.classList.remove("mist-hidden");
      
      // Vider le chat précédent et afficher un message de bienvenue
      agentChatHistory = [];
      renderAgentChat();
      addAgentMessage("agent", t("agents.welcome").replace("{name}", agent?.name || "Agent"));
      
      showBannerMessage(`${agent?.name || "Agent"} activé`);
    } else {
      // Pas d'agent - afficher l'état vide
      agentEmpty?.classList.remove("mist-hidden");
      agentMessages?.classList.add("mist-hidden");
      agentInputArea?.classList.add("mist-hidden");
      agentChatHistory = [];
    }
  });

  // Ajouter un message au chat agent
  function addAgentMessage(role, content) {
    const avatarUrl = role === "user" 
      ? "👤"
      : agentLogoUrl;
    
    agentChatHistory.push({ role, content });
    
    const messageEl = document.createElement("div");
    messageEl.className = `mist-agent-message ${role}`;
    messageEl.innerHTML = `
      <img src="${avatarUrl}" class="mist-agent-message-avatar" alt="${role}">
      <div class="mist-agent-message-bubble">${formatMessageContent(content)}</div>
    `;
    
    agentMessages?.appendChild(messageEl);
    agentMessages?.scrollTo({ top: agentMessages.scrollHeight, behavior: "smooth" });
  }

  // Afficher le typing indicator pour l'agent
  function showAgentTyping() {
    const typingEl = document.createElement("div");
    typingEl.className = "mist-agent-message agent";
    typingEl.id = "mist-agent-typing";
    typingEl.innerHTML = `
      <img src="${agentLogoUrl}" class="mist-agent-message-avatar" alt="Agent">
      <div class="mist-agent-typing">
        <div class="mist-agent-typing-dots">
          <span></span><span></span><span></span>
        </div>
        <span>${t("agents.thinking")}</span>
      </div>
    `;
    agentMessages?.appendChild(typingEl);
    agentMessages?.scrollTo({ top: agentMessages.scrollHeight, behavior: "smooth" });
  }

  function removeAgentTyping() {
    const typingEl = dock.querySelector("#mist-agent-typing");
    typingEl?.remove();
  }

  // Rendre le chat agent
  function renderAgentChat() {
    if (!agentMessages) return;
    agentMessages.innerHTML = "";
    agentChatHistory.forEach(msg => {
      const avatarUrl = msg.role === "user" 
        ? "👤"
        : agentLogoUrl;
      
      const messageEl = document.createElement("div");
      messageEl.className = `mist-agent-message ${msg.role}`;
      messageEl.innerHTML = `
        <img src="${avatarUrl}" class="mist-agent-message-avatar" alt="${msg.role}">
        <div class="mist-agent-message-bubble">${formatMessageContent(msg.content)}</div>
      `;
      agentMessages.appendChild(messageEl);
    });
  }

  // Envoyer un message à l'agent
  async function sendAgentMessage() {
    const text = agentInput?.value.trim();
    if (!text) return;
    
    const agentId = agentSelect?.value;
    if (!agentId) {
      showBannerMessage(t("agents.selectFirst"));
      return;
    }

    addAgentMessage("user", text);
    agentInput.value = "";
    agentInput.style.height = "auto";
    
    showAgentTyping();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "askAgent",
        agentId: agentId,
        question: text,
        history: agentChatHistory.slice(-10) // Envoyer les 10 derniers messages pour le contexte
      });

      removeAgentTyping();

      if (response?.error) {
        addAgentMessage("agent", `❌ ${response.error}`);
      } else {
        addAgentMessage("agent", response?.result || t("chat.noResponse"));
      }
    } catch (err) {
      removeAgentTyping();
      addAgentMessage("agent", `❌ ${t("chat.error")}: ${err.message}`);
    }
  }

  // Event listeners pour le chat agent
  agentSendBtn?.addEventListener("click", sendAgentMessage);
  
  agentInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAgentMessage();
    }
  });

  // Auto-resize du textarea agent
  agentInput?.addEventListener("input", () => {
    agentInput.style.height = "auto";
    agentInput.style.height = Math.min(agentInput.scrollHeight, 120) + "px";
  });

  // Bouton "Ajouter un agent" dans l'état vide
  agentAddFirst?.addEventListener("click", () => {
    settingsOverlay.classList.add("open");
    loadApiKeyToInput();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ONGLET INTÉGRATION - Documents Google Docs/Sheets/Slides
  // ═══════════════════════════════════════════════════════════════════════════

  let integrationDocs = [];
  let activeIntegrationDoc = null;
  let integrationChatHistory = [];

  // Éléments DOM de l'onglet intégration
  const integrationPanel = dock.querySelector(".mist-integration-panel");
  const integrationToggle = dock.querySelector("#mist-integration-toggle");
  const integrationPanelContent = dock.querySelector("#mist-integration-panel-content");
  const integrationUseCurrentBtn = dock.querySelector("#mist-integration-use-current");
  const integrationUrlInput = dock.querySelector("#mist-integration-url");
  const integrationAddBtn = dock.querySelector("#mist-integration-add-btn");
  const integrationDocsContainer = dock.querySelector("#mist-integration-docs");
  const integrationEmpty = dock.querySelector("#mist-integration-empty");
  const integrationChatWrapper = dock.querySelector("#mist-integration-chat-wrapper");
  const integrationChat = dock.querySelector("#mist-integration-chat");
  const integrationMessages = dock.querySelector("#mist-integration-messages");
  const integrationInputArea = dock.querySelector("#mist-integration-input-area");
  const integrationInput = dock.querySelector("#mist-integration-input");
  const integrationSendBtn = dock.querySelector("#mist-integration-send");
  const integrationActionBtns = dock.querySelectorAll("[data-integ-action]");

  // Toggle du panneau déroulant
  integrationToggle?.addEventListener("click", () => {
    integrationPanel?.classList.toggle("collapsed");
  });

  // Vérifier si la page courante est un Google Doc
  function checkCurrentPageIsGoogleDoc() {
    const currentUrl = window.location.href;
    const docType = getGoogleDocType(currentUrl);
    if (docType && integrationUseCurrentBtn) {
      integrationUseCurrentBtn.classList.remove("mist-hidden");
      integrationUseCurrentBtn.innerHTML = `📄 ${t("integration.addCurrentPage")} (${docType.label})`;
    } else if (integrationUseCurrentBtn) {
      integrationUseCurrentBtn.classList.add("mist-hidden");
    }
  }

  // Utiliser la page courante comme document
  integrationUseCurrentBtn?.addEventListener("click", async () => {
    const currentUrl = window.location.href;
    const added = await addIntegrationDoc(currentUrl);
    if (added) {
      // Extraire le contenu directement depuis la page courante
      const doc = integrationDocs.find(d => d.url === currentUrl);
      if (doc) {
        const content = extractCurrentPageContent();
        if (content) {
          doc.content = content;
          doc.title = document.title.replace(" - Google Docs", "").replace(" - Google Sheets", "").replace(" - Google Slides", "").trim();
          doc.status = "ready";
          await saveIntegrationDocs();
          renderIntegrationDocs();
          showBannerMessage("✅ Contenu extrait de la page !");
        }
      }
    }
  });

  // Extraire le contenu de la page courante (si c'est un Google Doc)
  function extractCurrentPageContent() {
    const url = window.location.href;
    let content = "";
    
    if (url.includes("docs.google.com/document")) {
      // Google Docs
      const editor = document.querySelector('.kix-appview-editor');
      content = editor?.innerText || document.body.innerText;
    } else if (url.includes("docs.google.com/spreadsheets")) {
      // Google Sheets
      const grid = document.querySelector('.grid-container');
      content = grid?.innerText || document.body.innerText;
    } else if (url.includes("docs.google.com/presentation")) {
      // Google Slides
      const slides = document.querySelector('.punch-viewer-content');
      content = slides?.innerText || "";
      // Aussi extraire les notes
      const notes = document.querySelector('.punch-viewer-speakernotes-text');
      if (notes) content += "\n\n--- Notes ---\n" + notes.innerText;
      if (!content.trim()) content = document.body.innerText;
    }
    
    return content.slice(0, 50000);
  }

  // Déterminer le type de document Google
  function getGoogleDocType(url) {
    if (url.includes("docs.google.com/document")) return { type: "docs", icon: "📄", label: "Google Docs" };
    if (url.includes("docs.google.com/spreadsheets")) return { type: "sheets", icon: "📊", label: "Google Sheets" };
    if (url.includes("docs.google.com/presentation")) return { type: "slides", icon: "📽️", label: "Google Slides" };
    if (url.includes("drive.google.com")) return { type: "drive", icon: "📁", label: "Google Drive" };
    return null;
  }

  // Extraire l'ID du document depuis l'URL
  function extractDocId(url) {
    const patterns = [
      /\/d\/([a-zA-Z0-9-_]+)/,
      /\/folders\/([a-zA-Z0-9-_]+)/,
      /id=([a-zA-Z0-9-_]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Charger les documents depuis le stockage
  async function loadIntegrationDocs() {
    return new Promise(resolve => {
      chrome.storage.local.get(["mistralIntegrationDocs"], (result) => {
        integrationDocs = result.mistralIntegrationDocs || [];
        renderIntegrationDocs();
        resolve();
      });
    });
  }

  // Sauvegarder les documents
  async function saveIntegrationDocs() {
    return new Promise(resolve => {
      chrome.storage.local.set({ mistralIntegrationDocs: integrationDocs }, resolve);
    });
  }

  // Ajouter un document
  async function addIntegrationDoc(url) {
    const docType = getGoogleDocType(url);
    if (!docType) {
      showBannerMessage(`⚠️ ${t("integration.invalidUrl")}`);
      return false;
    }

    const docId = extractDocId(url);
    if (!docId) {
      showBannerMessage(`⚠️ ${t("integration.cannotExtractId")}`);
      return false;
    }

    // Vérifier si le document existe déjà
    if (integrationDocs.some(d => d.docId === docId)) {
      showBannerMessage(`⚠️ ${t("integration.alreadyAdded")}`);
      return false;
    }

    // Créer le document
    const doc = {
      id: Date.now().toString(),
      docId,
      url,
      type: docType.type,
      icon: docType.icon,
      label: docType.label,
      title: `Document ${docType.label}`,
      status: "loading",
      content: null,
      chatHistory: [],
      addedDate: new Date().toISOString()
    };

    integrationDocs.push(doc);
    await saveIntegrationDocs();
    renderIntegrationDocs();

    // Extraire le contenu du document
    extractDocContent(doc);

    showBannerMessage(`✅ ${t("integration.docAdded")}`);
    return true;
  }

  // Extraire le contenu d'un document Google
  async function extractDocContent(doc) {
    try {
      // Ouvrir le document dans un onglet pour extraire le contenu
      const response = await chrome.runtime.sendMessage({
        type: "extractGoogleDocContent",
        docId: doc.docId,
        docType: doc.type,
        url: doc.url
      });

      if (response?.success) {
        const index = integrationDocs.findIndex(d => d.id === doc.id);
        if (index !== -1) {
          integrationDocs[index].title = response.title || doc.title;
          integrationDocs[index].content = response.content;
          integrationDocs[index].status = "ready";
          await saveIntegrationDocs();
          renderIntegrationDocs();
        }
      } else {
        // Marquer comme prêt quand même - l'utilisateur peut toujours interagir
        const index = integrationDocs.findIndex(d => d.id === doc.id);
        if (index !== -1) {
          integrationDocs[index].status = "ready";
          integrationDocs[index].content = t("integration.contentAvailable");
          await saveIntegrationDocs();
          renderIntegrationDocs();
        }
      }
    } catch (err) {
      console.error("Erreur extraction doc:", err);
      const index = integrationDocs.findIndex(d => d.id === doc.id);
      if (index !== -1) {
        integrationDocs[index].status = "ready";
        await saveIntegrationDocs();
        renderIntegrationDocs();
      }
    }
  }

  // Supprimer un document
  async function removeIntegrationDoc(docId) {
    integrationDocs = integrationDocs.filter(d => d.id !== docId);
    if (activeIntegrationDoc === docId) {
      activeIntegrationDoc = null;
      integrationChatHistory = [];
      integrationChatWrapper?.classList.add("mist-hidden");
    }
    await saveIntegrationDocs();
    renderIntegrationDocs();
    showBannerMessage(`📂 ${t("integration.docRemoved")}`);
  }

  // Sélectionner un document
  function selectIntegrationDoc(docId) {
    // Sauvegarder l'historique du document actuel avant de changer
    if (activeIntegrationDoc) {
      const currentDoc = integrationDocs.find(d => d.id === activeIntegrationDoc);
      if (currentDoc) {
        currentDoc.chatHistory = [...integrationChatHistory];
        saveIntegrationDocs();
      }
    }
    
    activeIntegrationDoc = docId;
    
    // Mettre à jour l'UI
    integrationDocsContainer?.querySelectorAll(".mist-integration-doc").forEach(el => {
      el.classList.toggle("active", el.dataset.docId === docId);
    });

    const doc = integrationDocs.find(d => d.id === docId);
    if (doc) {
      integrationChatWrapper?.classList.remove("mist-hidden");
      integrationMessages.innerHTML = "";
      
      // Restaurer l'historique ou créer un message de bienvenue
      if (doc.chatHistory && doc.chatHistory.length > 0) {
        integrationChatHistory = [...doc.chatHistory];
        // Réafficher tous les messages
        doc.chatHistory.forEach(msg => {
          renderIntegrationMessage(msg.role, msg.content, false);
        });
      } else {
        integrationChatHistory = [];
        // Message de bienvenue
        addIntegrationMessage("assistant", `📄 ${t("integration.selected").replace("{title}", doc.title)}`);
      }
      
      // Scroll vers le bas
      integrationMessages?.scrollTo({ top: integrationMessages.scrollHeight, behavior: "smooth" });
    }
  }

  // Rendu des documents
  function renderIntegrationDocs() {
    if (!integrationDocsContainer) return;

    if (integrationDocs.length === 0) {
      integrationDocsContainer.innerHTML = `
        <div class="mist-integration-empty" id="mist-integration-empty">
          <div class="mist-integration-empty-icon">📂</div>
          <p id="mist-integration-empty-text">${t("integration.empty")}</p>
          <span id="mist-integration-empty-hint">${t("integration.emptyHint")}</span>
        </div>
      `;
      integrationChatWrapper?.classList.add("mist-hidden");
      return;
    }

    let html = integrationDocs.map(doc => {
      const hasContent = doc.content && doc.content.length > 100 && !doc.content.includes("Document accessible via:");
      return `
      <div class="mist-integration-doc ${activeIntegrationDoc === doc.id ? 'active' : ''}" data-doc-id="${doc.id}">
        <div class="mist-integration-doc-icon ${doc.type}">${doc.icon}</div>
        <div class="mist-integration-doc-info">
          <div class="mist-integration-doc-title">${escapeHtml(doc.title)}</div>
          <div class="mist-integration-doc-type">${doc.label}</div>
        </div>
        <span class="mist-integration-doc-status ${doc.status}" title="${hasContent ? t("integration.contentAvailable") : t("integration.openDocToAnalyze")}">${hasContent ? '✅' : '⚠️'}</span>
        <div class="mist-integration-doc-actions">
          <button class="mist-integration-doc-btn" data-refresh-doc="${doc.id}" title="${t("ui.refreshDocContent")}">🔄</button>
          <button class="mist-integration-doc-btn" data-open-doc="${doc.id}" title="${t("ui.open")}">🔗</button>
          <button class="mist-integration-doc-btn delete" data-delete-doc="${doc.id}" title="${t("ui.delete")}">🗑️</button>
        </div>
      </div>
    `;}).join("");

    integrationDocsContainer.innerHTML = html;

    // Event listeners
    integrationDocsContainer.querySelectorAll(".mist-integration-doc").forEach(el => {
      el.addEventListener("click", (e) => {
        if (!e.target.closest("[data-delete-doc]") && !e.target.closest("[data-open-doc]") && !e.target.closest("[data-refresh-doc]")) {
          selectIntegrationDoc(el.dataset.docId);
        }
      });
    });

    integrationDocsContainer.querySelectorAll("[data-delete-doc]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const docId = btn.dataset.deleteDoc;
        if (confirm(t("integration.confirmDelete"))) {
          removeIntegrationDoc(docId);
        }
      });
    });

    integrationDocsContainer.querySelectorAll("[data-open-doc]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const docId = btn.dataset.openDoc;
        const doc = integrationDocs.find(d => d.id === docId);
        if (doc) {
          window.open(doc.url, "_blank");
        }
      });
    });

    // Bouton rafraîchir - réextraire le contenu
    integrationDocsContainer.querySelectorAll("[data-refresh-doc]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const docId = btn.dataset.refreshDoc;
        const doc = integrationDocs.find(d => d.id === docId);
        if (doc) {
          showBannerMessage(`🔄 ${t("chat.extractingContent")}`);
          doc.status = "loading";
          renderIntegrationDocs();
          await extractDocContent(doc);
          
          // Vérifier si le contenu a été extrait
          const updatedDoc = integrationDocs.find(d => d.id === docId);
          if (updatedDoc && updatedDoc.content && updatedDoc.content.length > 100 && !updatedDoc.content.includes("Document accessible via:")) {
            showBannerMessage("✅ Contenu extrait avec succès !");
          } else {
            showBannerMessage(`⚠️ ${t("integration.openDocAndRetry")}`);
          }
        }
      });
    });
  }

  // Render un message dans le chat intégration (sans l'ajouter à l'historique)
  function renderIntegrationMessage(role, content, scroll = true) {
    const avatarUrl = role === "user" 
      ? "👤"
      : mistralLogoUrl;
    
    const messageEl = document.createElement("div");
    messageEl.className = `mist-message ${role}`;
    messageEl.innerHTML = `
      <img src="${avatarUrl}" class="mist-message-avatar" alt="${role}">
      <div class="mist-message-bubble">${formatMessageContent(content)}</div>
    `;
    
    // Ajouter les boutons d'action pour les messages assistant (même style que chat principal)
    if (role === "assistant") {
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "mist-message-actions";
      actionsDiv.innerHTML = `
        <button class="mist-message-action-btn" data-action="copy">📋 ${t("chat.copy")}</button>
        <button class="mist-message-action-btn" data-action="regenerate">🔄 ${t("chat.regenerate")}</button>
      `;
      messageEl.querySelector(".mist-message-bubble")?.after(actionsDiv);
      
      // Event listener pour copier
      actionsDiv.querySelector('[data-action="copy"]')?.addEventListener("click", (e) => {
        const btn = e.target;
        navigator.clipboard.writeText(content);
        btn.textContent = `✅ ${t("chat.copied")}`;
        setTimeout(() => btn.textContent = `📋 ${t("chat.copy")}`, 1500);
      });
    }
    
    integrationMessages?.appendChild(messageEl);
    if (scroll) {
      integrationMessages?.scrollTo({ top: integrationMessages.scrollHeight, behavior: "smooth" });
    }
  }

  // Ajouter un message au chat intégration (avec sauvegarde)
  function addIntegrationMessage(role, content) {
    integrationChatHistory.push({ role, content });
    renderIntegrationMessage(role, content, true);
    
    // Sauvegarder dans le document actif
    if (activeIntegrationDoc) {
      const doc = integrationDocs.find(d => d.id === activeIntegrationDoc);
      if (doc) {
        doc.chatHistory = [...integrationChatHistory];
        saveIntegrationDocs();
      }
    }
  }

  // Envoyer un message pour l'intégration
  async function sendIntegrationMessage(customPrompt = null) {
    const text = customPrompt || integrationInput?.value.trim();
    if (!text) return;
    
    if (!activeIntegrationDoc) {
      showBannerMessage(t("integration.selectFirst"));
      return;
    }

    const doc = integrationDocs.find(d => d.id === activeIntegrationDoc);
    if (!doc) return;

    if (!customPrompt) {
      addIntegrationMessage("user", text);
      integrationInput.value = "";
    }

    // Afficher le typing indicator (trois petits points)
    const typingEl = document.createElement("div");
    typingEl.className = "mist-message assistant";
    typingEl.id = "mist-integration-typing";
    typingEl.innerHTML = `
      <img src="${mistralLogoUrl}" class="mist-message-avatar" alt="AI">
      <div class="mist-message-bubble" style="padding: 12px 18px;">
        <div class="mist-agent-typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    integrationMessages?.appendChild(typingEl);
    integrationMessages?.scrollTo({ top: integrationMessages.scrollHeight, behavior: "smooth" });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "integrationChat",
        docInfo: {
          title: doc.title,
          type: doc.type,
          content: doc.content,
          url: doc.url
        },
        question: text,
        history: integrationChatHistory.slice(-10)
      });

      // Retirer le typing indicator
      dock.querySelector("#mist-integration-typing")?.remove();

      if (response?.error) {
        addIntegrationMessage("assistant", `❌ ${response.error}`);
      } else {
        addIntegrationMessage("assistant", response?.result || t("chat.noResponse"));
      }
    } catch (err) {
      dock.querySelector("#mist-integration-typing")?.remove();
      addIntegrationMessage("assistant", `❌ Erreur : ${err.message}`);
    }
  }

  // Event listeners pour l'intégration
  integrationAddBtn?.addEventListener("click", async () => {
    const url = integrationUrlInput?.value.trim();
    if (!url) {
      showBannerMessage(`⚠️ ${t("integration.enterUrl")}`);
      return;
    }
    const success = await addIntegrationDoc(url);
    if (success) {
      integrationUrlInput.value = "";
    }
  });

  integrationUrlInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      integrationAddBtn?.click();
    }
  });

  integrationSendBtn?.addEventListener("click", () => sendIntegrationMessage());

  integrationInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendIntegrationMessage();
    }
  });

  // Actions rapides intégration
  integrationActionBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.integAction;
      const doc = integrationDocs.find(d => d.id === activeIntegrationDoc);
      if (!doc) {
        showBannerMessage(t("integration.selectFirst"));
        return;
      }

      let prompt = "";
      switch (action) {
        case "analyze":
          prompt = `Analyse en détail le document "${doc.title}" et donne-moi une vue d'ensemble complète.`;
          break;
        case "summarize":
          prompt = `Résume le document "${doc.title}" en points clés.`;
          break;
        case "suggest":
          prompt = `Propose des améliorations et suggestions pour le document "${doc.title}".`;
          break;
      }

      if (prompt) {
        addIntegrationMessage("user", prompt);
        sendIntegrationMessage(prompt);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    addMessage("user", text);
    userInput.value = "";
    chatEmpty.classList.add("mist-hidden");

    showTypingIndicator();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "askQuestion",
        question: text,
        includeContext: true
      });

      removeTypingIndicator();

      if (response?.error) {
        addMessage("assistant", `❌ Erreur : ${response.error}`, null, true);
      } else {
        addMessage("assistant", response?.result || t("chat.noResponse"));
      }
    } catch (err) {
      removeTypingIndicator();
      addMessage("assistant", `❌ Erreur : ${err.message}`, null, true);
    }
  }

  // ─── AGENT DE PAGE ───
  async function executePageAgent() {
    chatEmpty.classList.add("mist-hidden");
    addMessage("assistant", `🤖 ${t("action.pageagent.title")}...\n\n_${t("chat.pageAgentWorking")}_`, `🤖 ${t("action.pageagent.title")}`);
    showTypingIndicator();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "runPageAgent"
      });

      removeTypingIndicator();

      if (response?.error) {
        updateLastMessage(`❌ ${response.error}`);
        return;
      }

      // Construire le message de réponse
      let resultContent = response.analysis || "Analyse effectuée.";
      
      // Ajouter les actions effectuées
      if (response.actions && response.actions.length > 0) {
        resultContent += "\n\n---\n\n### 🎯 Actions effectuées\n\n";
        response.actions.forEach((action, index) => {
          const actionIcons = {
            'HIGHLIGHT': '🖍️ Surlignage',
            'SCROLL_TO': '📜 Scroll vers',
            'SHOW_TOOLTIP': '💬 Bulle d\'aide'
          };
          const actionName = actionIcons[action.type] || action.type;
          resultContent += `${index + 1}. **${actionName}** sur \`${action.selector}\``;
          if (action.text) {
            resultContent += `\n   _"${action.text}"_`;
          }
          resultContent += "\n";
        });
        
        resultContent += "\n💡 _Les actions sont visibles sur la page. Cliquez sur ✕ pour fermer les bulles._";
      }

      updateLastMessage(resultContent);

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  // ─── SURLIGNER LES IDÉES CLÉS ───
  async function executeHighlightKeyIdeas() {
    chatEmpty.classList.add("mist-hidden");
    addMessage("assistant", `🖍️ ${t("chat.analyzing")}\n\n_${t("chat.highlightingIdeas")}_`, `🖍️ ${t("action.highlight.title")}`);
    showTypingIndicator();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "highlightKeyIdeas",
        includeContext: true
      });

      removeTypingIndicator();

      if (response?.error) {
        updateLastMessage(`❌ ${response.error}`);
        return;
      }

      // Parser le JSON de la réponse
      let keyIdeas;
      try {
        // Chercher le JSON dans la réponse
        const jsonMatch = response.result?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          keyIdeas = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // Si pas de JSON valide, afficher le texte brut
        updateLastMessage(response.result || "Analyse terminée.");
        return;
      }

      // Surligner les phrases sur la page
      let highlightCount = 0;
      const allPhrases = [
        ...(keyIdeas.arguments || []),
        ...(keyIdeas.definitions || []),
        ...(keyIdeas.keyNumbers || []),
        ...(keyIdeas.summaryPhrases || [])
      ];

      // Supprimer les anciens surlignages
      document.querySelectorAll('.mist-highlight').forEach(el => {
        el.outerHTML = el.innerHTML;
      });

      // Surligner chaque phrase
      allPhrases.forEach((phrase, index) => {
        if (phrase && phrase.length > 10) {
          const highlighted = highlightTextInPage(phrase, index);
          if (highlighted) highlightCount++;
        }
      });

      // Construire le message de résultat
      let resultContent = `## 🖍️ Idées clés identifiées\n\n`;
      resultContent += `**${highlightCount} éléments surlignés sur la page**\n\n`;

      if (keyIdeas.arguments?.length > 0) {
        resultContent += `### 💡 Arguments principaux\n`;
        keyIdeas.arguments.forEach(arg => resultContent += `- ${arg}\n`);
        resultContent += `\n`;
      }

      if (keyIdeas.definitions?.length > 0) {
        resultContent += `### 📖 Définitions\n`;
        keyIdeas.definitions.forEach(def => resultContent += `- ${def}\n`);
        resultContent += `\n`;
      }

      if (keyIdeas.keyNumbers?.length > 0) {
        resultContent += `### 📊 Chiffres clés\n`;
        keyIdeas.keyNumbers.forEach(num => resultContent += `- ${num}\n`);
        resultContent += `\n`;
      }

      if (keyIdeas.summaryPhrases?.length > 0) {
        resultContent += `### ✨ Phrases résumantes\n`;
        keyIdeas.summaryPhrases.forEach(sum => resultContent += `- ${sum}\n`);
        resultContent += `\n`;
      }

      resultContent += `\n---\n💡 _Les passages surlignés sont visibles sur la page. Cliquez sur "Effacer" pour les retirer._\n\n`;
      resultContent += `<button class="mist-btn-inline" onclick="document.querySelectorAll('.mist-highlight').forEach(el => el.outerHTML = el.innerHTML)">🗑️ Effacer les surlignages</button>`;

      updateLastMessage(resultContent);

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  // Fonction pour surligner du texte dans la page
  function highlightTextInPage(searchText, index) {
    const colors = ['#FFD93D', '#FF6B35', '#FF8C42', '#FFA62F', '#FFD93D'];
    const color = colors[index % colors.length];
    
    // Créer un TreeWalker pour parcourir les noeuds texte
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Ignorer les scripts, styles et notre dock
          if (node.parentElement?.closest('script, style, #mistral-browse-assistant-dock')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    let found = false;
    const searchLower = searchText.toLowerCase().slice(0, 50); // Chercher les 50 premiers caractères

    while (node = walker.nextNode()) {
      const textLower = node.textContent.toLowerCase();
      if (textLower.includes(searchLower)) {
        const span = document.createElement('span');
        span.className = 'mist-highlight';
        span.style.cssText = `background: linear-gradient(180deg, transparent 60%, ${color}80 60%); padding: 2px 0;`;
        
        const parent = node.parentElement;
        if (parent && !parent.classList.contains('mist-highlight')) {
          const range = document.createRange();
          range.selectNodeContents(node);
          range.surroundContents(span);
          found = true;
          break;
        }
      }
    }
    return found;
  }

  // ─── EXTRAIRE LES DONNÉES ───
  async function executeExtractData() {
    chatEmpty.classList.add("mist-hidden");
    addMessage("assistant", `📦 ${t("chat.extractingData")}\n\n_${t("chat.analyzing")}_`, `📦 ${t("action.extract.title")}`);
    showTypingIndicator();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "extractData",
        includeContext: true
      });

      removeTypingIndicator();

      if (response?.error) {
        updateLastMessage(`❌ ${response.error}`);
        return;
      }

      // Parser le JSON de la réponse
      let extractedData;
      try {
        const jsonMatch = response.result?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // Si pas de JSON valide, afficher le texte brut
        updateLastMessage(response.result || "Extraction terminée.");
        return;
      }

      // Stocker les données pour export
      window.__mistralExtractedData = extractedData;

      // Construire le message de résultat
      let resultContent = `## 📦 Données extraites\n\n`;

      // Tableaux
      if (extractedData.tables?.length > 0) {
        resultContent += `### 📊 Tableaux\n\n`;
        extractedData.tables.forEach((table, idx) => {
          resultContent += `**${table.title || `Tableau ${idx + 1}`}**\n\n`;
          if (table.headers && table.rows) {
            resultContent += `| ${table.headers.join(' | ')} |\n`;
            resultContent += `| ${table.headers.map(() => '---').join(' | ')} |\n`;
            table.rows.forEach(row => {
              resultContent += `| ${row.join(' | ')} |\n`;
            });
          }
          resultContent += `\n`;
        });
      }

      // Arguments
      if (extractedData.arguments?.length > 0) {
        resultContent += `### 💡 Arguments\n\n`;
        extractedData.arguments.forEach(arg => {
          resultContent += `- **${arg.point}**`;
          if (arg.details) resultContent += `: ${arg.details}`;
          resultContent += `\n`;
        });
        resultContent += `\n`;
      }

      // Étapes
      if (extractedData.steps?.length > 0) {
        resultContent += `### 📋 Étapes\n\n`;
        extractedData.steps.forEach(step => {
          resultContent += `${step.step}. **${step.title}**\n`;
          if (step.description) resultContent += `   ${step.description}\n`;
        });
        resultContent += `\n`;
      }

      // Concepts
      if (extractedData.concepts?.length > 0) {
        resultContent += `### 📖 Concepts clés\n\n`;
        extractedData.concepts.forEach(concept => {
          resultContent += `- **${concept.term}**: ${concept.definition}\n`;
        });
        resultContent += `\n`;
      }

      // Résumé
      if (extractedData.summary) {
        resultContent += `### 📝 Résumé\n${extractedData.summary}\n\n`;
      }

      resultContent += `\n---\n\n`;
      resultContent += `📥 **Exporter les données:**\n\n`;

      updateLastMessage(resultContent);

      // Ajouter les boutons d'export après le rendu
      setTimeout(() => {
        const lastMessage = chatTab.querySelector('.mist-message:last-child .mist-message-bubble');
        if (lastMessage && !lastMessage.querySelector('.mist-export-buttons')) {
          const exportDiv = document.createElement('div');
          exportDiv.className = 'mist-export-buttons';
          exportDiv.style.cssText = 'display: flex; gap: 8px; margin-top: 12px;';
          exportDiv.innerHTML = `
            <button class="mist-btn mist-btn-primary" id="mist-export-csv">📥 Télécharger CSV</button>
            <button class="mist-btn" id="mist-export-json">📄 Télécharger JSON</button>
          `;
          lastMessage.appendChild(exportDiv);

          // Event listeners pour les exports
          exportDiv.querySelector('#mist-export-csv')?.addEventListener('click', () => exportDataAsCSV());
          exportDiv.querySelector('#mist-export-json')?.addEventListener('click', () => exportDataAsJSON());
        }
      }, 100);

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  function exportDataAsCSV() {
    const data = window.__mistralExtractedData;
    if (!data) return;

    let csv = '';

    // Exporter les tableaux
    if (data.tables?.length > 0) {
      data.tables.forEach(table => {
        if (table.title) csv += `# ${table.title}\n`;
        if (table.headers) csv += table.headers.join(',') + '\n';
        if (table.rows) {
          table.rows.forEach(row => {
            csv += row.map(cell => `"${cell}"`).join(',') + '\n';
          });
        }
        csv += '\n';
      });
    }

    // Exporter les arguments
    if (data.arguments?.length > 0) {
      csv += '# Arguments\nPoint,Détails\n';
      data.arguments.forEach(arg => {
        csv += `"${arg.point}","${arg.details || ''}"\n`;
      });
      csv += '\n';
    }

    // Exporter les concepts
    if (data.concepts?.length > 0) {
      csv += '# Concepts\nTerme,Définition\n';
      data.concepts.forEach(concept => {
        csv += `"${concept.term}","${concept.definition}"\n`;
      });
    }

    downloadFile(csv, 'donnees-extraites.csv', 'text/csv');
    showBannerMessage('✅ CSV téléchargé !');
  }

  function exportDataAsJSON() {
    const data = window.__mistralExtractedData;
    if (!data) return;

    const json = JSON.stringify(data, null, 2);
    downloadFile(json, 'donnees-extraites.json', 'application/json');
    showBannerMessage('✅ JSON téléchargé !');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── COMPARER DES PAGES ───
  async function executeComparePages() {
    chatEmpty.classList.add("mist-hidden");
    addMessage("assistant", `⚖️ ${t("chat.preparingComparison")}\n\n_${t("chat.retrievingTabs")}_`, `⚖️ ${t("action.compare.title")}`);
    showTypingIndicator();

    try {
      // Demander la liste des onglets au background
      const tabsResponse = await chrome.runtime.sendMessage({ type: "getOpenTabs" });
      
      if (!tabsResponse?.tabs || tabsResponse.tabs.length < 2) {
        removeTypingIndicator();
        updateLastMessage("⚠️ **Pas assez d'onglets ouverts**\n\nOuvrez au moins 2 onglets avec du contenu pour pouvoir les comparer.");
        return;
      }

      removeTypingIndicator();

      // Créer l'interface de sélection des onglets
      let selectionHtml = `## ⚖️ Sélectionnez les pages à comparer\n\n`;
      selectionHtml += `_Cochez les onglets que vous souhaitez comparer (2-4 max)_\n\n`;
      
      updateLastMessage(selectionHtml);

      // Ajouter la liste de sélection après le rendu
      setTimeout(() => {
        const lastMessage = chatTab.querySelector('.mist-message:last-child .mist-message-bubble');
        if (lastMessage && !lastMessage.querySelector('.mist-tabs-selection')) {
          const selectionDiv = document.createElement('div');
          selectionDiv.className = 'mist-tabs-selection';
          selectionDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin: 12px 0; max-height: 200px; overflow-y: auto;';
          
          tabsResponse.tabs.forEach((tab, idx) => {
            const isCurrentTab = tab.active;
            const checkbox = document.createElement('label');
            checkbox.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--mist-bg-input); border-radius: 6px; cursor: pointer;';
            checkbox.innerHTML = `
              <input type="checkbox" class="mist-tab-checkbox" data-tab-id="${tab.id}" ${isCurrentTab ? 'checked' : ''}>
              <img src="${tab.favIconUrl || ''}" style="width: 16px; height: 16px;" onerror="this.style.display='none'">
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px;">${escapeHtml(tab.title?.slice(0, 50) || 'Sans titre')}</span>
              ${isCurrentTab ? '<span style="font-size: 10px; color: var(--mist-yellow);">(actuel)</span>' : ''}
            `;
            selectionDiv.appendChild(checkbox);
          });

          const buttonDiv = document.createElement('div');
          buttonDiv.style.cssText = 'display: flex; gap: 8px; margin-top: 12px;';
          buttonDiv.innerHTML = `
            <button class="mist-btn mist-btn-primary" id="mist-compare-selected">⚖️ Comparer les sélectionnés</button>
          `;

          lastMessage.appendChild(selectionDiv);
          lastMessage.appendChild(buttonDiv);

          // Event listener pour le bouton de comparaison
          buttonDiv.querySelector('#mist-compare-selected')?.addEventListener('click', async () => {
            const selectedTabs = Array.from(selectionDiv.querySelectorAll('.mist-tab-checkbox:checked'))
              .map(cb => parseInt(cb.dataset.tabId));
            
            if (selectedTabs.length < 2) {
              showBannerMessage('⚠️ Sélectionnez au moins 2 onglets');
              return;
            }
            if (selectedTabs.length > 4) {
              showBannerMessage('⚠️ Maximum 4 onglets');
              return;
            }

            // Lancer la comparaison
            await runComparison(selectedTabs);
          });
        }
      }, 100);

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  async function runComparison(tabIds) {
    addMessage("assistant", `⚖️ ${t("chat.comparing")}\n\n_${t("chat.analyzing")}_`, `⚖️ ${t("action.compare.title")}`);
    showTypingIndicator();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "comparePages",
        tabIds: tabIds
      });

      removeTypingIndicator();

      if (response?.error) {
        updateLastMessage(`❌ ${response.error}`);
        return;
      }

      updateLastMessage(response.result || "Comparaison terminée.");

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  // ─── YOUTUBE ACTIONS ───
  async function executeYouTubeAction(actionMode) {
    chatEmpty.classList.add("mist-hidden");
    mainInputArea.classList.remove("mist-hidden");

    const actionLabels = {
      summarize: "📺 Résumé vidéo YouTube",
      keyPoints: "📌 Points clés de la vidéo",
      transcript: "📝 Transcript de la vidéo"
    };

    // Vérifier si on est sur YouTube
    if (!isYouTubePage()) {
      addMessage("assistant", "⚠️ **Cette fonctionnalité est réservée aux vidéos YouTube**\n\nOuvrez une vidéo YouTube et réessayez.", actionLabels[actionMode]);
      return;
    }

    addMessage("assistant", `🎬 ${t("action.youtube.analyzing")}\n\n_${t("chat.extracting")}_`, actionLabels[actionMode]);
    showTypingIndicator();

    try {
      // Extraire les informations YouTube
      const youtubeInfo = extractYouTubeInfo();

      if (youtubeInfo.error) {
        removeTypingIndicator();
        updateLastMessage(`⚠️ ${youtubeInfo.message}`);
        return;
      }

      // Mode TRANSCRIPT: extraction directe et téléchargement
      if (actionMode === "transcript") {
        let fullTranscript = youtubeInfo.transcript;
        let transcriptSource = "dom";
        
        // Si on a des captionTracks, essayer de récupérer le transcript complet
        if (youtubeInfo.captionTracks && youtubeInfo.captionTracks.length > 0) {
          // Préférer français, puis anglais, puis premier disponible
          let selectedTrack = youtubeInfo.captionTracks.find(t => t.languageCode === 'fr') 
            || youtubeInfo.captionTracks.find(t => t.languageCode === 'en')
            || youtubeInfo.captionTracks[0];
          
          if (selectedTrack?.baseUrl) {
            const fetchedTranscript = await fetchYouTubeTranscript(selectedTrack.baseUrl);
            if (fetchedTranscript) {
              fullTranscript = fetchedTranscript;
              transcriptSource = selectedTrack.isAutoGenerated ? "auto" : "manual";
            }
          }
        }
        
        // Si transcript trouvé, télécharger le fichier
        if (fullTranscript && fullTranscript.length > 50) {
          removeTypingIndicator();
          
          const filename = downloadTranscriptAsFile(
            `Transcript: ${youtubeInfo.title}\nChaîne: ${youtubeInfo.channel}\nURL: ${youtubeInfo.url}\nDurée: ${youtubeInfo.duration}\n\n${'='.repeat(50)}\n\n${fullTranscript}`,
            youtubeInfo.title
          );
          
          const preview = fullTranscript.slice(0, 1500);
          const wordCount = fullTranscript.split(/\s+/).length;
          const lineCount = fullTranscript.split('\n').length;
          const availableLangs = youtubeInfo.captionTracks?.map(t => `${t.name} (${t.languageCode})`).join(', ') || 'Non détecté';
          
          updateLastMessage(
            `**📺 ${youtubeInfo.title}**\n` +
            `👤 ${youtubeInfo.channel}` +
            (youtubeInfo.duration ? ` • ⏱️ ${youtubeInfo.duration}` : "") +
            `\n\n---\n\n` +
            `## ✅ Transcript extrait avec succès !\n\n` +
            `📄 **Fichier téléchargé:** \`${filename}\`\n\n` +
            `📊 **Statistiques:**\n` +
            `- 📝 ${lineCount} lignes\n` +
            `- 📖 ~${wordCount} mots\n` +
            `- 🌍 Langues disponibles: ${availableLangs}\n` +
            `- 📡 Source: ${transcriptSource === 'auto' ? 'Sous-titres automatiques' : transcriptSource === 'manual' ? 'Sous-titres manuels' : 'Panneau de transcription'}\n\n` +
            `---\n\n` +
            `### 📋 Aperçu du transcript:\n\n` +
            `\`\`\`\n${preview}${fullTranscript.length > 1500 ? '\n\n... [voir le fichier complet]' : ''}\n\`\`\``
          );
          return;
        }
        
        // FALLBACK: Pas de transcript direct, utiliser l'IA pour générer une transcription
        updateLastMessage(`🎬 **${youtubeInfo.title}**\n\n⏳ _Sous-titres non accessibles directement. Génération d'une transcription via IA..._`);
        
        // Envoyer au background pour traitement par l'IA
        const response = await chrome.runtime.sendMessage({
          type: "youtubeAction",
          actionMode: "transcript",
          youtubeInfo: youtubeInfo
        });

        removeTypingIndicator();

        if (response?.error) {
          updateLastMessage(`❌ ${response.error}`);
          return;
        }

        // Afficher le résultat de l'IA avec option de téléchargement
        const aiTranscript = response.result || "Transcription non disponible.";
        
        // Télécharger le fichier généré par l'IA
        const filename = downloadTranscriptAsFile(
          `Transcript (généré par IA): ${youtubeInfo.title}\nChaîne: ${youtubeInfo.channel}\nURL: ${youtubeInfo.url}\nDurée: ${youtubeInfo.duration}\n\n⚠️ Note: Cette transcription a été générée par IA basée sur les informations disponibles de la vidéo.\n\n${'='.repeat(50)}\n\n${aiTranscript}`,
          youtubeInfo.title
        );
        
        updateLastMessage(
          `**📺 ${youtubeInfo.title}**\n` +
          `👤 ${youtubeInfo.channel}` +
          (youtubeInfo.duration ? ` • ⏱️ ${youtubeInfo.duration}` : "") +
          `\n\n---\n\n` +
          `## 🤖 Transcription générée par IA\n\n` +
          `⚠️ *Les sous-titres natifs n'étaient pas accessibles. Cette transcription est basée sur l'analyse du contenu disponible.*\n\n` +
          `📄 **Fichier téléchargé:** \`${filename}\`\n\n` +
          `---\n\n` +
          aiTranscript
        );
        return;
      }

      // Pour summarize et keyPoints: envoyer au background
      const response = await chrome.runtime.sendMessage({
        type: "youtubeAction",
        actionMode: actionMode,
        youtubeInfo: youtubeInfo
      });

      removeTypingIndicator();

      if (response?.error) {
        updateLastMessage(`❌ ${response.error}`);
        return;
      }

      // Afficher le résultat
      let resultContent = response.result || "Analyse terminée.";

      // Ajouter les infos de la vidéo en en-tête
      const headerInfo = `**📺 ${youtubeInfo.title}**\n` +
        `👤 ${youtubeInfo.channel}` +
        (youtubeInfo.duration ? ` • ⏱️ ${youtubeInfo.duration}` : "") +
        (youtubeInfo.views ? ` • 👁️ ${youtubeInfo.views}` : "") +
        `\n\n---\n\n`;

      updateLastMessage(headerInfo + resultContent);

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  async function executeQuickAction(actionType) {
    const actionLabels = {
      summary: t("actionLabel.summary"),
      detailed: t("actionLabel.detailed"),
      simplify: t("actionLabel.simplify"),
      translate: t("actionLabel.translate"),
      critique: t("actionLabel.critique"),
      plan: t("actionLabel.plan"),
      pageAgent: t("actionLabel.pageAgent"),
      highlightKeyIdeas: t("actionLabel.highlightKeyIdeas"),
      extractData: t("actionLabel.extractData"),
      comparePages: t("actionLabel.comparePages"),
      rewriteScientific: t("actionLabel.rewriteScientific"),
      rewriteJournalistic: t("actionLabel.rewriteJournalistic"),
      rewriteMarketing: t("actionLabel.rewriteMarketing"),
      rewriteUXCopy: t("actionLabel.rewriteUXCopy"),
      rewriteTwitterThread: t("actionLabel.rewriteTwitterThread"),
      rewriteLinkedIn: t("actionLabel.rewriteLinkedIn"),
      generateArticlePlan: t("actionLabel.generateArticlePlan"),
      generateYouTubePlan: t("actionLabel.generateYouTubePlan"),
      generateEmailSequence: t("actionLabel.generateEmailSequence"),
      generateTutorial: t("actionLabel.generateTutorial"),
      generateContactEmail: t("actionLabel.generateContactEmail")
    };

    chatEmpty.classList.add("mist-hidden");
    
    // Afficher la barre d'input pour voir la réponse
    mainInputArea.classList.remove("mist-hidden");
    
    // Actions spéciales qui gèrent leurs propres messages
    const specialActions = ["pageAgent", "highlightKeyIdeas", "extractData", "comparePages", "summarizeYouTube", "youtubeKeyPoints", "youtubeTranscript"];
    
    if (specialActions.includes(actionType)) {
      switch (actionType) {
        case "pageAgent":
          await executePageAgent();
          return;
        case "highlightKeyIdeas":
          await executeHighlightKeyIdeas();
          return;
        case "extractData":
          await executeExtractData();
          return;
        case "comparePages":
          await executeComparePages();
          return;
        case "summarizeYouTube":
          await executeYouTubeAction("summarize");
          return;
        case "youtubeKeyPoints":
          await executeYouTubeAction("keyPoints");
          return;
        case "youtubeTranscript":
          await executeYouTubeAction("transcript");
          return;
      }
    }
    
    // Message spécial pour l'analyse avec recherche
    if (actionType === "critique") {
      addMessage("assistant", `🔍 ${t("chat.searching")}`, actionLabels[actionType]);
    } else {
      addMessage("assistant", "", actionLabels[actionType] || actionType);
    }
    
    showTypingIndicator();

    try {
      let messageType = actionType;
      let question = "";
      let withSearch = false;

      switch (actionType) {
        case "summary":
          messageType = "summarizePage";
          break;
        case "detailed":
          messageType = "detailedSummary";
          question = "Fais un résumé détaillé et structuré de cette page avec des sections.";
          break;
        case "simplify":
          messageType = "simplify";
          question = "Explique le contenu de cette page de manière simple, pour quelqu'un qui n'y connaît rien.";
          break;
        case "translate":
          messageType = "translate";
          question = "Traduis les points principaux de cette page en français.";
          break;
        case "critique":
          messageType = "critique";
          withSearch = true;
          question = "Fais une analyse complète de cette page avec recherches web complémentaires.";
          break;
        case "plan":
          messageType = "plan";
          question = "Génère un plan structuré (titre, sous-titres, points clés) à partir du contenu de cette page.";
          break;
        // Réécritures
        case "rewriteScientific":
          messageType = "rewriteScientific";
          question = "Réécris ce contenu dans un style scientifique et académique.";
          break;
        case "rewriteJournalistic":
          messageType = "rewriteJournalistic";
          question = "Réécris ce contenu dans un style journalistique.";
          break;
        case "rewriteMarketing":
          messageType = "rewriteMarketing";
          question = "Réécris ce contenu dans un style marketing persuasif.";
          break;
        case "rewriteUXCopy":
          messageType = "rewriteUXCopy";
          question = "Réécris ce contenu dans un style UX Copy clair et concis.";
          break;
        case "rewriteTwitterThread":
          messageType = "rewriteTwitterThread";
          question = "Transforme ce contenu en thread Twitter engageant.";
          break;
        case "rewriteLinkedIn":
          messageType = "rewriteLinkedIn";
          question = "Transforme ce contenu en post LinkedIn professionnel.";
          break;
        // Génération de contenu
        case "generateArticlePlan":
          messageType = "generateArticlePlan";
          question = "Génère un plan d'article SEO détaillé à partir de ce contenu.";
          break;
        case "generateYouTubePlan":
          messageType = "generateYouTubePlan";
          question = "Génère un plan de vidéo YouTube engageant.";
          break;
        case "generateEmailSequence":
          messageType = "generateEmailSequence";
          question = "Génère une séquence de 3 emails marketing.";
          break;
        case "generateTutorial":
          messageType = "generateTutorial";
          question = "Génère un tutoriel structuré étape par étape.";
          break;
        case "generateContactEmail":
          messageType = "generateContactEmail";
          question = "Génère un email de prise de contact professionnel basé sur le contexte de cette page.";
          break;
      }

      const response = await chrome.runtime.sendMessage({
        type: messageType,
        question,
        includeContext: true,
        withSearch
      });

      removeTypingIndicator();
      
      let resultContent = response?.result || response?.error || t("chat.noResponse");
      
      // Ajouter les sources si présentes
      if (response?.sources && response.sources.length > 0) {
        resultContent += "\n\n---\n\n### 📚 Sources consultées\n\n";
        response.sources.forEach((source, index) => {
          resultContent += `${index + 1}. **${source.title}**\n`;
          resultContent += `   🔗 ${source.url}\n`;
          if (source.snippet) {
            resultContent += `   _${source.snippet.slice(0, 100)}..._\n`;
          }
          resultContent += "\n";
        });
      }
      
      updateLastMessage(resultContent);

    } catch (err) {
      removeTypingIndicator();
      updateLastMessage(`❌ Erreur : ${err.message}`);
    }
  }

  function addMessage(role, content, actionLabel = null, isError = false) {
    const msg = { role, content, actionLabel, isError };
    messages.push(msg);
    renderMessages();
  }

  function updateLastMessage(content) {
    if (messages.length > 0) {
      messages[messages.length - 1].content = content;
      renderMessages();
    }
  }

  const chatMistralLogo = chrome.runtime.getURL("images/mistral.png");

  function renderMessages() {
    // Garder uniquement les messages, pas l'empty state
    const existingMessages = chatTab.querySelectorAll(".mist-message, .mist-typing-container");
    existingMessages.forEach(el => el.remove());

    messages.forEach(msg => {
      const div = document.createElement("div");
      div.className = `mist-message ${msg.role}`;

      const avatarContent = msg.role === "assistant" 
        ? `<img src="${chatMistralLogo}" alt="Mistral">` 
        : `<span style="font-size: 24px;">👤</span>`;
      
      let actionHtml = "";
      if (msg.actionLabel) {
        actionHtml = `<div class="mist-message-action">⚡ ${msg.actionLabel}</div>`;
      }

      const contentHtml = formatMessageContent(msg.content);

      div.innerHTML = `
        <div class="mist-message-avatar">${avatarContent}</div>
        <div class="mist-message-content">
          ${actionHtml}
          <div class="mist-message-bubble">${contentHtml}</div>
          ${msg.role === "assistant" && msg.content ? `
            <div class="mist-message-actions">
              <button class="mist-message-action-btn" data-action="copy">📋 ${t("chat.copy")}</button>
              <button class="mist-message-action-btn" data-action="regenerate">🔄 ${t("chat.regenerate")}</button>
            </div>
          ` : ""}
        </div>
      `;

      chatTab.appendChild(div);

      // Event listeners pour les actions
      div.querySelectorAll(".mist-message-action-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.dataset.action === "copy") {
            navigator.clipboard.writeText(msg.content);
            btn.textContent = `✅ ${t("chat.copied")}`;
            setTimeout(() => btn.textContent = `📋 ${t("chat.copy")}`, 1500);
          }
        });
      });
    });

    chatTab.scrollTop = chatTab.scrollHeight;
  }

  function showTypingIndicator() {
    const container = document.createElement("div");
    container.className = "mist-message assistant mist-typing-container";
    container.innerHTML = `
      <div class="mist-message-avatar"><img src="${chatMistralLogo}" alt="Mistral"></div>
      <div class="mist-message-content">
        <div class="mist-message-bubble">
          <div class="mist-typing">
            <span class="mist-typing-dot"></span>
            <span class="mist-typing-dot"></span>
            <span class="mist-typing-dot"></span>
          </div>
        </div>
      </div>
    `;
    chatTab.appendChild(container);
    chatTab.scrollTop = chatTab.scrollHeight;
  }

  function removeTypingIndicator() {
    const typing = chatTab.querySelector(".mist-typing-container");
    if (typing) typing.remove();
  }

  function formatMessageContent(content) {
    if (!content) return "";
    
    // Nettoyer les artefacts HTML mal formatés générés par l'IA
    // Pattern: (url" target="blank" class="mist-link">texte) -> [texte](url)
    content = content.replace(/\(([^"]+)"\s*target="[^"]*"\s*class="[^"]*">([^<]+)\)/g, '[$2]($1)');
    // Pattern: <a href="url" ...>texte</a> mal formaté
    content = content.replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '[$2]($1)');
    // Supprimer les attributs HTML orphelins
    content = content.replace(/"\s*target="[^"]*"\s*class="[^"]*">/g, '');
    content = content.replace(/target="[^"]*"\s*class="[^"]*">/g, '');
    
    // Fonction pour parser les tableaux Markdown
    function parseMarkdownTables(text) {
      const lines = text.split('\n');
      let result = [];
      let tableLines = [];
      let inTable = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Détecter une ligne de tableau (commence et finit par |)
        if (line.startsWith('|') && line.endsWith('|')) {
          // Ignorer les lignes de séparation (|---|---|)
          if (/^\|[\s\-:]+\|$/.test(line.replace(/\|/g, '|').replace(/[\s\-:]+/g, ''))) {
            if (!inTable && tableLines.length > 0) {
              // C'est la ligne de séparation après l'en-tête
              inTable = true;
            }
            continue;
          }
          tableLines.push(line);
          inTable = true;
        } else {
          // Si on sort d'un tableau, le convertir
          if (tableLines.length > 0) {
            result.push(convertTableToHtml(tableLines));
            tableLines = [];
            inTable = false;
          }
          result.push(line);
        }
      }
      
      // Convertir le dernier tableau s'il y en a un
      if (tableLines.length > 0) {
        result.push(convertTableToHtml(tableLines));
      }
      
      return result.join('\n');
    }
    
    function convertTableToHtml(tableLines) {
      if (tableLines.length === 0) return '';
      
      let html = '<div class="mist-table-wrapper"><table class="mist-table">';
      
      tableLines.forEach((line, index) => {
        const cells = line.split('|').filter(cell => cell !== '');
        const isHeader = index === 0;
        const tag = isHeader ? 'th' : 'td';
        const rowClass = isHeader ? 'mist-table-header' : '';
        
        html += `<tr class="${rowClass}">`;
        cells.forEach(cell => {
          // Nettoyer la cellule et gérer les <br> pour les retours à la ligne
          let cellContent = cell.trim().replace(/&lt;br&gt;/g, '<br>').replace(/<br>/g, '<br>');
          html += `<${tag}>${cellContent}</${tag}>`;
        });
        html += '</tr>';
      });
      
      html += '</table></div>';
      return html;
    }
    
    // Escape HTML d'abord
    let html = escapeHtml(content);
    
    // Parser les tableaux Markdown AVANT les autres transformations
    html = parseMarkdownTables(html);
    
    // Liens Markdown [texte](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="mist-link">$1</a>');
    
    // URLs brutes (http:// ou https://)
    html = html.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" class="mist-link">$1</a>');
    
    // Titres (###### avant ##### avant #### avant ### avant ## avant #)
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    
    // Gras **texte**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italique *texte* ou _texte_
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Code inline `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Listes à puces (- ou *)
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
    
    // Listes numérotées (1. 2. etc)
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    
    // Regrouper les <li> consécutifs dans des <ul>
    html = html.replace(/(<li>.*?<\/li>)(\s*<br>\s*)?(<li>)/g, '$1$3');
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
    
    // Nettoyer les <br> à l'intérieur des <ul>
    html = html.replace(/<ul>\s*<br>\s*/g, '<ul>');
    html = html.replace(/\s*<br>\s*<\/ul>/g, '</ul>');
    
    // Paragraphes : lignes vides deviennent des séparations
    html = html.replace(/\n\n+/g, '</p><p>');
    
    // Retours à la ligne simples
    html = html.replace(/\n/g, '<br>');
    
    // Nettoyer les <br> après les titres et avant/après les listes
    html = html.replace(/<\/h([1-6])><br>/g, '</h$1>');
    html = html.replace(/<br><h([1-6])>/g, '<h$1>');
    html = html.replace(/<\/ul><br>/g, '</ul>');
    html = html.replace(/<br><ul>/g, '<ul>');
    html = html.replace(/<\/p><br>/g, '</p>');
    html = html.replace(/<br><p>/g, '<p>');
    
    // Nettoyer les <br> autour des tableaux
    html = html.replace(/<\/table><\/div><br>/g, '</table></div>');
    html = html.replace(/<br><div class="mist-table-wrapper">/g, '<div class="mist-table-wrapper">');
    
    // Wrapper dans un paragraphe si nécessaire
    if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<p') && !html.startsWith('<div')) {
      html = '<p>' + html + '</p>';
    }
    
    // Nettoyer les paragraphes vides
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p><br><\/p>/g, '');
    
    return html;
  }

  // ─── INITIALISATION ───
  async function init() {
    // Charger les agents au démarrage
    await loadAgents();
    
    // Vérifier la clé API
    const key = await getStoredKey();
    if (key) {
      // Tester si la clé est valide
      try {
        const response = await chrome.runtime.sendMessage({
          type: "testApiKey",
          apiKey: key
        });
        if (response && response.valid) {
          updateStatus("connected");
        } else {
          updateStatus("error");
        }
      } catch (e) {
        // En cas d'erreur de communication, on assume connecté si clé présente
        updateStatus("connected");
      }
      showMainContent();
    } else {
      updateStatus("");
      showOnboarding();
    }
  }

  init();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS API
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function getStoredKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(["mistralApiKey"], (result) => {
      resolve(result.mistralApiKey || "");
    });
  });
}

async function saveApiKey(key) {
  return new Promise(resolve => {
    chrome.storage.local.set({ mistralApiKey: key }, resolve);
  });
}

async function testApiKey(key) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "testApiKey", apiKey: key }, (response) => {
      resolve(response || { valid: false, error: t("chat.noResponse") });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTENER MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getPageContext") {
  const text = getPageText();
  const selection = message.includeSelection ? getSelectionText() : "";
  sendResponse({
    title: document.title,
    url: window.location.href,
    text,
    selection
  });
    return true;
  }

  // Agent de page : récupérer les snapshots
  if (message.type === "getAgentSnapshots") {
    const pageSnapshot = buildPageSnapshot();
    const behaviorSnapshot = buildUserBehaviorSnapshot();
    sendResponse({
      page: pageSnapshot,
      behavior: behaviorSnapshot
    });
    return true;
  }

  // Agent de page : exécuter les actions
  if (message.type === "executeAgentActions") {
    if (message.actions && Array.isArray(message.actions)) {
      executeAgentActions(message.actions);
    }
    sendResponse({ success: true });
    return false;
  }

  // Agent de page : nettoyer les actions
  if (message.type === "cleanupAgentActions") {
    cleanupAgentActions();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "toggleDock") {
    const existing = document.querySelector(".mist-dock");
    if (existing) {
      existing.classList.add("closing");
      setTimeout(() => existing.remove(), 250);
    } else {
bootstrapDock();
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "executeAction") {
    // Action rapide depuis le popup
    sendResponse({ success: true });
    return false;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

function bootstrapDock() {
  injectDockStyles();
  buildDock();
}

// Ne pas ouvrir automatiquement le dock au chargement
// L'utilisateur cliquera sur l'icône de l'extension pour l'ouvrir

} // Fin du bloc if (window.__MISTRAL_ASSISTANT_LOADED__)
