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

## Commands

For buttons such as a Stream Deck's: POST to `/command` instead.

| JSON | |
| --- | --- |
| `{"do":"pause"}`, `{"do":"resume"}`, `{"do":"toggle-pause"}` | the Pause switch |
| `{"do":"next"}`, `{"do":"previous"}` | another wallpaper, from the rotation's list (all of them when none are picked) |
| `{"do":"wallpaper","id":"sakura"}` | one wallpaper |

## Jobs

For long work (switch it on in Settings → jobs): POST to `/job` when it starts and when it ends, with the same id.

```sh
curl -X POST http://127.0.0.1:47811/job -d '{"id":"render-1","name":"render","state":"start"}'
curl -X POST http://127.0.0.1:47811/job -d '{"id":"render-1","name":"render","state":"done"}'
```

| `state` | |
| --- | --- |
| `start` | it's running |
| `needs` | it's waiting for you (amber) |
| `done`, `failed` | how it ended (green, red) |
| `end` | forget it, quietly |
