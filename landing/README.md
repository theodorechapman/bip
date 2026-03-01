# bip landing (vite + bun)

## local setup

```bash
cd landing
bun install
bun run dev
```

starts vite on default dev server:

- url: `http://localhost:3000`

## scripts

- `bun run dev` — run dev server
- `bun run build` — build production assets to `dist/`
- `bun run preview` — preview production build on `http://localhost:3000`

## structure

- `index.html` — entry html shell
- `src/main.tsx` — react mount
- `src/App.tsx` — page composition
- `src/components/` — all landing sections (hero, features, protocol, etc.)
- `vite.config.ts` — vite config
