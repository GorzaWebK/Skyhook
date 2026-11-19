// Firebase web config for online leaderboards (the shared "foundry-arena"
// project). These values are not secret: Firebase web configs are public by
// design, and the database security rules (firebase/database.rules.full.json
// is the complete file for the Firebase console) control who can read and
// write what. Skyhook only uses the skyhook/ path.
//
// Set this to null to switch online leaderboards off.
export const ONLINE_CONFIG = {
  apiKey: 'AIzaSyAZbpZCxU6cykOywHHvSqpnRiAxfkaEuEU',
  authDomain: 'foundry-arena.firebaseapp.com',
  databaseURL: 'https://foundry-arena-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'foundry-arena',
  storageBucket: 'foundry-arena.firebasestorage.app',
  messagingSenderId: '690371517667',
  appId: '1:690371517667:web:bb6fcab88afa90b13c39d6',
};
