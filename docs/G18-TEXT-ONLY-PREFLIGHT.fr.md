# G18 — Prévalidation stricte du texte avant un envoi navigateur

Le parcours de test WebBridge ne possède **aucune capacité de transfert d'images, fichiers, audio ou multimodal**. Un message qui contient de tels champs ne doit pas être envoyé, réduit à du texte, ni remplacé silencieusement par un ancien message.

Le garde commun `assertTextOnlyTurn` s'exécute avant tout `submit` dans l'échange principal, le relais RPC, le BrowserPort de test et le faux navigateur. Il exige exactement `turnID` et `prompt` comme propriétés propres et ordinaires d'un objet simple, un identifiant borné et un texte non vide de 16 000 caractères au maximum. Champs surnuméraires, pièces jointes (même non énumérables), symboles, accesseurs et prototypes inattendus sont refusés **avant un effet navigateur**.

Le répondant HTTP de test examine le **dernier message utilisateur**, même s'il est multimodal, plutôt que de rechercher le dernier message utilisateur *déjà textuel* ; cela empêche l'envoi silencieux d'un prompt antérieur lorsqu'un nouveau message comporte une image. Les tests reproduisent en rouge puis corrigent les deux comportements.

Ce filtre est une protection pour le parcours texte/fixture, pas un décodage ni une prise en charge de fichiers. Il ne prouve pas que les cinq interfaces commerciales acceptent ou refusent une pièce jointe, et n'autorise aucune navigation réelle.
