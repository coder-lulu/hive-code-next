ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG STRIP_COMPONENTS=0
COPY codex-package.tar.gz /tmp/codex-package.tar.gz
COPY codex-worker.mjs /opt/hive/codex-worker.mjs
COPY config.toml requirements.toml /etc/codex/
RUN mkdir -p /opt/codex && tar -xzf /tmp/codex-package.tar.gz -C /opt/codex --strip-components=${STRIP_COMPONENTS} && test -x /opt/codex/bin/codex && rm /tmp/codex-package.tar.gz && chmod -R a+rX /opt/codex /opt/hive
USER 1000:1000
WORKDIR /workspace
ENV HOME=/home/hive CODEX_HOME=/home/hive/.codex PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=production ORCA_BACKGROUND_LAUNCH=1
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["/opt/hive/codex-worker.mjs"]
