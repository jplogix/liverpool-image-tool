# Liverpool

Static frontend deployment for Dokploy.

## Dokploy

Use the Dockerfile deployment type.

- Build context: `.`
- Dockerfile: `Dockerfile`
- Container port: `80`
- Health check path: `/healthz`

The repository currently deploys the prebuilt `dist` directory. Rebuild the frontend before deploying if the app source is restored later.
