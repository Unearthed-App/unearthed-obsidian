# Unearthed Obsidian Plugin (Kindle/KOReader Sync)

> **Wait**: there is an alternative way to sync with Unearthed and that is through **[Unearthed Local](https://unearthed.app/local)** which is an app that you install on your device, where there is no cloud required. Once you have it you can keep it forever. For the Unearthed Local app, you do **not** need to use this Obsidian Plugin.
> 
Unearthed is a service that seamlessly syncs your Kindle (& KOReader) highlights and notes to your preferred platforms.
A **Daily Reflection** is served to you that consists of a quote, your note, book, author and location. This plugin allows you to use custom templates to determine how books will appear in Obsidian. It is smart enough to know what quotes/highlights exist already and just append those that are needed.

Currently, Unearthed supports receiving books from:

-   **Kindle**
-   **KOReader**
-   **Unearthed.app** - file import and/or manual creation

and sending books to:

-   **Obsidian** (via this plugin) (or [Unearthed Local](https://unearthed.app/local))
-   **Notion**
-   **Capacities**
-   **Supernotes**
-   And, of course, the **Unearthed** app itself.


## Kindle
Only the books visible in your Kindle notebook at [Amazon Kindle Notebook](https://read.amazon.com/notebook) will be synced.

## KOReader
Highlights and notes made in the KOReader app can now also be sent to Unearthed, and therefore Obsidian. These highlights will be merged with those from Kindle along with highlights created manually within Unearthed. If you have the same book in both Kindle and KOReader, the highlights will be merged to the same book so that when it appears in Obsidian, all the highlights are within the same book file.

## Tags

Unearthed.app (Unearthed Online) has a comprehensive solution for tagging highlights and notes. You can do this manually (and quickly via inline highlighting text) or you can let AI help you tag and extract ideas. Within unearthed.app you will be able to see a graph view of all of your books, highlights, and tags connected together. These tags will be sent to your Obsidian vault as well, allowing you to connect your ideas together and keep them offline. Tag files will automatically be created in Obsidian and linked to your books.
![image](https://github.com/user-attachments/assets/15ce1a8d-3032-4f32-b4e4-61c9befd1464)
![image](https://github.com/user-attachments/assets/06e1332a-9196-4781-95d7-5b3b1a688efa)

## Video Tutorial
Checkout the Youtube channel for some other hopefully useful videos: [Channel](https://www.youtube.com/@CheersCal)

## Useful Settings

### Choose your templates

Customisable templates allow you to get the data looking just the way you want.
_Beginning and ending the 'Source(book) template' with '---', will result in the data being added as Obsidian Properties._
![image](https://github.com/user-attachments/assets/9b6d1f4c-9a12-410b-ae65-1a3db6a32004)
![image](https://github.com/user-attachments/assets/036e3adf-05cb-4842-b111-3305137cfa68)

### Custom Colours
 - yellow
 - blue
 - pink
 - orange
 - red
 - green
 - olive
 - cyan
 - purple
 - gray

![image](https://github.com/user-attachments/assets/b36b1082-5784-4e75-9c0d-517b83c08816)

## Daily Reflection

![image](https://github.com/user-attachments/assets/e0bb8af3-1d8c-4037-a38a-89a339b371f4)

## All Quotes and Notes Synced

![image](https://github.com/user-attachments/assets/50bd5fc9-c13e-4c8c-86db-ddba0a88a4cd)

## How to Sync Your Kindle Books with Obsidian

1. Choose if you'd prefer to bypass this plugin entirely and install the completely local app instead ([Unearthed Local](https://unearthed.app/local)). Compare them here: [unearthed.app](https://unearthed.app)
2. If you've chosen to continue with [Unearthed Online](https://unearthed.app/online), create an account on [unearthed.app](https://unearthed.app).
3. Follow the prompts to sync your Kindle data to Unearthed (this step requires installing a browser extension and creating an Unearthed API key). The browser extension will be linked within unearthed.app, but here are the links again: [Chrome](https://chromewebstore.google.com/detail/unearthed-app/aneeklbnnklhdaipicoakebmbedcgmfb), [Firefox](https://addons.mozilla.org/en-US/firefox/addon/unearthed-app/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search)
4. Once you see that Unearthed is receiving books from Kindle, install the Unearthed plugin in your Obsidian vault.
5. Create another Unearthed API key within Unearthed.app and paste it into 'Unearthed API key' in the plugin settings.
6. Get your 'User Id' from the Unearthed.app settings page and paste it into 'Unearthed User ID' in the plugin settings.
7. Press the "Sync" button next to 'Manual sync'
8. You can set it to auto-sync each time Obsidian loads, or choose to sync manually from the side panel or the plugin settings.

## How to Sync Your KOReader Books with Obsidian

1. This can also be accomplished with ([Unearthed Local](https://unearthed.app/local). However if you prefer to continue with _Unearthed Online_ Create an account on [unearthed.app](https://unearthed.app).
2. Following the instructions on [Unearthed KOReader Plugin](https://github.com/Unearthed-App/unearthed-koreader) to install the plugin on your device running KOReader. You'll need an Unearthed API key to connect KOReader and Unearthed together.
3. Once you see that Unearthed is receiving books from KOReader, install the Unearthed plugin in your Obsidian vault.
4. Open the plugin settings in Obsidian and paste in another Unearthed API key, then press "Sync."
5. You can set it to auto-sync each time Obsidian loads, or choose to sync manually from the side panel or the plugin settings.

## Open Source & Contributions

Unearthed.app, the browser extension, the Obsidian plugin, and KOReader plugin are all **open source**. I welcome contributions, feedback, and suggestions from the community. If you'd like to get involved, check out the repositories and feel free to submit a pull request or open an issue.
