# password-mgr (pm)

[English](README.md) · [简体中文](README.zh-CN.md)

A local password manager: one **master password** encrypts all your passwords and API keys into a **single encrypted file**.
It ships both a command-line interface (CLI) and a local web UI, and is built on the [Cordis](https://github.com/cordiverse/cordis) framework.
The CLI, the web UI and this documentation are available in **English and Simplified Chinese** (see [Language](#language)).

```
master password ──scrypt──▶ KEK ──AES-GCM unwrap──▶ DEK ──AES-GCM decrypt──▶ entries
                              (key-encrypting key)      (data-encrypting key)
```

## Features

- 🔐 **Single-file encrypted storage**: AES-256-GCM authenticated encryption; the master password is stretched with scrypt (64 MiB memory cost)
- 🗂️ **Open entry model**: an entry is just title/username/password; everything else lives as free-form key–value pairs in `extra`
  (category, URL, notes and tags are merely conventional keys) — nothing is guessed, nothing is lost
- 🏷️ **Custom categories**: the built-ins (Email / API Key / Website / Other) are suggestions; type any name to create one
  (e.g. "Server" or "Work"). Categories can be added, renamed and deleted from both the CLI and the web UI; an empty category means "uncategorized"
- 🖱️ **Drag to categorize**: in the web UI, drag an entry onto a category to move it (drag onto "Uncategorized" to clear it)
- 🔎 **Filtering and search**: filter by category, search across all extra key–values
- 🖥️ **Two front ends**: the `pm` CLI and the `pm web` local UI (listens on 127.0.0.1 only)
- 🌐 **Bilingual (English / 简体中文)**: CLI output, help and errors, the web UI and the docs; language follows the system locale and can be overridden with `--lang` or `PM_LANG`
- 🎲 **Password generator**: configurable length, character sets and ambiguous-character exclusion
- 📋 **Clipboard copy**: `pm cp <entry>` puts the password straight into the system clipboard
- 📥 **Import / export**: plaintext JSON and CSV for backup and migration
- 🔒 **Encrypted copy**: export a pmvault backup protected by the same master password (CLI and web UI); safe to store, and it can be imported back
- 🔑 **Changing the master password does not re-encrypt data**: the data key (DEK) is separate, so a password change only rewraps the DEK
- 🛡️ **Integrity protection**: tamper detection, a cross-process file lock (concurrent writes no longer silently lose data), and an automatic `.bak` before every overwrite
- 🧯 **No dirty state on write failures**: every change lands on a draft copy first and is committed to memory only after the write succeeds
- 📦 **Zero build**: Node runs the TypeScript sources directly; no bundler, very few dependencies

## Install

Requires Node.js >= 23.6 (native TypeScript support).

```bash
npm install          # install dependencies
npm link             # optional: link the pm command globally
```

You can also run it without installing: `node bin/pm.js <command>` or `npm run pm -- <command>`.

## Quick start

```bash
pm init                                  # create the vault and set the master password
pm add website GitHub -u me@example.com -g --url https://github.com -t dev
pm add                                   # no arguments = interactive wizard
pm ls                                    # list entries (passwords masked)
pm get GitHub --show                     # show details with the password revealed
pm cp GitHub                             # copy the password to the clipboard
pm web                                   # open the local web UI
```

## Commands

| Command | Description |
| --- | --- |
| `pm init` | Create the vault (sets the master password; `--force` overwrites an existing file) |
| `pm add [category] [title]` | Add an entry; `-u` username, `-p` password, `-g` generate, `--url`, `-n` note, `-t` tag, `-e key=value` arbitrary extra fields |
| `pm ls [category]` | List entries; the category can be any custom name or `uncategorized`/`none`, `-q` keyword filter, `--json` JSON output |
| `pm cat [list]` | Category overview (category / value / built-in or custom / entry count) |
| `pm cat add <name>` | Register a custom category (even if it has no entries yet) |
| `pm cat rename <old> <new>` | Rename a category and update the entries that use it |
| `pm cat rm <name>` | Delete a category; its entries become uncategorized (built-ins can be removed too — re-add the same name to restore) |
| `pm get <query>` | Show an entry; `--show` reveals the password, `-c` copies it, `-f <field>` prints one field (a core field or any extra key), `--json` |
| `pm cp <query>` | Copy the password to the clipboard |
| `pm edit <query>` | Edit an entry; `-e key=value` sets extra fields, `--clear <key>` clears one; with no options it goes interactive |
| `pm rm <query>` | Delete an entry (asks for confirmation in interactive mode) |
| `pm gen` | Generate random passwords; `-l` length, `-c` count, `--no-symbols`, `--no-ambiguous`, `--copy` |
| `pm passwd` | Change the master password |
| `pm export [file]` | Export; `--format json\|csv` is plaintext, `--format vault` exports an encrypted copy (no unlock needed); without a file it goes to stdout |
| `pm import <file>` | Import from JSON/CSV or a pmvault encrypted backup (auto-detected; the backup asks for its own master password; duplicates are skipped by default) |
| `pm web` | Start the local web UI: `-p` port, `--auto-lock` idle minutes, `--no-open` |
| `pm info` | Show the vault path, status and per-category counts |
| `pm help [command]` | Show help |

Category names are free-form strings: the four built-ins accept either language (`email`/`邮箱`, `apikey`/`api`, `website`/`网站`, `other`/`其他`), and anything else is kept verbatim as a custom category (`pm add server aliyun-ecs -u root`). A category is optional.
An entry query matches the id, an exact title, or a fuzzy match over the title, username and all extra keys and values.

**Global options** (must come before the command): `-F, --file <path>` selects the vault file (or set `PM_VAULT`),
`--lang <en|zh>` selects the output language (or set `PM_LANG`). The default vault lives at `~/.password-mgr/vault.json`.

**Piping** (script-friendly: in non-interactive mode the master password is read as one line from stdin):

```bash
printf 'master-password\n' | pm get GitHub -f password
pm gen -l 32 | pbcopy
# importing an encrypted backup: line 1 is the current vault password, line 2 the backup's
printf 'master-password\nbackup-master-password\n' | pm import backup.pmv
```

## Language

Everything user-facing is bilingual (English and Simplified Chinese): CLI command descriptions, prompts, error messages,
the web UI, and these docs.

- Default: the CLI detects `PM_LANG`, then POSIX `LANGUAGE` / `LC_ALL` / `LC_MESSAGES` / `LANG`, then the system locale;
  anything that is not `en*` or `zh*` falls back to English (`C`/`POSIX` mean English).
- Override per command with `--lang en` / `--lang zh` (this takes precedence over all environment variables).
- Override per shell with `export PM_LANG=zh` (or `=en`).
- In the web UI, use the language selector in the top bar or on the unlock card; the choice is stored in the browser and
  also switches the server-side language, so API error messages and the next page load stay in the selected language.

```bash
pm --lang zh --help          # Chinese help
PM_LANG=zh pm ls             # Chinese output
LANG=zh_CN.UTF-8 pm ls       # follows the system locale
```

Machine-readable output is never translated: `--json`, `-f/--field`, raw `gen` output and exports are locale-independent.

## Web UI

```bash
pm web                    # prints an access URL containing a token
pm web -p 8080 --auto-lock 5
```

Security design (for local use):

- Listens on the loopback address only; binding elsewhere asks for confirmation (it would expose your passwords to the LAN)
- Generates a random access token at startup. Open the printed URL once (`http://127.0.0.1:3170/?token=…`); the token stays in that tab, so refreshing the same tab works. A new tab needs the full URL again. API requests must carry the token in the `X-Vault-Token` header. The page shell itself contains no vault data
- Validates the `Host`, `Origin`, and `Sec-Fetch-Site` headers to block DNS rebinding, other local ports, and cross-site requests
- The list endpoint never sends password fields; only viewing a single entry returns them
- Idle auto-lock (10 minutes by default); the DEK lives only in the Node process memory

The web UI's "Export" offers plaintext JSON/CSV and an **encrypted copy** (pmvault, same master password);
"Import" accepts JSON / CSV / pmvault backups (an encrypted backup asks for its master password).

## Entry model

An entry has three core fields; everything else goes into `extra`:

```jsonc
{
  "title": "Godaddy",
  "username": "h2p74f...",          // optional
  "password": "VvQn8D4...",         // optional
  "extra": {                        // arbitrary keys; all values are strings
    "category": "apikey",           // conventional key: category (email/apikey/website/other)
    "url": "https://...",           // conventional key: URL
    "notes": "…",                   // conventional key: notes
    "tags": "dns|api",              // conventional key: tags, separated by |
    "SecretId": "AKID...",          // any other key you like
    "environment": "prod"
  }
}
```

In the CLI, use `-e key=value` (repeatable) to read and write arbitrary keys, and `pm get <entry> -f <key>` to print one value.
The web UI detail view lists every extra key, and the entry dialog has a dedicated "Extra fields" input.

Categories work the same way: `extra.category` can be anything. **Drag an entry onto a category in the sidebar to categorize it**
(drag onto "Uncategorized" to clear it). The **＋ New** button at the top of the category list creates one; selecting a category
reveals **Rename / Delete**. The category input in the entry dialog also accepts a brand-new name (with suggestions for existing ones).
Built-in categories can be renamed or deleted too (deleting removes them from the list and makes their entries uncategorized; re-create the name to restore).
New categories are registered automatically; `pm cat add` creates an empty one ahead of time.

Import files follow the same structure, for example:

```json
{ "version": 2, "entries": [
  { "title": "Godaddy", "username": "…", "password": "…",
    "extra": { "category": "apikey", "notes": "key/secret from the dashboard" } }
] }
```

Legacy shapes are accepted: top-level `category`/`url`/`notes`/`tags` on an entry (JSON) or the matching CSV columns are folded into `extra`.

## Encrypted backup (pmvault)

`pm export --format vault backup.pmv` (web UI: "Export → Download encrypted copy") writes an **encrypted copy**:
it is a complete vault file (AES-256-GCM, protected by the master password) with no plaintext inside, safe to upload or store off-site.
Exporting only copies the current file, **does not ask for the master password**, and does not touch the main vault.

- **Full restore**: use the copy as a vault file — copy it over `~/.password-mgr/vault.json`, or run `pm -F backup.pmv <command>`; the master password stays the same.
- **Merge back**: `pm import backup.pmv` asks for the backup's master password and merges its entries into the current vault
  (duplicates are skipped by default; `--keep-duplicates` keeps them; creation timestamps are preserved).
- The copy shares the master password with the vault: forget the password and neither can be recovered.

## File format

```jsonc
{
  "format": "pmvault",
  "version": 2,
  "kdf":     { "algo": "scrypt", "N": 65536, "r": 8, "p": 1, "salt": "…" },
  "wrapped": { "algo": "aes-256-gcm", "iv": "…", "tag": "…", "data": "…" },  // DEK wrapped by the KEK
  "vault":   { "algo": "aes-256-gcm", "iv": "…", "tag": "…", "data": "…" },  // entries encrypted by the DEK
  "meta":    { "createdAt": "…", "updatedAt": "…" }
}
```

`version: 1` files are still readable: unlocking folds the old category/url/notes/tags into `extra`, and the next write upgrades them to v2.

The ciphertexts are bound to their roles with different additional authenticated data (AAD), so `wrapped` and `vault` cannot be swapped.
Files are written with mode `0600` and the directory with `0700`; every overwrite keeps a `.bak` copy; writes use an atomic "temp file + rename".

Writes take an exclusive `<file>.lock` covering the whole "read → verify → write → rename" sequence: if another `pm` process is writing,
this process gets a clear conflict message instead of silently overwriting. Locks left behind by a crash are cleaned up after 10 seconds.
KDF parameters are range-checked on read, so a maliciously crafted vault cannot trigger unbounded memory allocation.

## Security boundaries (please read)

- **Forgetting the master password means the data is permanently unreadable.** There is no backdoor and no recovery key; this is deliberate.
- The master password is entered **through channels other than the command line** (a hidden prompt), but the `-p` option exposes it
  to your shell history and process list — use it for testing only.
- After unlocking, the DEK and plaintext entries live in process memory; the code does its best to wipe key buffers, but JavaScript strings
  cannot be reliably zeroed — **memory dumps and debuggers are out of scope**.
- Cloud-synced folders (iCloud/Dropbox) only ever see the encrypted file, which is safe; **the encrypted copy (`.pmv`) is equally safe**
  since it is just a complete copy of the vault file; but **exported JSON/CSV is plaintext**, so delete it when you are done.
- Clipboard contents are not cleared automatically.
- This tool protects against "file leaks" and offline brute force; it does not protect a compromised machine (keyloggers, memory scraping, …).

## Project structure

```
src/
  index.ts            entry point: global options + locale resolution + Cordis assembly
  i18n/               message catalog (en.ts is the source of truth, zh.ts is type-checked against it)
  cli/                localized help rendering and error/type messages
  crypto.ts           scrypt / AES-256-GCM / password generator primitives
  types.ts            entry model (title/username/password + extra) and category conventions
  serialize.ts        JSON / CSV import and export (extra key–value round-trip)
  plugins/
    vault.ts          Vault service: crypto, persistence, CRUD (ctx.vault)
    commands.ts       CLI command plugin (injects cli, vault)
    web.ts            web UI plugin (injects server, vault; provides ctx.webui)
  web/ui.ts           self-contained single-page UI (no external resources; drag-and-drop and category editing included)
  utils/              hidden input, clipboard, terminal formatting
test/                 node:test unit tests (plus CLI end-to-end and i18n catalog checks)
```

Cordis usage: `Vault` and `WebUI` are `Service`s; `commands`/`web` declare their dependencies via `inject`;
every route, event listener and timer is registered inside its plugin's fiber and disposed with it; `schemastery` validates plugin config.

## Testing

```bash
npm test          # node:test (crypto / vault / serialization / i18n / web UI / CLI)
npm run typecheck # tsc --noEmit
```
