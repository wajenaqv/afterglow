# Send signals from your own scripts

While AfterGlow runs, it listens on your own computer only:

```sh
curl -X POST http://127.0.0.1:47811/signal -d '{"source":"build","kind":"new"}'
```

| field | |
| --- | --- |
| `source` | a name: `whatsapp`, `gmail`, `build`, … (known apps light up in their own colour) |
| `kind` | `new` (something happened), `unread` (how many are waiting, with `count`), `clear`, `flash` |
| `count` | for `unread` |
| `colour` | optional `#rrggbb` |
| `afterglow` | optional seconds the glow takes to fade (default 4) |

Requests from web pages are refused, so a website can't set your wallpaper off. To try it without writing anything, use **Try a signal** in the tray menu.
