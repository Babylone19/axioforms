# AxioForms

Un moteur de formulaires configurable via JSON : on décrit un formulaire (champs,
validations, conditions d'affichage, pièces jointes), on le publie en version, et on
reçoit les réponses dans une base PostgreSQL. Le projet couvre tout le parcours —
édition, page publique, stockage, API REST, export et webhooks.

Exercice technique réalisé pour **Axio** — octobre 2026.

## Sommaire

- [Ce que ça fait](#ce-que-ça-fait)
- [Stack et architecture](#stack-et-architecture)
- [Démarrage rapide](#démarrage-rapide)
- [Accès à l'application](#accès-à-lapplication)
- [Format du schéma de formulaire](#format-du-schéma-de-formulaire)
- [API REST](#api-rest)
- [Webhooks](#webhooks)
- [Tests](#tests)
- [Décisions et arbitrages](#décisions-et-arbitrages)
- [État du MVP](#état-du-mvp)
- [Limites connues](#limites-connues)
- [Utilisation de l'IA](#utilisation-de-lia)
- [Pistes d'évolution](#pistes-dévolution)

## Ce que ça fait

- **Un schéma JSON typé**, validé côté serveur : dix types de champs (`text`,
  `textarea`, `email`, `number`, `date`, `select`, `radio`, `checkbox`, `file`,
  `section`), des ids uniques, et un refus net des cycles ou des références à des
  champs inexistants dans les conditions.
- **De la logique conditionnelle** (`visibleIf`) évaluée en cascade : un même code
  tourne dans le navigateur (pour l'affichage en direct) et côté serveur (à la
  soumission). Les champs masqués ne sont ni exigés, ni enregistrés.
- **Des validations cohérentes** de bout en bout : requis, longueurs, bornes, regex
  avec message personnalisé, taille et type MIME des fichiers. Le client valide pour
  le confort, le serveur revalide parce que c'est lui qui a raison.
- **Du versionnement** : un brouillon éditable, des versions publiées immuables, et
  chaque réponse rattachée à la version qui l'a produite.
- **Des soumissions JSON ou multipart** : les pièces jointes sont vérifiées par
  sniffing des octets (pas l'en-tête du client), limitées en taille, et stockées sur
  disque sous un nom aléatoire.
- **Un espace d'administration** : liste des formulaires, éditeur visuel en
  glisser-déposer (avec bascule JSON validée en direct), aperçu interactif,
  publication, historique des versions, réponses paginées et export CSV.
- **Une API REST** protégée par clés (`X-API-Key`, HMAC-SHA256 + pepper), avec des
  erreurs homogènes et du rate limiting.
- **Des webhooks** non bloquants : un POST à chaque réponse, dont le statut est
  consigné dans les métadonnées (`success`, `failed:http_…`, `failed:network`,
  `failed:timeout`).
- **Un formulaire de démonstration** seedé avec des conditions en cascade, un fichier
  et quelques réponses d'exemple.

## Stack et architecture

| Couche  | Choix                                            |
|---------|--------------------------------------------------|
| API     | Node.js ≥ 20, TypeScript, Fastify 5              |
| Données | PostgreSQL 16, Drizzle ORM, driver `postgres`    |
| Schémas | Zod (schéma de formulaire, validation, env)      |
| Front   | React 19, Vite, TypeScript (aucun framework CSS) |
| Tests   | Vitest + `app.inject()` (intégration API)        |
| Infra   | docker-compose (Postgres sur le port 5433)       |

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
      admin/       AdminApp, FormList, FormEditor, VisualEditor,
                   fieldOps, ResponsesView
      components/  FormFields (contrôle partagé public + aperçu)
      lib/         api (public), admin (client authentifié)
packages/
  shared/          schéma Zod, validation, évaluation des conditions
                   (utilisé par l'API ET le navigateur)
```

Le cœur du projet, c'est `@axioforms/shared` : le **même** code valide et évalue les
conditions des deux côtés. Le serveur revalide toujours, visibilité comprise, parce
qu'un client n'est jamais digne de confiance.

### Modèle de données

```text
api_keys
  id uuid PK · name · key_prefix (unique) · key_hash · created_at · revoked_at

forms
  id uuid PK · slug (unique) · title · description · status (draft|published)
  webhook_url · schema_draft jsonb · created_at · updated_at

form_versions                     ← snapshot immuable du schéma publié
  id uuid PK · form_id FK→forms (cascade) · version_number int
  schema_json jsonb · created_at
  UNIQUE(form_id, version_number)

responses
  id uuid PK · form_id FK→forms (cascade)
  form_version_id FK→form_versions (restrict)   ← version utilisée
  data jsonb · meta jsonb (ipHash, userAgent, webhookStatus) · submitted_at

attachments
  id uuid PK · response_id FK→responses (cascade) · field_id
  filename · stored_path · mime_type · size_bytes · created_at
```

Concrètement : un formulaire a 0..N versions et 0..N réponses ; chaque réponse pointe
vers une seule version, ce qui permet de réinterpréter d'anciennes réponses même après
avoir modifié le formulaire ; une réponse a 0..N pièces jointes dont les octets vivent
sur disque (`UPLOAD_DIR`) — la base ne garde que les métadonnées. Index principaux :
`forms.status`, `responses(form_id, submitted_at)`, `responses.form_version_id`,
`attachments.response_id`, `api_keys.key_prefix`.

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

> J'utilise volontairement le port 5433 pour cohabiter avec un PostgreSQL local déjà
> présent sur 5432. `DATABASE_URL` est déjà configurée dans `.env.example`.

Autres commandes utiles :

```bash
npm test             # 103 tests (API + package partagé + web)
npm run typecheck
npm run build        # shared + api + web
```

## Accès à l'application

| URL | Description |
|-----|-------------|
| `http://localhost:5173/f/demo-onboarding-client` | Formulaire public de démonstration |
| `http://localhost:5173/#/` | Administration (demande une clé API) |
| `http://localhost:3000/health` | Santé API + base de données |

L'administration garde la clé API dans `localStorage` : c'est pratique pour une démo,
mais je la remplacerais par une vraie session en production. Le lien public d'un
formulaire suit le format `/f/<slug>`.

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
(chaîne ou tableau), `truthy`. Une condition qui référence un champ pas encore
visible ou pas renseigné est **fausse**. L'évaluation est itérative (point fixe borné)
pour gérer les cascades, et les cycles sont rejetés dès la validation du schéma.

## API REST

Base : `http://localhost:3000`. Toutes les routes privées exigent l'en-tête
`X-API-Key: axf_<préfixe>_<secret>`. Les erreurs suivent toujours ce format :

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
| GET | `/api/forms/:id/responses/export.csv` | Export CSV (`;`, BOM UTF-8, colonnes = union des champs) |
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
`details` par champ, `401 INVALID_API_KEY`, `404 NOT_FOUND`, `429` quand le rate limit
est atteint.

### Notes d'implémentation

- **Fichiers** : les parties multipart s'appellent `file_<fieldId>` ; la partie
  `answers` contient le JSON des réponses (plat ou `{ "answers": … }`). Le type MIME
  retenu est celui détecté dans les octets, pas celui annoncé par le client. Les
  fichiers sont stockés hors base sous `UPLOAD_DIR/<formId>/<uuid>` et la base ne garde
  que les métadonnées. Un fichier transmis pour un champ masqué est ignoré.
- **Visibilité** : le serveur recalcule la visibilité à partir des réponses avant de
  valider, puis retire des données les valeurs des champs masqués.
- **Pièces jointes** : insérées dans la même transaction que la réponse ; si la
  validation échoue, les fichiers déjà écrits sont nettoyés.
- **Rate limiting** : 60 req/min en lecture publique, 10 req/min à la soumission (par
  IP, en mémoire — à externaliser pour un déploiement multi-instances).

## Webhooks

On configure `webhookUrl` sur un formulaire (admin ou API). À chaque réponse, l'API
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
`user-agent: AxioForms-Webhook/1.0`. Le résultat atterrit dans
`responses.meta.webhookStatus`. Pas de retry ni de signature HMAC dans cette version
(voir les limites).

## Tests

```bash
npm test
```

103 tests Vitest, essentiellement d'intégration via `app.inject()` sur une vraie base
PostgreSQL :

- `packages/shared` : schéma (doublons, cycles, options), validation (coercition,
  messages, champs masqués), visibilité (point fixe, opérateurs, cascades).
- `apps/api` : CRUD formulaires, clés API, publication/versions, soumissions JSON,
  multipart/pièces jointes (sniffing, taille, champs masqués), lecture des réponses
  (filtres, pagination, CSV), téléchargement, webhooks (succès/échec/timeout, statut).
- `apps/web` : helpers purs de l'éditeur visuel (nettoyage d'ids, création et
  changement de type de champ, réordonnancement).

Seuls les tests d'intégration ont besoin de Postgres démarré et migré.

## Décisions et arbitrages

- **Schéma en `jsonb` + snapshot par version** : pas de migration à chaque type de
  champ, tout en gardant une réponse interprétable dans le temps grâce à
  `responses.form_version_id`.
- **Logique métier dans `@axioforms/shared`** : une seule implémentation des conditions
  et de la validation, partagée client/serveur, et une revalidation systématique côté
  serveur.
- **Zod généré depuis le schéma** plutôt qu'un moteur de règles maison : messages
  d'erreur homogènes et coercion maîtrisée des valeurs `multipart` (toutes des chaînes).
- **Fastify** : validation de schéma intégrée, `app.inject()` rapide pour les tests, et
  un écosystème mûr (rate-limit, multipart, helmet).
- **Drizzle** : requêtes typées en TypeScript, migrations SQL lisibles, pas de
  génération lourde.
- **Clés API hachées** : le secret n'est jamais stocké ; on retrouve la clé par préfixe
  puis on compare en HMAC-SHA256 avec un pepper — rapide et sans fuite en cas de dump.
- **Fichiers sur disque** : plus simple et moins cher que la base ; le chemin est
  relatif à `UPLOAD_DIR` et le nom est un UUID (ni traversée de chemin, ni écrasement).
- **Webhook fire-and-forget** : la soumission ne dépend jamais d'un service tiers ; le
  statut reste consultable dans les métadonnées.
- **Front sans framework UI** : CSS maison et composants React natifs, pour rester
  lisible et rapide à relire.

## État du MVP

**Terminé et vérifié** (détail dans les sections précédentes) :

- [x] Schéma JSON en base, 10 types de champs, validations par champ, conditions
  (champs **et** sections), détection des cycles et des références inconnues.
- [x] Interface d'administration : éditeur visuel drag & drop + JSON, aperçu
  interactif, publication, historique des versions, liste des réponses,
  téléchargement, export.
- [x] Page publique par formulaire, validation client **et** serveur identiques,
  champs masqués ni exigés ni enregistrés.
- [x] Pièces jointes : type MIME réel (sniffing), taille globale et par champ, stockage
  local, téléchargement protégé.
- [x] Stockage des réponses liées à la version, API REST par clé (formulaires,
  réponses, pièces jointes), webhook par formulaire avec statut.
- [x] Seed d'un formulaire d'exemple conditionnel, tests automatisés (103), README.

**Bonus réalisés** : versionnage des formulaires, export CSV, éditeur visuel drag & drop.

**Non réalisés (bonus)** : génération de formulaire par LLM, formulaires multi-étapes
avec sauvegarde, documentation OpenAPI séparée, déploiement en ligne (l'API et le front
se lancent en local ; docker-compose ne couvre que PostgreSQL).

## Limites connues

- Pas de comptes utilisateurs ni d'équipes : une clé API donne accès à tous les
  formulaires. C'est suffisant pour l'exercice, pas pour du multi-tenant.
- Pas de signature HMAC ni de retry/backoff pour les webhooks : un seul essai.
- Stockage des fichiers en local (pas d'object storage), sans antivirus ni scan.
- Rate limiting en mémoire, non partagé entre instances.
- L'admin est un SPA servi par Vite en développement (`/f/:slug` a besoin du fallback
  SPA ; prévu pour un hébergement statique avec rewrite).
- Pas de brouillons de réponses, ni de reprise de saisie, ni d'i18n.

## Utilisation de l'IA

J'ai développé ce projet avec l'assistance d'un agent de codage (opencode + LLM) :

- **Génération** : squelettes de routes, tests d'intégration, composants React et
  documentation, à partir d'un découpage fonctionnel que j'avais défini en amont.
- **Vérification systématique** : chaque branche est passée par `tsc` et la suite de
  tests, et j'ai rejoué les parcours critiques (formulaire public, éditeur, soumission
  avec fichier, téléchargement, export, webhook) dans un navigateur réel et en base.
  Les bugs trouvés ainsi ont été corrigés — insertion des pièces jointes, conflit de
  proxy `/f`, course entre fichiers de tests, suppression globale d'attachements par un
  test, PDF de démo illisible, export CSV mal délimité.
- **Relecture humaine** : le choix d'architecture, les arbitrages et la relecture du
  code final restent les miens ; l'IA n'a pas servi à inventer des exigences qui
  n'étaient pas demandées.

## Pistes d'évolution

- Authentification utilisateurs (OAuth/magic link) et rôles par formulaire.
- Signature HMAC des webhooks + retries avec backoff + journal de livraison.
- Stockage S3/minio, URLs signées, quota par formulaire.
- Export CSV asynchrone pour les gros volumes, filtres par plage de dates dans l'UI.
- Schéma de formulaire enrichi (répétitions, champs calculés, pièces jointes multiples).
- Déploiement conteneurisé complet (API + build web servi par l'API, migrations au
  démarrage).
