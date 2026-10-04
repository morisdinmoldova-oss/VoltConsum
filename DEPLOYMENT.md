# Publicare VoltConsum pe Vercel

Aplicația este statică și nu necesită build sau instalare de pachete. Configurația Vercel este în `vercel.json`. `.vercelignore` și `.gitignore` exclud raportul energetic generat, care poate conține date despre consumul unei locuințe; păstrează raportul numai local și verifică fișierele selectate înainte de publicare.

## Înainte de publicare

1. Dacă nu ai încă proiect Firebase, creează unul în [Firebase Console](https://console.firebase.google.com/), înregistrează o aplicație Web și copiază `apiKey`, `authDomain`, `projectId` și `appId` în `firebase-config.js`.
2. În Firebase Authentication activează **Email/Password** și **Anonymous**; Anonymous este necesar pentru accesul demo guest. Activează Google/Facebook numai dacă vrei să oferi acești furnizori. Pașii Meta sunt în [FIREBASE_AUTH_SETUP.md](./FIREBASE_AUTH_SETUP.md).
3. Configurația Firebase Web este publică prin design; nu adăuga chei de server sau secrete OAuth în aplicație.
4. Pune proiectul într-un repository GitHub pe care contul tău Vercel îl poate accesa. Repository-ul poate rămâne privat; publicarea site-ului nu cere publicarea codului sursă. Nu adăuga secrete OAuth, chei de server sau date personale.

Fără Firebase configurat, email/Google/Facebook nu pot autentifica utilizatori. Butonul guest oferă numai o previzualizare demo locală, etichetată ca neautentificată; aceasta se încheie la refresh și nu este un mecanism de autentificare pentru producție.

### Crearea repository-ului dacă folderul local nu este încă versionat

1. Instalează GitHub Desktop și autentifică-te în contul GitHub.
2. Alege **File → Add Local Repository** și selectează folderul VoltConsum. Dacă aplicația spune că folderul nu este repository Git, alege **Create a repository** pentru același folder.
3. Creează primul commit, apoi alege **Publish repository**. Debifează **Keep this code private** numai dacă dorești în mod expres să publici și codul sursă; Vercel poate importa un repository privat autorizat.
4. În Vercel, autorizează integrarea GitHub să acceseze acel repository și continuă cu pașii de deploy de mai jos.

## Deploy

1. Autentifică-te pe [vercel.com](https://vercel.com/) și alege **Add New → Project**.
2. Importă repository-ul GitHub VoltConsum.
3. Selectează **Other** ca framework preset. Lasă Build Command și Install Command necompletate; directorul public este rădăcina proiectului.
4. Publică proiectul. Vercel va afișa un URL `*.vercel.app`.
5. În Firebase Console → Authentication → Settings → Authorized domains, adaugă exact domeniul atribuit de Vercel.
6. Verifică autentificarea email și guest; activează Google/Facebook și configurează callback-ul Meta afișat de Firebase înainte să le folosești.

## Indexare Google

- `index.html` permite indexarea, iar `robots.txt` nu blochează crawlerele.
- După publicare, actualizează acest HTML cu URL-ul real în `rel="canonical"`, `og:url` și `og:image`, apoi adaugă sitemap cu URL-ul live.
- Înregistrează domeniul `vercel.app` sau domeniul personalizat în Google Search Console și trimite sitemap-ul. Google decide independent dacă și când indexează site-ul; rezultatele nu apar imediat și nu pot fi garantate.
- Caută în Google după **VoltConsum** sau după titlul paginii **VoltConsum — Calculator de consum și energie solară în Moldova**.

## Limitări de date

Prognoza meteo/solar folosește Open-Meteo. Calculatoarele sunt estimări, iar datele utilizatorului sunt păstrate în browser; Firebase Auth nu sincronizează și nu separă aceste date per cont. Directorul electricienilor rămâne fără profiluri până când este disponibil un registru oficial public direct.
