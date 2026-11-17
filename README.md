# Scholar Lite

Static HTML/CSS/JS app using Bootstrap, Firebase Authentication, Firestore, and Gemini 3.8 Flash through the Interactions API.

## Setup

1. Configure `js/firebaseConfig.js` with your Firebase Web App configuration. Do not put the Gemini API key in this file.
2. In Firebase Authentication, enable Email/Password and Google providers. Add your deployed domain (and `localhost` for local development) to Authorized domains.
3. Create a Firestore database and deploy rules restricting each user's data to their own UID. Example:
   ```
   match /users/{uid}/scholarLite/{document=**} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
4. Deploy this repository to Vercel. Vercel automatically serves `api/gemini.js` as the `/api/gemini` serverless endpoint.
5. In Vercel Project Settings → Environment Variables, add `GEMINI_API_KEY` with your Gemini API key, then redeploy.
6. Open the deployed website and test Study Assistant and Quiz Generator.

## Timetable synchronization

The weekly timetable is stored in the signed-in user's Firestore document at `users/{uid}/scholarLite/data`, in the `timetable` field. When a user signs in, the app loads that account's timetable; adding or deleting an activity saves the updated list. Existing browser-only timetable data is migrated when the account does not yet have a timetable. Signed-out users continue to use local browser storage.

The Firestore rules in the Setup section must allow each authenticated user to read and write their own `users/{uid}/scholarLite/**` documents. The example recursive rule already covers the timetable field because it is stored in the existing `data` document.

## Study Assistant chat history

Chat conversations are stored per signed-in user in the Firestore subcollection `users/{uid}/scholarLite/data/chats`. Users can create, switch between, and delete conversations. The latest 60 messages per conversation are retained in the saved record. Guests can chat for the current session, but their conversations are not synced or saved after leaving/reloading.

## Markdown and LaTeX

Markdown is rendered in Study Assistant replies, generated quiz questions/options, and the live Note preview. LaTeX supports `$...# Scholar Lite

Static HTML/CSS/JS app using Bootstrap, Firebase Authentication, Firestore, and Gemini 3.8 Flash through the Interactions API.

## Setup

1. Configure `js/firebaseConfig.js` with your Firebase Web App configuration. Do not put the Gemini API key in this file.
2. In Firebase Authentication, enable Email/Password and Google providers. Add your deployed domain (and `localhost` for local development) to Authorized domains.
3. Create a Firestore database and deploy rules restricting each user's data to their own UID. Example:
   ```
   match /users/{uid}/scholarLite/{document=**} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
4. Deploy this repository to Vercel. Vercel automatically serves `api/gemini.js` as the `/api/gemini` serverless endpoint.
5. In Vercel Project Settings → Environment Variables, add `GEMINI_API_KEY` with your Gemini API key, then redeploy.
6. Open the deployed website and test Study Assistant and Quiz Generator.

 or `\\(...\\)` for inline math and `$...$` or `\\[...\\]` for display math. The browser uses Marked, DOMPurify, and KaTeX from CDN.

## Pomodoro
- Supports focus, short-break, and long-break modes.
- Each duration can be customized from 1 to 180 minutes.
- Preferences are saved in the browser using local storage.

## Local development

A static server such as `python -m http.server` only serves HTML/CSS/JS; it does not execute `api/gemini.js`. Use the Vercel development runtime (`vercel dev`) to test the full app locally.

## Security

Gemini requests are sent through the server-side endpoint. Keep `GEMINI_API_KEY` only in server environment variables; never commit it or expose it in browser JavaScript. If a Gemini key was previously placed in a public file, revoke it and create a new one.