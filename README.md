# Holaf Utilities for ComfyUI

## 🚨 ***AVERTISSEMENT DE SÉCURITÉ EXTRÊMEMENT IMPORTANT*** 🚨

**Cette extension personnalisée fournit des outils puissants, y compris une interface de terminal web (shell), à la machine exécutant le serveur ComfyUI. En installant et en utilisant cette extension, vous ouvrez un point d'accès direct et potentiellement dangereux à votre système.**

**UTILISEZ CETTE EXTENSION À VOS PROPRES RISQUES. LE OU LES AUTEURS NE SONT PAS RESPONSABLES DES DOMMAGES, PERTES DE DONNÉES OU FAILLES DE SÉCURITÉ QUI POURRAIENT RÉSULTER de SON UTILISATION.**

---

### Avant de continuer, vous DEVEZ comprendre :

1.  **Exécution de Code à Distance :** L'utilitaire Terminal est conçu pour exécuter des commandes shell sur votre serveur depuis un navigateur web. Si votre ComfyUI est accessible sur un réseau (même local), toute personne pouvant accéder à la page web de ComfyUI pourrait potentiellement prendre le contrôle de votre serveur.
2.  **Sécurité Réseau :** **N'EXPOSEZ PAS** votre instance ComfyUI à l'internet public (par exemple, en utilisant `--listen 0.0.0.0`) avec cette extension installée, sauf si vous l'avez sécurisée derrière une couche d'authentification robuste (comme un reverse proxy avec login/mot de passe) et que vous utilisez le **HTTPS**.
3.  **Authentification par Mot de Passe :** Le Terminal est sécurisé par un mot de passe que vous définissez. Le mot de passe est stocké sous forme de hash dans le fichier `config.ini`.
4.  **Usage Prévu :** Cet outil est destiné aux utilisateurs avancés qui ont besoin d'effectuer de la maintenance système (gérer des fichiers, mettre à jour des dépôts, surveiller des processus avec `nvidia-smi`) sur un serveur ComfyUI distant ou sans tête, sans avoir besoin d'une session SSH distincte.

**Si vous ne comprenez pas ces risques, N'INSTALLEZ PAS CETTE EXTENSION.**

---

## Utilitaires Inclus

*   **Holaf Terminal :** Un panneau de terminal flottant et fonctionnel, accessible depuis le menu "Utilities". Il s'exécute dans l'environnement de ComfyUI, vous donnant accès au bon environnement virtuel Python.
*   **Holaf Model Manager :** Une interface pour visualiser, rechercher et gérer les modèles reconnus par ComfyUI.
*   **Holaf Image Viewer :** Un gestionnaire d'images et de métadonnées puissant, rapide et basé sur une base de données, incluant un éditeur d'images non destructif.
*   **(Prévu) Holaf Session Log :** Un journal d'activité de l'interface utilisateur pour suivre toutes les actions effectuées pendant la session.

---

## Installation

1.  Naviguez vers le répertoire des nœuds personnalisés de ComfyUI :
    ```bash
    cd ComfyUI/custom_nodes/
    ```

2.  Clonez ce dépôt :
    ```bash
    git clone <repository_url> ComfyUI-Holaf-Utilities
    ```
    *(Remplacez `<repository_url>` par l'URL réelle du dépôt)*

3.  Installez les dépendances Python requises. Naviguez dans le nouveau répertoire et utilisez `pip` :
    ```bash
    cd ComfyUI-Holaf-Utilities
    pip install -r requirements.txt
    ```
    *Note : Cela installera des paquets comme `pywinpty` sur Windows pour fournir une expérience de terminal complète.*

4.  Redémarrez ComfyUI.

---

## Configuration & Usage

### Première Utilisation (Terminal)

1.  Après l'installation et le redémarrage de ComfyUI, cliquez sur le bouton **"Utilities"** dans la barre de menu supérieure, puis sélectionnez **"Terminal"**.
2.  Un panneau flottant apparaîtra, affichant un écran "Setup".
3.  Entrez et confirmez un mot de passe fort directement dans le panneau et cliquez sur "Set Password".
4.  Le backend tentera de sauvegarder une version hashée de votre mot de passe dans un fichier `config.ini`.
    *   **En cas de succès,** le panneau passera à un écran de connexion.
    *   **En cas d'échec (dû aux permissions de fichiers),** le panneau affichera le hash du mot de passe généré et des instructions. Vous devrez alors copier manuellement ce hash dans votre fichier `config.ini` et redémarrer ComfyUI.
    *   Le fichier `config.ini` est situé dans `ComfyUI/custom_nodes/ComfyUI-Holaf-Utilities/`.

### Usage Normal

1.  Cliquez sur le menu **"Utilities"** pour ouvrir un panneau d'utilitaire.
2.  Pour le Terminal, entrez le mot de passe que vous avez configuré et cliquez sur "Connect".
3.  Vous pouvez afficher/cacher le panneau en cliquant à nouveau sur l'élément de menu.

---

## Feuille de Route et État du Projet (Project Roadmap & Status)

Ce document suit l'évolution du projet, les fonctionnalités prévues et les bugs identifiés.

**Légende :**
*   `💡 Idée / Prévu`
*   `🔧 Refactorisation / Amélioration Technique`
*   `🐞 Bug Actif`
*   `✅ Terminé`

---

### Système Général et Nouveaux Outils

*   `💡` **Remplacement des notifications par un système de "Toasts" :** Remplacer les `alert()` et `confirm()` bloquants par des notifications non bloquantes, stylisées (succès, erreur, info) et qui disparaissent automatiquement pour une expérience utilisateur plus fluide.
*   `💡` **Nouvel outil : Journal de Session (Session Log) :** Ajouter un nouveau panneau qui affichera un historique textuel de toutes les actions de l'utilisateur et des réponses du système au sein de l'interface (ex: "5 images supprimées", "Erreur API", etc.), offrant une traçabilité claire de la session.
*   `💡` **Tâche de Maintenance Périodique :** Implémenter un worker de fond s'exécutant toutes les heures pour nettoyer les données obsolètes (miniatures orphelines, entrées de base de données invalides) et optimiser la base de données, garantissant la performance sur le long terme.

---

### Holaf Image Viewer

#### 🐞 Bugs Actifs

*   `🐞` **[CRITIQUE] La sauvegarde du workflow lors de l'export d'une image échoue.** Lorsque l'utilisateur exporte une image (même avec l'option "inclure les métadonnées"), le workflow n'est sauvegardé ni dans les métadonnées de l'image ("embed"), ni en tant que fichier `.json` annexe ("sideload").
*   `🐞` **La sauvegarde des filtres est défaillante.** Les filtres sélectionnés dans le panneau de gauche (dossiers, formats, dates, etc.) ne sont pas correctement sauvegardés et restaurés entre les sessions.

#### 🔧 Améliorations Majeures et Refactorisation

*   `🔧` **Migration vers une Architecture pilotée par l'État (State-Driven) :** Refactoriser en profondeur le code JavaScript pour utiliser un gestionnaire d'état central. L'objectif est de rendre l'interface hyper-réactive : les changements de filtres seront appliqués instantanément à l'état de l'interface, et la récupération des données se fera en arrière-plan sans latence perçue par l'utilisateur.
*   `🔧` **Surveillance des Fichiers en Temps Réel :** Remplacer le scan périodique de la base de données par une surveillance active du système de fichiers (via `watchdog`) pour une détection et un affichage instantanés des nouvelles images ou des suppressions.

#### ✨ Nouvelles Fonctionnalités Prévues

*   `💡` **Gestion Automatisée des Fichiers Corrompus :**
    *   Créer un dossier spécial `output/corrupted`.
    *   Lors des scans, déplacer automatiquement les images illisibles (et leurs fichiers `.txt`/`.json`) vers ce dossier.
    *   Afficher `Corrupted` comme un filtre spécial dans l'interface, avec un bouton "Empty" pour purger le dossier.
*   `💡` **Amélioration du panneau de filtres des dossiers :**
    *   Ajouter un bouton **"Invert"** pour inverser la sélection des dossiers.
    *   Ajouter une icône de **cadenas** à côté de chaque dossier pour verrouiller son état (sélectionné/désélectionné). Les dossiers verrouillés ne seront pas affectés par les boutons "All", "None" ou "Invert".
*   `💡` **Fonctionnalités à définir :**
    *   Bouton **"Edit"** : Définir son action (ex: renommer, taguer).
    *   Bouton **"Slideshow"** : Implémenter un mode diaporama.

---

### ✅ Historique des Tâches Terminées (Sélection)

*   `✅` **Refactorisation Majeure du Code :** Le backend et le frontend ont été scindés en modules logiques pour une meilleure maintenabilité.
*   `✅` **Mise en Place de l'Éditeur d'Images :** L'architecture de base pour l'édition non-destructive (fichiers `.edt`, interface, filtres CSS) est fonctionnelle.
*   `✅` **Implémentation de la Corbeille :** Les fonctionnalités "Delete" (déplacer vers `trashcan`), "Restore" et "Empty Trashcan" sont complétées.
*   `✅` **Fonctionnalités "Extract/Inject Metadata" :** Les API et les boutons pour extraire les métadonnées vers des fichiers annexes (et vice-versa) sont implémentés.
*   `✅` **Correction des bugs de l'éditeur d'image :** Les problèmes initiaux de mise en page (superposition des panneaux) et de style (icône de crayon) sont résolus.
*   `✅` **Système de Cache de Miniatures :** La génération et la gestion des miniatures en tâche de fond sont implémentées.

---
*Cette extension a été développée par Gemini (AI Assistant), sous la direction de Holaf.*