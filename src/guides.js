// Setup guides for Settings → apps → more connections (appspage.js shows
// one step at a time), for someone who has never
// opened a developer console. Each step is a list of parts:
//   "text"                          plain text
//   { b: "Create" }                 a button or field name to look for
//   { link: "label", url }          opens the page (extras.rs open_link allows it)
//   { copy: "value" }               the exact value to paste, with a copy button
// The last step of an account guide is where its client id is pasted
// (appspage.js puts the fields there). Keep these in step with the providers in
// src-tauri/src/connectors/oauth.rs (scopes, redirect hosts).

const REDIRECT_127 = "http://127.0.0.1:47812/callback";
const REDIRECT_LOCALHOST = "http://localhost:47812/callback";

export const GUIDES = {
  gmail: {
    intro: "Your unread inbox count. Google needs you to register AfterGlow as your own app (free, about 5 minutes, once). AfterGlow only asks to read label counts, never emails.",
    time: "about 5 minutes",
    steps: [
      ["Open ", { link: "Google Cloud Console", url: "https://console.cloud.google.com/projectcreate" }, " and sign in with your Gmail account. Create a project named ", { copy: "AfterGlow" }, " and click ", { b: "Create" }, "."],
      ["Turn on the Gmail API: open ", { link: "Gmail API", url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com" }, ", check the AfterGlow project is selected at the top, and click ", { b: "Enable" }, "."],
      ["Set up sign-in: open ", { link: "Google Auth Platform", url: "https://console.cloud.google.com/auth/overview" }, ", click ", { b: "Get started" }, ". App name ", { copy: "AfterGlow" }, ", your email as support email, audience ", { b: "External" }, ", your email again as contact, agree and ", { b: "Create" }, "."],
      ["Keep it signed in: in ", { link: "Audience", url: "https://console.cloud.google.com/auth/audience" }, " click ", { b: "Publish app" }, ", then ", { b: "Confirm" }, ". (Left in testing, Google signs you out every 7 days.)"],
      ["Create the key: in ", { link: "Clients", url: "https://console.cloud.google.com/auth/clients" }, " click ", { b: "Create client" }, ", application type ", { b: "Desktop app" }, ", name ", { copy: "AfterGlow" }, ", ", { b: "Create" }, ". No redirect URI is needed for a desktop app."],
      ["Copy the ", { b: "Client ID" }, " and ", { b: "Client secret" }, " from the dialog into the boxes below and click ", { b: "sign in" }, ". Google warns the app isn't verified: click ", { b: "Continue" }, " (it's your own app)."],
    ],
  },
  outlook: {
    intro: "Your unread Outlook inbox count (Outlook.com, Hotmail or work accounts). Microsoft needs you to register AfterGlow as your own app (free, about 3 minutes, once).",
    time: "about 3 minutes",
    steps: [
      ["Open ", { link: "Microsoft Entra → App registrations", url: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" }, " and sign in with your Microsoft account. Click ", { b: "New registration" }, "."],
      ["Name ", { copy: "AfterGlow" }, ". Supported account types: ", { b: "Accounts in any organizational directory and personal Microsoft accounts" }, "."],
      ["Redirect URI: platform ", { b: "Public client/native (mobile & desktop)" }, ", URI ", { copy: REDIRECT_LOCALHOST }, ". Click ", { b: "Register" }, "."],
      ["On the app's overview page, copy the ", { b: "Application (client) ID" }, " into the box below, click ", { b: "sign in" }, " and accept. No secret needed."],
    ],
  },
  spotify: {
    intro: "A pulse when the song changes. You need Spotify Premium (Spotify's rule for developer apps). Spotify needs you to register AfterGlow as your own app (free, about 2 minutes, once).",
    time: "about 2 minutes",
    steps: [
      ["Open the ", { link: "Spotify developer dashboard", url: "https://developer.spotify.com/dashboard" }, ", sign in and click ", { b: "Create app" }, "."],
      ["App name ", { copy: "AfterGlow" }, ", any description, Redirect URI ", { copy: REDIRECT_127 }, " (click ", { b: "Add" }, "), tick ", { b: "Web API" }, ", agree and ", { b: "Save" }, "."],
      ["Open the app's ", { b: "Settings" }, ", copy the ", { b: "Client ID" }, " into the box below and click ", { b: "sign in" }, ". No secret needed."],
    ],
  },
  steam: {
    intro: "Chat messages light a lantern in Steam blue until you've seen it. Friends coming online or starting a game give a pulse. Chat only needs Steam's own Settings → Friends & Chat → 'Flash window when I receive a chat message' on (it is unless you changed it); friends need your free Steam Web API key (about 2 minutes, once).",
    time: "about 2 minutes",
    steps: [
      ["Open ", { link: "Steam Web API key", url: "https://steamcommunity.com/dev/apikey" }, " and sign in. Domain name ", { copy: "localhost" }, ", agree, ", { b: "Register" }, ", and copy the ", { b: "Key" }, "."],
      ["Your profile: in Steam, open your profile, right-click the page and ", { b: "Copy Page URL" }, ". The link, the 17-digit Steam ID or your custom profile name all work."],
      ["Steam only shares your friends with your own key if your friends list is visible: ", { link: "Privacy Settings", url: "https://steamcommunity.com/my/edit/settings" }, " → ", { b: "Friends List" }, ": ", { b: "Public" }, "."],
      ["Paste the key and your profile above and click ", { b: "connect Steam" }, ". The key goes into your system's keychain."],
    ],
  },
};
