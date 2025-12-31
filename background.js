/* ═══════════════════════════════════════════════════════════════════════════
   FUSION BROWSE ASSISTANT - Background Service Worker
   Avec recherche web et sources
   ═══════════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT_MAX_CHARS = 15000;
const API_BASE_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_API_URL = API_BASE_URL; // Alias pour compatibilité
const DEFAULT_MODEL = "mistral-large-latest"; // Modèle par défaut
const AUTO_WEB_SEARCH = true; // Recherche web automatique si l'info n'est pas dans le contexte

// Fonction pour récupérer le modèle stocké par l'utilisateur
async function getStoredModel() {
  return new Promise(resolve => {
    chrome.storage.local.get(["mistralModel"], (result) => {
      resolve(result.mistralModel || DEFAULT_MODEL);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS SYSTÈME
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT AGENT DE PAGE
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_AGENT_SYSTEM_PROMPT = `Tu es un assistant intelligent intégré dans un navigateur web. Tu analyses les pages web et aides l'utilisateur à naviguer et comprendre le contenu.

RÈGLES STRICTES:
1. Tu réponds UNIQUEMENT en JSON valide, sans aucun texte avant ou après.
2. Tu ne peux utiliser QUE ces 3 types d'actions:
   - HIGHLIGHT: surligne un élément (selector requis)
   - SCROLL_TO: scrolle vers un élément (selector requis)
   - SHOW_TOOLTIP: affiche une bulle d'aide (selector + text requis)
3. Les sélecteurs doivent être des sélecteurs CSS simples et précis.
4. Choisis MAXIMUM 3-4 actions pertinentes, pas plus.
5. L'analyse doit être courte et utile (2-3 phrases max).

FORMAT DE RÉPONSE (JSON STRICT):
{
  "analysis": "Description courte de ce que tu as compris et ce que tu fais",
  "actions": [
    {"type": "HIGHLIGHT", "selector": "selecteur CSS"},
    {"type": "SCROLL_TO", "selector": "selecteur CSS"},
    {"type": "SHOW_TOOLTIP", "selector": "selecteur CSS", "text": "Message à afficher"}
  ]
}

EXEMPLES DE SÉLECTEURS VALIDES:
- "h1" (premier titre)
- "article p:first-of-type" (premier paragraphe d'article)
- "main h2:nth-of-type(2)" (deuxième sous-titre)
- ".content" (élément avec classe content)
- "#main-title" (élément avec id main-title)

COMPORTEMENT:
- Si l'utilisateur a sélectionné du texte, concentre-toi dessus.
- Si l'utilisateur est en bas de page (scroll > 80%), suggère de remonter aux points clés.
- Surligne les informations importantes.
- Utilise les tooltips pour donner des conseils utiles.`;

const SYSTEM_PROMPTS = {
  summary: `Tu es un assistant qui lit le contenu d'une page web et en fait un résumé structuré et clair.
- Utilise des bullet points pour les idées principales
- Ajoute une section "À retenir" avec 3 points clés
- Simplifie le jargon technique si nécessaire`,

  detailed: `Tu es un assistant qui crée des résumés détaillés et structurés de pages web.
- Organise le contenu en sections logiques avec des titres
- Inclus les détails importants
- Termine par une conclusion synthétique`,

  simplify: `Tu es un assistant pédagogue qui vulgarise le contenu pour des débutants.
- Utilise des termes simples et des analogies
- Explique les concepts techniques de manière accessible
- Structure ta réponse de façon progressive`,

  translate: `Tu es un assistant de traduction.
- Traduis le contenu principal dans la langue demandée
- Garde la structure et le sens du texte original
- Signale les termes difficiles à traduire`,

  critique: `Tu es un assistant analytique expert qui effectue des analyses complètes et approfondies en utilisant des recherches web complémentaires.

TON PROCESSUS D'ANALYSE:
1. Analyse approfondie du contenu de la page
2. Recherches web pour enrichir et compléter les informations
3. Croisement des sources pour une vue complète du sujet
4. Synthèse des informations pertinentes

TA RÉPONSE DOIT INCLURE:
- **Résumé du contenu** : Les points essentiels de la page
- **Contexte enrichi** : Informations complémentaires trouvées via les recherches
- **Points clés à retenir** : Les éléments importants à comprendre
- **Informations complémentaires** : Ce que les autres sources ajoutent
- **Pour aller plus loin** : Suggestions et pistes d'approfondissement
- **Sources consultées** : Liste des sources utilisées avec URLs

Important: Cite TOUJOURS tes sources avec les URLs quand tu références des informations externes.`,

  plan: `Tu es un assistant qui génère des plans structurés à partir de contenu.
- Crée un plan avec titres et sous-titres
- Organise les idées de manière logique
- Propose des sections cohérentes`,

  ask: `Tu es un assistant intelligent qui répond aux questions.

PROCESSUS:
1. Cherche d'abord la réponse dans le CONTEXTE DE LA PAGE fourni
2. Si l'information est présente, réponds en citant les passages pertinents
3. Si l'information N'EST PAS dans le contexte, tu peux quand même répondre avec tes connaissances générales
4. Indique clairement la SOURCE de ta réponse (page ou connaissances générales)

IMPORTANT:
- Si tu as besoin d'informations plus récentes ou spécifiques, ajoute "[RECHERCHE_WEB_RECOMMANDÉE]" à la fin de ta réponse
- Sois utile et informatif, ne refuse pas de répondre si tu peux aider`,

  askWithAutoSearch: `Tu es un assistant intelligent qui répond aux questions en utilisant TOUTES les sources disponibles.

SOURCES DISPONIBLES:
1. Le CONTEXTE DE LA PAGE (contenu de la page web actuelle)
2. Les RÉSULTATS DE RECHERCHE WEB (informations complémentaires)
3. Tes CONNAISSANCES GÉNÉRALES

PROCESSUS:
1. Analyse la question de l'utilisateur
2. Cherche la réponse dans le contexte de la page
3. Enrichis avec les résultats de recherche web si fournis
4. Complète avec tes connaissances si nécessaire
5. Synthétise une réponse complète et utile

FORMAT DE RÉPONSE:
- Réponds de manière claire et structurée
- Cite tes sources (page, recherche web, ou connaissances)
- Si tu utilises des résultats web, inclus les URLs pertinentes
- Distingue les infos de la page vs les infos externes`,

  askWithSearch: `Tu es un assistant qui répond aux questions en utilisant le contenu de la page ET des recherches web complémentaires.

PROCESSUS:
1. Analyse la question de l'utilisateur
2. Cherche la réponse dans le contenu de la page
3. Complète avec les résultats de recherche web fournis
4. Synthétise une réponse complète

IMPORTANT:
- Cite TOUJOURS tes sources avec les URLs
- Distingue les infos venant de la page vs des recherches web
- Si les sources se contredisent, signale-le`,

  search: `Tu es un assistant qui suggère des recherches web utiles.
- Propose 5 requêtes de recherche pertinentes
- Chaque requête doit être courte et spécifique
- Présente-les sous forme de liste à puces`,

  extractKeywords: `Extrais 3 à 5 mots-clés ou expressions de recherche pertinents pour vérifier les informations de ce contenu.
Réponds UNIQUEMENT avec les mots-clés séparés par des virgules, sans autre texte.
Exemple: mot-clé 1, mot-clé 2, mot-clé 3`,

  // ═══════════════════════════════════════════════════════════════════════════
  // NOUVELLES FEATURES
  // ═══════════════════════════════════════════════════════════════════════════

  highlightKeyIdeas: `Tu es un assistant expert en analyse de texte.
Ta tâche est d'identifier les éléments clés d'un texte pour les surligner.

IDENTIFIE ET RETOURNE AU FORMAT JSON:
{
  "arguments": ["phrase exacte 1", "phrase exacte 2"],
  "definitions": ["phrase exacte avec définition"],
  "keyNumbers": ["phrase avec chiffre clé"],
  "summaryPhrases": ["phrase résumante importante"]
}

RÈGLES:
- Extrais les PHRASES EXACTES du texte original (pas de paraphrase)
- Maximum 3-4 éléments par catégorie
- Choisis les éléments les plus pertinents et importants
- Les phrases doivent être suffisamment longues pour être identifiées (min 10 mots)
- Réponds UNIQUEMENT avec le JSON, sans autre texte`,

  extractData: `Tu es un assistant expert en extraction et structuration de données.
Ta tâche est d'extraire les données structurées d'une page web.

ANALYSE LE CONTENU ET RETOURNE AU FORMAT JSON:
{
  "tables": [
    {
      "title": "Titre du tableau",
      "headers": ["Col1", "Col2", "Col3"],
      "rows": [["val1", "val2", "val3"], ["val4", "val5", "val6"]]
    }
  ],
  "arguments": [
    {"point": "Argument principal", "details": "Explication"}
  ],
  "steps": [
    {"step": 1, "title": "Titre étape", "description": "Description"}
  ],
  "concepts": [
    {"term": "Concept", "definition": "Définition"}
  ],
  "summary": "Résumé en une phrase du contenu"
}

RÈGLES:
- Extrais TOUTES les données structurées que tu trouves
- Si un type de données n'existe pas, retourne un tableau vide
- Pour les tableaux, préserve la structure originale
- Réponds UNIQUEMENT avec le JSON, sans autre texte`,

  comparePages: `Tu es un assistant expert en analyse comparative.
Ta tâche est de comparer plusieurs pages/contenus et générer un tableau comparatif clair.

GÉNÈRE UNE COMPARAISON STRUCTURÉE:

## 📊 Tableau Comparatif

| Critère | Page 1 | Page 2 | Page 3 |
|---------|--------|--------|--------|
| **Nom/Titre** | ... | ... | ... |
| **Prix** | ... | ... | ... |
| **Avantages** | ... | ... | ... |
| **Inconvénients** | ... | ... | ... |
| **Public cible** | ... | ... | ... |

## ✅ Points forts de chaque option
- **Page 1**: ...
- **Page 2**: ...

## ❌ Points faibles
- **Page 1**: ...
- **Page 2**: ...

## 🏆 Recommandation
[Ton avis sur la meilleure option selon le contexte]

## 📝 Résumé
[Synthèse en 2-3 phrases]`,

  rewriteScientific: `Tu es un rédacteur scientifique expert.
Réécris le texte fourni dans un style scientifique et académique:
- Vocabulaire précis et technique
- Ton neutre et objectif
- Citations de sources si pertinent
- Structure logique (introduction, développement, conclusion)
- Pas d'opinions personnelles, que des faits`,

  rewriteJournalistic: `Tu es un journaliste professionnel.
Réécris le texte fourni dans un style journalistique:
- Accroche percutante
- Pyramide inversée (essentiel en premier)
- Phrases courtes et dynamiques
- Citations et témoignages mis en valeur
- 5W (Who, What, When, Where, Why)`,

  rewriteMarketing: `Tu es un expert en copywriting marketing.
Réécris le texte fourni dans un style marketing persuasif:
- Headline accrocheur
- Bénéfices avant fonctionnalités
- Call-to-action clairs
- Preuve sociale si possible
- Urgence et rareté
- Ton engageant et positif`,

  rewriteUXCopy: `Tu es un expert en UX Writing.
Réécris le texte fourni dans un style UX Copy:
- Phrases ultra-courtes et claires
- Verbes d'action
- Langage simple et accessible
- Guidage utilisateur
- Ton humain et empathique
- Évite le jargon`,

  rewriteSimple: `Tu es un pédagogue expert.
Réécris le texte fourni pour un enfant de 10 ans:
- Mots simples du quotidien
- Phrases courtes (max 15 mots)
- Comparaisons avec des choses familières
- Explique chaque terme technique
- Ton amical et encourageant
- Utilise des exemples concrets`,

  rewriteTwitterThread: `Tu es un expert en communication Twitter/X.
Transforme le texte en thread Twitter viral:
- Premier tweet = hook puissant
- 5-10 tweets maximum
- Chaque tweet = une idée
- Emojis pertinents
- Numérotation (1/, 2/, etc.)
- Dernier tweet = CTA et récap`,

  rewriteLinkedIn: `Tu es un expert en personal branding LinkedIn.
Transforme le texte en post LinkedIn engageant:
- Hook en première ligne (avec line break)
- Storytelling personnel
- Points clés en liste
- Emojis professionnels
- Question finale pour l'engagement
- Hashtags pertinents (3-5)`,

  generateArticlePlan: `Tu es un rédacteur expert.
Génère un plan d'article complet à partir du contenu:

# 📝 Plan d'Article

## Titre proposé
[Titre accrocheur et SEO-friendly]

## Introduction (Hook)
- Accroche
- Problématique
- Promesse de valeur

## Corps de l'article
### Section 1: [Titre]
- Point clé 1
- Point clé 2

### Section 2: [Titre]
- Point clé 1
- Point clé 2

[etc.]

## Conclusion
- Récapitulatif
- Call-to-action
- Ouverture

## Mots-clés SEO suggérés
- mot-clé 1, mot-clé 2...`,

  generateYouTubePlan: `Tu es un créateur YouTube expert.
Génère un plan de vidéo YouTube à partir du contenu:

# 🎬 Plan Vidéo YouTube

## Titre de la vidéo
[Titre optimisé pour le CTR]

## Miniature suggérée
[Description de la miniature idéale]

## Hook (0-30s)
[Accroche pour retenir l'audience]

## Introduction (30s-1min)
[Présentation du sujet]

## Corps de la vidéo
### Chapitre 1: [Titre] (timestamp)
- Point principal
- Exemple/Démonstration

### Chapitre 2: [Titre] (timestamp)
- Point principal
- Exemple/Démonstration

[etc.]

## Conclusion
- Récapitulatif
- Call-to-action (like, sub, comment)

## Description YouTube
[Texte optimisé avec timestamps et liens]

## Tags suggérés
tag1, tag2, tag3...`,

  generateEmailSequence: `Tu es un expert en email marketing.
Génère une séquence d'emails à partir du contenu:

# 📧 Séquence Email

## Email 1: [Sujet] - J+0
**Objet:** [Objet accrocheur]
**Preview text:** [Texte aperçu]

[Corps de l'email]

**CTA:** [Action souhaitée]

---

## Email 2: [Sujet] - J+2
**Objet:** [Objet]
**Preview text:** [Texte]

[Corps]

**CTA:** [Action]

---

## Email 3: [Sujet] - J+5
[etc.]

## Conseils d'envoi
- Meilleur moment
- Segmentation suggérée`,

  generateTutorial: `Tu es un expert en création de tutoriels.
Génère un tutoriel structuré à partir du contenu:

# 📚 Tutoriel Complet

## Objectif
[Ce que l'utilisateur saura faire à la fin]

## Prérequis
- [ ] Prérequis 1
- [ ] Prérequis 2

## Temps estimé
[X minutes]

## Étape 1: [Titre]
### Ce qu'on va faire
[Explication]

### Comment faire
1. Action 1
2. Action 2
3. Action 3

### ⚠️ Points d'attention
- Erreur courante à éviter

### ✅ Résultat attendu
[Ce qu'on doit obtenir]

---

## Étape 2: [Titre]
[Même structure]

---

## Récapitulatif
[Check-list finale]

## Pour aller plus loin
[Ressources complémentaires]`,

  generateContactEmail: `Tu es un expert en communication professionnelle et en rédaction d'emails de prise de contact.
Analyse le contexte de la page (entreprise, personne, produit, service) et génère un email de prise de contact personnalisé.

# ✉️ Email de Prise de Contact

## Analyse du contexte
[Résume ce que tu as compris de la page : entreprise, activité, personne ciblée]

## Email proposé

**À:** [email suggéré si trouvé ou placeholder]
**Objet:** [Objet accrocheur et personnalisé]

---

[Formule d'appel personnalisée],

[Premier paragraphe: accroche personnalisée montrant que tu connais l'interlocuteur/l'entreprise]

[Deuxième paragraphe: raison du contact, proposition de valeur claire]

[Troisième paragraphe: call-to-action clair - proposition de RDV, appel, etc.]

[Formule de politesse adaptée au contexte]

[Signature]

---

## 💡 Conseils pour personnaliser
- Points à mentionner pour renforcer le message
- Éléments à adapter selon votre situation
- Timing suggéré pour l'envoi

## 🔄 Version courte (follow-up)
[Version condensée pour relance]`
};

// ─────────────────────────────────────────────────────────────────────────────
// RECHERCHE WEB
// ─────────────────────────────────────────────────────────────────────────────

async function searchWeb(query, numResults = 5) {
  try {
    // Utiliser DuckDuckGo HTML (pas besoin de clé API)
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      console.error('Erreur recherche DuckDuckGo:', response.status);
      return [];
    }
    
    const html = await response.text();
    
    // Parser les résultats (format simplifié)
    const results = [];
    const regex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;
    
    let match;
    while ((match = regex.exec(html)) !== null && results.length < numResults) {
      const url = decodeURIComponent(match[1].replace('/l/?uddg=', '').split('&')[0]);
      if (url.startsWith('http')) {
        results.push({
          title: match[2].trim(),
          url: url,
          snippet: match[3].trim()
        });
      }
    }
    
    // Méthode alternative si la première ne fonctionne pas
    if (results.length === 0) {
      const altRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null && results.length < numResults) {
        const url = match[1];
        if (url.startsWith('http') && !url.includes('duckduckgo.com')) {
          results.push({
            title: match[2].trim() || 'Résultat',
            url: url,
            snippet: ''
          });
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Erreur lors de la recherche web:', error);
    return [];
  }
}

async function searchBrave(query, numResults = 5) {
  // Alternative avec Brave Search (nécessite une clé API gratuite)
  // L'utilisateur peut ajouter sa clé Brave Search dans les paramètres
  try {
    const braveApiKey = await getBraveApiKey();
    if (!braveApiKey) return [];
    
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`, {
      headers: {
        'X-Subscription-Token': braveApiKey,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description
    }));
  } catch (error) {
    return [];
  }
}

async function getBraveApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["braveApiKey"], (result) => {
      resolve(result.braveApiKey || "");
    });
  });
}

async function performWebSearch(queries) {
  const allResults = [];
  const seenUrls = new Set();
  
  for (const query of queries) {
    const results = await searchWeb(query, 3);
    for (const result of results) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        allResults.push(result);
      }
    }
    // Petit délai entre les recherches
    await new Promise(r => setTimeout(r, 300));
  }
  
  return allResults.slice(0, 8); // Maximum 8 résultats
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉTECTION AUTOMATIQUE DE RECHERCHE WEB
// ─────────────────────────────────────────────────────────────────────────────

async function checkIfNeedsWebSearch(apiKey, question, context) {
  // Types de questions qui nécessitent souvent des recherches web
  const webSearchIndicators = [
    /\b(actualit|news|récent|aujourd'hui|cette semaine|ce mois|2024|2025)\b/i,
    /\b(prix|coût|tarif|combien|compare|meilleur|top|ranking)\b/i,
    /\b(où trouver|comment acheter|où acheter|disponible)\b/i,
    /\b(avis|review|test|comparatif)\b/i,
    /\b(météo|bourse|crypto|bitcoin)\b/i,
    /\b(officiel|site|contact|adresse|téléphone)\b/i,
    /\b(what is|who is|when did|where is|how to)\b/i,
    /\b(définition|signification|c'est quoi)\b/i
  ];
  
  // Vérifier si la question contient des indicateurs
  const hasIndicators = webSearchIndicators.some(regex => regex.test(question));
  
  // Vérifier si le contexte de la page semble suffisant
  const contextLength = (context.text || "").length;
  const hasRelevantContext = contextLength > 500;
  
  // Si la question a des indicateurs de recherche web et peu de contexte
  if (hasIndicators && !hasRelevantContext) {
    return true;
  }
  
  // Pour les questions génériques sans contexte riche
  if (contextLength < 200 && question.length > 20) {
    return true;
  }
  
  // Vérifier si la question porte sur quelque chose qui n'est probablement pas dans la page
  const questionLower = question.toLowerCase();
  const titleLower = (context.title || "").toLowerCase();
  const textSample = (context.text || "").toLowerCase().slice(0, 3000);
  
  // Extraire les mots-clés importants de la question
  const questionKeywords = question
    .toLowerCase()
    .replace(/[^\w\sàâäéèêëïîôùûüç-]/g, "")
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  // Si moins de 30% des mots-clés sont dans le contexte, recherche web recommandée
  const keywordsInContext = questionKeywords.filter(kw => 
    textSample.includes(kw) || titleLower.includes(kw)
  );
  
  if (questionKeywords.length > 0) {
    const relevanceScore = keywordsInContext.length / questionKeywords.length;
    if (relevanceScore < 0.3) {
      return true;
    }
  }
  
  return false;
}

async function generateSearchQuery(apiKey, question, pageTitle) {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "mistral-small-latest", // Modèle rapide pour cette tâche simple
        messages: [
          { 
            role: "system", 
            content: "Tu génères des requêtes de recherche web optimales. Réponds UNIQUEMENT avec la requête de recherche, sans autre texte. La requête doit être courte (3-6 mots) et pertinente." 
          },
          { 
            role: "user", 
            content: `Question de l'utilisateur: "${question}"\nContexte (titre de la page): "${pageTitle}"\n\nGénère une requête de recherche Google optimale pour répondre à cette question.` 
          }
        ],
        temperature: 0.1,
        max_tokens: 50
      })
    });
    
    if (!response.ok) return question; // Fallback sur la question originale
    
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || question;
  } catch (error) {
    return question;
  }
}

async function extractKeywordsFromContent(apiKey, content, title) {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPTS.extractKeywords },
          { role: "user", content: `Titre: ${title}\n\nContenu (extrait): ${content.slice(0, 2000)}` }
        ],
        temperature: 0.2,
        max_tokens: 100
      })
    });
    
    if (!response.ok) return [title];
    
    const data = await response.json();
    const keywords = data?.choices?.[0]?.message?.content || title;
    return keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
  } catch (error) {
    return [title];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MENU CONTEXTUEL
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
  chrome.contextMenus.create({
      id: "mistral-explain",
      title: "🔍 Expliquer avec Mistral",
    contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "mistral-summarize",
      title: "📝 Résumer avec Mistral",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "mistral-translate",
      title: "🌍 Traduire avec Mistral",
      contexts: ["selection"]
    });
    
    chrome.contextMenus.create({
      id: "mistral-search-analyze",
      title: "🔬 Analyser avec recherche web",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !info.selectionText) return;

    const apiKey = await getStoredApiKey();
    if (!apiKey) {
    notifyUser("⚠️ Ajoutez votre clé Mistral dans l'extension.");
      return;
    }

  let question = "";
  let mode = "ask";
  let withSearch = false;

  switch (info.menuItemId) {
    case "mistral-explain":
      question = `Explique clairement ce passage : "${info.selectionText}"`;
      break;
    case "mistral-summarize":
      question = `Résume ce passage en quelques points : "${info.selectionText}"`;
      mode = "summary";
      break;
    case "mistral-translate":
      question = `Traduis ce passage en français : "${info.selectionText}"`;
      mode = "translate";
      break;
    case "mistral-search-analyze":
      mode = "critique";
      withSearch = true;
      break;
  }

  try {
    let searchResults = [];
    if (withSearch) {
      notifyUser("🔍 Recherche en cours...");
      const keywords = await extractKeywordsFromContent(apiKey, info.selectionText, tab.title);
      searchResults = await performWebSearch(keywords);
    }
    
    const result = await runMistralCall({
      apiKey,
      mode,
      context: {
        title: tab.title || "Page",
        url: tab.url || "",
        text: info.selectionText,
        selection: info.selectionText
      },
      userQuestion: question,
      searchResults
    });

    notifyUser(result ? result.slice(0, 200) + "..." : "Pas de réponse.");
  } catch (error) {
    notifyUser(`❌ Erreur : ${error.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getPageContext") {
    if (!sender.tab?.id) {
      sendResponse(null);
      return true;
    }
    chrome.tabs.sendMessage(
      sender.tab.id, 
      { type: "getPageContext", includeSelection: message.includeSelection }, 
      sendResponse
    );
    return true;
  }

  // Agent de page
  if (message.type === "runPageAgent") {
    handlePageAgent(message, sender, sendResponse);
    return true;
  }

  // Chat avec un agent personnalisé
  if (message.type === "askAgent") {
    handleAgentChat(message, sender, sendResponse);
    return true;
  }

  // Récupérer la liste des onglets ouverts
  if (message.type === "getOpenTabs") {
    chrome.tabs.query({}, (tabs) => {
      const filteredTabs = tabs
        .filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://'))
        .map(tab => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          active: tab.active
        }));
      sendResponse({ tabs: filteredTabs });
    });
    return true;
  }

  // Comparer des pages (avec tabIds spécifiques)
  if (message.type === "comparePages" && message.tabIds) {
    handleComparePages(message.tabIds, sendResponse);
    return true;
  }

  // Chat avec document intégré
  if (message.type === "integrationChat") {
    handleIntegrationChat(message, sendResponse);
    return true;
  }

  // Actions YouTube
  if (message.type === "youtubeAction") {
    handleYouTubeAction(message, sendResponse);
    return true;
  }

  // Extraire le contenu d'un document Google
  if (message.type === "extractGoogleDocContent") {
    handleExtractGoogleDoc(message, sendResponse);
    return true;
  }

  // Actions principales (avec ou sans recherche)
  const actionTypes = [
    "summarizePage", "askQuestion", "suggestSearches", "detailedSummary", "simplify", 
    "translate", "critique", "plan", "analyzeWithSearch", "askWithSearch",
    // Nouvelles actions
    "highlightKeyIdeas", "extractData", "comparePages",
    "rewriteScientific", "rewriteJournalistic", "rewriteMarketing", "rewriteUXCopy",
    "rewriteTwitterThread", "rewriteLinkedIn",
    "generateArticlePlan", "generateYouTubePlan", "generateEmailSequence", "generateTutorial",
    "generateContactEmail"
  ];
  if (actionTypes.includes(message.type)) {
    handleActionMessage(message, sender, sendResponse);
    return true;
  }

  if (message.type === "testApiKey") {
    handleTestKey(message.apiKey).then(sendResponse);
    return true;
  }

  if (message.type === "getStoredKey") {
    getStoredApiKey().then((apiKey) => sendResponse({ apiKey }));
    return true;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL DES ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function handleActionMessage(message, sender, sendResponse) {
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      sendResponse({ error: "Ajoutez votre clé Mistral dans l'extension." });
      return;
    }

    const tabId = sender.tab?.id || (await getActiveTabId());
    if (!tabId) {
      sendResponse({ error: "Impossible de trouver l'onglet actif." });
      return;
    }

    chrome.tabs.sendMessage(tabId, { type: "getPageContext", includeSelection: true }, async (contextResponse) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: "Impossible de communiquer avec la page. Rechargez-la et réessayez." });
        return;
      }

      if (!contextResponse) {
        sendResponse({ error: "Contexte de page introuvable." });
        return;
      }

      const includeContext = message.includeContext !== false;
      const preparedContext = includeContext
        ? contextResponse
        : { ...contextResponse, text: "", selection: "" };

      try {
        let mode = mapMessageTypeToMode(message.type);
        let searchResults = [];
        
        // Actions avec recherche web explicite
        const explicitSearch = message.type === "analyzeWithSearch" || 
                               message.type === "askWithSearch" || 
                               message.type === "critique" ||
                               message.withSearch === true;
        
        // Recherche web automatique pour le chat (askQuestion)
        const isChat = message.type === "askQuestion";
        const autoSearchEnabled = AUTO_WEB_SEARCH && isChat && message.question;
        
        if (explicitSearch) {
          // Recherche explicite demandée
          const keywords = await extractKeywordsFromContent(
            apiKey, 
            preparedContext.text || preparedContext.selection, 
            preparedContext.title
          );
          const searchQueries = [...new Set([...keywords, preparedContext.title])].slice(0, 4);
          searchResults = await performWebSearch(searchQueries);
        } else if (autoSearchEnabled) {
          // Recherche automatique intelligente pour le chat
          // On analyse si la question nécessite des infos externes
          const needsWebSearch = await checkIfNeedsWebSearch(
            apiKey,
            message.question,
            preparedContext
          );
          
          if (needsWebSearch) {
            // Extraire les mots-clés de la question + contexte
            const searchQuery = await generateSearchQuery(apiKey, message.question, preparedContext.title);
            searchResults = await performWebSearch([searchQuery, message.question].slice(0, 2));
            mode = "askWithAutoSearch"; // Utiliser le mode enrichi
          }
        }
        
        const result = await runMistralCall({
          apiKey,
          mode,
          context: preparedContext,
          userQuestion: message.question || "",
          searchResults
        });

        // Vérifier si la réponse suggère une recherche web (fallback)
        if (result && result.includes("[RECHERCHE_WEB_RECOMMANDÉE]") && searchResults.length === 0) {
          // Faire une recherche web automatique
          const searchQuery = await generateSearchQuery(apiKey, message.question, preparedContext.title);
          searchResults = await performWebSearch([searchQuery, message.question].slice(0, 2));
          
          // Relancer avec les résultats de recherche
          const enrichedResult = await runMistralCall({
            apiKey,
            mode: "askWithAutoSearch",
            context: preparedContext,
            userQuestion: message.question || "",
            searchResults
          });
          
          sendResponse({ 
            result: enrichedResult.replace("[RECHERCHE_WEB_RECOMMANDÉE]", ""), 
            sources: searchResults,
            autoSearched: true
          });
          return;
        }

        sendResponse({ 
          result: result.replace("[RECHERCHE_WEB_RECOMMANDÉE]", ""), 
          sources: searchResults,
          autoSearched: searchResults.length > 0 && !explicitSearch
        });
      } catch (error) {
        sendResponse({ error: error.message || "Erreur lors de l'appel API." });
      }
    });
  } catch (error) {
    sendResponse({ error: error.message || "Erreur inattendue." });
  }
}

function mapMessageTypeToMode(type) {
  const mapping = {
    summarizePage: "summary",
    detailedSummary: "detailed",
    simplify: "simplify",
    translate: "translate",
    critique: "critique",
    analyzeWithSearch: "critique",
    plan: "plan",
    askQuestion: "ask",
    askWithSearch: "askWithSearch",
    askWithAutoSearch: "askWithAutoSearch",
    suggestSearches: "search",
    // Nouvelles actions
    highlightKeyIdeas: "highlightKeyIdeas",
    extractData: "extractData",
    comparePages: "comparePages",
    rewriteScientific: "rewriteScientific",
    rewriteJournalistic: "rewriteJournalistic",
    rewriteMarketing: "rewriteMarketing",
    rewriteUXCopy: "rewriteUXCopy",
    rewriteTwitterThread: "rewriteTwitterThread",
    rewriteLinkedIn: "rewriteLinkedIn",
    generateArticlePlan: "generateArticlePlan",
    generateYouTubePlan: "generateYouTubePlan",
    generateEmailSequence: "generateEmailSequence",
    generateTutorial: "generateTutorial",
    generateContactEmail: "generateContactEmail"
  };
  return mapping[type] || "ask";
}

// ─────────────────────────────────────────────────────────────────────────────
// APPEL API MISTRAL
// ─────────────────────────────────────────────────────────────────────────────

async function runMistralCall({ apiKey, mode, context, userQuestion, searchResults = [], agentId = null }) {
  const language = await getStoredLanguage();
  const langInstruction = getLanguageInstruction(language);
  const basePrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.ask;
  const systemPrompt = `${langInstruction}\n\n${basePrompt}`;
  const userPrompt = buildUserPrompt(mode, context, userQuestion, searchResults);
  
  // Utiliser le modèle stocké ou l'agent spécifié
  const userModel = await getStoredModel();

  const payload = {
    model: agentId || userModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 3000
  };

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.error?.message || errorData?.message || `Erreur HTTP ${response.status}`;
      
      if (response.status === 401) {
        throw new Error("Clé API invalide ou expirée.");
      } else if (response.status === 429) {
        throw new Error("Trop de requêtes. Attendez un moment.");
      } else if (response.status === 402) {
        throw new Error("Crédit API insuffisant.");
      } else {
        throw new Error(errorMessage);
      }
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "Réponse vide de l'API.";
  } catch (error) {
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      throw new Error("Impossible de contacter l'API Mistral.");
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION DES PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

function buildUserPrompt(mode, context, userQuestion, searchResults = []) {
  const truncatedContext = truncateText(context.text, CONTEXT_MAX_CHARS);
  const selectionBlock = context.selection 
    ? `\n\n📌 EXTRAIT SÉLECTIONNÉ:\n"${context.selection}"`
    : "";
  
  const baseMeta = `📄 PAGE ANALYSÉE: ${context.title || "(Titre inconnu)"}\n🔗 URL: ${context.url || "(URL inconnue)"}`;
  
  // Formater les résultats de recherche
  let searchBlock = "";
  if (searchResults && searchResults.length > 0) {
    searchBlock = "\n\n🔍 RÉSULTATS DE RECHERCHE WEB:\n";
    searchResults.forEach((result, index) => {
      searchBlock += `\n**Source ${index + 1}:** ${result.title}\n`;
      searchBlock += `URL: ${result.url}\n`;
      if (result.snippet) {
        searchBlock += `Extrait: ${result.snippet}\n`;
      }
    });
  }

  switch (mode) {
    case "summary":
      return `${baseMeta}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nFais un résumé en 5 bullet points maximum, puis ajoute une section "À retenir" avec 3 points clés.`;

    case "detailed":
      return `${baseMeta}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nFais un résumé détaillé et structuré avec des sections claires.`;

    case "simplify":
      return `${baseMeta}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nVulgarise ce contenu pour un débutant. Utilise des termes simples et des exemples.`;

    case "translate":
      return `${baseMeta}${selectionBlock}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nTraduis le contenu principal en français.`;

    case "critique":
      return `${baseMeta}${searchBlock}\n\n📖 CONTENU DE LA PAGE:\n${truncatedContext}\n\n📋 TÂCHE:\nFais une analyse complète et approfondie de ce contenu en utilisant les sources de recherche fournies.\n\n1. Résume les points essentiels\n2. Enrichis avec les informations des recherches web\n3. Synthétise une vue complète du sujet\n4. Propose des pistes pour approfondir\n5. CITE TES SOURCES avec les URLs`;

    case "plan":
      return `${baseMeta}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nGénère un plan structuré (titres, sous-titres, points clés) à partir de ce contenu.`;

    case "search":
      return `${baseMeta}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nPropose 5 requêtes de recherche pertinentes pour approfondir ce sujet.`;

    case "askWithSearch":
      return `${baseMeta}${selectionBlock}${searchBlock}\n\n📖 CONTEXTE PAGE:\n${truncatedContext}\n\n❓ QUESTION:\n${userQuestion || "(Aucune question)"}\n\n📋 TÂCHE:\nRéponds à la question en utilisant le contenu de la page ET les résultats de recherche. CITE TES SOURCES.`;

    case "askWithAutoSearch":
      return `${baseMeta}${selectionBlock}${searchBlock}\n\n📖 CONTEXTE PAGE:\n${truncatedContext}\n\n❓ QUESTION:\n${userQuestion || "(Aucune question)"}\n\n📋 TÂCHE:\nRéponds à la question en utilisant TOUTES les sources disponibles:\n1. Le contexte de la page web\n2. Les résultats de recherche web (si fournis)\n3. Tes connaissances générales\n\nStructure ta réponse clairement et CITE TES SOURCES avec les URLs quand tu utilises des informations des recherches web.`;

    // ═══════════════════════════════════════════════════════════════════════
    // NOUVELLES FEATURES
    // ═══════════════════════════════════════════════════════════════════════

    case "highlightKeyIdeas":
      return `📖 CONTENU À ANALYSER:\n${truncatedContext}\n\n📋 TÂCHE:\nIdentifie et extrais les éléments clés (arguments, définitions, chiffres, phrases résumantes) au format JSON demandé.`;

    case "extractData":
      return `${baseMeta}\n\n📖 CONTENU:\n${truncatedContext}\n\n📋 TÂCHE:\nExtrais toutes les données structurées (tableaux, arguments, étapes, concepts) au format JSON demandé.`;

    case "comparePages":
      return `📋 TÂCHE: Compare ces contenus et génère un tableau comparatif détaillé.\n\n${userQuestion || truncatedContext}`;

    case "rewriteScientific":
    case "rewriteJournalistic":
    case "rewriteMarketing":
    case "rewriteUXCopy":
    case "rewriteSimple":
    case "rewriteTwitterThread":
    case "rewriteLinkedIn":
      const textToRewrite = context.selection || truncatedContext;
      return `📖 TEXTE À RÉÉCRIRE:\n${textToRewrite}\n\n📋 TÂCHE:\nRéécris ce texte dans le style demandé.`;

    case "generateArticlePlan":
    case "generateYouTubePlan":
    case "generateEmailSequence":
    case "generateTutorial":
      return `${baseMeta}\n\n📖 CONTENU SOURCE:\n${truncatedContext}\n\n📋 TÂCHE:\nGénère le plan/contenu structuré demandé à partir de ces informations.`;

    case "generateContactEmail":
      return `${baseMeta}\n\n📖 CONTEXTE DE LA PAGE:\n${truncatedContext}\n\n📋 TÂCHE:\nAnalyse cette page pour comprendre l'entreprise/personne ciblée et génère un email de prise de contact professionnel et personnalisé.`;

    case "ask":
    default:
      return `${baseMeta}${selectionBlock}\n\n📖 CONTEXTE PAGE:\n${truncatedContext}\n\n❓ QUESTION:\n${userQuestion || "(Aucune question)"}\n\n📋 TÂCHE:\nRéponds sur la base des informations présentes.`;
  }
}

function truncateText(text, maxChars) {
  if (!text) return "(Aucun contenu textuel détecté)";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}...\n\n[⚠️ Texte tronqué - ${clean.length} caractères au total]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST DE CLÉ API
// ─────────────────────────────────────────────────────────────────────────────

async function handleTestKey(apiKey) {
  if (!apiKey) {
    return { valid: false, error: "Clé manquante" };
  }

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "user", content: "Réponds uniquement 'OK'." }
        ],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 401) {
        return { valid: false, error: "Clé API invalide" };
      } else if (response.status === 402) {
        return { valid: false, error: "Crédit insuffisant" };
      } else if (response.status === 429) {
        return { valid: false, error: "Trop de requêtes" };
      }
      
      return { valid: false, error: errorData?.error?.message || `Erreur ${response.status}` };
    }

    const data = await response.json();
    return { valid: true, response: data?.choices?.[0]?.message?.content || "" };
  } catch (error) {
    return { valid: false, error: error.message || "Erreur de connexion" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

function notifyUser(message) {
  chrome.notifications?.create({
    type: "basic",
    iconUrl: "icon48.png",
    title: "Fusion Browse Assistant",
    message: message.slice(0, 200)
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["mistralApiKey"], (result) => {
      resolve(result.mistralApiKey || "");
    });
  });
}

async function getStoredLanguage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["mistralLanguage"], (result) => {
      // Default to English if no language is set
      resolve(result.mistralLanguage || "en");
    });
  });
}

function getLanguageInstruction(langCode) {
  const languages = {
    fr: "IMPORTANT: Tu DOIS répondre UNIQUEMENT en FRANÇAIS. Toutes tes réponses doivent être en français.",
    en: "IMPORTANT: You MUST respond ONLY in ENGLISH. All your responses must be in English.",
    de: "WICHTIG: Du MUSST NUR auf DEUTSCH antworten. Alle deine Antworten müssen auf Deutsch sein.",
    es: "IMPORTANTE: DEBES responder ÚNICAMENTE en ESPAÑOL. Todas tus respuestas deben ser en español."
  };
  return languages[langCode] || languages.fr;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DE PAGE
// ─────────────────────────────────────────────────────────────────────────────

async function handlePageAgent(message, sender, sendResponse) {
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      sendResponse({ 
        error: "Configure ta clé Mistral pour activer l'agent de page (⚙️ en haut à droite)." 
      });
      return;
    }

    const tabId = sender.tab?.id || (await getActiveTabId());
    if (!tabId) {
      sendResponse({ error: "Impossible de trouver l'onglet actif." });
      return;
    }

    // Récupérer les snapshots depuis le content script
    chrome.tabs.sendMessage(tabId, { type: "getAgentSnapshots" }, async (snapshots) => {
      if (chrome.runtime.lastError || !snapshots) {
        sendResponse({ error: "Impossible de communiquer avec la page. Rechargez-la." });
        return;
      }

      try {
        // Appeler Mistral avec les snapshots
        const result = await runPageAgentCall(apiKey, snapshots);
        
        if (result.error) {
          sendResponse({ error: result.error });
          return;
        }

        // Envoyer les actions au content script pour exécution
        if (result.actions && result.actions.length > 0) {
          chrome.tabs.sendMessage(tabId, {
            type: "executeAgentActions",
            actions: result.actions
          });
        }

        // Renvoyer l'analyse et les actions à l'UI
        sendResponse({
          analysis: result.analysis || "Analyse effectuée.",
          actions: result.actions || [],
          success: true
        });

      } catch (error) {
        sendResponse({ error: error.message || "Erreur lors de l'analyse." });
      }
    });

  } catch (error) {
    sendResponse({ error: error.message || "Erreur inattendue." });
  }
}

async function runPageAgentCall(apiKey, snapshots) {
  const language = await getStoredLanguage();
  const langInstruction = getLanguageInstruction(language);
  const userModel = await getStoredModel();
  
  // Construire le prompt utilisateur avec les snapshots
  const userPrompt = buildPageAgentPrompt(snapshots);

  const payload = {
    model: userModel,
    messages: [
      { 
        role: "system", 
        content: `${langInstruction}\n\n${PAGE_AGENT_SYSTEM_PROMPT}` 
      },
      { 
        role: "user", 
        content: userPrompt 
      }
    ],
    temperature: 0.2,
    max_tokens: 1000
  };

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        return { error: "Clé API invalide." };
      } else if (response.status === 429) {
        return { error: "Trop de requêtes. Attendez un moment." };
      }
      return { error: errorData?.error?.message || `Erreur ${response.status}` };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";

    // Parser le JSON de la réponse
    return parseAgentResponse(content);

  } catch (error) {
    return { error: error.message || "Erreur de connexion" };
  }
}

function buildPageAgentPrompt(snapshots) {
  const { page, behavior } = snapshots;
  
  let prompt = `SNAPSHOT DE LA PAGE:
- Titre: ${page.title}
- URL: ${page.url}
- Description: ${page.metaDescription || "(aucune)"}
- Éléments: ${page.interactiveElements.links} liens, ${page.interactiveElements.buttons} boutons, ${page.interactiveElements.images} images

TITRES DE LA PAGE:
${page.headings.map(h => `- [${h.level}] ${h.text}`).join('\n') || "(aucun titre)"}

EXTRAIT DU CONTENU:
${page.textSample.slice(0, 1500)}...

COMPORTEMENT UTILISATEUR:
- Scroll: ${behavior.scrollPercent}% de la page
- Sélection: ${behavior.selection ? `"${behavior.selection.slice(0, 200)}"` : "(aucune sélection)"}
- Zone visible: ${behavior.visibleContext.slice(0, 150)}

TÂCHE:
Analyse cette page et aide l'utilisateur. Réponds UNIQUEMENT en JSON avec le format spécifié.`;

  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARAISON DE PAGES MULTI-ONGLETS
// ─────────────────────────────────────────────────────────────────────────────

async function handleComparePages(tabIds, sendResponse) {
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      sendResponse({ error: "Configure ta clé Mistral pour comparer les pages." });
      return;
    }

    // Récupérer le contenu de chaque onglet
    const pagesContent = [];
    
    for (const tabId of tabIds) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { 
          type: "getPageContext", 
          includeSelection: false 
        });
        
        if (response) {
          pagesContent.push({
            title: response.title || "Sans titre",
            url: response.url || "",
            text: response.text?.slice(0, 3000) || "" // Limiter le texte
          });
        }
      } catch (e) {
        // Ignorer les onglets qui ne répondent pas
        console.log(`Tab ${tabId} ne répond pas:`, e.message);
      }
    }

    if (pagesContent.length < 2) {
      sendResponse({ error: "Impossible de récupérer le contenu d'au moins 2 pages. Assurez-vous que les pages sont chargées." });
      return;
    }

    // Construire le prompt pour la comparaison
    const language = await getStoredLanguage();
    const langInstruction = getLanguageInstruction(language);
    
    let pagesPrompt = "";
    pagesContent.forEach((page, idx) => {
      pagesPrompt += `\n\n--- PAGE ${idx + 1} ---\n`;
      pagesPrompt += `📄 Titre: ${page.title}\n`;
      pagesPrompt += `🔗 URL: ${page.url}\n`;
      pagesPrompt += `📖 Contenu:\n${page.text}\n`;
    });

    const systemPrompt = `${langInstruction}\n\n${SYSTEM_PROMPTS.comparePages}`;
    const userPrompt = `Compare ces ${pagesContent.length} pages et génère un tableau comparatif détaillé:\n${pagesPrompt}`;
    const userModel = await getStoredModel();

    const payload = {
      model: userModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 3000
    };

    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      sendResponse({ error: errorData?.error?.message || `Erreur ${response.status}` });
      return;
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content || "Pas de résultat.";
    
    sendResponse({ result });

  } catch (error) {
    sendResponse({ error: error.message || "Erreur lors de la comparaison." });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT AVEC AGENTS PERSONNALISÉS
// ─────────────────────────────────────────────────────────────────────────────

async function handleAgentChat(message, sender, sendResponse) {
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      sendResponse({ error: "Configure ta clé Mistral pour utiliser les agents." });
      return;
    }

    const { agentId, question, history = [] } = message;
    
    if (!agentId) {
      sendResponse({ error: "Aucun agent sélectionné." });
      return;
    }

    const language = await getStoredLanguage();
    const langInstruction = getLanguageInstruction(language);

    // Construire les messages avec l'historique
    const messages = [];
    
    // Ajouter l'historique de conversation
    history.forEach(msg => {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content
      });
    });

    // Ajouter la nouvelle question
    messages.push({
      role: "user",
      content: question
    });

    const payload = {
      agent_id: agentId,
      messages: messages
    };

    const response = await fetch("https://api.mistral.ai/v1/agents/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        sendResponse({ error: "Clé API invalide." });
      } else if (response.status === 404) {
        sendResponse({ error: "Agent non trouvé. Vérifiez l'ID de l'agent." });
      } else if (response.status === 429) {
        sendResponse({ error: "Trop de requêtes. Attendez un moment." });
      } else {
        sendResponse({ error: errorData?.error?.message || `Erreur ${response.status}` });
      }
      return;
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content || "Pas de réponse.";
    
    sendResponse({ result });

  } catch (error) {
    sendResponse({ error: error.message || "Erreur lors de la communication avec l'agent." });
  }
}

function parseAgentResponse(content) {
  try {
    // Nettoyer le contenu (au cas où il y aurait du texte autour)
    let jsonStr = content.trim();
    
    // Chercher le JSON dans la réponse
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    // Valider la structure
    if (typeof parsed !== 'object') {
      throw new Error("Réponse invalide");
    }

    // Valider les actions
    let actions = [];
    if (Array.isArray(parsed.actions)) {
      actions = parsed.actions.filter(action => {
        // Vérifier que l'action est valide
        if (!action.type || !action.selector) return false;
        if (!['HIGHLIGHT', 'SCROLL_TO', 'SHOW_TOOLTIP'].includes(action.type)) return false;
        if (action.type === 'SHOW_TOOLTIP' && !action.text) return false;
        return true;
      }).slice(0, 5); // Maximum 5 actions
    }

    return {
      analysis: parsed.analysis || "Analyse effectuée.",
      actions
    };

  } catch (error) {
    console.error("[Agent] Erreur parsing JSON:", error, content);
    return { 
      error: "La réponse de l'IA n'a pas pu être comprise. Réessayez.",
      analysis: null,
      actions: []
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTÉGRATION DOCUMENTS - Google Docs/Sheets/Slides
// ─────────────────────────────────────────────────────────────────────────────

async function handleIntegrationChat(message, sendResponse) {
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      sendResponse({ error: "Configure ta clé Mistral pour utiliser les intégrations." });
      return;
    }

    const { docInfo, question, history = [] } = message;
    
    if (!docInfo) {
      sendResponse({ error: "Aucun document sélectionné." });
      return;
    }

    const language = await getStoredLanguage();
    const langInstruction = getLanguageInstruction(language);

    // Construire le contexte du document
    const docContext = `
Document: ${docInfo.title}
Type: ${docInfo.type}
URL: ${docInfo.url}
${docInfo.content ? `\nContenu:\n${docInfo.content.slice(0, 15000)}` : ''}
`;

    // Vérifier si on a du vrai contenu
    const hasRealContent = docInfo.content && 
                           docInfo.content.length > 100 && 
                           !docInfo.content.includes("Document accessible via:");
    
    // Prompt système pour l'assistant d'intégration
    let systemPrompt = "";
    
    if (hasRealContent) {
      systemPrompt = `Tu es un assistant spécialisé dans l'analyse et la modification de documents Google (Docs, Sheets, Slides).
${langInstruction}

Tu as accès au contenu complet du document suivant:
${docContext}

Tes capacités:
- Analyser en détail le contenu et la structure du document
- Résumer les points clés avec précision
- Proposer des améliorations de rédaction, mise en forme, structure
- Répondre aux questions sur le contenu
- Suggérer des modifications avec des instructions claires
- Créer des résumés, extraire des données, identifier les thèmes principaux

Pour les modifications, fournis des instructions précises que l'utilisateur pourra appliquer dans le document.
Format tes réponses avec du Markdown pour une meilleure lisibilité.`;
    } else {
      systemPrompt = `Tu es un assistant spécialisé dans l'analyse de documents Google.
${langInstruction}

L'utilisateur a partagé un lien vers un document: ${docInfo.url}

IMPORTANT: Tu n'as PAS accès au contenu de ce document car:
1. Le document nécessite des permissions d'accès
2. OU le document n'est pas ouvert dans un onglet du navigateur

Indique à l'utilisateur qu'il doit:
1. **Ouvrir le document** dans un onglet du navigateur
2. S'assurer que le document est **partagé** (mode lecture au minimum)
3. **Réessayer** l'analyse une fois le document ouvert

Tu peux tout de même:
- Donner des conseils généraux sur l'utilisation de ${docInfo.type}
- Proposer une structure type pour ce genre de document
- Répondre à des questions générales

Sois honnête sur tes limitations et guide l'utilisateur vers la solution.`;
    }
    
    // Si pas de vrai contenu et première question, donner des instructions
    if (!hasRealContent && history.length === 0) {
      const helpMessage = `📋 **Document**: ${docInfo.title}
🔗 **Type**: ${docInfo.type}

⚠️ **Je n'ai pas encore accès au contenu de ce document.**

Pour que je puisse l'analyser en détail:

1. **Ouvre le document** en cliquant sur le lien 🔗 ci-dessus
2. **Reviens ici** et pose ta question à nouveau

Une fois le document ouvert dans ton navigateur, je pourrai:
- 📝 Résumer le contenu
- 🔍 Analyser la structure
- 💡 Proposer des améliorations
- ❓ Répondre à tes questions

---

En attendant, comment puis-je t'aider ?`;
      
      sendResponse({ response: helpMessage });
      return;
    }

    // Construire les messages
    const messages = [
      { role: "system", content: systemPrompt }
    ];
    
    // Ajouter l'historique
    history.forEach(msg => {
      if (msg.role && msg.content) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content
        });
      }
    });

    // Ajouter la question
    messages.push({ role: "user", content: question });
    
    const userModel = await getStoredModel();

    const payload = {
      model: userModel,
      messages,
      max_tokens: 4000,
      temperature: 0.7
    };

    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      sendResponse({ error: errorData?.error?.message || `Erreur ${response.status}` });
      return;
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content || "Pas de réponse.";
    
    sendResponse({ result });

  } catch (error) {
    sendResponse({ error: error.message || "Erreur lors de l'analyse du document." });
  }
}

async function handleExtractGoogleDoc(message, sendResponse) {
  try {
    const { docId, docType, url } = message;
    
    // Essayer de trouver un onglet avec ce document déjà ouvert
    const tabs = await chrome.tabs.query({});
    const existingTab = tabs.find(tab => tab.url && tab.url.includes(docId));
    
    if (existingTab) {
      // Document déjà ouvert - extraire le contenu
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: existingTab.id },
          func: extractGoogleDocContentFromPage,
          args: [docType]
        });
        
        if (results && results[0] && results[0].result) {
          const { title, content } = results[0].result;
          sendResponse({
            success: true,
            title: title || `Document (${docId.slice(0, 8)}...)`,
            content: content || "Contenu extrait avec succès."
          });
          return;
        }
      } catch (scriptError) {
        console.log("Script extraction failed:", scriptError);
      }
    }
    
    // Pas d'onglet trouvé ou extraction échouée - ouvrir le document
    const newTab = await chrome.tabs.create({ url, active: false });
    
    // Attendre que la page charge
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: newTab.id },
        func: extractGoogleDocContentFromPage,
        args: [docType]
      });
      
      // Fermer l'onglet temporaire
      await chrome.tabs.remove(newTab.id);
      
      if (results && results[0] && results[0].result) {
        const { title, content } = results[0].result;
        sendResponse({
          success: true,
          title: title || `Document (${docId.slice(0, 8)}...)`,
          content: content || "Contenu extrait."
        });
        return;
      }
    } catch (scriptError) {
      // Fermer l'onglet si erreur
      try { await chrome.tabs.remove(newTab.id); } catch {}
      console.log("Extraction error:", scriptError);
    }
    
    // Fallback
    let typeLabel = "Document Google";
    switch (docType) {
      case "docs": typeLabel = "Google Docs"; break;
      case "sheets": typeLabel = "Google Sheets"; break;
      case "slides": typeLabel = "Google Slides"; break;
      case "drive": typeLabel = "Google Drive"; break;
    }
    
    sendResponse({
      success: true,
      title: `${typeLabel} (${docId.slice(0, 8)}...)`,
      content: `Document accessible via: ${url}\n\n⚠️ Pour analyser ce document en détail, veuillez l'ouvrir dans un onglet, puis réessayez.\n\nJe peux vous aider à:\n- Comprendre le contenu une fois ouvert\n- Suggérer des améliorations\n- Proposer des modifications\n- Résumer les informations clés`
    });

  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Fonction injectée dans la page Google pour extraire le contenu
function extractGoogleDocContentFromPage(docType) {
  let title = document.title || "Document";
  let content = "";
  
  // Nettoyer le titre
  title = title.replace(" - Google Docs", "")
               .replace(" - Google Sheets", "")
               .replace(" - Google Slides", "")
               .replace(" - Google Drive", "")
               .trim();
  
  switch (docType) {
    case "docs":
      // Google Docs - extraire le contenu de l'éditeur
      const docsContent = document.querySelector('.kix-appview-editor');
      if (docsContent) {
        content = docsContent.innerText || "";
      } else {
        // Fallback
        const canvasText = document.querySelector('.kix-page-content-wrapper');
        content = canvasText?.innerText || document.body.innerText;
      }
      break;
      
    case "sheets":
      // Google Sheets - extraire les données visibles
      const sheetCells = document.querySelectorAll('.cell-input');
      const cellTexts = [];
      sheetCells.forEach(cell => {
        const text = cell.innerText?.trim();
        if (text) cellTexts.push(text);
      });
      content = cellTexts.join(" | ");
      
      if (!content) {
        // Alternative: extraire tout le texte visible
        const grid = document.querySelector('.grid-container');
        content = grid?.innerText || document.body.innerText;
      }
      break;
      
    case "slides":
      // Google Slides - extraire le texte des slides
      const slideTexts = [];
      
      // Filmstrip (vignettes)
      const filmstrip = document.querySelectorAll('.punch-filmstrip-thumbnail');
      
      // Slide active
      const currentSlide = document.querySelector('.punch-viewer-content');
      if (currentSlide) {
        content = currentSlide.innerText || "";
      }
      
      // Extraire aussi les notes du présentateur si visibles
      const speakerNotes = document.querySelector('.punch-viewer-speakernotes-text');
      if (speakerNotes) {
        content += "\n\n--- Notes du présentateur ---\n" + speakerNotes.innerText;
      }
      
      // Si pas de contenu, fallback
      if (!content.trim()) {
        const allText = document.querySelectorAll('[data-placeholder]');
        allText.forEach(el => {
          const text = el.innerText?.trim();
          if (text) slideTexts.push(text);
        });
        content = slideTexts.join("\n\n");
      }
      
      if (!content.trim()) {
        content = document.body.innerText;
      }
      break;
      
    default:
      content = document.body.innerText;
  }
  
  // Nettoyer le contenu
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50000); // Limiter la taille
  
  return { title, content };
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function handleYouTubeAction(message, sendResponse) {
  try {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      sendResponse({ error: "Configure ta clé Mistral pour analyser des vidéos YouTube." });
      return;
    }

    const { actionMode, youtubeInfo } = message;
    
    if (!youtubeInfo) {
      sendResponse({ error: "Aucune information vidéo reçue." });
      return;
    }

    const language = await getStoredLanguage();
    const langInstruction = getLanguageInstruction(language);

    // Construire le contexte de la vidéo
    let videoContext = `
VIDÉO YOUTUBE:
- Titre: ${youtubeInfo.title}
- Chaîne: ${youtubeInfo.channel}
- Durée: ${youtubeInfo.duration || "Non disponible"}
- Vues: ${youtubeInfo.views || "Non disponible"}
- URL: ${youtubeInfo.url}

DESCRIPTION:
${youtubeInfo.description || "Pas de description disponible."}
`;

    // Ajouter les chapitres si disponibles
    if (youtubeInfo.chapters && youtubeInfo.chapters.length > 0) {
      videoContext += "\n\nCHAPITRES DE LA VIDÉO:\n";
      youtubeInfo.chapters.forEach(ch => {
        videoContext += `[${ch.time}] ${ch.title}\n`;
      });
    }

    // Ajouter le transcript si disponible (limite élevée pour la transcription)
    if (youtubeInfo.transcript && youtubeInfo.transcript.length > 0) {
      videoContext += `\n\nTRANSCRIPT:\n${youtubeInfo.transcript.slice(0, 50000)}`;
    }

    // Ajouter les commentaires si disponibles
    if (youtubeInfo.comments && youtubeInfo.comments.length > 0) {
      videoContext += "\n\nCOMMENTAIRES POPULAIRES:\n";
      youtubeInfo.comments.forEach(c => {
        videoContext += `- ${c.author}: "${c.text.slice(0, 200)}"\n`;
      });
    }

    // Définir le prompt système selon l'action
    let systemPrompt = "";
    let userPrompt = "";

    switch (actionMode) {
      case "summarize":
        systemPrompt = `Tu es un expert en analyse de contenu vidéo YouTube. Tu dois produire un résumé TRÈS DÉTAILLÉ et exhaustif de la vidéo.
${langInstruction}

IMPORTANT: Sois le plus détaillé possible. Ne raccourcis pas, développe chaque point en profondeur.

Structure ton résumé ainsi:
1. **📌 Résumé exécutif** (2-3 phrases) - L'essence de la vidéo
2. **🎯 Points principaux** - Les 5-10 idées clés avec explications
3. **📋 Résumé détaillé par section** - Un résumé complet et exhaustif:
   - Si des chapitres existent, traite CHAQUE chapitre en détail
   - Sinon, divise le contenu en sections logiques
   - Pour chaque section: titre, contenu détaillé, exemples mentionnés
4. **💬 Citations et moments clés** - Les phrases ou moments marquants
5. **💡 Points à retenir** - Les enseignements importants
6. **🎓 Pour aller plus loin** - Sujets connexes ou recommandations mentionnées

Utilise le Markdown pour la mise en forme. Sois EXHAUSTIF et DÉTAILLÉ.`;
        userPrompt = `Analyse et produis un résumé TRÈS DÉTAILLÉ de cette vidéo YouTube. Ne raccourcis rien, développe au maximum:\n\n${videoContext}`;
        break;

      case "keyPoints":
        systemPrompt = `Tu es un expert en synthèse de contenu. Tu dois extraire TOUS les points clés d'une vidéo YouTube de manière détaillée.
${langInstruction}

Formate ta réponse ainsi:

## 🎯 Points clés principaux
[Les 5-8 idées majeures avec explications détaillées]

## 📌 Points secondaires importants  
[10-20 points additionnels pertinents]

## 💡 Conseils et recommandations mentionnés
[Tous les conseils pratiques de la vidéo]

## 📊 Données et chiffres clés
[Statistiques, dates, nombres mentionnés]

## 🔗 Ressources et références
[Liens, livres, personnes mentionnées]

Pour chaque point:
- Utilise des émojis pertinents
- Développe avec 1-2 phrases d'explication
- Cite des exemples si mentionnés dans la vidéo
- Classe par importance ou chronologie`;
        userPrompt = `Extrais TOUS les points clés de cette vidéo YouTube de manière exhaustive:\n\n${videoContext}`;
        break;

      case "transcript":
        if (youtubeInfo.transcript && youtubeInfo.transcript.length > 100) {
          // Transcript disponible: nettoyer et structurer
          systemPrompt = `Tu es un assistant qui aide à transcrire et structurer le contenu des vidéos YouTube.
${langInstruction}

Nettoie le transcript fourni:
- Supprime les répétitions inutiles
- Ajoute de la ponctuation si nécessaire
- Organise en paragraphes cohérents
- Ajoute des titres de sections si la vidéo a plusieurs parties
- Garde le texte fidèle au contenu original`;
          userPrompt = `Voici le transcript de la vidéo "${youtubeInfo.title}". Nettoie-le et structure-le de manière lisible:\n\n${youtubeInfo.transcript.slice(0, 60000)}`;
        } else {
          // Pas de transcript disponible - générer une transcription détaillée basée sur les infos
          systemPrompt = `Tu es un expert en analyse de contenu vidéo. Tu dois générer une transcription détaillée du contenu de la vidéo basée sur toutes les informations disponibles.
${langInstruction}

IMPORTANT: 
- Génère un texte qui reconstitue le contenu probable de la vidéo
- Base-toi sur le titre, la description, les chapitres et les commentaires
- Écris comme si tu retranscrivais ce que dit le présentateur
- Utilise un style naturel et fluide
- Si des chapitres sont disponibles, structure le texte selon ces chapitres
- Sois aussi détaillé que possible

Format:
## [Titre du chapitre/section]
[Contenu de la transcription]

N'indique PAS que c'est une reconstitution dans le texte lui-même.`;
          
          userPrompt = `Génère une transcription détaillée de cette vidéo YouTube basée sur les informations suivantes:\n\n${videoContext}`;
        }
        break;

      default:
        sendResponse({ error: "Action YouTube non reconnue." });
        return;
    }

    // Appel API Mistral - limites élevées pour résumés et transcriptions détaillés
    const maxTokensByAction = {
      transcript: 16000,
      summarize: 8000,
      keyPoints: 6000
    };
    
    const userModel = await getStoredModel();
    
    const payload = {
      model: userModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: maxTokensByAction[actionMode] || 4000,
      temperature: 0.7
    };

    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      sendResponse({ error: errorData?.error?.message || `Erreur ${response.status}` });
      return;
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content || "Pas de réponse.";
    
    sendResponse({ result });

  } catch (error) {
    sendResponse({ error: error.message || "Erreur lors de l'analyse de la vidéo." });
  }
}
