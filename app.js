"use strict";

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
let formatter = new Intl.NumberFormat("ro-MD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let integerFormatter = new Intl.NumberFormat("ro-MD", { maximumFractionDigits: 0 });
const t = value => window.VoltI18n.translate(value);

const initialAppliances = [
  { id: 1, name: "Frigider", watts: 120, hours: 24, color: "#c6ff68" },
  { id: 2, name: "Mașină de spălat", watts: 1800, hours: 1, color: "#80d9a1" },
  { id: 3, name: "Iluminat LED", watts: 240, hours: 5, color: "#ffd36d" },
  { id: 4, name: "Televizor & media", watts: 150, hours: 6, color: "#7dc6f2" },
  { id: 5, name: "Altele", watts: 410, hours: 4, color: "#b79af4" }
];
let appliances = initialAppliances.map(item => ({ ...item }));
let nextApplianceId = initialAppliances.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1;
let tariff = 3.5;
let chartInstances = [];
let selectedPeriod = "week";
let toastTimer;
let authMode = "signin";
let appInitialized = false;
let editingApplianceId = null;
let socialAuthInProgress = false;
let weatherForecast = null;
let weatherRequestController = null;
let weatherErrorKey = null;
let localDemoSession = false;

const THEME_KEY = "voltconsum.theme";
const APP_STATE_KEY = "voltconsum.calculator.state";
const DEFAULT_WEATHER_LOCATION = { name: "Chișinău", admin: "", latitude: 47.0105, longitude: 28.8638 };
const WEATHER_LOCATION_KEY = "voltconsum.weather.location";
const MOLDOVA_BOUNDS = { minLat: 45.4, maxLat: 48.55, minLon: 26.55, maxLon: 30.2 };
const WEATHER_REFRESH_MS = 30 * 60 * 1000;
let weatherLocation = { ...DEFAULT_WEATHER_LOCATION };
const WEATHER_PERFORMANCE_RATIO = 0.8;
const DEFAULT_SOLAR = { power: 6, investment: 195000, yieldPerKwp: 1250, selfConsumptionPercent: 76 };
const DEFAULT_CABLE_LENGTH_METERS = 20;
const NOMINAL_VOLTAGE = 230;
const COPPER_RESISTIVITY = 0.0175;
const MAX_VOLTAGE_DROP_PERCENT = 3;
const STANDARD_CABLE_SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];
let lastValidSolarSettings = { ...DEFAULT_SOLAR };
let lastValidCableLength = DEFAULT_CABLE_LENGTH_METERS;

function applyTheme(theme, persist = false) {
  const selectedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selectedTheme;
  document.querySelector('meta[name="theme-color"]').content = selectedTheme === "light" ? "#f2f5ef" : "#07110f";
  const nextLabel = t(selectedTheme === "dark" ? "Tema deschisă" : "Tema întunecată");
  ["#auth-theme-toggle", "#app-theme-toggle"].forEach(selector => {
    const button = $(selector);
    button.innerHTML = `${selectedTheme === "dark" ? "☼" : "☾"} <span>${nextLabel}</span>`;
    button.setAttribute("aria-label", t(selectedTheme === "dark" ? "Activează tema deschisă" : "Activează tema întunecată"));
    button.setAttribute("aria-pressed", String(selectedTheme === "light"));
    button.title = button.getAttribute("aria-label");
  });
  if (appInitialized) {
    renderConsumptionChart();
    renderApplianceChart();
    drawWaveform();
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, selectedTheme);
    } catch (error) {
      showToast("Tema s-a schimbat, dar browserul nu a putut salva preferința.");
    }
  }
}

function initTheme() {
  ["#auth-theme-toggle", "#app-theme-toggle"].forEach(selector => {
    $(selector).addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      applyTheme(currentTheme === "dark" ? "light" : "dark", true);
    });
  });
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  applyTheme(theme);
}

function readSolarSettings() {
  return {
    power: Number($("#system-power-input").value),
    investment: Number($("#investment-input").value),
    yieldPerKwp: Number($("#solar-yield-input").value),
    selfConsumptionPercent: Number($("#solar-self-consumption-input").value)
  };
}

function isValidSolarSettings(solar) {
  return solar && [solar.power, solar.investment, solar.yieldPerKwp, solar.selfConsumptionPercent].every(Number.isFinite) &&
    solar.power > 0 && solar.power <= 1000 &&
    solar.investment > 0 && solar.investment <= 100000000 &&
    solar.yieldPerKwp > 0 && solar.yieldPerKwp <= 3000 &&
    Number.isInteger(solar.selfConsumptionPercent) && solar.selfConsumptionPercent >= 0 && solar.selfConsumptionPercent <= 100;
}

function applySolarSettings(solar) {
  $("#system-power-input").value = String(solar.power);
  $("#investment-input").value = String(solar.investment);
  $("#solar-yield-input").value = String(solar.yieldPerKwp);
  $("#solar-self-consumption-input").value = String(solar.selfConsumptionPercent);
}

function saveAppState() {
  const state = {
    appliances,
    tariff,
    solar: readSolarSettings(),
    savingsPercent: Number($("#savings-slider").value),
    powerFactor: Number($("#pf-slider").value),
    cableLengthMeters: Number($("#cable-length").value),
    selectedPeriod,
    engineerMode: $("#engineer-mode").checked
  };
  try {
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast("Modificările sunt active, dar nu au putut fi salvate în acest browser.");
  }
}

function loadAppState() {
  let state;
  try {
    const stored = localStorage.getItem(APP_STATE_KEY);
    if (!stored) return;
    state = JSON.parse(stored);
  } catch (error) {
    showToast("Setările salvate nu au putut fi citite; au fost încărcate valorile implicite.");
    return;
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    showToast("Setările salvate sunt invalide; au fost încărcate valorile implicite.");
    return;
  }

  let invalid = false;
  if (Array.isArray(state.appliances) && state.appliances.every(item =>
    item && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.name === "string" && item.name.trim().length > 0 &&
    item.name.length <= 32 && Number.isFinite(item.watts) && item.watts > 0 && item.watts <= 50000 &&
    Number.isFinite(item.hours) && item.hours > 0 && item.hours <= 24
  ) && new Set(state.appliances.map(item => item.id)).size === state.appliances.length) {
    appliances = state.appliances.map((item, index) => ({
      id: item.id,
      name: item.name.trim(),
      watts: item.watts,
      hours: item.hours,
      color: /^#[\da-f]{6}$/i.test(item.color) ? item.color : ["#c6ff68", "#80d9a1", "#ffd36d", "#7dc6f2", "#b79af4", "#f394a4"][index % 6]
    }));
    nextApplianceId = appliances.reduce((maximum, item) => Math.max(maximum, item.id), 0) + 1;
  } else if (Object.hasOwn(state, "appliances")) invalid = true;

  if (Number.isFinite(state.tariff) && state.tariff >= 0 && state.tariff <= 10) {
    tariff = state.tariff;
    $("#tariff-input").value = String(tariff);
  } else if (Object.hasOwn(state, "tariff")) invalid = true;

  const solar = state.solar;
  if (isValidSolarSettings(solar)) {
    applySolarSettings(solar);
  } else if (Object.hasOwn(state, "solar")) invalid = true;

  if (Number.isInteger(state.savingsPercent) && state.savingsPercent >= 0 && state.savingsPercent <= 80) {
    $("#savings-slider").value = String(state.savingsPercent);
  } else if (Object.hasOwn(state, "savingsPercent")) invalid = true;

  if (Number.isFinite(state.powerFactor) && state.powerFactor >= 0.5 && state.powerFactor <= 1) {
    $("#pf-slider").value = String(state.powerFactor);
  } else if (Object.hasOwn(state, "powerFactor")) invalid = true;

  if (Number.isInteger(state.cableLengthMeters) && state.cableLengthMeters >= 1 && state.cableLengthMeters <= 500) {
    $("#cable-length").value = String(state.cableLengthMeters);
  } else if (Object.hasOwn(state, "cableLengthMeters")) invalid = true;

  if (["week", "month"].includes(state.selectedPeriod)) {
    selectedPeriod = state.selectedPeriod;
    $$(".period-button").forEach(button => button.classList.toggle("active", button.dataset.period === selectedPeriod));
  } else if (Object.hasOwn(state, "selectedPeriod")) invalid = true;

  if (typeof state.engineerMode === "boolean") {
    $("#engineer-mode").checked = state.engineerMode;
    document.body.classList.toggle("engineer-mode", state.engineerMode);
  } else if (Object.hasOwn(state, "engineerMode")) invalid = true;

  if (invalid) showToast("Unele setări salvate au fost ignorate deoarece valorile nu sunt valide.");
}

function showAuthError(message) {
  const element = document.querySelector("#auth-error");
  if (element) element.textContent = t(message);
}

function lockApplication() {
  localDemoSession = false;
  document.body.classList.remove("authenticated");
  $("#protected-app").setAttribute("aria-hidden", "true");
  $("#protected-app").inert = true;
  $("#protected-app").hidden = true;
  $("#auth-screen").hidden = false;
  $("#auth-email").focus({ preventScroll: true });
}

function applyAuthSession(user) {
  $("#auth-password").value = "";
  $("#auth-password-confirm").value = "";
  showAuthError("");
  document.body.classList.add("authenticated");
  $("#auth-screen").hidden = true;
  $("#protected-app").hidden = false;
  $("#protected-app").setAttribute("aria-hidden", "false");
  $("#protected-app").inert = false;
  const isGuest = user.isAnonymous || user.isLocalDemo;
  const email = user.email || "";
  const displayName = isGuest ? t("Vizitator") : (user.displayName || email || t("Cont Firebase"));
  const initials = isGuest ? "VC" : displayName.slice(0, 2).toLocaleUpperCase("ro");
  $(".profile-copy strong").textContent = displayName;
  $(".profile-copy span").textContent = t(user.isLocalDemo
    ? "Demo local · fără autentificare Firebase"
    : isGuest ? "Sesiune temporară Firebase" : "Cont Firebase securizat");
  $(".profile .profile-avatar").textContent = initials;
  $(".top-avatar").textContent = initials;
  $("#welcome-name").textContent = isGuest ? t("Vizitator") : displayName.split("@")[0];
  $("#account-button").innerHTML = `${t("Deconectare")} <span>↗</span>`;
  $("#account-button").title = t("Închide sesiunea și revino la ecranul de autentificare");
  if (!appInitialized) {
    init();
    appInitialized = true;
    loadWeatherForecast();
  }
  if (window.Chart) requestAnimationFrame(() => chartInstances.forEach(chart => chart && chart.resize()));
}

function hasFirebaseConfig() {
  const config = window.VoltConsumFirebaseConfig;
  const requiredFields = ["apiKey", "authDomain", "projectId", "appId"];
  return Boolean(config && requiredFields.every(key =>
    typeof config[key] === "string" && config[key].trim() && !config[key].startsWith("YOUR_")
  ));
}

function getFirebaseAuth() {
  if (!window.firebase || !window.firebase.auth) {
    throw new Error("Firebase Authentication nu s-a încărcat. Verifică conexiunea la internet și reîncarcă pagina.");
  }
  if (!hasFirebaseConfig()) {
    throw new Error("Configurează firebase-config.js cu setările Web Firebase și activează furnizorul în Firebase Console.");
  }
  const config = window.VoltConsumFirebaseConfig;
  if (!window.firebase.apps.length) window.firebase.initializeApp(config);
  return window.firebase.auth();
}

function getSocialAuthError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "Există deja un cont pentru această adresă. Conectează-te în schimb.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Emailul sau parola sunt incorecte.";
    case "auth/weak-password":
      return "Alege o parolă mai puternică, de cel puțin 8 caractere.";
    case "auth/invalid-email":
      return "Introdu o adresă de email validă.";
    case "auth/too-many-requests":
      return "Au fost prea multe încercări. Așteaptă puțin și încearcă din nou.";
    case "auth/network-request-failed":
      return "Conexiunea la Firebase a eșuat. Verifică internetul și încearcă din nou.";
    case "auth/admin-restricted-operation":
      return "Activează metoda selectată în Firebase Console → Authentication → Sign-in method.";
    case "auth/unauthorized-domain":
      return "Domeniul acestei pagini nu este autorizat în Firebase Authentication.";
    case "auth/operation-not-allowed":
      return "Activează metoda selectată în Firebase Console → Authentication → Sign-in method.";
    case "auth/popup-blocked":
      return "Popup-ul de conectare a fost blocat. Permite ferestrele popup și încearcă din nou.";
    case "auth/popup-closed-by-user":
      return "Conectarea a fost anulată înainte de finalizare.";
    default:
      return "Conectarea socială a eșuat. Verifică setările furnizorului și încearcă din nou.";
  }
}

async function signInWithSocialProvider(providerName) {
  if (socialAuthInProgress) return;
  socialAuthInProgress = true;
  const button = $(`#${providerName}-login`);
  const originalMarkup = button.innerHTML;
  const otherButton = $("#google-login") === button ? $("#facebook-login") : $("#google-login");
  button.disabled = true;
  otherButton.disabled = true;
  $("#auth-submit").disabled = true;
  $("#guest-login").disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = t(providerName === "google" ? "Se conectează cu Google..." : "Se conectează cu Facebook...");
  showAuthError("");
  let auth;
  try {
    auth = getFirebaseAuth();
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    const provider = providerName === "google"
      ? new window.firebase.auth.GoogleAuthProvider()
      : new window.firebase.auth.FacebookAuthProvider();
    if (providerName === "google") provider.setCustomParameters({ prompt: "select_account" });
    else provider.addScope("email");
    const result = await auth.signInWithPopup(provider);
    if (!result.user?.email) {
      await auth.signOut();
      throw new Error("Furnizorul nu a returnat o adresă de email. Permite partajarea emailului și încearcă din nou.");
    }
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    applyAuthSession(result.user);
  } catch (error) {
    showAuthError(error instanceof Error && !error.code ? error.message : getSocialAuthError(error));
  } finally {
    socialAuthInProgress = false;
    button.disabled = false;
    otherButton.disabled = false;
    $("#auth-submit").disabled = false;
    $("#guest-login").disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = originalMarkup;
  }
}

async function submitAuth(event) {
  event.preventDefault();
  showAuthError("");
  const email = $("#auth-email").value.trim().toLocaleLowerCase("ro");
  const password = $("#auth-password").value;
  const submit = $("#auth-submit");
  const confirmPassword = $("#auth-password-confirm").value;
  if (!email || !$("#auth-email").validity.valid || password.length < 8) {
    showAuthError("Introdu o adresă de email validă și o parolă de cel puțin 8 caractere.");
    return;
  }
  if (authMode === "signup" && password !== confirmPassword) {
    showAuthError("Parolele nu coincid. Verifică și încearcă din nou.");
    return;
  }
  submit.disabled = true;
  $("#guest-login").disabled = true;
  submit.textContent = t(authMode === "signup" ? "Se creează contul..." : "Se verifică datele...");
  try {
    const auth = getFirebaseAuth();
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    if (authMode === "signup") {
      await auth.createUserWithEmailAndPassword(email, password);
    } else {
      await auth.signInWithEmailAndPassword(email, password);
    }
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (auth.currentUser) applyAuthSession(auth.currentUser);
  } catch (error) {
    showAuthError(error instanceof Error && !error.code ? error.message : getSocialAuthError(error));
  } finally {
    submit.disabled = false;
    $("#guest-login").disabled = false;
    updateAuthForm(false);
  }
}

function updateAuthForm(clearError = true) {
  const creatingAccount = authMode === "signup";
  $("#signin-tab").classList.toggle("active", !creatingAccount);
  $("#signup-tab").classList.toggle("active", creatingAccount);
  $("#signin-tab").setAttribute("aria-selected", String(!creatingAccount));
  $("#signup-tab").setAttribute("aria-selected", String(creatingAccount));
  $("#auth-title").textContent = t(creatingAccount ? "Creează-ți contul." : "Bine ai revenit.");
  $("#auth-password").autocomplete = creatingAccount ? "new-password" : "current-password";
  $(".confirm-password-label").hidden = !creatingAccount;
  $("#auth-password-confirm").hidden = !creatingAccount;
  $("#auth-password-confirm").required = creatingAccount;
  $("#password-hint").hidden = !creatingAccount;
  $("#auth-submit").innerHTML = creatingAccount ? `${t("Creează contul")} <span>→</span>` : `${t("Conectează-te")} <span>→</span>`;
  if (clearError) showAuthError("");
}

async function signInAsGuest() {
  if (socialAuthInProgress) return;
  socialAuthInProgress = true;
  const button = $("#guest-login");
  button.disabled = true;
  $("#auth-submit").disabled = true;
  showAuthError("");
  try {
    if (!hasFirebaseConfig()) {
      localDemoSession = true;
      showAuthError("");
      applyAuthSession({ isAnonymous: true, isLocalDemo: true });
      showToast("Demo local fără autentificare Firebase. Sesiunea se închide la reîncărcarea paginii.");
      return;
    }
    const auth = getFirebaseAuth();
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    await auth.signInAnonymously();
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  } catch (error) {
    showAuthError(error instanceof Error && !error.code ? error.message : getSocialAuthError(error));
  } finally {
    socialAuthInProgress = false;
    button.disabled = false;
    $("#auth-submit").disabled = false;
  }
}

function initAuth() {
  initTheme();
  const firebaseConfigured = hasFirebaseConfig();
  $("#guest-login-label").textContent = t(firebaseConfigured ? "Intră ca oaspete / demo" : "Intră în demo local");
  $("#guest-mode-note").textContent = t(firebaseConfigured
    ? "Sesiunea de oaspete folosește Firebase Authentication."
    : "Firebase nu este configurat. Demo-ul local nu autentifică utilizatori și sesiunea se pierde la reîncărcare.");
  if (!firebaseConfigured) {
    $("#auth-disclaimer-copy").textContent = t("Emailul și autentificarea socială necesită configurarea Firebase. Demo-ul local nu este un cont autentificat; datele calculatorului rămân numai în acest browser.");
  }
  $("#auth-form").addEventListener("submit", submitAuth);
  $("#signin-tab").addEventListener("click", () => { authMode = "signin"; updateAuthForm(); });
  $("#signup-tab").addEventListener("click", () => { authMode = "signup"; updateAuthForm(); });
  $("#guest-login").addEventListener("click", signInAsGuest);
  $("#google-login").addEventListener("click", () => signInWithSocialProvider("google"));
  $("#facebook-login").addEventListener("click", () => signInWithSocialProvider("facebook"));
  $("#account-button").addEventListener("click", async () => {
    $("#auth-password").value = "";
    $("#auth-password-confirm").value = "";
    if (localDemoSession) {
      lockApplication();
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      return;
    }
    try {
      await getFirebaseAuth().signOut();
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch (error) {
      showAuthError(error instanceof Error && !error.code ? error.message : getSocialAuthError(error));
    }
  });
  window.addEventListener("hashchange", () => {
    if (!document.body.classList.contains("authenticated") && location.hash) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  });
  document.addEventListener("click", event => {
    if (!document.body.classList.contains("authenticated") && event.target.closest("a[href^='#']")) {
      event.preventDefault();
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      lockApplication();
    }
  }, true);
  lockApplication();
  if (!hasFirebaseConfig()) return;
  try {
    getFirebaseAuth().onAuthStateChanged(user => {
      if (user) {
        applyAuthSession(user);
      } else {
        lockApplication();
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      }
    }, error => {
      lockApplication();
      showAuthError(getSocialAuthError(error));
    });
  } catch (error) {
    lockApplication();
    showAuthError(error instanceof Error ? error.message : "Configurează Firebase Authentication pentru a continua.");
  }
}

const articles = [
  { category: "RECOMANDARE OFICIALĂ", date: "MINISTERUL ENERGIEI · MD", title: "Ministerul Energiei recomandă reducerea consumului în orele de vârf", summary: "Ministerul Energiei al Republicii Moldova îndeamnă consumatorii să reducă folosirea energiei electrice în două intervale de vârf: 07:00–10:00 dimineața și 18:00–23:00 seara. Instituția explică faptul că efortul colectiv poate contribui la securitatea energetică a țării și la reducerea costurilor de procurare a energiei. Pentru gospodării, mesajul practic este să reprogrameze, atunci când este posibil, aparatele flexibile — precum mașina de spălat sau încărcarea unui vehicul electric — în afara acestor ore. Recomandarea nu indică o economie individuală garantată; efectul depinde de profilul de consum și de modul de funcționare al sistemului energetic.", className: "solar", artLabel: "CONSUM · MD", image: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=900&q=82", imageAlt: "Rețea de transport a energiei electrice", source: "https://energie.gov.md/ro", sourceName: "Ministerul Energiei al Republicii Moldova" },
  { category: "INFRASTRUCTURĂ · MD", date: "MOLDELECTRICA · PROIECTE", title: "Proiecte de interconectare și modernizare a rețelei", summary: "Moldelectrica prezintă proiecte precum linia de 400 kV Vulcănești–Chișinău și interconexiunea Bălți–Suceava, alături de lucrări la stațiile electrice din Chișinău, Vulcănești și Bălți. Operatorul descrie aceste investiții ca proiecte de consolidare a sistemului energetic național. Pentru stadiul curent, calendar și detalii tehnice, consultă pagina oficială; proiectele de infrastructură nu reprezintă o prognoză a facturii casnice.", className: "smart", artLabel: "REȚEA · MOLDOVA", image: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=900&q=82", imageAlt: "Rețea de transport a energiei electrice din Republica Moldova", source: "https://moldelectrica.md/ro/", sourceName: "Moldelectrica" },
  { category: "EFICIENȚĂ ENERGETICĂ · MD", date: "PREMIER ENERGY · INFORMAȚII UTILE", title: "Recomandări de eficiență energetică pentru consumatori", summary: "Premier Energy publică recomandări pentru utilizarea rațională a energiei electrice și pune la dispoziție un simulator de consum. Compară rezultatul simulatorului cu propriile facturi și verifică pe pagina furnizorului dacă recomandările sau intervalele menționate se aplică situației tale. Prețurile și condițiile contractuale trebuie confirmate direct la furnizor și la autoritatea de reglementare.", className: "efficiency", artLabel: "EFICIENȚĂ · MD", image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=82", imageAlt: "Iluminat eficient într-o locuință", source: "https://premierenergy.md/info-utile/sugestii-de-eficienta-energetica/", sourceName: "Premier Energy Moldova" },
  { category: "FOTOVOLTAICE", date: "IEA · ANALIZĂ DE PIAȚĂ", title: "Lanțul de aprovizionare solar depinde de materiale și comerț", summary: "Analiza IEA asupra lanțurilor globale de aprovizionare fotovoltaică evidențiază două aspecte măsurabile. Într-un scenariu aliniat la zero emisii nete, cererea de argint pentru fabricarea panourilor solare ar putea depăși în 2030 echivalentul a 30% din producția mondială totală de argint din 2020, față de aproximativ 10% în prezent. Separat, raportul numără 16 taxe și măsuri de import aplicate unor segmente ale lanțului fotovoltaic, față de una în 2011, și încă opt politici în discuție; măsurile acoperă 15% din cererea globală din afara Chinei. Acestea sunt estimări și date globale din analiza citată, nu prețuri ori prognoze locale.", className: "market", artLabel: "IEA · SOLAR PV", image: "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=82", imageAlt: "Panouri fotovoltaice într-un parc solar", source: "https://www.iea.org/reports/solar-pv-global-supply-chains/executive-summary", sourceName: "Agenția Internațională a Energiei (IEA)" }
];

const guidePoints = [
  [
    ["Notează indexul contorului și data citirii la începutul și la sfârșitul perioadei; diferența în kWh este baza comparației.", "Записывайте показания счётчика и даты в начале и конце периода; разница в кВт·ч — основа для сравнения.", "Record meter readings and dates at the start and end of the period; the kWh difference is the basis for comparison."],
    ["Verifică prețul final aplicabil categoriei tale în factura și oferta curentă a furnizorului; tarifele se pot modifica.", "Проверьте итоговый тариф для вашей категории в счёте и актуальном предложении поставщика; тарифы могут меняться.", "Check the final rate for your customer category on your bill and your supplier's current offer; tariffs can change."],
    ["Separă energia consumată de soldul anterior, penalități sau servicii distincte: totalul de plată nu este întotdeauna doar kWh × tarif.", "Отделяйте стоимость потреблённой энергии от прежней задолженности, пени и отдельных услуг: сумма к оплате не всегда равна только кВт·ч × тариф.", "Separate energy charges from prior balances, penalties, or separate services: the total due is not always just kWh × tariff."]
  ],
  [
    ["Estimarea de bază este puterea medie consumată în kW × orele de funcționare; pentru aparate cu cicluri, folosește energia pe ciclu indicată de producător.", "Базовая оценка: средняя потребляемая мощность в кВт × часы работы; для приборов с циклами используйте указанную производителем энергию за цикл.", "A basic estimate is average power draw in kW × operating hours; for cycle-based appliances, use the manufacturer's stated energy per cycle."],
    ["Eticheta indică valori de test sau o clasă, nu neapărat consumul exact din casa ta; programul, încărcarea și temperatura schimbă rezultatul.", "Этикетка указывает результаты испытаний или класс, а не обязательно фактическое потребление у вас дома; программа, загрузка и температура влияют на результат.", "The label gives test values or a class, not necessarily your home's exact usage; program, load, and temperature change the result."],
    ["Măsoară aparatele cu un contor de priză compatibil; nu conecta prin astfel de dispozitive consumatori mari dacă limita lor nu este potrivită.", "Измеряйте приборы совместимым розеточным ваттметром; не подключайте через него мощные нагрузки, если прибор не рассчитан на них.", "Measure appliances with a compatible plug-in energy meter; do not connect high-load equipment unless the meter is rated for it."]
  ],
  [
    ["Compară facturile lunare și notează lunile de încălzire; consumul sezonier nu se compară corect cu o singură lună de vară.", "Сравнивайте ежемесячные счета и отмечайте отопительный сезон; сезонное потребление нельзя корректно оценить по одному летнему месяцу.", "Compare monthly bills and mark the heating season; seasonal usage cannot be fairly assessed from one summer month."],
    ["Redu pierderile prin etanșarea golurilor și izolarea potrivită clădirii, fără a bloca ventilarea necesară.", "Снижайте теплопотери, уплотняя щели и выбирая подходящую зданию изоляцию, не перекрывая необходимую вентиляцию.", "Reduce heat loss by sealing gaps and choosing insulation suited to the building, without blocking necessary ventilation."],
    ["Pentru comparație înainte/după, ține cont de vreme, temperatura din locuință și numărul de persoane; toate influențează factura.", "При сравнении до и после учитывайте погоду, температуру в доме и число жильцов: всё это влияет на счёт.", "When comparing before and after, account for weather, indoor temperature, and occupancy; all affect the bill."]
  ],
  [
    ["kWp este puterea nominală a panourilor în condiții de test; producția reală variază cu sezonul, orientarea, umbrirea și temperatura.", "кВтп — номинальная мощность панелей в испытательных условиях; фактическая выработка зависит от сезона, ориентации, тени и температуры.", "kWp is the panels' rated output under test conditions; actual generation varies with season, orientation, shading, and temperature."],
    ["Cere estimarea pe luni, nu doar un total anual, și solicită ipotezele despre acoperiș, umbrire, invertor și pierderi.", "Запрашивайте помесячный прогноз, а не только годовую сумму, и уточняйте предположения о крыше, затенении, инверторе и потерях.", "Ask for a monthly yield estimate, not only an annual total, and request assumptions about roof, shade, inverter, and losses."],
    ["Compară oferte cu aceeași putere și aceleași componente incluse; verifică garanțiile și costurile de instalare în scris.", "Сравнивайте предложения с одинаковой мощностью и составом оборудования; проверяйте гарантии и стоимость монтажа письменно.", "Compare quotes with the same capacity and included components; check warranties and installation costs in writing."]
  ],
  [
    ["Capacitatea nominală nu este întotdeauna energia utilizabilă; verifică energia disponibilă, puterea maximă și rezerva setată.", "Номинальная ёмкость не всегда равна доступной энергии; уточните полезную энергию, максимальную мощность и заданный резерв.", "Nominal capacity is not always usable energy; check usable capacity, maximum output, and the configured reserve."],
    ["Încărcarea și descărcarea au pierderi, iar performanța depinde de temperatură, putere și modul de utilizare.", "При зарядке и разрядке есть потери; эффективность зависит от температуры, мощности и режима использования.", "Charging and discharging incur losses; performance depends on temperature, power, and usage pattern."],
    ["Cere durata garanției, condițiile de păstrare a capacității și numărul de cicluri; calculează economiile din energia efectiv folosită.", "Уточните срок гарантии, условия сохранения ёмкости и число циклов; рассчитывайте экономию по фактически используемой энергии.", "Ask about warranty duration, capacity-retention terms, and cycle count; estimate savings from energy actually used."]
  ],
  [
    ["SCOP descrie eficiența sezonieră estimată, dar consumul casei depinde și de izolație, temperaturile cerute și dimensionarea sistemului.", "SCOP описывает расчётную сезонную эффективность, но потребление дома также зависит от изоляции, требуемой температуры и размера системы.", "SCOP describes estimated seasonal efficiency, but home usage also depends on insulation, required temperatures, and system sizing."],
    ["Solicită calculul necesarului de căldură pe încăperi și verifică dacă radiatoarele sau încălzirea în pardoseală sunt potrivite.", "Попросите расчёт теплопотерь по помещениям и проверьте совместимость радиаторов или тёплого пола.", "Request a room-by-room heat-loss calculation and check whether radiators or underfloor heating are suitable."],
    ["Compară consumul electric măsurat cu energia termică livrată; nu compara direct kWh electrici cu kWh de combustibil fără randament.", "Сравнивайте измеренное потребление электричества с поданным теплом; не сопоставляйте напрямую кВт·ч электричества и топлива без учёта КПД.", "Compare measured electricity use with delivered heat; do not compare electric and fuel kWh directly without accounting for efficiency."]
  ],
  [
    ["Răcește doar încăperea folosită și ține ușile și ferestrele închise în timpul funcționării.", "Охлаждайте только используемое помещение и держите двери и окна закрытыми во время работы.", "Cool only the room in use and keep doors and windows closed while the unit is operating."],
    ["Curăță filtrele conform manualului și cere verificarea echipamentului dacă răcirea slăbește sau apar zgomote neobișnuite.", "Очищайте фильтры по инструкции и закажите проверку, если охлаждение ухудшилось или появился необычный шум.", "Clean filters according to the manual and arrange an inspection if cooling weakens or unusual noises appear."],
    ["Pentru cost, măsoară kWh pe perioadă; puterea nominală nu înseamnă că aparatul consumă constant acea putere.", "Для оценки расходов измеряйте кВт·ч за период; номинальная мощность не означает постоянное потребление на этом уровне.", "For cost estimates, measure kWh over time; rated power does not mean the unit draws that power continuously."]
  ],
  [
    ["Începe cu evaluarea pierderilor la acoperiș, pereți, ferestre și podea; soluția depinde de construcția locuinței.", "Начните с оценки потерь через крышу, стены, окна и пол; решение зависит от конструкции дома.", "Start by assessing heat loss through the roof, walls, windows, and floor; the solution depends on the building."],
    ["Planifică ventilarea și controlul umezelii împreună cu izolarea; lucrările nepotrivite pot favoriza condensul și mucegaiul.", "Планируйте вентиляцию и контроль влажности вместе с утеплением; неподходящие работы могут вызвать конденсат и плесень.", "Plan ventilation and moisture control alongside insulation; unsuitable work can encourage condensation and mould."],
    ["Păstrează facturile și compară perioade similare ca durată și vreme; astfel poți verifica dacă lucrarea a redus consumul.", "Сохраняйте счета и сравнивайте периоды одинаковой длительности и погоды; так можно проверить эффект утепления.", "Keep bills and compare periods with similar duration and weather to check whether the work reduced usage."]
  ],
  [
    ["Estimează energia din distanța parcursă și consumul mașinii în kWh/100 km; consumul real depinde de anotimp și traseu.", "Оцените энергию по пробегу и расходу автомобиля в кВт·ч/100 км; фактическое потребление зависит от сезона и маршрута.", "Estimate energy from distance driven and the vehicle's kWh/100 km; actual use depends on season and route."],
    ["Adaugă pierderile de încărcare folosind măsurarea contorului sau datele producătorului; energia din baterie poate fi mai mică decât cea luată din rețea.", "Учитывайте потери зарядки по счётчику или данным производителя: энергия в батарее может быть меньше взятой из сети.", "Account for charging losses using meter readings or manufacturer data; battery energy can be lower than energy drawn from the grid."],
    ["Înainte de instalarea unui wallbox, cere unui electrician calificat să verifice circuitul, protecțiile și puterea disponibilă.", "Перед установкой настенной зарядной станции попросите квалифицированного электрика проверить линию, защиту и доступную мощность.", "Before installing a wallbox, have a qualified electrician check the circuit, protection, and available supply capacity."]
  ],
  [
    ["Cere furnizorului tariful actual pentru categoria ta și verifică dacă există opțiuni cu intervale orare.", "Запросите у поставщика действующий тариф для вашей категории и уточните наличие тарифов по времени суток.", "Ask your supplier for the current rate for your customer category and whether time-of-use options are available."],
    ["Nu presupune că mutarea consumului este automat mai ieftină; compară condițiile, intervalele și costul total din ofertă.", "Не считайте перенос потребления автоматически более дешёвым: сравните условия, интервалы и полную стоимость предложения.", "Do not assume shifting usage is automatically cheaper; compare terms, time periods, and total offer cost."],
    ["Verifică periodic comunicările furnizorului și ANRE; tarifele și regulile comerciale se pot actualiza.", "Периодически проверяйте сообщения поставщика и НАРЭ: тарифы и коммерческие условия могут обновляться.", "Check supplier and ANRE notices periodically; tariffs and commercial terms may be updated."]
  ],
  [
    ["Măsoară consumul înainte de instalarea unei prize inteligente și după aceea în același interval de utilizare.", "Измерьте потребление до установки умной розетки и после неё за одинаковый период использования.", "Measure usage before and after installing a smart plug over comparable operating periods."],
    ["Automatizează doar aparatele compatibile; nu întrerupe alimentarea frigiderului, echipamentelor medicale sau dispozitivelor care trebuie să rămână pornite.", "Автоматизируйте только совместимые приборы; не отключайте холодильник, медицинское оборудование и устройства, которым нужно постоянное питание.", "Automate only compatible appliances; do not interrupt power to refrigerators, medical equipment, or devices that must stay on."],
    ["Verifică sarcina maximă admisă și protecția prizei; nu folosi temporizatoare subdimensionate pentru consumatori puternici.", "Проверьте допустимую нагрузку и защиту розетки; не используйте маломощные таймеры для мощных приборов.", "Check the rated load and outlet protection; do not use undersized timers for high-power appliances."]
  ],
  [
    ["Verifică perioada facturată, indexurile inițial și final și dacă citirea este reală sau estimată.", "Проверьте расчётный период, начальные и конечные показания, а также фактическая или расчётная это передача данных.", "Check the billing period, opening and closing readings, and whether the reading is actual or estimated."],
    ["Compară kWh facturați cu diferența dintre citirile contorului pentru aceeași perioadă și contactează furnizorul dacă diferă.", "Сравните указанные кВт·ч с разницей показаний счётчика за тот же период; при расхождении обратитесь к поставщику.", "Compare billed kWh with the meter-reading difference for the same period and contact the supplier if they differ."],
    ["Verifică tariful, categoria de consum și eventualele ajustări sau solduri distincte; păstrează factura pentru clarificări.", "Проверьте тариф, категорию потребления и отдельные корректировки или остатки; сохраните счёт для уточнений.", "Check the tariff, customer category, and separate adjustments or balances; keep the bill for queries."]
  ],
  [
    ["Compară oferte pentru aceeași categorie și același consum anual, folosind prețul final și condițiile scrise.", "Сравнивайте предложения для одной категории и годового потребления, учитывая итоговую цену и письменные условия.", "Compare offers for the same customer category and annual usage, using final prices and written terms."],
    ["Verifică perioada contractului, metoda de facturare, canalele de reclamații și condițiile de modificare sau încetare.", "Проверьте срок договора, порядок выставления счетов, каналы подачи жалоб и условия изменения или расторжения.", "Check contract duration, billing method, complaint channels, and change or termination terms."],
    ["Confirmă informația actuală la furnizor și la ANRE; această pagină nu stabilește eligibilitatea sau tarifele oficiale.", "Подтвердите актуальные сведения у поставщика и НАРЭ; эта страница не определяет право на услугу или официальные тарифы.", "Confirm current information with the supplier and ANRE; this page does not determine eligibility or official rates."]
  ],
  [
    ["Adună cel puțin un an de facturi, dacă există, pentru a vedea variația sezonieră reală a gospodăriei.", "Соберите счета хотя бы за год, если они есть, чтобы увидеть фактические сезонные колебания домохозяйства.", "Collect at least a year's bills, if available, to see your household's actual seasonal variation."],
    ["Separă costurile recurente de lucrări, reparații sau achiziții unice și notează tariful aplicat fiecărei perioade.", "Отделяйте регулярные расходы от ремонта и разовых покупок, отмечая тариф для каждого периода.", "Separate recurring costs from repairs or one-off purchases and note the rate applied in each period."],
    ["Planifică o rezervă pe baza propriilor luni cu consum ridicat; nu folosi o medie națională ca predicție personală.", "Планируйте резерв по месяцам с высоким потреблением именно у вас; не используйте среднее по стране как личный прогноз.", "Plan a buffer using your own high-usage months; do not treat a national average as a personal forecast."]
  ],
  [
    ["Citește indexul contorului la date regulate și calculează diferența lunară în kWh.", "Регулярно записывайте показания счётчика и рассчитывайте месячную разницу в кВт·ч.", "Record meter readings regularly and calculate the monthly kWh difference."],
    ["Notează separat schimbările mari: încălzire electrică, boiler, aparate noi, număr de locatari sau perioade de absență.", "Отдельно отмечайте крупные изменения: электрическое отопление, бойлер, новые приборы, число жильцов или отсутствие дома.", "Record major changes separately: electric heating, a water heater, new appliances, occupancy, or time away."],
    ["Folosește media proprie pe mai multe luni pentru planificare; casele diferă ca suprafață, izolație și mod de folosire.", "Используйте собственное среднее за несколько месяцев для планирования: дома различаются площадью, изоляцией и режимом использования.", "Use your own multi-month average for planning; homes differ in size, insulation, and usage patterns."]
  ],
  [
    ["Înlocuiește becurile folosite cel mai mult cu LED-uri și compară puterea și fluxul luminos, nu doar forma becului.", "Замените наиболее используемые лампы на светодиодные и сравнивайте мощность и световой поток, а не только форму.", "Replace the most-used bulbs with LEDs and compare power and light output, not just bulb shape."],
    ["Folosește lumina naturală, stinge iluminatul nefolosit și iluminează zona de lucru; acestea sunt recomandări publicate de Premier Energy.", "Используйте дневной свет, выключайте ненужное освещение и освещайте рабочую зону — такие рекомендации публикует Premier Energy.", "Use daylight, switch off unused lights, and illuminate task areas; these measures are recommended by Premier Energy."],
    ["Verifică economiile prin kWh măsurați înainte și după; suma în MDL depinde de tariful tău.", "Проверяйте экономию по измеренным кВт·ч до и после; сумма в MDL зависит от вашего тарифа.", "Verify savings using measured kWh before and after; the MDL amount depends on your tariff."]
  ],
  [
    ["Verifică etanșarea ușilor și ferestrelor, dar nu bloca ventilarea prevăzută a încăperilor.", "Проверьте уплотнения дверей и окон, но не перекрывайте предусмотренную вентиляцию помещений.", "Check door and window seals, but do not block required room ventilation."],
    ["Întreține echipamentele de încălzire conform manualului; aparatele pe gaz trebuie verificate de un specialist calificat.", "Обслуживайте отопительное оборудование по инструкции производителя; газовые приборы должен проверять квалифицированный специалист.", "Maintain heating equipment according to the manufacturer's instructions; gas appliances should be inspected by a qualified professional."],
    ["Urmărește lunar indexurile și facturile pentru a observa din timp o creștere neobișnuită a consumului.", "Ежемесячно отслеживайте показания счётчиков и счета, чтобы вовремя заметить необычный рост потребления.", "Track meter readings and bills monthly to notice unusual increases in usage."]
  ],
  [
    ["Înainte de montaj, cere operatorului de rețea lista actuală de pași, documente și condiții tehnice pentru adresa ta.", "До монтажа запросите у сетевого оператора актуальный перечень этапов, документов и технических условий для вашего адреса.", "Before installation, ask the network operator for the current steps, documents, and technical conditions for your address."],
    ["Nu presupune că energia injectată se compensează automat unu-la-unu; verifică schema și contractul aplicabile la data proiectului.", "Не предполагайте автоматический взаимозачёт энергии один к одному; проверьте действующую на дату проекта схему и договор.", "Do not assume exported electricity is automatically credited one-for-one; check the scheme and contract applicable when you install."],
    ["Folosește un proiectant și instalator calificați; solicită protecții, schema electrică, măsurare și recepție conform cerințelor oficiale.", "Привлекайте квалифицированных проектировщика и монтажника; запросите защиту, электрическую схему, учёт и приёмку по официальным требованиям.", "Use qualified designers and installers; request protection, wiring diagrams, metering, and commissioning that meet official requirements."]
  ],
  [
    ["Calculează costul orientativ din energia luată din rețea și tariful aplicabil locului și orei de încărcare.", "Оцените стоимость по энергии, взятой из сети, и тарифу для места и времени зарядки.", "Estimate cost using energy drawn from the grid and the rate applicable to the charging location and time."],
    ["Consumul la 100 km variază cu temperatura, viteza, relief, încălzirea habitaclului și stilul de condus.", "Расход на 100 км зависит от температуры, скорости, рельефа, отопления салона и стиля вождения.", "Consumption per 100 km varies with temperature, speed, terrain, cabin heating, and driving style."],
    ["La încărcare acasă, cere unui electrician să dimensioneze circuitul; evită prelungitoare și prize deteriorate.", "Для домашней зарядки попросите электрика подобрать линию; не используйте удлинители и повреждённые розетки.", "For home charging, have an electrician size the circuit; avoid extension leads and damaged outlets."]
  ],
  [
    ["Cere o evaluare a pierderilor de căldură și verifică dacă instalația interioară poate funcționa eficient la temperaturile propuse.", "Попросите оценить теплопотери и проверьте, сможет ли внутренняя система эффективно работать при рекомендуемых температурах.", "Request a heat-loss assessment and check whether the indoor system can operate efficiently at the proposed temperatures."],
    ["Compară oferte care includ echipamentul, montajul, adaptările electrice și hidraulice, punerea în funcțiune și garanția.", "Сравнивайте предложения с оборудованием, монтажом, электрическими и гидравлическими работами, запуском и гарантией.", "Compare quotes covering equipment, installation, electrical and plumbing changes, commissioning, and warranty."],
    ["Solicită estimarea consumului anual și a căldurii livrate pe baza climei locale și a temperaturii interioare dorite.", "Запросите расчёт годового потребления и выработанного тепла с учётом местного климата и желаемой температуры в помещении.", "Request annual usage and delivered-heat estimates based on the local climate and desired indoor temperature."]
  ],
  [
    ["Verifică volumul măsurat, perioada, indexurile și unitățile indicate; nu confunda metri cubi cu kWh.", "Проверьте измеренный объём, период, показания и единицы; не путайте кубометры с кВт·ч.", "Check measured volume, billing period, readings, and units; do not confuse cubic metres with kWh."],
    ["Conversia gazului în energie depinde de puterea calorifică și factorii aplicați de furnizor; folosește datele de pe factura ta.", "Перевод газа в энергию зависит от теплоты сгорания и коэффициентов поставщика; используйте данные из своего счёта.", "Gas-to-energy conversion depends on calorific value and supplier factors; use the data on your own bill."],
    ["Pentru o neconcordanță, contactează furnizorul de gaze cu indexul și factura perioadei respective.", "При расхождении обратитесь к поставщику газа, указав показания счётчика и счёт за соответствующий период.", "For a discrepancy, contact your gas supplier with the meter reading and bill for that period."]
  ],
  [
    ["Setează încălzirea și apa caldă conform manualului aparatului și necesităților locuinței; evită setările extreme inutile.", "Настраивайте отопление и горячую воду по инструкции прибора и потребностям дома; избегайте ненужных крайних значений.", "Set heating and hot water according to the appliance manual and household needs; avoid unnecessarily extreme settings."],
    ["Verifică pierderile de apă caldă și izolează conductele numai cu materiale și soluții potrivite instalației.", "Проверьте потери горячей воды и утепляйте трубы только материалами и способом, подходящими для системы.", "Check for hot-water losses and insulate pipes only with materials and methods suitable for the system."],
    ["Nu repara singur instalația de gaz și nu bloca ventilația; lucrările și verificările se lasă specialiștilor calificați.", "Не ремонтируйте газовую систему самостоятельно и не перекрывайте вентиляцию; работы и проверки поручайте квалифицированным специалистам.", "Do not repair gas equipment yourself or block ventilation; leave installation and inspection to qualified professionals."]
  ]
];

const guides = [
  { title: "Reducerea facturii în Moldova", description: "Urmărește consumul în kWh, introdu tariful final de pe factura furnizorului și compară costul înainte și după schimbări.", href: "#calculator" },
  { title: "Consum electrocasnice", description: "Estimează consumul frigiderului, mașinii de spălat, boilerului și aparatelor în standby pe baza puterii și orelor de folosire.", href: "#calculator" },
  { title: "Încălzire și consum sezonier", description: "Compară în MDL scenarii pentru încălzire electrică și consumatori mari. Folosește facturile proprii, nu valori generale.", href: "#calculator" },
  { title: "Dimensionarea panourilor", description: "Testează puterea în kWp și producția anuală estimată pentru locația ta din Republica Moldova; rezultatul este orientativ.", href: "#solar" },
  { title: "Baterie pentru sistem fotovoltaic", description: "Evaluează cum capacitatea bateriei și energia mutată spre seară pot influența autoconsumul și amortizarea.", href: "#solar" },
  { title: "Pompă de căldură", description: "Calculează consumul electric estimat și discută dimensionarea, SCOP-ul și adaptarea instalației cu un specialist local.", href: "#calculator" },
  { title: "Aer condiționat", description: "Adaugă aparatul în calculator pentru a estima kWh și costul în MDL, în funcție de putere și timpul de utilizare.", href: "#calculator" },
  { title: "Izolarea locuinței", description: "Prioritizează pierderile de căldură și compară consumul înainte și după lucrări folosind citirile propriei gospodării.", href: "#savings" },
  { title: "Încărcarea mașinii electrice", description: "Estimează energia necesară pentru încărcarea acasă, apoi aplică tariful tău în MDL/kWh pentru un cost orientativ.", href: "#calculator" },
  { title: "Tarife și intervale de consum", description: "Verifică oferta și condițiile actuale la furnizorul tău din Republica Moldova înainte de a muta consumul pe anumite ore.", href: "#local-resources" },
  { title: "Automatizări pentru locuință", description: "Prizele inteligente și programatoarele te pot ajuta să măsori și să deplasezi consumul; verifică economiile cu date reale.", href: "#savings" },
  { title: "Cum citești factura la energie", description: "Compară indexul contorului și kWh facturați cu estimarea din VoltConsum și verifică tariful aplicat la furnizor.", href: "#calculator" },
  { title: "Furnizorul și contractul", description: "Consultă informațiile regulatorului și furnizorului pentru condițiile valabile în localitatea și categoria ta de consum.", href: "#local-resources" },
  { title: "Buget anual pentru utilități", description: "Folosește consumul lunar din facturi și tariful tău pentru a planifica cheltuielile în MDL, inclusiv lunile de iarnă.", href: "#calculator" },
  { title: "Consumul lunar al locuinței", description: "Construiește o estimare proprie în kWh din aparatele folosite; consumul depinde de locuință, anotimp și obiceiuri.", href: "#calculator" },
  { title: "Economisire de energie acasă", description: "Identifică aparatele cu utilizare frecventă și testează efectul reducerii consumului de iluminat.", href: "#savings" },
  { title: "Pregătirea locuinței pentru iarnă", description: "Planifică încălzirea și reducerea pierderilor, apoi urmărește consumul lunar în facturile din sezon.", href: "#calculator" },
  { title: "Panouri și racordare", description: "Estimează producția și amortizarea, apoi verifică la ANRE și la operator cerințele curente de racordare și statutul prosumatorului.", href: "#solar" },
  { title: "Mașină electrică în Republica Moldova", description: "Estimează costul încărcării în MDL cu tariful tău și ia în calcul diferențele dintre încărcarea acasă și cea publică.", href: "#calculator" },
  { title: "Instalarea unei pompe de căldură", description: "Compară investiția cu economiile estimate și cere proiectantului un calcul adaptat climei și locuinței tale.", href: "#solar" },
  { title: "Factură și consum de gaze", description: "Verifică volumul, perioada și componentele facturii de gaze la furnizor; instrumentele VoltConsum de aici estimează energia electrică.", href: "#local-resources" },
  { title: "Economisirea gazului și a apei calde", description: "Întreținerea instalației și reducerea pierderilor pot micșora consumul; confirmă măsurile potrivite cu un specialist autorizat.", href: "#savings" }
].map((guide, index) => ({ ...guide, points: guidePoints[index] }));

const guideSources = {
  0: { href: "https://anre.md/", label: "ANRE · reglementarea energiei" },
  1: { href: "https://premierenergy.md/info-utile/sugestii-de-eficienta-energetica/", label: "Premier Energy · recomandări de eficiență" },
  2: { href: "https://cned.gov.md/", label: "CNED · energie durabilă" },
  3: { href: "https://cned.gov.md/", label: "CNED · energie durabilă" },
  4: { href: "https://cned.gov.md/", label: "CNED · energie durabilă" },
  5: { href: "https://cned.gov.md/", label: "CNED · energie durabilă" },
  7: { href: "https://cned.gov.md/", label: "CNED · energie durabilă" },
  9: { href: "https://anre.md/", label: "ANRE · reglementarea energiei" },
  11: { href: "https://anre.md/", label: "ANRE · reglementarea energiei" },
  12: { href: "https://anre.md/", label: "ANRE · reglementarea energiei" },
  15: { href: "https://premierenergy.md/info-utile/sugestii-de-eficienta-energetica/", label: "Premier Energy · recomandări de eficiență" },
  16: { href: "https://premierenergy.md/info-utile/sugestii-de-eficienta-energetica/", label: "Premier Energy · recomandări de eficiență" },
  17: { href: "https://anre.md/", label: "ANRE · reglementarea energiei" },
  18: { href: "https://anre.md/", label: "ANRE · reglementarea energiei" },
  19: { href: "https://cned.gov.md/", label: "CNED · energie durabilă" },
  20: { href: "https://energocom.md/", label: "Energocom · informații despre gaze" },
  21: { href: "https://premierenergy.md/info-utile/sugestii-de-eficienta-energetica/", label: "Premier Energy · recomandări de eficiență" }
};

const resourceGroups = [
  {
    title: "Calculatoare VoltConsum · MDL",
    links: [
      ["Calculator consum și cost în MDL", "#calculator"],
      ["Calculator pe aparate", "#calculator"],
      ["Estimare sistem fotovoltaic", "#solar"],
      ["Economii la iluminat", "#savings"],
      ["Simulator de factor de putere", "#waveform-panel"]
    ]
  },
  {
    title: "Instituții și informații din Moldova",
    links: [
      ["Ministerul Energiei al Republicii Moldova", "https://energie.gov.md/ro"],
      ["ANRE · Agenția Națională pentru Reglementare în Energetică", "https://anre.md/"],
      ["CNED · Centrul Național pentru Energie Durabilă", "https://cned.gov.md/"],
      ["Moldelectrica · operatorul sistemului de transport", "https://moldelectrica.md/ro/"],
      ["Premier Energy Moldova · informații și eficiență", "https://premierenergy.md/"],
      ["Energocom · informații despre furnizare", "https://energocom.md/"]
    ]
  }
];

function format(value) {
  return formatter.format(Number.isFinite(value) ? value : 0);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = t(message);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function getDailyTotal() {
  return appliances.reduce((sum, item) => sum + item.watts * item.hours / 1000, 0);
}

function resetApplianceEditor() {
  editingApplianceId = null;
  $("#appliance-form").reset();
  $("#save-appliance").innerHTML = t("+ Adaugă");
  $("#cancel-edit-appliance").hidden = true;
}

function renderAppliances() {
  const body = $("#appliance-rows");
  body.replaceChildren();
  $("#appliance-count").textContent = String(appliances.length);
  appliances.forEach(item => {
    const row = document.createElement("tr");
    const daily = item.watts * item.hours / 1000;
    row.innerHTML = `<td>${escapeHtml(t(item.name))}</td><td>${integerFormatter.format(item.watts)} W</td><td>${format(item.hours)}</td><td>${format(daily)}</td><td><button class="edit-appliance" type="button" aria-label="${t("Editează ")}${escapeHtml(t(item.name))}" data-edit="${item.id}">✎</button><button class="delete-appliance" type="button" aria-label="${t("Șterge ")}${escapeHtml(t(item.name))}" data-delete="${item.id}">×</button></td>`;
    body.append(row);
  });
  const daily = getDailyTotal();
  const monthly = daily * 30;
  $("#daily-total").innerHTML = `${format(daily)} <small>kWh</small>`;
  $("#monthly-total").innerHTML = `${format(monthly)} <small>kWh</small>`;
  $("#monthly-cost").innerHTML = `${format(monthly * tariff)} <small>MDL</small>`;
  $("#today-kwh").textContent = format(daily);
  $("#today-cost").textContent = format(daily * tariff);
  $("#tariff-display").textContent = format(tariff);
  $("#appliance-total").textContent = format(daily);
  renderApplianceChart();
  renderLegend();
  updateCurrentReading();
}

function renderLegend() {
  const legend = $("#appliance-legend");
  legend.replaceChildren();
  const entries = appliances.map(item => ({ ...item, daily: item.watts * item.hours / 1000 }))
    .sort((a, b) => b.daily - a.daily);
  entries.forEach(item => {
    const el = document.createElement("div");
    el.className = "legend-item";
    el.innerHTML = `<i style="background:${item.color}"></i><span title="${escapeHtml(t(item.name))}">${escapeHtml(t(item.name))}</span><strong>${format(item.daily)}<small>kWh</small></strong>`;
    legend.append(el);
  });
}

function renderApplianceChart() {
  const canvas = $("#appliance-chart");
  const lightTheme = document.documentElement.dataset.theme === "light";
  if (window.Chart) {
    if (chartInstances[1]) chartInstances[1].destroy();
    const sorted = [...appliances].sort((a, b) => b.watts * b.hours - a.watts * a.hours);
    chartInstances[1] = new Chart(canvas, {
      type: "doughnut",
        data: { labels: sorted.map(item => t(item.name)), datasets: [{ data: sorted.map(item => item.watts * item.hours / 1000), backgroundColor: sorted.map(item => item.color), borderColor: lightTheme ? "#ffffff" : "#0d1815", borderWidth: 4, hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "76%", plugins: { legend: { display: false }, tooltip: { backgroundColor: lightTheme ? "#ffffff" : "#17231d", titleColor: lightTheme ? "#17231b" : "#edf5e9", bodyColor: lightTheme ? "#425348" : "#d1dfd1", callbacks: { label: context => ` ${format(context.raw)} ${t("kWh / zi")}` } } } }
    });
  } else {
    drawFallbackDoughnut(canvas);
  }
}

function drawFallbackDoughnut(canvas) {
  const ctx = canvas.getContext("2d");
  const box = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = box.width * scale;
  canvas.height = box.height * scale;
  ctx.scale(scale, scale);
  const total = getDailyTotal() || 1;
  let start = -Math.PI / 2;
  appliances.forEach(item => {
    const end = start + item.watts * item.hours / 1000 / total * Math.PI * 2;
    ctx.beginPath(); ctx.arc(box.width / 2, box.height / 2, box.width * .39, start, end);
    ctx.lineWidth = box.width * .1; ctx.strokeStyle = item.color; ctx.stroke(); start = end;
  });
}

function renderConsumptionChart() {
  const canvas = $("#consumption-chart");
  const lightTheme = document.documentElement.dataset.theme === "light";
  const chartText = lightTheme ? "#435349" : "#b7c4ba";
  const chartGrid = lightTheme ? "#e3e9e2" : "#1d2922";
  const orderedWeekdays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(2024, 0, 7 + index);
    return new Intl.DateTimeFormat(document.documentElement.lang, { weekday: "short" }).format(day);
  });
  const today = new Date();
  const weekLabels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    return orderedWeekdays[date.getDay()];
  });
  const weekData = [6.9, 8.1, 7.5, 9.3, 6.8, 8.6, getDailyTotal()];
  const monthLabels = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 30 + Math.round(index * 30 / 7));
    return new Intl.DateTimeFormat(document.documentElement.lang === "ro" ? "ro-MD" : document.documentElement.lang, { day: "numeric", month: "short" }).format(date);
  });
  const monthFactors = [1.03, .94, 1.1, .96, 1.04, .9, 1.02, 1.01];
  const monthData = monthFactors.map(factor => getDailyTotal() * 3.75 * factor);
  const labels = selectedPeriod === "week" ? weekLabels : monthLabels;
  const data = selectedPeriod === "week" ? weekData : monthData;
  const previous = data.map((value, index) => value * (index % 2 ? 1.11 : .94));
  const total = data.reduce((sum, value) => sum + value, 0);
  const previousTotal = previous.reduce((sum, value) => sum + value, 0);
  const change = previousTotal > 0 ? (total - previousTotal) / previousTotal * 100 : 0;
  $("#chart-total").innerHTML = `${format(total)} <small>kWh</small>`;
  $("#period-comparison").textContent = previousTotal > 0
    ? `${change <= 0 ? "↓" : "↑"} ${format(Math.abs(change))}% ${t("vs. anterior")}`
    : `— ${t("fără date de comparație")}`;
  if (window.Chart) {
    if (chartInstances[0]) chartInstances[0].destroy();
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    const consumptionColor = lightTheme ? "#527d26" : "#c6ff68";
    const previousColor = lightTheme ? "#8996a6" : "#3a4a40";
    const gradientColor = lightTheme ? "rgba(82, 125, 38, .16)" : "rgba(190, 247, 98, .23)";
    gradient.addColorStop(0, gradientColor);
    gradient.addColorStop(1, lightTheme ? "rgba(82, 125, 38, 0)" : "rgba(190, 247, 98, 0)");
    chartInstances[0] = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ label: t("Consum"), data, borderColor: consumptionColor, backgroundColor: gradient, borderWidth: 2.5, fill: true, tension: .38, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: consumptionColor }, { label: t("Perioada anterioară"), data: previous, borderColor: previousColor, borderWidth: 1.5, borderDash: [4, 5], fill: false, tension: .38, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, plugins: { legend: { display: false }, tooltip: { backgroundColor: lightTheme ? "#ffffff" : "#17231d", titleColor: lightTheme ? "#17231b" : "#edf5e9", bodyColor: lightTheme ? "#425348" : "#d1dfd1", callbacks: { label: context => ` ${context.dataset.label}: ${format(context.raw)} kWh` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: chartText, font: { family: "DM Mono", size: 10 } } }, y: { beginAtZero: true, border: { display: false }, grid: { color: chartGrid }, ticks: { color: chartText, font: { family: "DM Mono", size: 10 }, maxTicksLimit: 5, callback: value => `${value}` } } } }
    });
  } else {
    drawFallbackLine(canvas, labels, data, previous);
  }
}

function drawFallbackLine(canvas, labels, data, previous) {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const padding = { top: 12, right: 10, bottom: 24, left: 28 };
  const width = box.width - padding.left - padding.right;
  const height = box.height - padding.top - padding.bottom;
  const max = Math.ceil(Math.max(...data, ...previous) / 2) * 2 + 2;
  const point = (value, index, values) => ({
    x: padding.left + (values.length > 1 ? index / (values.length - 1) : .5) * width,
    y: padding.top + height - value / max * height
  });
  for (let value = 0; value <= max; value += max / 4) {
    const y = padding.top + height - value / max * height;
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(box.width - padding.right, y);
    ctx.strokeStyle = document.documentElement.dataset.theme === "light" ? "#e3e9e2" : "#1d2922"; ctx.lineWidth = 1; ctx.stroke();
  }
  const drawSeries = (values, color, dashed, fill) => {
    ctx.beginPath();
    values.forEach((value, index) => {
      const p = point(value, index, values);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    if (fill) {
      ctx.lineTo(point(values[values.length - 1], values.length - 1, values).x, padding.top + height);
      ctx.lineTo(padding.left, padding.top + height);
      ctx.closePath();
      ctx.fillStyle = document.documentElement.dataset.theme === "light" ? "rgba(117, 166, 54, .12)" : "rgba(190,247,98,.12)";
      ctx.fill();
    }
    ctx.beginPath();
    values.forEach((value, index) => {
      const p = point(value, index, values);
      if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 1 : 2;
    ctx.setLineDash(dashed ? [4, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const lightTheme = document.documentElement.dataset.theme === "light";
  drawSeries(previous, lightTheme ? "#aebbb0" : "#3a4a40", true, false);
  drawSeries(data, lightTheme ? "#66952d" : "#c6ff68", false, true);
  ctx.fillStyle = lightTheme ? "#435349" : "#b7c4ba";
  ctx.font = "10px 'DM Mono', monospace";
  ctx.textAlign = "center";
  labels.forEach((label, index) => {
    const p = point(0, index, labels);
    ctx.fillText(label, p.x, box.height - 5);
  });
}

function drawWaveform() {
  const canvas = $("#waveform");
  if (!canvas || !canvas.getClientRects().length) return;
  const box = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const pf = Number($("#pf-slider").value);
  const phase = Math.acos(pf);
  const center = box.height / 2;
  const amplitude = box.height * .35;
  const drawLine = (color, offset) => {
    ctx.beginPath();
    for (let x = 0; x <= box.width; x += 2) {
      const y = center - Math.sin((x / box.width) * Math.PI * 4 - offset) * amplitude;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
  };
  const lightTheme = document.documentElement.dataset.theme === "light";
  drawLine(lightTheme ? "#66952d" : "#c6ff68", 0);
  drawLine(lightTheme ? "#287fa8" : "#76c9f1", phase);
  $("#pf-output").textContent = pf.toFixed(2).replace(".", ",");
  updateCurrentReading();
}

function getElectricalEstimate() {
  const powerFactor = Number($("#pf-slider").value);
  const connectedPower = appliances.reduce((sum, item) => sum + item.watts, 0);
  const current = connectedPower / (NOMINAL_VOLTAGE * powerFactor);
  const length = Number($("#cable-length").value);
  if (!Number.isInteger(length) || length < 1 || length > 500) {
    return { powerFactor, connectedPower, current, length: null, voltageDrop: null, cableSection: null, sectionExceedsStandardRange: false };
  }
  if (connectedPower === 0) {
    return { powerFactor, connectedPower, current, length, voltageDrop: 0, cableSection: null, sectionExceedsStandardRange: false };
  }

  const requiredSection = 2 * length * current * COPPER_RESISTIVITY * powerFactor /
    (NOMINAL_VOLTAGE * MAX_VOLTAGE_DROP_PERCENT / 100);
  const recommendedSection = STANDARD_CABLE_SECTIONS.find(section => section >= requiredSection) ?? null;
  const calculationSection = recommendedSection ?? STANDARD_CABLE_SECTIONS[STANDARD_CABLE_SECTIONS.length - 1];
  const voltageDrop = 2 * length * current * COPPER_RESISTIVITY * powerFactor /
    (calculationSection * NOMINAL_VOLTAGE) * 100;
  return {
    powerFactor, connectedPower, current, length, voltageDrop, cableSection: recommendedSection,
    sectionExceedsStandardRange: recommendedSection === null
  };
}

function updateCurrentReading() {
  const estimate = getElectricalEstimate();
  $("#current-reading").textContent = `${format(estimate.current)} A`;
  if (estimate.length === null) {
    $("#voltage-drop").textContent = "—";
    $("#cable-section").textContent = "—";
    $("#engineering-note").textContent = t("Lungimea traseului trebuie să fie între 1 și 500 m.");
    return;
  }
  const sectionFormatter = new Intl.NumberFormat(
    document.documentElement.lang === "ro" ? "ro-MD" : document.documentElement.lang,
    { maximumFractionDigits: 1 }
  );
  $("#voltage-drop").textContent = `${format(estimate.voltageDrop)}%`;
  $("#cable-section").textContent = estimate.cableSection
    ? `${sectionFormatter.format(estimate.cableSection)} mm²`
    : estimate.sectionExceedsStandardRange
      ? `> ${integerFormatter.format(STANDARD_CABLE_SECTIONS[STANDARD_CABLE_SECTIONS.length - 1])} mm²`
      : "—";
  $("#engineering-note").textContent = window.VoltI18n.format(
    "Estimare orientativă: traseu de {length} m într-un sens, cupru la 20 °C, 230 V monofazat și toate puterile introduse simultan. Secțiunea urmărește doar o cădere de tensiune de cel mult 3%; nu verifică încălzirea conductorului, protecțiile sau metoda de montaj. Confirmă dimensionarea cu un electrician autorizat.",
    { length: integerFormatter.format(estimate.length) }
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function calculateSolar() {
  const { power, investment, yieldPerKwp, selfConsumptionPercent } = readSolarSettings();
  const monthlyProduction = power * yieldPerKwp / 12;
  const monthlySaving = monthlyProduction * selfConsumptionPercent / 100 * tariff;
  const payback = monthlySaving > 0 ? investment / (monthlySaving * 12) : null;
  $("#system-power-display").textContent = power.toFixed(1);
  $("#monthly-saving-display").textContent = integerFormatter.format(monthlySaving);
  $("#payback-display").textContent = payback === null ? "—" : payback.toFixed(1).replace(".", ",");
  $("#payback-unit").textContent = t(payback === null ? "nu se amortizează" : "ani");
  $("#self-use").textContent = new Intl.NumberFormat(
    document.documentElement.lang === "ro" ? "ro-MD" : document.documentElement.lang,
    { maximumFractionDigits: 1 }
  ).format(selfConsumptionPercent);
  $(".solar-system-panel .solar-estimate-note").textContent = window.VoltI18n.format(
    "Estimarea presupune că {percent}% din producție este autoconsumată; venitul din energia livrată în rețea nu este inclus.",
    { percent: integerFormatter.format(selfConsumptionPercent) }
  );
  $("#solar-today").textContent = format(power * yieldPerKwp / 365);
  updateTomorrowForecast(power);
}

function updateTomorrowForecast(power) {
  if (!weatherForecast || weatherForecast.tomorrowSolarYieldPerKw === null) {
    $("#tomorrow-production").textContent = "—";
    $("#production-bar").style.width = "0%";
    $("#solar-forecast-confidence").textContent = t("● INDISPONIBIL");
    $("#energy-recommendation").textContent = t("Estimarea solară este indisponibilă până la încărcarea prognozei de radiație.");
    return;
  }
  const production = power * weatherForecast.tomorrowSolarYieldPerKw;
  $("#tomorrow-production").textContent = format(production);
  $("#production-bar").style.width = `${Math.min(100, production / (power * 5) * 100)}%`;
  $("#solar-forecast-confidence").textContent = t("● ESTIMARE LIVE");
  $("#energy-recommendation").textContent = t(
    production >= 8
      ? "Prognoza indică producție solară bună. Programează consumatorii flexibili în jurul amiezii, dacă vremea permite."
      : production >= 3
        ? "Producție solară moderată estimată. Mută consumul flexibil în intervalul cu lumină din mijlocul zilei."
        : "Producție solară redusă estimată. Evită să te bazezi exclusiv pe panouri pentru consumatorii mari."
  );
}

function describeWeatherCode(code) {
  if (code === 0) return { label: "Senin", icon: "☀", art: "sunny" };
  if (code === 1) return { label: "Predominant senin", icon: "🌤", art: "partly-cloudy" };
  if (code === 2) return { label: "Parțial înnorat", icon: "⛅", art: "partly-cloudy" };
  if (code === 3) return { label: "Înnorat", icon: "☁", art: "cloudy" };
  if ([45, 48].includes(code)) return { label: "Ceață", icon: "〰", art: "cloudy" };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "Burniță", icon: "☂", art: "rainy" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Ploaie", icon: "☂", art: "rainy" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Ninsoare", icon: "❄", art: "snowy" };
  if ([95, 96, 99].includes(code)) return { label: "Furtună", icon: "ϟ", art: "stormy" };
  return { label: "Condiții variabile", icon: "☁", art: "cloudy" };
}

function forecastDayLabel(date, relativeDay) {
  if (relativeDay === 0) return t("ASTĂZI");
  if (relativeDay === 1) return t("MÂINE");
  const locale = document.documentElement.lang === "ro" ? "ro-MD" : document.documentElement.lang;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function updateDailyWeather(index, prefix, date) {
  const details = weatherForecast.daily;
  const weather = describeWeatherCode(details.weather_code[index]);
  const precipitation = details.precipitation_probability_max[index];
  $(`#${prefix}-forecast-label`).textContent = forecastDayLabel(date, index);
  $(`#${prefix}-forecast-icon`).textContent = weather.icon;
  $(`#${prefix}-forecast-icon`).setAttribute("aria-label", t(weather.label));
  $(`#${prefix}-high`).textContent = `${Math.round(details.temperature_2m_max[index])}°`;
  $(`#${prefix}-low`).textContent = `${Math.round(details.temperature_2m_min[index])}°`;
  $(`#${prefix}-precipitation`).textContent = Number.isFinite(precipitation) ? `${Math.round(precipitation)}%` : "—";
  $(`#${prefix}-precipitation-bar`).style.width = `${Number.isFinite(precipitation) ? Math.min(100, Math.max(0, precipitation)) : 0}%`;
}

function renderWeatherForecast() {
  if (!weatherForecast) return;
  const { current, daily } = weatherForecast;
  const currentWeather = describeWeatherCode(current.weather_code);
  $("#today-condition").textContent = t(currentWeather.label);
  $("#current-temperature").textContent = Math.round(current.temperature_2m);
  $("#current-weather-detail").textContent = window.VoltI18n.format(
    "Umiditate {humidity}% · Vânt {wind} km/h",
    { humidity: Math.round(current.relative_humidity_2m), wind: Math.round(current.wind_speed_10m) }
  );
  $("#today-weather-art").className = `weather-art ${currentWeather.art}`;
  updateDailyWeather(0, "today", daily.time[0]);
  updateDailyWeather(1, "tomorrow", daily.time[1]);
  $("#weather-live-status").classList.remove("weather-offline");
  $("#weather-status-label").textContent = t("LIVE");
}

function showWeatherError(message) {
  weatherErrorKey = message;
  $("#weather-error").textContent = t(message);
  $("#weather-error").hidden = false;
  $("#weather-live-status").classList.add("weather-offline");
  $("#weather-status-label").textContent = t("INDISPONIBIL");
  $("#today-condition").textContent = t("Prognoză indisponibilă");
  $("#current-temperature").textContent = "—";
  $("#current-weather-detail").textContent = t("Datele meteo nu sunt disponibile momentan.");
  $("#today-weather-art").className = "weather-art unavailable";
  ["today", "tomorrow"].forEach(prefix => {
    $(`#${prefix}-forecast-icon`).textContent = "—";
    $(`#${prefix}-high`).textContent = "—°";
    $(`#${prefix}-low`).textContent = "—°";
    $(`#${prefix}-precipitation`).textContent = "—";
    $(`#${prefix}-precipitation-bar`).style.width = "0%";
  });
  weatherForecast = null;
  updateTomorrowForecast(readSolarSettings().power);
}

async function loadWeatherForecast() {
  if (!appInitialized) return;
  if (weatherRequestController) weatherRequestController.abort();
  weatherRequestController = new AbortController();
  const controller = weatherRequestController;
  const timeout = setTimeout(() => controller.abort(), 12000);
  $("#weather-error").hidden = true;
  $("#weather-live-status").classList.remove("weather-offline");
  $("#weather-status-label").textContent = t("SE ÎNCARCĂ");
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(weatherLocation.latitude),
      longitude: String(weatherLocation.longitude),
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      hourly: "shortwave_radiation",
      forecast_days: "2",
      timezone: "auto"
    }).toString();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const requiredDaily = ["time", "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max"];
    if (!data.current || !data.daily || !data.hourly ||
        requiredDaily.some(key => !Array.isArray(data.daily[key]) || data.daily[key].length < 2) ||
        !Array.isArray(data.hourly.time) || !Array.isArray(data.hourly.shortwave_radiation)) {
      throw new Error("Răspunsul prognozei nu conține datele necesare.");
    }
    const currentValues = ["temperature_2m", "relative_humidity_2m", "weather_code", "wind_speed_10m"];
    if (currentValues.some(key => !Number.isFinite(data.current[key])) ||
        [0, 1].some(index => !Number.isFinite(data.daily.weather_code[index]) ||
          !Number.isFinite(data.daily.temperature_2m_max[index]) ||
          !Number.isFinite(data.daily.temperature_2m_min[index]))) {
      throw new Error("Răspunsul prognozei conține valori incomplete.");
    }
    const tomorrow = data.daily.time[1];
    const solarSamples = data.hourly.time.reduce((samples, time, index) => {
      if (time.startsWith(tomorrow) && Number.isFinite(data.hourly.shortwave_radiation[index])) {
        samples.push(data.hourly.shortwave_radiation[index]);
      }
      return samples;
    }, []);
    const solarYieldPerKw = solarSamples.length >= 12
      ? solarSamples.reduce((sum, radiation) => sum + radiation, 0) / 1000 * WEATHER_PERFORMANCE_RATIO
      : null;
    weatherForecast = {
      current: data.current,
      daily: data.daily,
      tomorrowSolarYieldPerKw: solarYieldPerKw
    };
    weatherErrorKey = null;
    renderWeatherForecast();
    calculateSolar();
  } catch (error) {
    if (error.name === "AbortError" && controller !== weatherRequestController) return;
    showWeatherError(error.name === "AbortError"
      ? "Prognoza meteo nu a răspuns în timp util. Încearcă din nou."
      : "Prognoza live nu este disponibilă acum. Verifică conexiunea și încearcă din nou.");
  } finally {
    clearTimeout(timeout);
  }
}

function renderElectricians() {
  const grid = $("#electricians-grid");
  grid.replaceChildren();
  const card = document.createElement("article");
  card.className = "electrician-source-card";
  const icon = document.createElement("div");
  icon.className = "source-card-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◈";
  const content = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "section-kicker";
  kicker.textContent = t("SURSA OFICIALĂ · ANRE");
  const heading = document.createElement("h3");
  heading.textContent = t("Registrul electricienilor nu este conectat încă.");
  const description = document.createElement("p");
  description.textContent = t("Pagina ANRE furnizată este pagina principală și nu identifică un registru public direct cu numele, autorizațiile și contactele electricienilor. Până la confirmarea linkului către registru, directorul rămâne nepopulat.");
  const link = document.createElement("a");
  link.href = "https://anre.md/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = t("Deschide site-ul oficial ANRE ↗");
  content.append(kicker, heading, description, link);
  card.append(icon, content);
  grid.append(card);
}

function renderNews() {
  const grid = $("#news-grid");
  grid.replaceChildren();
  articles.forEach(article => {
    const card = document.createElement("article");
    card.className = "news-card";
    card.innerHTML = `<div class="news-art ${article.className}"><img src="${article.image}" alt="${article.imageAlt}" loading="lazy" decoding="async"><span class="news-art-label">${article.artLabel}</span></div><div class="news-card-content"><div class="news-meta"><span class="news-category">${article.category}</span><span>${article.date}</span></div><h3>${article.title}</h3><p>${article.summary}</p><a class="news-read" href="${article.source}" target="_blank" rel="noopener noreferrer" aria-label="Citește sursa: ${article.sourceName}">Sursa: ${article.sourceName} ↗</a></div>`;
    grid.append(card);
  });
}

function renderResources() {
  const guideGrid = $("#guides-grid");
  guideGrid.replaceChildren();
  guides.forEach((guide, index) => {
    const card = document.createElement("article");
    card.className = "guide-card";
    const number = document.createElement("span");
    number.className = "guide-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("h3");
    title.textContent = guide.title;
    const description = document.createElement("p");
    description.textContent = guide.description;
    const details = document.createElement("details");
    details.className = "guide-details";
    const summary = document.createElement("summary");
    summary.textContent = window.VoltI18n.format("Puncte practice · {count}", { count: guide.points.length });
    const points = document.createElement("ul");
    points.className = "guide-points";
    const languageIndex = { ro: 0, ru: 1, en: 2 }[document.documentElement.lang] ?? 0;
    guide.points.forEach(point => {
      const item = document.createElement("li");
      item.textContent = point[languageIndex];
      points.append(item);
    });
    details.append(summary, points);
    const source = guideSources[index];
    let sourceLink;
    if (source) {
      sourceLink = document.createElement("a");
      sourceLink.className = "guide-source";
      sourceLink.href = source.href;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = `${t("Sursă oficială")}: ${t(source.label)} ↗`;
    }
    const link = document.createElement("a");
    link.href = guide.href;
    if (guide.href.startsWith("https://")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    link.setAttribute("aria-label", `${t("Citește ghidul")}: ${t(guide.title)}`);
    link.innerHTML = `${t("Deschide calculatorul")} <span aria-hidden="true">↗</span>`;
    card.append(number, title, description, details);
    if (sourceLink) card.append(sourceLink);
    card.append(link);
    guideGrid.append(card);
  });
  $("#guide-count").textContent = window.VoltI18n.format("{count} GHIDURI", { count: guides.length });

  const groups = $("#resource-link-groups");
  groups.replaceChildren();
  resourceGroups.forEach(group => {
    const section = document.createElement("section");
    section.className = "resource-link-group";
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    const list = document.createElement("ul");
    group.links.forEach(([label, href]) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = href;
      if (href.startsWith("https://")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.textContent = label;
      item.append(link);
      list.append(item);
    });
    section.append(heading, list);
    groups.append(section);
  });
}

function updateSavings() {
  const percent = Number($("#savings-slider").value);
  const savedKwh = Math.round(990 * percent / 100);
  $("#savings-percent").textContent = `${percent}%`;
  $("#annual-saving").textContent = integerFormatter.format(savedKwh * tariff);
  $("#saved-kwh").textContent = integerFormatter.format(savedKwh);
}

function createReport() {
  const daily = getDailyTotal();
  const { power, investment, yieldPerKwp, selfConsumptionPercent } = readSolarSettings();
  const monthlySolarSavings = power * yieldPerKwp / 12 * selfConsumptionPercent / 100 * tariff;
  const electrical = getElectricalEstimate();
  return {
    application: "VoltConsum",
    generatedAt: new Date().toISOString(),
    disclaimer: "Estimări orientative, calculate pe baza datelor introduse.",
    tariffMDLPerKWh: tariff,
    consumption: {
      dailyKWh: Number(daily.toFixed(2)),
      monthlyKWh: Number((daily * 30).toFixed(2)),
      estimatedMonthlyCostMDL: Number((daily * 30 * tariff).toFixed(2)),
      appliances: appliances.map(item => ({
        name: item.name, powerW: item.watts, hoursPerDay: item.hours,
        dailyKWh: Number((item.watts * item.hours / 1000).toFixed(2))
      }))
    },
    photovoltaic: {
      powerKWp: power,
      initialInvestmentMDL: investment,
      estimatedAnnualYieldKWhPerKWp: yieldPerKwp,
      estimatedSelfConsumptionPercent: selfConsumptionPercent,
      estimatedMonthlySavingsMDL: Number(monthlySolarSavings.toFixed(2)),
      estimatedPaybackYears: monthlySolarSavings > 0
        ? Number((investment / (monthlySolarSavings * 12)).toFixed(1))
        : null,
      estimatedTomorrowProductionKWh: Number((power * .58 * 3).toFixed(2))
    },
    electricalEstimate: {
      nominalVoltageV: NOMINAL_VOLTAGE,
      connectedPowerW: Number(electrical.connectedPower.toFixed(2)),
      powerFactor: electrical.powerFactor,
      estimatedCurrentA: Number(electrical.current.toFixed(2)),
      cableLengthMetersOneWay: electrical.length,
      estimatedVoltageDropPercent: electrical.voltageDrop === null ? null : Number(electrical.voltageDrop.toFixed(2)),
      minimumCableSectionForThreePercentDropMM2: electrical.cableSection,
      requiredSectionExceedsAvailableStandards: electrical.sectionExceedsStandardRange,
      assumptions: "Single-phase 230 V, copper at 20 C, all entered appliance ratings operating simultaneously; cable sizing covers voltage drop only and excludes ampacity, protective devices, installation method, and local code verification."
    }
  };
}

function downloadReport() {
  const blob = new Blob([JSON.stringify(createReport(), null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "voltconsum-raport-energetic.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Raportul JSON a fost descărcat.");
}

function openSolarModal() {
  applySolarSettings(lastValidSolarSettings);
  calculateSolar();
  $("#solar-modal").hidden = false;
  $("#system-power-input").focus();
}

function closeSolarModal() {
  const solar = readSolarSettings();
  if (!isValidSolarSettings(solar)) {
    applySolarSettings(lastValidSolarSettings);
    calculateSolar();
    showToast("Valorile incomplete sau invalide au fost înlocuite cu ultimele valori valide.");
  } else {
    applySolarSettings(lastValidSolarSettings);
    calculateSolar();
  }
  $("#solar-modal").hidden = true;
  $("#edit-solar").focus();
}

function greetingForHour(hour) {
  if (hour >= 5 && hour < 12) return "Bună dimineața,";
  if (hour >= 12 && hour < 18) return "Bună ziua,";
  return "Bună seara,";
}

function updateGreeting() {
  const greeting = $("#greeting-text");
  if (!greeting) return;
  const text = greetingForHour(new Date().getHours());
  if (greeting.dataset.source !== text) {
    greeting.dataset.source = text;
    greeting.textContent = text;
  }
}

function isInsideMoldova(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= MOLDOVA_BOUNDS.minLat && latitude <= MOLDOVA_BOUNDS.maxLat &&
    longitude >= MOLDOVA_BOUNDS.minLon && longitude <= MOLDOVA_BOUNDS.maxLon;
}

function isValidWeatherLocation(location) {
  return Boolean(location) && typeof location.name === "string" && location.name.length > 0 && location.name.length <= 80 &&
    (location.admin === undefined || typeof location.admin === "string") &&
    isInsideMoldova(location.latitude, location.longitude);
}

function renderWeatherLocation() {
  const label = weatherLocation.admin ? `${weatherLocation.name}, ${weatherLocation.admin}` : weatherLocation.name;
  $("#weather-location-name").textContent = label;
  $("#weather-location-name").title = label;
}

function loadWeatherLocation() {
  try {
    const stored = JSON.parse(localStorage.getItem(WEATHER_LOCATION_KEY));
    if (isValidWeatherLocation(stored)) weatherLocation = { name: stored.name, admin: stored.admin || "", latitude: stored.latitude, longitude: stored.longitude };
  } catch (error) {
    weatherLocation = { ...DEFAULT_WEATHER_LOCATION };
  }
}

function setWeatherLocation(location) {
  weatherLocation = { name: location.name, admin: location.admin || "", latitude: location.latitude, longitude: location.longitude };
  try {
    localStorage.setItem(WEATHER_LOCATION_KEY, JSON.stringify(weatherLocation));
  } catch (error) {
    showPickerStatus("Locația este folosită acum, dar browserul nu a putut salva alegerea.");
  }
  renderWeatherLocation();
  loadWeatherForecast();
}

function showPickerStatus(message) {
  const status = $("#weather-picker-status");
  status.textContent = message ? t(message) : "";
  status.hidden = !message;
}

function hideWeatherResults() {
  $("#weather-results").hidden = true;
  $("#weather-results").replaceChildren();
  $("#weather-search").setAttribute("aria-expanded", "false");
}

let weatherSearchController = null;
let weatherSearchTimer;

async function searchLocalities(query) {
  if (weatherSearchController) weatherSearchController.abort();
  weatherSearchController = new AbortController();
  const controller = weatherSearchController;
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  const language = document.documentElement.lang;
  url.search = new URLSearchParams({
    name: query, count: "10", language: ["ru", "en"].includes(language) ? language : "ro", format: "json", countryCode: "MD"
  }).toString();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const results = (Array.isArray(data.results) ? data.results : []).filter(item =>
      typeof item.name === "string" && isInsideMoldova(item.latitude, item.longitude));
    renderWeatherResults(results);
  } catch (error) {
    if (error.name === "AbortError") return;
    hideWeatherResults();
    showPickerStatus("Căutarea localităților nu este disponibilă acum. Încearcă din nou sau folosește „Locația mea”.");
  }
}

function renderWeatherResults(results) {
  const list = $("#weather-results");
  list.replaceChildren();
  if (!results.length) {
    hideWeatherResults();
    showPickerStatus("Nu am găsit nicio localitate cu acest nume în Republica Moldova.");
    return;
  }
  showPickerStatus("");
  results.forEach(item => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.admin1 ? `${item.name} · ${item.admin1}` : item.name;
    button.addEventListener("click", () => {
      $("#weather-search").value = "";
      hideWeatherResults();
      showPickerStatus("");
      setWeatherLocation({ name: item.name, admin: item.admin1 || "", latitude: item.latitude, longitude: item.longitude });
    });
    li.append(button);
    list.append(li);
  });
  list.hidden = false;
  $("#weather-search").setAttribute("aria-expanded", "true");
}

function useDeviceLocation() {
  if (!navigator.geolocation) {
    showPickerStatus("Browserul nu permite localizarea. Caută localitatea după nume.");
    return;
  }
  const button = $("#weather-geolocate");
  button.disabled = true;
  showPickerStatus("Se determină locația...");
  navigator.geolocation.getCurrentPosition(position => {
    button.disabled = false;
    const { latitude, longitude } = position.coords;
    if (!isInsideMoldova(latitude, longitude)) {
      showPickerStatus("Locația ta este în afara Republicii Moldova. Caută o localitate din Moldova după nume.");
      return;
    }
    showPickerStatus("");
    setWeatherLocation({
      name: "Locația mea", admin: `${latitude.toFixed(3)}°N, ${longitude.toFixed(3)}°E`,
      latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000
    });
  }, () => {
    button.disabled = false;
    showPickerStatus("Nu am putut folosi locația. Permite accesul în browser sau caută localitatea după nume.");
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

function initWeatherLocation() {
  loadWeatherLocation();
  renderWeatherLocation();
  $("#weather-search").addEventListener("input", event => {
    clearTimeout(weatherSearchTimer);
    const query = event.target.value.trim();
    if (query.length < 2) {
      if (weatherSearchController) weatherSearchController.abort();
      hideWeatherResults();
      showPickerStatus("");
      return;
    }
    weatherSearchTimer = setTimeout(() => searchLocalities(query), 300);
  });
  $("#weather-search").addEventListener("keydown", event => {
    if (event.key === "Escape") hideWeatherResults();
    if (event.key === "ArrowDown") $("#weather-results button")?.focus();
  });
  $("#weather-results").addEventListener("keydown", event => {
    const buttons = $$("#weather-results button");
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); buttons[Math.min(index + 1, buttons.length - 1)]?.focus(); }
    if (event.key === "ArrowUp") { event.preventDefault(); if (index <= 0) $("#weather-search").focus(); else buttons[index - 1].focus(); }
    if (event.key === "Escape") { hideWeatherResults(); $("#weather-search").focus(); }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".weather-search")) hideWeatherResults();
  });
  $("#weather-geolocate").addEventListener("click", useDeviceLocation);
  setInterval(() => {
    if (document.visibilityState === "visible" && appInitialized) loadWeatherForecast();
  }, WEATHER_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && appInitialized) {
      updateGreeting();
      if (!weatherForecast) loadWeatherForecast();
    }
  });
}

function init() {
  $("#system-power-input").value = String(DEFAULT_SOLAR.power);
  $("#investment-input").value = String(DEFAULT_SOLAR.investment);
  $("#solar-yield-input").value = String(DEFAULT_SOLAR.yieldPerKwp);
  $("#solar-self-consumption-input").value = String(DEFAULT_SOLAR.selfConsumptionPercent);
  $("#cable-length").value = String(DEFAULT_CABLE_LENGTH_METERS);
  loadAppState();
  updateGreeting();
  setInterval(updateGreeting, 60000);
  initWeatherLocation();
  lastValidSolarSettings = readSolarSettings();
  lastValidCableLength = Number($("#cable-length").value);
  $("#local-date").textContent = new Intl.DateTimeFormat(document.documentElement.lang === "ro" ? "ro-MD" : document.documentElement.lang, {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date()).toLocaleUpperCase(document.documentElement.lang);
  renderAppliances();
  renderConsumptionChart();
  renderElectricians();
  renderNews();
  renderResources();
  if (weatherErrorKey) showWeatherError(weatherErrorKey);
  else if (weatherForecast) renderWeatherForecast();
  else $("#weather-status-label").textContent = t("SE ÎNCARCĂ");
  calculateSolar();
  updateSavings();
  drawWaveform();

  $("#appliance-form").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("#appliance-name").value.trim();
    const watts = Number($("#appliance-watts").value);
    const hours = Number($("#appliance-hours").value);
    if (!name || !Number.isFinite(watts) || watts <= 0 || watts > 50000 || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
      showToast("Introdu un nume, o putere pozitivă și un timp între 0 și 24 de ore.");
      return;
    }
    const colors = ["#c6ff68", "#80d9a1", "#ffd36d", "#7dc6f2", "#b79af4", "#f394a4"];
    const wasEditing = editingApplianceId !== null;
    if (!wasEditing) {
      appliances.push({ id: nextApplianceId++, name, watts, hours, color: colors[appliances.length % colors.length] });
    } else {
      const appliance = appliances.find(item => item.id === editingApplianceId);
      if (!appliance) {
        resetApplianceEditor();
        showToast("Aparatul selectat nu mai există. Încearcă din nou.");
        return;
      }
      Object.assign(appliance, { name, watts, hours });
    }
    event.currentTarget.reset();
    resetApplianceEditor();
    renderAppliances();
    renderConsumptionChart();
    saveAppState();
    showToast(wasEditing
      ? window.VoltI18n.format("{name} a fost actualizat.", { name })
      : window.VoltI18n.format("{name} a fost adăugat în calculator.", { name }));
  });

  $("#appliance-rows").addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const editButton = target.closest("[data-edit]");
    if (editButton) {
      const appliance = appliances.find(item => item.id === Number(editButton.dataset.edit));
      if (!appliance) return;
      editingApplianceId = appliance.id;
      $("#appliance-name").value = appliance.name;
      $("#appliance-watts").value = String(appliance.watts);
      $("#appliance-hours").value = String(appliance.hours);
      $("#save-appliance").textContent = t("Salvează");
      $("#cancel-edit-appliance").hidden = false;
      $("#appliance-name").focus();
      return;
    }
    const button = target.closest("[data-delete]");
    if (!button) return;
    const deletedId = Number(button.dataset.delete);
    appliances = appliances.filter(item => item.id !== deletedId);
    if (editingApplianceId === deletedId) resetApplianceEditor();
    renderAppliances();
    renderConsumptionChart();
    saveAppState();
    showToast("Aparatul a fost eliminat.");
  });
  $("#cancel-edit-appliance").addEventListener("click", resetApplianceEditor);

  $("#tariff-input").addEventListener("input", event => {
    const value = Number(event.target.value);
    if (event.target.value === "" || !Number.isFinite(value) || value < 0 || value > 10) return;
    tariff = value;
    renderAppliances();
    updateSavings();
    calculateSolar();
    saveAppState();
  });
  $("#tariff-input").addEventListener("change", event => {
    const value = Number(event.target.value);
    if (event.target.value !== "" && Number.isFinite(value) && value >= 0 && value <= 10) return;
    event.target.value = tariff.toFixed(2);
    showToast("Tariful trebuie să fie între 0 și 10 MDL/kWh.");
  });

  $$(".period-button").forEach(button => button.addEventListener("click", () => {
    selectedPeriod = button.dataset.period;
    $$(".period-button").forEach(item => item.classList.toggle("active", item === button));
    renderConsumptionChart();
    saveAppState();
  }));
  $("#chart-menu").addEventListener("click", () => {
    renderConsumptionChart();
    showToast("Graficul de consum a fost actualizat.");
  });
  $("#pf-slider").addEventListener("input", () => {
    drawWaveform();
    saveAppState();
  });
  $("#cable-length").addEventListener("input", () => {
    updateCurrentReading();
    const length = Number($("#cable-length").value);
    if (!Number.isInteger(length) || length < 1 || length > 500) return;
    lastValidCableLength = length;
    saveAppState();
  });
  $("#cable-length").addEventListener("change", () => {
    const length = Number($("#cable-length").value);
    if (Number.isInteger(length) && length >= 1 && length <= 500) return;
    $("#cable-length").value = String(lastValidCableLength);
    updateCurrentReading();
    showToast("Lungimea traseului trebuie să fie între 1 și 500 m.");
  });
  $("#engineer-mode").addEventListener("change", event => {
    document.body.classList.toggle("engineer-mode", event.target.checked);
    if (event.target.checked) requestAnimationFrame(drawWaveform);
    saveAppState();
  });
  document.addEventListener("click", event => {
    const link = event.target.closest('a[href="#waveform-panel"]');
    if (!link || $("#engineer-mode").checked) return;
    $("#engineer-mode").checked = true;
    $("#engineer-mode").dispatchEvent(new Event("change", { bubbles: true }));
  });
  $("#savings-slider").addEventListener("input", () => {
    updateSavings();
    saveAppState();
  });
  $("#export-json").addEventListener("click", downloadReport);
  $("#export-pdf").addEventListener("click", () => window.print());
  $("#edit-consumption-metric").addEventListener("click", () => {
    $("#appliance-name").focus({ preventScroll: true });
    $("#calculator").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#edit-cost-metric").addEventListener("click", () => {
    $("#tariff-input").focus({ preventScroll: true });
    $("#calculator").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#edit-production-metric").addEventListener("click", openSolarModal);
  $("#edit-self-use-metric").addEventListener("click", openSolarModal);
  $("#scroll-to-calculator").addEventListener("click", () => {
    $("#appliance-name").focus({ preventScroll: true });
    $("#calculator").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#edit-solar").addEventListener("click", openSolarModal);
  $("#weather-refresh").addEventListener("click", loadWeatherForecast);
  $("#close-solar-modal").addEventListener("click", closeSolarModal);
  $("#cancel-solar").addEventListener("click", closeSolarModal);
  $("#solar-modal").addEventListener("click", event => {
    if (event.target === $("#solar-modal")) closeSolarModal();
  });
  $("#save-solar").addEventListener("click", () => {
    const solar = readSolarSettings();
    if (!isValidSolarSettings(solar)) {
      showToast("Verifică puterea, investiția și producția anuală; autoconsumul trebuie să fie între 0 și 100%.");
      return;
    }
    calculateSolar();
    lastValidSolarSettings = { ...solar };
    saveAppState();
    closeSolarModal();
    showToast("Estimarea sistemului solar a fost actualizată.");
  });
  ["#system-power-input", "#investment-input", "#solar-yield-input", "#solar-self-consumption-input"].forEach(selector => {
    $(selector).addEventListener("input", () => {
      const solar = readSolarSettings();
      if (!isValidSolarSettings(solar)) return;
      calculateSolar();
    });
  });
  $("#notifications-button").addEventListener("click", () => showToast("Nu ai notificări noi."));
  $(".profile-menu").addEventListener("click", () => showToast("Autentificarea este gestionată de Firebase; datele calculatorului sunt păstrate local în acest browser."));
  $("#menu-toggle").addEventListener("click", event => {
    const open = $("#sidebar").classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  const updateActiveNavLink = hash => {
    const target = document.getElementById(hash.slice(1));
    const matchingNavLink = $$(".nav-link").find(item => item.hash === hash)
      || (target?.closest("#about") && $$(".nav-link").find(item => item.hash === "#about"));
    if (matchingNavLink) {
      $$(".nav-link").forEach(item => item.classList.toggle("active", item === matchingNavLink));
    }
  };
  $$(".nav-link").forEach(link => link.addEventListener("click", () => {
    updateActiveNavLink(link.hash);
    $("#sidebar").classList.remove("open");
    $("#menu-toggle").setAttribute("aria-expanded", "false");
  }));
  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if ($("#sidebar").classList.contains("open") && !$("#sidebar").contains(target) && !$("#menu-toggle").contains(target)) {
      $("#sidebar").classList.remove("open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
    }
    const link = target.closest('#protected-app a[href^="#"]');
    if (link) {
      updateActiveNavLink(link.hash);
      $("#sidebar").classList.remove("open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
    }
  });
  window.addEventListener("hashchange", () => {
    updateActiveNavLink(location.hash);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("#solar-modal").hidden) {
      closeSolarModal();
    } else if (event.key === "Escape" && $("#sidebar").classList.contains("open")) {
      $("#sidebar").classList.remove("open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
      $("#menu-toggle").focus();
    } else if (event.key === "Tab" && !$("#solar-modal").hidden) {
      const focusable = $$("button:not([disabled]), input:not([disabled])", $("#solar-modal"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  window.addEventListener("resize", () => {
    if (window.Chart) chartInstances.forEach(chart => chart && chart.resize());
    else {
      renderConsumptionChart();
      renderApplianceChart();
    }
    drawWaveform();
  });
  if (!window.Chart) showToast("Graficele interactive necesită conexiune la internet pentru încărcarea bibliotecii Chart.js.");
}

initAuth();

document.addEventListener("voltconsum:languagechange", event => {
  const language = event.detail.language;
  const locale = language === "ro" ? "ro-MD" : language;
  formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  integerFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  applyTheme(document.documentElement.dataset.theme);
  if (!appInitialized) {
    updateAuthForm(false);
    return;
  }
  $("#local-date").textContent = new Intl.DateTimeFormat(locale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date()).toLocaleUpperCase(locale);
  renderAppliances();
  renderConsumptionChart();
  renderElectricians();
  renderNews();
  renderResources();
  if (weatherErrorKey) showWeatherError(weatherErrorKey);
  else if (weatherForecast) renderWeatherForecast();
  else $("#weather-status-label").textContent = t("SE ÎNCARCĂ");
  calculateSolar();
  updateSavings();
});
