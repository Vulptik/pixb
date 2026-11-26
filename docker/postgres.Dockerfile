# syntax=docker/dockerfile:1.7
# Standard database image. Rebase deliberately and rerun the container checks in CONTRIBUTING.md.
ARG POSTGRES_BASE=postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
FROM ${POSTGRES_BASE} AS trimmed
COPY docker/trim-postgres.sh /tmp/trim-postgres.sh
RUN sh /tmp/trim-postgres.sh && rm /tmp/trim-postgres.sh

# Copy the resulting filesystem so deleted LLVM files do not survive in layers.
# Preserve the upstream entrypoint, ownership, volume layout, and stop behavior.
FROM scratch
COPY --from=trimmed / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=en_US.utf8 \
    PG_MAJOR=18 \
    PG_VERSION=18.6 \
    PGDATA=/var/lib/postgresql/18/docker
LABEL org.opencontainers.image.title="PixB PostgreSQL (without optional LLVM JIT)" \
    org.opencontainers.image.base.name="postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"
VOLUME /var/lib/postgresql
STOPSIGNAL SIGINT
EXPOSE 5432
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres", "-c", "jit=off"]
