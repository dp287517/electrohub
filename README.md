# ElectroHub

A professional, responsive app for electrical engineering workflows (ATEX, Obsolescence, Selectivity, Fault Level Assessment, Arc Flash).

## Local development
```bash
npm install
npm run dev  # http://localhost:5173
```
Full-stack preview (build + serve):
```bash
npm run build
npm start    # http://localhost:3000
```

## Deployment on Render
- Branch: main
- Build: `npm install && npm run build`
- Start: `npm start`
- Environment variables:
  - `NEON_DATABASE_URL`
  - `JWT_SECRET`
  - `OPENAI_API_KEY` (optional)

## Next steps
- Implement Neon-backed auth and site/department scoping middleware.
- Add app routes for ATEX, Obsolescence, Selectivity, Fault Level Assessment, Arc Flash.
- Connect OpenAI assistants for guided flows.
