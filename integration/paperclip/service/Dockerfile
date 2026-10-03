ARG BASE_IMAGE=node:24.18.0-bullseye
FROM ${BASE_IMAGE}
WORKDIR /opt/hive-paperclip
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
