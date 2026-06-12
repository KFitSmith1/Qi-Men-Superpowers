FROM node:20-slim

# The Qi Men engine is pure Bash; node:20-slim (Debian) ships bash already.
# A UTF-8 locale is required for the engine's multibyte Chinese parsing.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production \
    PORT=8787

WORKDIR /app

# poppler-utils provides `pdftotext`/`pdftoppm` for PDF ingestion; tesseract
# (with English + Chinese packs) OCRs scanned/image-only PDFs as a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
    && rm -rf /var/lib/apt/lists/*

COPY engine/ engine/
COPY server/ server/
COPY web/ web/

RUN chmod +x engine/tools/bin/*.sh

EXPOSE 8787

# Container-level health probe (no curl/wget needed in node:slim).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER node
CMD ["node", "server/src/index.js"]
