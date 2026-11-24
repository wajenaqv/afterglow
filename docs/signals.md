# Send signals from your own scripts

While AfterGlow runs, it listens on your own computer only.

macOS:

```sh
curl -X POST http://127.0.0.1:47811/signal -d '{"source":"build","kind":"new"}'
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:47811/signal -Method Post -Body '{"source":"build","kind":"new"}'
```

Windows Command Prompt:

```bat
curl -X POST http://127.0.0.1:47811/signal -d "{\"source\":\"build\",\"kind\":\"new\"}"
```

| field | |
| --- | --- |
| `source` | a name: `whatsapp`, `gmail`, `build`, … (known apps light up in their own colour) |
| `kind` | `new` (something happened), `unread` (how many are waiting, with `count`), `clear`, `flash` |
| `count` | for `unread` |
| `colour` | optional `#rrggbb` |
| `afterglow` | optional seconds the glow takes to fade (default 4) |

Requests from web pages are refused, so a website can't set your wallpaper off. To try it without writing anything, use the test signals in Settings → apps → advanced.
