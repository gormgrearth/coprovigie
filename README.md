# CoproVigie 🏠

Application communautaire pour signaler en quelques clics une anomalie dans une copropriété (ascenseur, électricité, chauffage, éclairage, accessibilité…). Multi-copropriétés, gestion par un administrateur, lecture en temps réel.

**Stack :** un seul `index.html` + CSS + JS, base de données **Firebase Firestore**, hébergement **GitHub Pages**. Aucun serveur à maintenir, gratuit pour un usage de copropriété.

---

## 1. Comment ça marche

- **Résidents** : rejoignent avec le **code d'accès** de leur copropriété + un pseudo (pas de mot de passe). Ils signalent une anomalie en 2 clics : type d'incident → confirmer.
- **Administrateur** : se connecte avec le code + un **mot de passe admin** séparé. Il peut créer/supprimer des lieux (sous-groupes), des types d'incidents, changer le statut d'un signalement (signalé / en cours / résolu), et modifier le nom, le code d'accès ou le mot de passe de la copropriété.
- **Multi-copropriétés** : chaque copropriété créée est totalement indépendante (son propre code, son propre mot de passe admin, ses propres données).

---

## 2. Créer le projet Firebase (5 minutes)

1. Va sur [console.firebase.google.com](https://console.firebase.google.com) et connecte-toi avec un compte Google.
2. Clique sur **Ajouter un projet**, donne-lui un nom (ex. `coprovigie`), passe les étapes Google Analytics (facultatif, tu peux désactiver).
3. Une fois le projet créé, dans le menu de gauche : **Build → Firestore Database**.
4. Clique sur **Créer une base de données**.
   - Choisis une région proche (ex. `eur3 (europe-west)`).
   - Sélectionne **Mode production** (on configure les règles nous-mêmes juste après).
5. Toujours dans Firestore, va dans l'onglet **Règles** et remplace tout le contenu par celui du fichier [`firestore.rules`](./firestore.rules) fourni dans ce projet. Clique sur **Publier**.

### Récupérer la configuration

1. Dans le menu de gauche, clique sur l'**icône d'engrenage ⚙️ → Paramètres du projet**.
2. Descends jusqu'à **"Vos applications"**, clique sur l'icône **`</>`** (Web).
3. Donne un surnom à l'app (ex. `coprovigie-web`), **ne coche pas** "Configurer Firebase Hosting" (on utilise GitHub Pages).
4. Firebase t'affiche un objet `firebaseConfig` qui ressemble à ça :

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "coprovigie-xxxx.firebaseapp.com",
  projectId: "coprovigie-xxxx",
  storageBucket: "coprovigie-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

5. Copie ces valeurs dans le fichier **`firebase-config.js`** de ce projet, à la place des valeurs d'exemple (`VOTRE_API_KEY`, etc.).

---

## 3. Mettre en ligne avec GitHub Pages (gratuit)

1. Crée un nouveau dépôt sur [github.com/new](https://github.com/new) (par exemple `coprovigie`), public.
2. Mets-y les 4 fichiers de ce projet : `index.html`, `styles.css`, `app.js`, `firebase-config.js` (avec ta vraie config remplie).
3. Dans le dépôt GitHub : **Settings → Pages**.
4. Sous "Build and deployment", choisis **Source : Deploy from a branch**, branche `main`, dossier `/ (root)`. Sauvegarde.
5. Au bout d'une minute, ton site est en ligne à une adresse du type :
   `https://ton-pseudo-github.github.io/coprovigie/`

C'est cette adresse que tu partages avec les résidents.

> ⚠️ **Important** : les modules JavaScript (`type="module"`) ne fonctionnent pas si tu ouvres simplement `index.html` en double-cliquant dessus (`file://`). Il faut toujours passer par un vrai serveur web — GitHub Pages en est un, parfait pour ça. Pour tester en local avant publication, lance par exemple `python3 -m http.server` dans le dossier puis ouvre `http://localhost:8000`.

---

## 4. Premier lancement

1. Ouvre ton site, clique sur **"Créer une copropriété"**.
2. Renseigne le nom de l'immeuble, choisis un **code d'accès** (ex. `LILAS-12`), un **mot de passe administrateur**, et ton pseudo.
3. Tu es immédiatement connecté en tant qu'administrateur. Des types d'incidents classiques (ascenseur, électricité, chauffage, éclairage, accessibilité, eau, propreté, sécurité) et un premier lieu ("Bâtiment principal") sont créés automatiquement — tu peux les modifier dans **Admin → Lieux / Sous-groupes** et **Admin → Types d'incidents**.
4. Partage le **code d'accès** (pas le mot de passe admin !) avec les résidents : ils l'utilisent sur l'écran **"Rejoindre ma copropriété"**.

---

## 5. Notes importantes sur la sécurité

Cette application n'utilise **pas** de système de comptes individuels (Firebase Authentication) — l'accès se fait par un code partagé, comme demandé. C'est volontairement simple : pas de création de compte, pas de mot de passe à retenir pour les résidents.

**Ce que ça implique concrètement :**
- Toute personne connaissant le **code d'accès** peut signaler des anomalies et lire les signalements (c'est l'usage prévu : un espace communautaire).
- Toute personne suffisamment technique (ouvrant les outils de développement du navigateur) pourrait théoriquement lire ou écrire directement dans la base Firestore sans passer par l'interface, y compris deviner l'identifiant interne d'une copropriété. Les règles fournies (`firestore.rules`) limitent ce qui peut être écrit (structure des données valide) mais ne vérifient pas "qui" écrit, car il n'y a pas d'authentification.
- **Recommandation** : ne mettez pas d'informations sensibles dans les commentaires de signalement, et changez le mot de passe administrateur si vous soupçonnez qu'il a été partagé par erreur.

**Pour aller plus loin** (hors périmètre de cette version, mais possible en évolution) : migrer vers Firebase Authentication (connexion par email ou compte Google), avec des règles Firestore basées sur l'identité réelle de l'utilisateur plutôt que sur un code partagé. Cela demande de revoir l'auth et les règles, mais conserve la même structure de données.

---

## 6. Structure des fichiers

```
coprovigie/
├── index.html          → structure de la page (tous les écrans)
├── styles.css           → mise en forme, responsive mobile/desktop
├── app.js                → logique applicative + connexion Firestore
├── firebase-config.js    → TA configuration Firebase (à compléter)
└── firestore.rules       → règles de sécurité à coller dans Firebase Console
```

## 7. Personnalisation rapide

- **Couleurs / police** : tout est en variables CSS en haut de `styles.css` (section `:root`).
- **Types d'incidents par défaut** proposés à la création d'une copro : tableau `DEFAULT_TYPES` en haut de `app.js`.
- **Icônes disponibles** pour créer un nouveau type dans l'admin : tableau `ICON_CHOICES` dans `app.js`.

## 8. Limites connues

- Pas de notifications push (les résidents doivent ouvrir l'app pour voir les nouveautés — la liste se met à jour en temps réel une fois l'app ouverte, grâce à Firestore).
- Pas de upload de photos (peut être ajouté avec Firebase Storage si besoin).
- Le mot de passe administrateur est stocké en clair dans Firestore (pas haché). Acceptable pour un usage de copropriété non-critique, mais à garder en tête.
