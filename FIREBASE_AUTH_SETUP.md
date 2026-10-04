# Configurare autentificare Firebase pentru VoltConsum

1. Creează sau selectează un proiect în Firebase Console și înregistrează o aplicație Web.
2. În **Authentication → Sign-in method**, activează **Email/Password**, **Anonymous**, **Google** și **Facebook**. Metoda Anonymous este necesară pentru accesul demo ca guest.
3. Înlocuiește valorile `YOUR_API_KEY`, `YOUR_AUTH_DOMAIN`, `YOUR_PROJECT_ID` și `YOUR_APP_ID` din `firebase-config.js` cu configurația Web furnizată de Firebase.
4. Pentru Facebook, creează o aplicație Meta, adaugă produsul **Facebook Login** și configurează în Meta URI-ul OAuth de redirecționare afișat de Firebase. Introdu App ID și App Secret numai în setările furnizorului Facebook din Firebase Console; nu le adăuga în fișierele aplicației.
5. Adaugă domeniul de publicare în **Authentication → Settings → Authorized domains**. Testează pe `localhost` sau pe domeniul HTTPS de producție; popup-urile OAuth nu funcționează din `file://`.

Emailul/parola, Google, Facebook și sesiunea guest sunt autentificate de Firebase Authentication. Firebase gestionează persistența și revalidarea sesiunii; aplicația nu mai acordă acces pe baza conturilor/parolelor salvate local. Conturile locale create într-o versiune anterioară nu sunt migrate automat: utilizatorii trebuie să creeze un cont Firebase nou sau să conecteze un furnizor activat.

Configurația Web (inclusiv apiKey) este publică prin design. Nu include chei de server sau secrete OAuth în codul clientului. Protejează orice servicii și date Firebase cu reguli Firestore/Storage și verificarea tokenurilor Firebase ID pe server. Datele calculatorului VoltConsum sunt în continuare stocate local și nu sunt sincronizate în contul Firebase; autentificarea nu izolează aceste date per utilizator.

Pentru producție, folosește Firebase Hosting sau alt host HTTPS, autorizează numai domeniile necesare și dezactivează furnizorii de autentificare pe care nu îi folosești. Testele reale de login necesită proiect Firebase configurat și acreditări de furnizori valide.
