# AxioForms

Moteur de formulaires configurable via JSON : création, publication versionnée, logique
conditionnelle, validation serveur/client, pièces jointes, stockage des réponses,
consultation/export et webhooks. Exercice technique réalisé pour **Axio** — octobre 2026.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Stack et architecture](#stack-et-architecture)
- [Démarrage rapide](#démarrage-rapide)
- [Accès à l'application](#accès-à-lapplication)
- [Format du schéma de formulaire](#format-du-schéma-de-formulaire)
- [API REST](#api-rest)
- [Webhooks](#webhooks)
- [Tests](#tests)
- [Décisions et arbitrages](#décisions-et-arbitrages)
- [Limites connues](#limites-connues)
- [Utilisation de l'IA](#utilisation-de-lia)
- [Pistes d'évolution](#pistes-dévolution)

## Fonctionnalités

- **Schéma JSON** typé et validé côté serveur : champs `text`, `textarea`, `email`,
  `number`, `date`, `select`, `radio`, `checkbox`, `file`, `section` ; ids uniques ;
  détection des cycles et des références inconnues dans les conditions.
- **Logique conditionnelle** (`visibleIf`) évaluée en cascade, en direct dans le
  navigateur et à nouveau côté serveur à la soumission (les champs masqués sont ignorés
  et leurs valeurs ignorées).
- **Validation** : Zod généré depuis le schéma (requis, longueurs, bornes, regex avec
  message personnalisé), validation client (mêmes règles via le package partagé) et
  serveur (source de vérité).
- **Versionnement** : brouillon `schema_draft` éditable, publication en versions
  immuables (`form_versions`) ; les réponses restent liées à la version soumise.
- **Soumission** JSON ou `multipart/form-data` avec pièces jointes (contrôle de type
  MIME réel par sniffing d'octets, taille max globale et par champ, nom de stockage
  aléatoire).
- **Espace d'administration** : liste des formulaires, éditeur JSON avec validation en
  direct, aperçu interactif, publication, historique des versions, réponses paginées
  avec téléchargement des pièces jointes et export CSV.
- **API REST** protégée par clés (`X-API-Key`, HMAC-SHA256 + pepper, préfixe indexé),
  réponses d'erreur homogènes, rate limiting.
- **Webhooks** : POST non bloquant à chaque réponse, statut enregistré
  (`success`, `failed:http_…`, `failed:network`, `failed:timeout`).
- **Formulaire de démonstration** seedé avec conditions en cascade, fichier et réponses
  d'exemple.

## Stack et architecture

| Couche      | Choix                                             |
|-------------|---------------------------------------------------|
| API         | Node.js ≥ 20, TypeScript, Fastify 5               |
| Données     | PostgreSQL 16, Drizzle ORM, driver `postgres`     |
| Schémas     | Zod (schéma de formulaire, validation, env)       |
| Front       | React 19, Vite, TypeScript (aucun framework CSS)  |
| Tests       | Vitest + `app.inject()` (intégration API)         |
| Infra       | docker-compose (Postgres sur le port 5433)        |

```text
apps/
  api/
    src/
      routes/      health, keys, forms, versions, public, responses,
                   attachments, webhooks (HTTP)
      lib/         apiKeys, files (upload/stockage), webhooks, slug
      db/          schéma Drizzle + migrations
      plugins/     auth (clé API), errors (réponses homogènes)
    scripts/       create-key.ts, seed.ts
  web/
    src/
      pages/       PublicForm (rendu public /f/:slug)
      admin/       AdminApp, FormList, FormEditor, ResponsesView
      components/  FormFields (contrôle partagé public + aperçu)
      lib/         api (public), admin (client authentifié)
packages/
  shared/          schéma Zod, validation, évaluation des conditions
                   (utilisé par l'API ET le navigateur)
```

Le package `@axioforms/shared` est la clé de la cohérence : le **même** code valide et
évalue les conditions côté client et côté serveur. Le serveur revalide toujours, y
compris la visibilité, car le client n'est jamais digne de confiance.

## Démarrage rapide

Prérequis : Node.js ≥ 20, npm, Docker.

```bash
git clone https://github.com/Babylone19/axioforms.git
cd axioforms
npm install

cp .env.example .env        # ajuster API_KEY_PEPPER si besoin
docker compose up -d        # PostgreSQL 16 sur localhost:5433
npm run db:migrate          # applique les migrations Drizzle

npm run key:create -w apps/api -- "clé de démo"   # affiche la clé (axf_…)
npm run seed -w apps/api                          # formulaire + réponses de démo

# deux terminaux :
npm run dev          # API  -> http://localhost:3000
npm run dev:web      # web  -> http://localhost:5173
```

> Le port 5433 est utilisé volontairement pour cohabiter avec un PostgreSQL local
> déjà présent sur 5432. `DATABASE_URL` correspond dans `.env.example`.

Autres commandes utiles :

```bash
npm test             # 88 tests (API + package partagé)
npm run typecheck
npm run build        # shared + api + web
```

## Accès à l'application

| URL | Description |
|-----|-------------|
| `http://localhost:5173/f/demo-onboarding-client` | Formulaire public de démonstration |
| `http://localhost:5173/#/` | Administration (demande une clé API) |
| `http://localhost:3000/health` | Santé API + base de données |

L'administration stocke la clé API dans `localStorage` (pratique pour une démo, à
remplacer par une vraie session en production). Le lien public d'un formulaire est
`/f/<slug>`.

## Format du schéma de formulaire

```json
{
  "schemaVersion": 1,
  "title": "Onboarding client",
  "description": "Première prise de contact",
  "fields": [
    {
      "id": "client_type",
      "type": "select",
      "label": "Type de client",
      "required": true,
      "options": [
        { "value": "particulier", "label": "Particulier" },
        { "value": "entreprise", "label": "Entreprise" }
      ]
    },
    {
      "id": "vat_number",
      "type": "text",
      "label": "Numéro de TVA",
      "required": true,
      "validation": {
        "pattern": "^BE[0-9]{10}$",
        "errorText": "Format attendu : BE + 10 chiffres"
      },
      "visibleIf": { "field": "client_type", "op": "eq", "value": "entreprise" }
    },
    {
      "id": "contract",
      "type": "file",
      "label": "Contrat signé",
      "validation": {
        "maxSizeBytes": 2097152,
        "acceptedMimeTypes": ["application/pdf", "image/png"]
      },
      "visibleIf": { "field": "client_type", "op": "eq", "value": "entreprise" }
    }
  ]
}
```

### Champs

| Propriété     | Détails |
|---------------|---------|
| `id`          | `^[a-z][a-z0-9_]{0,63}$`, unique dans le formulaire |
| `type`        | `text`, `textarea`, `email`, `number`, `date`, `select`, `radio`, `checkbox`, `file`, `section` |
| `label`       | Obligatoire, ≤ 200 caractères |
| `description` | Texte d'aide optionnel |
| `required`    | Booléen (défaut `false`) |
| `placeholder` | Texte indicatif |
| `options`     | Obligatoire pour `select`/`radio`/`checkbox`, interdit pour `section` : `[{ value, label }]` |
| `validation`  | `minLength`, `maxLength`, `min`, `max`, `pattern` + `errorText`, `maxSizeBytes`, `acceptedMimeTypes` |
| `visibleIf`   | Condition d'affichage (voir ci-dessous) |

### Conditions (`visibleIf`)

```json
{ "field": "client_type", "op": "eq", "value": "entreprise" }
```

Opérateurs : `eq`, `neq`, `in`, `not_in` (valeur tableau), `gt`, `lt`, `contains`
(chaîne ou tableau), `truthy`. Une condition dont le champ référencé n'est pas encore
visible/renseigné est **fausse**. L'évaluation est itérative (point fixe borné) pour
gérer les cascades ; les cycles sont refusés à la validation du schéma.

## API REST

Base : `http://localhost:3000`. Toutes les routes privées exigent l'en-tête
`X-API-Key: axf_<préfixe>_<secret>`. Les erreurs suivent le format :

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": { "champ": "…" } } }
```

### Formulaires et versions (privé)

| Méthode | Route | Description |
|---------|-------|-------------|
| POST    | `/api/forms` | Créer un formulaire (titre, description, schéma, webhookUrl) |
| GET     | `/api/forms` | Lister les formulaires |
| GET     | `/api/forms/:id` | Détail (schéma brouillon) |
| PATCH   | `/api/forms/:id` | Mettre à jour titre/description/schéma/webhookUrl |
| DELETE  | `/api/forms/:id` | Supprimer (cascade réponses/pièces jointes) |
| POST    | `/api/forms/:id/publish` | Publier le brouillon en version N+1 |
| GET     | `/api/forms/:id/versions` | Historique des versions |
| GET     | `/api/forms/:id/versions/:n` | Schéma d'une version |
| GET     | `/api/forms/:id/published` | Dernière version publiée |

### Réponses (privé)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/forms/:id/responses?limit=20&offset=0&version=1&since=2026-01-01T00:00:00Z` | Liste paginée (max 100) |
| GET | `/api/forms/:id/responses/:responseId` | Détail + pièces jointes (URLs) |
| GET | `/api/forms/:id/responses/export.csv` | Export CSV (colonnes = union des champs) |
| GET | `/api/attachments/:id` | Téléchargement d'une pièce jointe |

### Public

| Méthode | Route | Description |
|---------|-------|-------------|
| GET  | `/api/public/f/:slug` | Formulaire publié (schéma + version) |
| POST | `/api/public/f/:slug/responses` | Soumission JSON ou multipart |

### Clés API (privé)

| Méthode | Route | Description |
|---------|-------|-------------|
| POST   | `/api/keys` | Créer une clé (le secret n'est affiché qu'une fois) |
| GET    | `/api/keys` | Lister (préfixes, dates, révocation) |
| DELETE | `/api/keys/:id` | Révoquer |

### Exemples `curl`

```bash
KEY="axf_…"
API=http://localhost:3000

# Créer et publier un formulaire
curl -s -X POST $API/api/forms -H "X-API-Key: $KEY" -H 'content-type: application/json' \
  -d '{"title":"Contact","schema":{"title":"Contact","fields":[{"id":"email","type":"email","label":"Email","required":true}]}}'
curl -s -X POST $API/api/forms/<ID>/publish -H "X-API-Key: $KEY"

# Lecture publique
curl -s $API/api/public/f/contact-xxxxxx

# Soumission JSON
curl -s -X POST $API/api/public/f/contact-xxxxxx/responses \
  -H 'content-type: application/json' \
  -d '{"answers":{"email":"ada@example.com"}}'

# Soumission multipart avec fichier (champ fichier `contract`)
curl -s -X POST $API/api/public/f/contact-xxxxxx/responses \
  -F 'answers={"email":"ada@example.com"}' \
  -F 'file_contract=@contrat.pdf'

# Réponses et export
curl -s "$API/api/forms/<ID>/responses?limit=20" -H "X-API-Key: $KEY"
curl -s "$API/api/forms/<ID>/responses/export.csv" -H "X-API-Key: $KEY" -o reponses.csv

# Pièce jointe
curl -s $API/api/attachments/<ATTACHMENT_ID> -H "X-API-Key: $KEY" -o fichier.pdf
```

Codes notables : `201` soumission/version créée, `400 VALIDATION_FAILED` avec
`details` par champ, `401 INVALID_API_KEY`, `404 NOT_FOUND`, `429` lorsque le rate
limit est atteint.

### Notes d'implémentation

- **Fichiers** : les parties multipart sont nommées `file_<fieldId>` ; la partie
  `answers` contient le JSON des réponses (plat ou `{ "answers": … }`). Le type MIME
  retenu est celui détecté dans les octets, pas l'en-tête client. Les fichiers sont
  stockés hors base sous `UPLOAD_DIR/<formId>/<uuid>` ; la base garde les métadonnées.
  Un fichier transmis pour un champ masqué est ignoré (ni exigé, ni enregistré).
- **Visibilité** : le serveur recalcule la visibilité à partir des réponses avant de
  valider ; les valeurs des champs masqués sont supprimées des données stockées.
- **Pièces jointes** : insérées dans la même transaction que la réponse ; en cas
  d'échec de validation, les fichiers écrits sont supprimés.
- **Rate limiting** : lecture publique 60 req/min, soumission 10 req/min (par IP, en
  mémoire — à externaliser pour un déploiement multi-instances).

## Webhooks

Configurer `webhookUrl` sur un formulaire (admin ou API). À chaque réponse, l'API
envoie en arrière-plan (timeout 5 s, jamais bloquant) :

```json
{
  "event": "response.created",
  "formId": "…",
  "formSlug": "contact-xxxxxx",
  "versionNumber": 1,
  "responseId": "…",
  "submittedAt": "2026-10-21T10:00:00.000Z",
  "data": { "email": "ada@example.com" }
}
```

En-têtes : `content-type: application/json`, `x-axioforms-event: response.created`,
`user-agent: AxioForms-Webhook/1.0`. Le résultat est consigné dans
`responses.meta.webhookStatus`. Pas de retry ni de signature HMAC dans cette version
(voir limites).

## Tests

```bash
npm test
```

88 tests (Vitest), majoritairement d'intégration via `app.inject()` sur une vraie base
PostgreSQL :

- `packages/shared` : schéma (doublons, cycles, options), validation (coercition,
  messages, champs masqués), visibilité (fixpoint, opérateurs, cascades).
- `apps/api` : CRUD formulaires, clés API, publication/versions, soumissions JSON,
  multipart/pièces jointes (sniffing, taille, champs masqués), lecture des réponses
  (filtres, pagination, CSV), téléchargement, webhooks (succès/échec/timeout, statut).

Seuls les tests d'intégration nécessitent Postgres démarré et migré.

## Décisions et arbitrages

- **Schéma stocké en `jsonb` + snapshot par version** : souplesse d'évolution sans
  migrations à chaque type de champ, tout en garantissant qu'une réponse reste
  interprétable dans le temps (`responses.form_version_id`).
- **Logique métier dans `@axioforms/shared`** : une seule implémentation des conditions
  et de la validation, partagée client/serveur ; le serveur revalide systématiquement.
- **Zod généré depuis le schéma** plutôt qu'un moteur de règles maison : messages
  d'erreur homogènes et coercion maîtrisée des valeurs `multipart` (chaînes).
- **Fastify** : validation de schéma intégrée, injection de tests rapide, écosystème
  (rate-limit, multipart, helmet) mature.
- **Drizzle** : typage TypeScript des requêtes, migrations SQL lisibles, pas de
  génération lourde.
- **Clés API hachées** : le secret n'est jamais stocké ; lookup par préfixe puis
  comparaison HMAC-SHA256 avec pepper — rapide et sans fuite en cas de dump.
- **Fichiers sur disque** plutôt qu'en base : simplicité et coût ; le chemin est
  relatif à `UPLOAD_DIR` et le nom est un UUID (pas de traversée de chemin ni
  d'écrasement).
- **Webhook fire-and-forget** : la soumission ne dépend jamais de la disponibilité
  d'un service tiers ; le statut est visible dans les métadonnées.
- **Front sans framework UI** : CSS simple, composants React natifs, pour rester lisible
  et rapide à évaluer.

## Limites connues

- Pas de comptes utilisateurs/équipes : une clé API donne accès à tous les formulaires
  (suffisant pour l'exercice, pas pour du multi-tenant).
- Pas de signature HMAC ni de retry/backoff pour les webhooks ; un seul essai.
- Stockage des fichiers local (pas d'object storage), pas d'antivirus ni de scan.
- Rate limiting en mémoire, non partagé entre instances.
- L'admin est un SPA servi par Vite en développement (`/f/:slug` nécessite le fallback
  SPA ; prévu pour un hébergement statique avec rewrite).
- Pas de brouillons de réponses, ni de reprise de saisie, ni d'i18n.

## Utilisation de l'IA

Ce projet a été développé avec l'assistance d'un agent de codage (opencode + LLM) :

- **Génération** : squelettes de routes, tests d'intégration, composants React et
  documentation, à partir d'un découpage fonctionnel défini en amont.
- **Vérification systématique** : chaque branche a été validée par `tsc` et la suite
  de tests ; les parcours critiques (formulaire public, éditeur, soumission avec
  fichier, téléchargement, export, webhook) ont été exercés dans un navigateur réel et
  en base. Les bugs trouvés ainsi ont été corrigés (insertion des pièces jointes,
  conflit de proxy `/f`, course entre fichiers de tests, suppression globale des
  pièces jointes par un test).
- **Relecture humaine** : choix d'architecture, arbitrages et relecture du code final
  restent sous responsabilité de l'auteur ; l'IA n'a pas été utilisée pour improviser
  des exigences non demandées.

## Pistes d'évolution

- Authentification utilisateurs (OAuth/magic link) et rôles par formulaire.
- Signature HMAC des webhooks + retries avec backoff + journal de livraison.
- Stockage S3/minio, URLs signées, quota par formulaire.
- Export CSV asynchrone pour gros volumes, filtres par plage de dates dans l'UI.
- Schéma de formulaire enrichi (répétitions, champs calculés, pièces jointes multiples).
- Déploiement conteneurisé complet (API + web build servi par l'API, migrations au
  démarrage).
