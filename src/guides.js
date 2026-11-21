// Setup guides for Settings → apps: step by step, for someone who has never
// opened a developer console. Each step is a list of parts:
//   "text"                          plain text
//   { b: "Create" }                 a button or field name to look for
//   { link: "label", url }          opens the page (extras.rs open_link allows it)
//   { copy: "value" }               the exact value to paste, with a copy button
// The last step of an account guide is where its client id is pasted
// (main.js puts the fields there). Keep these in step with the providers in
// src-tauri/src/connectors/oauth.rs (scopes, redirect hosts).

const REDIRECT_127 = "http://127.0.0.1:47812/callback";
const REDIRECT_LOCALHOST = "http://localhost:47812/callback";

export const GUIDES = {
  notifications: {
    intro: "Counts the notifications apps show (WhatsApp, Slack, Teams, Discord, …). Nothing to set up: switch it on and Windows asks once.",
    steps: [
      ["Switch it on above and choose ", { b: "Allow" }, " when Windows asks."],
      ["If you said no, turn it on in ", { link: "Windows Settings → Notifications access", url: "ms-settings:privacy-notifications" }, ", then switch AfterGlow off and on here."],
    ],
  },
  dock: {
    intro: "Counts the red badges on Dock icons (WhatsApp, Messages, Mail, …). macOS asks for Accessibility access once.",
    steps: [
      ["Switch it on above. macOS opens a dialog: choose ", { b: "Open System Settings" }, "."],
      ["Turn on ", { b: "AfterGlow" }, " in ", { link: "Privacy & Security → Accessibility", url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" }, "."],
      ["After installing a new version, macOS may ask again."],
    ],
  },
  gmail: {
    intro: "Your unread inbox count. Google needs you to register AfterGlow as your own app (free, about 5 minutes, once). AfterGlow only asks to read label counts, never emails.",
    time: "about 5 minutes",
    steps: [
      ["Open ", { link: "Google Cloud Console", url: "https://console.cloud.google.com/projectcreate" }, " and sign in with your Gmail account. Create a project named ", { copy: "AfterGlow" }, " and click ", { b: "Create" }, "."],
      ["Turn on the Gmail API: open ", { link: "Gmail API", url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" }, ", check the AfterGlow project is selected at the top, and click ", { b: "Enable" }, "."],
      ["Set up sign-in: open ", { link: "Google Auth Platform", url: "https://console.cloud.google.com/auth/overview" }, ", click ", { b: "Get started" }, ". App name ", { copy: "AfterGlow" }, ", your email as support email, audience ", { b: "External" }, ", your email again as contact, agree and ", { b: "Create" }, "."],
      ["Let yourself sign in: in ", { link: "Audience", url: "https://console.cloud.google.com/auth/audience" }, ", under ", { b: "Test users" }, " click ", { b: "Add users" }, " and add your Gmail address. (The app stays in testing; that's fine for you.)"],
      ["Create the key: in ", { link: "Clients", url: "https://console.cloud.google.com/auth/clients" }, " click ", { b: "Create client" }, ", application type ", { b: "Desktop app" }, ", name ", { copy: "AfterGlow" }, ", ", { b: "Create" }, ". No redirect URI is needed for a desktop app."],
      ["Copy the ", { b: "Client ID" }, " and ", { b: "Client secret" }, " from the dialog into the boxes below, click ", { b: "save" }, ", then ", { b: "sign in" }, ". Google warns the app isn't verified: click ", { b: "Continue" }, " (it's your own app)."],
    ],
  },
  outlook: {
    intro: "Your unread Outlook inbox count (Outlook.com, Hotmail or work accounts). Microsoft needs you to register AfterGlow as your own app (free, about 3 minutes, once).",
    time: "about 3 minutes",
    steps: [
      ["Open ", { link: "Microsoft Entra → App registrations", url: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" }, " and sign in with your Microsoft account. Click ", { b: "New registration" }, "."],
      ["Name ", { copy: "AfterGlow" }, ". Supported account types: ", { b: "Accounts in any organizational directory and personal Microsoft accounts" }, "."],
      ["Redirect URI: platform ", { b: "Public client/native (mobile & desktop)" }, ", URI ", { copy: REDIRECT_LOCALHOST }, ". Click ", { b: "Register" }, "."],
      ["On the app's overview page, copy the ", { b: "Application (client) ID" }, " into the box below, click ", { b: "save" }, ", then ", { b: "sign in" }, " and accept. No secret needed."],
    ],
  },
  spotify: {
    intro: "A pulse when the song changes. Spotify needs you to register AfterGlow as your own app (free, about 2 minutes, once).",
    time: "about 2 minutes",
    steps: [
      ["Open the ", { link: "Spotify developer dashboard", url: "https://developer.spotify.com/dashboard" }, ", sign in and click ", { b: "Create app" }, "."],
      ["App name ", { copy: "AfterGlow" }, ", any description, Redirect URI ", { copy: REDIRECT_127 }, " (click ", { b: "Add" }, "), tick ", { b: "Web API" }, ", agree and ", { b: "Save" }, "."],
      ["Open the app's ", { b: "Settings" }, ", copy the ", { b: "Client ID" }, " into the box below, click ", { b: "save" }, ", then ", { b: "sign in" }, ". No secret needed."],
    ],
  },
};
