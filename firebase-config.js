// Substitua pelos dados do SEU projeto Firebase
// (Console Firebase > Configurações do projeto > Seus apps > Config)
const firebaseConfig = {
  apiKey: "COLE_AQUI_A_API_KEY",
  authDomain: "COLE_AQUI.firebaseapp.com",
  projectId: "COLE_AQUI_O_PROJECT_ID",
  storageBucket: "COLE_AQUI.appspot.com",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// Se quiser testar localmente com o emulador do Firebase, descomente:
// functions.useEmulator("localhost", 5001);
