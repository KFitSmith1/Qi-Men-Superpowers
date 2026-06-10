FROM node:20-slim

# The Qi Men engine is pure Bash; node:20-slim (Debian) ships bash already.
# A UTF-8 locale is required for the engine's multibyte Chinese parsing.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production \
    PORT=8787

WORKDIR /app
COPY engine/ engine/
COPY server/ server/
COPY web/ web/

RUN chmod +x engine/tools/bin/*.sh

EXPOSE 8787
USER node
CMD ["node", "server/src/index.js"]
