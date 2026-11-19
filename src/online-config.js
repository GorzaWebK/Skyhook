// Firebase web config for online leaderboards (the shared "foundry-arena"
// project). These values are not secret: Firebase web configs are public by
// design, and the database security rules (firebase/database.rules.json)
// control who can read and write what.
//
// Leave this as null to keep online leaderboards switched off.
// To switch them on, replace null with the config object from the Firebase
// console (Project settings > Your apps > SDK setup and configuration):
//   export const ONLINE_CONFIG = { apiKey: '...', authDomain: '...', databaseURL: '...', projectId: '...', appId: '...' };
export const ONLINE_CONFIG = null;
