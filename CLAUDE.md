# Regole per Claude in questa repo

- Leggi `STATO-PROGETTO.md` prima di iniziare e aggiornalo alla fine di ogni modifica rilevante.
- L'app gira sul Raspberry Pi (`vito`) insieme ad altre app: non usare porte, nomi di container, volumi, reti o percorsi già usati da altre app. Porte già occupate e dettagli in `STATO-PROGETTO.md`. Questa app usa la porta 8085.
- Il Pi segue `main` e si aggiorna da solo ogni 5 minuti con `update.sh` via cron: mantieni `update.sh` funzionante.
- Flusso: branch, pull request verso `main`, unione con "Create a merge commit".
