# syntax=docker/dockerfile:1.9
# Контекст збірки — app/ (ізольовано від решти репо). Збирають так:
#   DOCKER_BUILDKIT=1 docker build -f docker/Dockerfile --secret id=npmtoken,src=.npm_token -t <img> app

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Секрет етапу збірки через BuildKit. Токен приватного реєстру монтується ЛИШЕ на час цього RUN
# (/run/secrets/npmtoken, tmpfs) і НЕ осідає:
#   - не в history, на відміну від ARG NPM_TOKEN (той лишається в метаданих образу);
#   - не в шарах, на відміну від COPY токена + rm наступним шаром (rm лишає whiteout, а байти
#     попереднього шару нікуди не діваються).
# .npmrc посилається на ${NPM_TOKEN}; у фінальний образ .npmrc не копіюється взагалі.
RUN --mount=type=secret,id=npmtoken \
    NPM_TOKEN="$(cat /run/secrets/npmtoken)" npm ci --no-audit --no-fund
COPY server.js ./server.js

# ── runtime: distroless, БЕЗ shell, non-root ─────────────────────────────────
# Мета distroless тут не розмір, а те, чого бракує зловмиснику після RCE: sh немає взагалі.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/server.js ./server.js
# USER ЧИСЛОМ (не 'nonroot'): kubelet не резолвить імена, і runAsNonRoot:true + ім'я дало б
# CreateContainerConfigError («image has non-numeric user»).
USER 65532:65532
EXPOSE 8080
# ENTRYPOINT distroless-образу — node; CMD — скрипт → `node server.js`.
CMD ["server.js"]
